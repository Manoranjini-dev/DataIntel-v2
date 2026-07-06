# MCP Toolbox for Databases — Detailed Implementation Plan (DataIntel v2)

> **Status:** Implementation-ready · **Branch:** `phase-2` · **Date:** 2026-07-06
> **Locked decisions:** Credential delivery = generated `tools.yaml` (0600 / tmpfs) · Scope = hot query path only (MySQL, Postgres, BigQuery) · Routing = deterministic per-connection source key · Strangler rollout behind a feature flag with automatic legacy fallback.

This plan is grounded in the **actual** code, not the aspirational README. Where the earlier draft named things that don't exist in the repo, the corrections are called out inline as **[CORRECTION]**.

---

## 0. TL;DR

Adopt Google's [MCP Toolbox for Databases](https://github.com/googleapis/mcp-toolbox) as an **external sidecar** that owns connection-pooling and read-only query execution for the SQL "hot path." Keep `MCPService` as the single facade every consumer talks to; internally it becomes a **router** that sends `executeReadQuery` to Toolbox for supported connectors and falls back to the existing native connectors on any error. Schema introspection, Databricks, Fabric, Mongo, and Elasticsearch stay on the native path.

This is a **hybrid, additive change**. No public `MCPService` signature changes. No DB migration required for Phase A. One env flag (`TOOLBOX_ENABLED`) turns the whole thing on or off.

---

## 1. Ground truth — how the code actually works today

### 1.1 What "MCP" is
`backend/src/mcp/` is an **in-process abstraction**, not an external MCP server. `MCPService` ([mcp.service.ts](backend/src/mcp/mcp.service.ts)) holds a `connectorRegistry: Map<ConnectorType, IMCPConnector>` of 10 driver classes in [mcp/connectors/](backend/src/mcp/connectors). The JSON-RPC layer (`handleJsonRpc`, `listTools`, `callTool`) is **dead code** — nothing external consumes it. Adopting Toolbox introduces a real external server for the first time.

### 1.2 The session lifecycle (Pattern 1 — stateless per request)
Every consumer follows the exact same three-call dance:

```ts
const session = await this.mcpService.createSession({ host, port, username, password, database, connectorType });
const result  = await this.mcpService.executeReadQuery(session.sessionId, sql);
await this.mcpService.destroySession(session.sessionId).catch(() => {});
```

- `createSession(params)` test-connects, checks `getCapabilities().readOnly`, generates a random `connectorId` (UUID) + `sessionId` (UUID), AES-256-CBC-encrypts the password with a **process-lifetime runtime key** (`mcp.service.ts:62-64`), and stores it in the in-memory `activeParams` map. **There is no live socket** — the native connector reconnects/queries/disconnects per call.
- `executeReadQuery(sessionId, sql)` resolves params from `activeParams`, calls `connector.executeReadQuery(params, sql, timeout)`, returns `MCPToolResult<MCPQueryResult>`.

### 1.3 **[CORRECTION]** — the session does *not* carry the persisted connection id
`MCPSession` ([mcp/types/index.ts:13](backend/src/mcp/types/index.ts)) has `{ sessionId, connectorId, connectorType, params(no pw), capabilities, isActive, createdAt }`. `connectorId` is a **random UUID**, unrelated to the persisted `datasource_connections.id`. `ConnectionParams` ([common/types/index.ts:43](backend/src/common/types/index.ts)) is `{ host, port, username, password, database, connectorType, ssl?, connectionOptions? }` — also **no id**.

Consequence: to bind a request to a Toolbox source named `conn_<id>`, we would otherwise have to thread the persisted id through **six call sites**. We avoid that with a **deterministic source key** (§3).

### 1.4 Consumers of `MCPService` (all preserved, untouched)
`grep` for `createSession`/`executeReadQuery` gives the full blast radius:
- [chat/chat-query.service.ts](backend/src/chat/chat-query.service.ts) — 4 sites
- [chat/chat-stream.controller.ts](backend/src/chat/chat-stream.controller.ts)
- [combo/combo-executor.service.ts](backend/src/combo/combo-executor.service.ts)
- [dashboard/widget-execution.service.ts](backend/src/dashboard/widget-execution.service.ts)
- [dashboard/default-cards.service.ts](backend/src/dashboard/default-cards.service.ts)
- [query/query.service.ts](backend/src/query/query.service.ts) — uses `getSession` + `executeReadQuery`
- [connection/persistent-connection.service.ts](backend/src/connection/persistent-connection.service.ts) — schema sync via `getSchema()`

Each caller reads a row from `datasource_connections`, decrypts the password, and passes raw params into `createSession`. **They all already have the connection id in scope** (e.g. `widget-execution.service.ts:133` selects `SELECT * FROM datasource_connections WHERE id=$1`), which is why the deterministic-key approach is cheap and the id-threading approach is *also* available if we ever want per-connection telemetry.

### 1.5 **[CORRECTION]** — credential storage is a util, not a "CredentialVaultService"
There is **no** `CredentialVaultService` and **no per-org HKDF sub-key**. Credentials at rest are handled by [common/utils/encryption.ts](backend/src/common/utils/encryption.ts): `encrypt/decrypt` using **AES-256-GCM** with a single `CREDENTIAL_ENCRYPTION_KEY` (hex) env var, stored as `iv:tag:ciphertext`. Persisted connections live in the `datasource_connections` table (raw SQL via `persistent-connection.service.ts`), columns: `id, name, connector_type, host, port, database_name, username, encrypted_password, ssl_enabled, connection_options, created_by, deleted_at`. This still satisfies NFR "credentials encrypted at rest (AES-256)".

### 1.6 Read-only safety (already layered)
`node-sql-parser` AST validator (10 rules, select-only, auto `LIMIT 500`, join-validation) in [validation/](backend/src/validation) **+** connector `getCapabilities().readOnly`. Config: `MCP_EXECUTION_TIMEOUT_MS=30000`, `MCP_MAX_RESULT_ROWS=500` ([env.validation.ts:30-34](backend/src/common/config/env.validation.ts)).

### 1.7 Infra reality
- `@nestjs/event-emitter@3.1.0` and `@nestjs/config@3.2.0` are **already installed** → debounced regeneration via events is feasible.
- **Not installed:** `@toolbox-sdk/core`, `js-yaml`, `ioredis`. We'll add `@toolbox-sdk/core` (or use plain HTTP) and `js-yaml`.
- [docker-compose.yml](docker-compose.yml) currently defines only `backend` + `frontend` (Postgres is external Neon, Redis optional). We add a `toolbox` service + a shared config volume.

---

## 2. What Toolbox gives us, and the gaps

- Standalone Go server (`us-central1-docker.pkg.dev/database-toolbox/toolbox/toolbox`), **port 5000**, config via `tools.yaml` (`sources:` + `tools:`), **hot-reloads** on file change.
- **Prebuilt generic tools** per source: `execute_sql`, `list_tables`. We map `executeReadQuery → *-execute-sql`.
- **TypeScript SDK** `@toolbox-sdk/core` (`ToolboxClient.loadTool()`), or plain `POST /api/tool/{tool}/invoke`.
- Native sources we care about: **PostgreSQL, MySQL, BigQuery** (also SQL Server, Oracle, Snowflake — future).

**Toolbox execute-sql support across our 10 connectors** (verified against the repo's `integrations/*/tools/*-execute-sql.md`):

| Connector | Toolbox source | Tool kind | Path |
|---|---|---|---|
| MySQL | `mysql` | `mysql-execute-sql` | ✅ Toolbox |
| Postgres | `postgres` | `postgres-execute-sql` | ✅ Toolbox |
| Redshift | `postgres` (wire-compatible) | `postgres-execute-sql` | ✅ Toolbox (validate) |
| BigQuery | `bigquery` | `bigquery-execute-sql` | ✅ Toolbox (ADC/SA) |
| SQL Server / **Fabric** | `mssql` | `mssql-execute-sql` | ✅ Toolbox (Fabric needs validation) |
| Oracle | `oracle` | `oracle-execute-sql` | ✅ Toolbox |
| Snowflake | `snowflake` | `snowflake-execute-sql` | ✅ Toolbox |
| Databricks | — | — | ❌ native only |
| MongoDB | `mongodb` (non-SQL) | `mongodb-find`/… | ❌ native only |
| Elasticsearch | `elasticsearch` (non-SQL) | es-* | ❌ native only |

**[IMPLEMENTED]** All seven SQL connectors above are handled by `toolbox-source.mapper.ts`. Redshift is mapped onto the `postgres` source; Snowflake account→`host`, Oracle serviceName→`database`, MSSQL server→`host` (matching the native connectors). Hence **hybrid is unavoidable** — Databricks + the two non-SQL sources always take the native path.

---

## 3. The central engineering challenge & chosen solution

**Toolbox `sources` are static in `tools.yaml` at boot. DataIntel registers connections dynamically at runtime.** Bridge = **backend-owned config generator + hot reload**.

**Source/tool naming — deterministic key (the key refinement vs the draft).**
Because `createSession` receives raw params without an id (§1.3), we compute a stable key **from the params**:

```
sourceKey = "conn_" + sha256(`${connectorType}|${host}|${port}|${database}|${username}`).slice(0,16)
```

- `ToolboxConfigService` emits one `source` (`<sourceKey>`) and one tool (`<sourceKey>__execute_sql`) per active supported connection, using the **same** hash function.
- `MCPService.executeReadQuery` computes the key from the session's stored params and invokes `<sourceKey>__execute_sql`. **No caller changes, no signature changes, no id threading.**
- Password is *not* in the hash (rotation shouldn't change the source name); a rotation just rewrites the file for the same key.

*Rejected alternatives:* one Toolbox process per connection (too heavy); passing creds at call-time (unsupported — sources are static); threading persisted `connectionId` through all six call sites (works but needlessly invasive — keep as optional Phase B for telemetry).

---

## 4. Target architecture

```
┌──────────────── NestJS backend (consumers UNCHANGED) ────────────────┐
│ ChatQuery · ComboExecutor · WidgetExecution · DefaultCards · Query    │
│                     │  (identical MCPService API)                      │
│              ┌───────▼────────┐                                        │
│              │   MCPService   │  ← ROUTER / FACADE (only file changed  │
│              │  route by type │     on the hot path)                   │
│              └──┬──────────┬──┘                                        │
│    toolbox path │          │ legacy native path                       │
│        ┌────────▼───┐  ┌───▼──────────────────┐                       │
│        │ Toolbox    │  │ existing *.connector  │ (Databricks, Fabric,  │
│        │ ClientSvc  │  │ classes (10)          │  Mongo, ES, fallback) │
│        └─────┬──────┘  └───────────────────────┘                       │
│   ┌──────────▼───────────────┐        encryption.ts (encrypt/decrypt,  │
│   │ ToolboxConfigService      │        CREDENTIAL_ENCRYPTION_KEY)       │
│   │ writes tools.yaml on      │        datasource_connections (source   │
│   │ connection change         │        of truth, unchanged)            │
└───┼───────────────────────────┼────────────────────────────────────────┘
    │ file 0600 / tmpfs         │
┌───▼────────────────────┐      │
│  MCP Toolbox (sidecar)  │ ── pools ──► External DBs (MySQL / PG / BQ)
│  :5000  hot-reload      │
└─────────────────────────┘
```

`sessionId` stays a logical handle; there's no live socket because Toolbox pools. On the Toolbox path we don't even need the in-memory password (Toolbox holds it via the file) — but we keep `activeParams` populated because the **fallback** path still needs it.

---

## 5. Credential handling — **LOCKED: generated `tools.yaml`, 0600 / tmpfs**

Moving execution to Toolbox means the decrypted password must reach the Toolbox process. Decision: backend writes a **locked-down, co-located config file**.

**Guardrails:**
- `encryption.ts` + `CREDENTIAL_ENCRYPTION_KEY` remains the **at-rest source of truth** (AES-256-GCM in `datasource_connections`). The generated `tools.yaml` is a transient live handle only.
- File written **atomically**: write `tools.yaml.tmp` → `fsync` → `chmod 600` → `rename` (rename is atomic on POSIX; on the Linux sidecar volume this is fine even though the backend host is Windows in dev).
- Sidecar co-located in the same trust boundary; the config volume is not exposed to other services; **the file contents are never logged** (log the source *count*, never values).
- Satisfies NFR "credentials encrypted at rest (AES-256)" — at-rest store unchanged.
- *Future:* external secret manager (Google Secret Manager / Vault) for managed cloud deploys.

*Not chosen:* env-var interpolation (new runtime connections would need a Toolbox restart).

---

## 6. Component-by-component changes

### New — `backend/src/mcp/toolbox/`

| File | Responsibility |
|---|---|
| `toolbox.constants.ts` | `sourceKeyFor(params)` hash helper; `TOOLBOX_SUPPORTED = {mysql, postgres, bigquery}`; kind maps. |
| `toolbox-source.mapper.ts` | `ConnectorType → { sourceKind, toolKind, fields }`. mysql→`mysql`/`mysql-execute-sql`; postgres→`postgres`/`postgres-execute-sql`; bigquery→`bigquery`/`bigquery-execute-sql` (service-account JSON from vaulted password **or** ADC/OAuth). |
| `toolbox-config.service.ts` | Query active supported connections → decrypt → build YAML (`js-yaml`) → atomic write. Debounced (~500ms) regeneration. `OnModuleInit` bootstrap + health-wait. |
| `toolbox-client.service.ts` | Wraps `@toolbox-sdk/core` (or HTTP `POST /api/tool/{tool}/invoke`). `invokeExecuteSql(sourceKey, sql)`; `isHealthy()` (cached, short TTL) for the routing guard; enforce statement timeout. |
| `toolbox-result.normalizer.ts` | Map Toolbox response → existing `MCPQueryResult` `{ rows, columns, rowCount, executionTimeMs, totalHits? }` so downstream is untouched. |

### Modified (only three source files + config/compose)
- [mcp/mcp.service.ts](backend/src/mcp/mcp.service.ts) — `executeReadQuery` (and optionally `testConnection`) consult a routing decision (§10) and delegate to Toolbox or legacy. **Signatures unchanged.** Compute `sourceKey` from session params.
- [mcp/mcp.module.ts](backend/src/mcp/mcp.module.ts) — provide the 3 new services; import `EventEmitterModule` if not already global; startup hook.
- [common/config/env.validation.ts](backend/src/common/config/env.validation.ts) — add + validate the new env vars (§8) on the `EnvironmentVariables` class.
- [connection/persistent-connection.service.ts](backend/src/connection/persistent-connection.service.ts) — emit lifecycle events (`connection.created/updated/deleted/credentials_rotated`) after the existing create/update/delete/rotatePassword writes, so `ToolboxConfigService` can regenerate. (Alternative: call `toolboxConfig.scheduleRegen()` directly — fewer moving parts than events; pick one, events preferred for decoupling.)
- [docker-compose.yml](docker-compose.yml) + `backend/package.json`.

### Untouched by design
All of `chat/`, `combo/`, `dashboard/`, `query/`, `schema/`, `validation/`, and **every `*.connector.ts`** (legacy path preserved as fallback).

---

## 7. Schema introspection — stays native (do NOT move to Toolbox)

Toolbox's prebuilt `list_tables` **does not reliably return FK/PK/index metadata**, which the app needs for the ERD, the compressed LLM schema string, and the AST validator's join-validation rule. Therefore:

- **Keep `describeSchema` / `getSchema` on native drivers.** It already produces rich `SchemaMetadata`, runs rarely (only on sync), and is cached. Low risk, high value.
- *Optional later:* custom Toolbox tools per dialect querying `information_schema` — out of scope for Phase A.

**Net: only `executeReadQuery` moves to Toolbox in Phase A.**

---

## 8. Deployment & configuration

### `docker-compose.yml` — add sidecar + shared volume
```yaml
  toolbox:
    image: us-central1-docker.pkg.dev/database-toolbox/toolbox/toolbox:latest
    command: ["--tools-file","/config/tools.yaml","--address","0.0.0.0","--port","5000"]
    volumes:
      - toolbox-config:/config:ro          # backend writes, toolbox reads
    ports: ["5000:5000"]
    networks: [app-network]
    restart: unless-stopped

  backend:
    # ...existing...
    volumes:
      - toolbox-config:/config:rw          # backend writes tools.yaml here
    depends_on: [toolbox]

volumes:
  toolbox-config:                          # mount as tmpfs in prod
```

### New env vars (add to `EnvironmentVariables`, all `@IsOptional`)
| Var | Default | Purpose |
|---|---|---|
| `TOOLBOX_ENABLED` | `false` | Master kill-switch. |
| `TOOLBOX_URL` | `http://toolbox:5000` | Sidecar base URL. |
| `TOOLBOX_CONFIG_PATH` | `/config/tools.yaml` | Where the generator writes. |
| `TOOLBOX_ROUTED_CONNECTORS` | `mysql,postgres,bigquery` | Allowlist for routing. |
| `TOOLBOX_STATEMENT_TIMEOUT_MS` | `30000` | Mirror of `MCP_EXECUTION_TIMEOUT_MS`. |
| `TOOLBOX_MAX_ROWS` | `500` | Mirror of `MCP_MAX_RESULT_ROWS`. |
| `TOOLBOX_HEALTH_TTL_MS` | `5000` | `isHealthy()` cache TTL. |

### Dependencies
```
cd backend && npm i js-yaml && npm i -D @types/js-yaml
```
**[IMPLEMENTED]** The client uses the **stable HTTP contract** (`POST /api/tool/{name}/invoke`, body `{sql}`, response `{result:"<json>"}`) via Node's global `fetch` — **not** `@toolbox-sdk/core` — to avoid depending on the under-documented SDK invoke signature. Only `js-yaml` is added. Tool kinds confirmed against the repo: `mysql-execute-sql`, `postgres-execute-sql`, `bigquery-execute-sql` (single `sql` param). `tools.yaml` uses the canonical map style (`sources:` / `tools:`). Default `TOOLBOX_ROUTED_CONNECTORS=mysql,postgres` (BigQuery added after SA-JSON/ADC wiring is validated).

### Windows-dev note
Backend dev runs on Windows; the sidecar is Linux-only. For local dev either (a) run Toolbox via Docker Desktop and point `TOOLBOX_URL` at it with `TOOLBOX_CONFIG_PATH` on a bind-mounted path, or (b) keep `TOOLBOX_ENABLED=false` locally and exercise Toolbox only in CI/staging containers. Atomic-rename semantics differ on Windows (rename over existing file throws `EEXIST`) → the writer must `unlink`-then-`rename` or use `fs.renameSync` with a platform guard. Bake this into `toolbox-config.service.ts`.

---

## 9. Security & read-only layering (guarantees unchanged, one layer added)

1. `ValidationPipe` (whitelist) →
2. AST 10-rule validator (select-only, auto `LIMIT 500`, join-validation) →
3. human approval where configured →
4. re-validate on execute →
5. **Toolbox read-only `execute_sql` tool** (new) →
6. read-only DB user credentials.

Row cap: keep enforcing `LIMIT 500` via the validator (we send SQL text) and mirror `TOOLBOX_MAX_ROWS` in tool config. Satisfies NFR read-only + PRD **AI-05** (no write ops).

---

## 10. Routing & rollout (strangler)

**Routing decision inside `MCPService.executeReadQuery`:**
```ts
private useToolbox(type: ConnectorType): boolean {
  return this.toolboxEnabled
      && this.routedConnectors.has(type)
      && this.toolboxClient.isHealthy();   // cached
}

async executeReadQuery(sessionId: string, sql: string): Promise<MCPToolResult<MCPQueryResult>> {
  const session = this.sessions.get(sessionId);
  if (!session || !session.isActive) return { success:false, error:'No active session found', executionTimeMs:0 };
  const params = this.resolveConnectionParams(session.connectorId);
  if (!params) return { success:false, error:'Connection params not found', executionTimeMs:0 };

  if (this.useToolbox(session.connectorType)) {
    try {
      const sourceKey = sourceKeyFor(params);
      return await this.toolboxClient.invokeExecuteSql(sourceKey, String(sql)); // normalized inside
    } catch (e) {
      this.logger.warn(`Toolbox path failed, falling back to native: ${e.message}`);
      this.audit?.log?.({ eventType:'query_fallback', details:{ transport:'toolbox', connectorType: session.connectorType } });
      // fall through to legacy
    }
  }
  const connector = this.getConnector(session.connectorType);
  return connector.executeReadQuery(params, String(sql), this.executionTimeout);
}
```
**Any Toolbox error → fall back to legacy + audit.** A Toolbox outage never breaks queries.

- **Order of migration:** (1) `mysql` + `postgres` (best-tested), then (2) `bigquery`. Databricks / Fabric / Mongo / ES stay native.
- **Verification per connector — shadow-diff:** run the same SQL on both paths behind a flag, diff row counts/columns in a staging org before flipping the allowlist.
- **Rollback:** flip `TOOLBOX_ENABLED=false` (or remove a connector from `TOOLBOX_ROUTED_CONNECTORS`). No schema migration, no redeploy of app code.

---

## 11. Phase 2 PRD connector mapping (traceability)

| PRD | Connector | Toolbox? | Plan |
|---|---|---|---|
| **DS2-01** | BigQuery | ✅ native `bigquery-execute-sql` | Route via Toolbox; mapper supports **service-account JSON** and **OAuth/ADC**. |
| **DS2-02** | Databricks | ❌ unsupported | Keep native `@databricks/sql` (PAT) on legacy path. |
| **DS2-03** | Microsoft Fabric | ⚠️ no first-class source | Try Toolbox `mssql` source → Fabric SQL-analytics endpoint via **service principal**; flag *needs-validation*. Fallback: native `mssql`. |
| **DS2-04** | All P1 features on P2 connectors | ✅ | Full-table / custom-query / preview / sharing / scheduled-refresh all funnel through `executeReadQuery` → inherited automatically. |
| **AI-01..05** | NL chat, any-visual, save-as-card, add-to-dashboard, **no writes** | ✅ | ChatQuery already funnels through `executeReadQuery`; AI-05 enforced by AST validator + Toolbox read-only tool + read-only creds (§9). |

**Out of scope for *this* plan** (independent Phase-2 workstreams): SSO (SSO-01..05), advanced visuals (funnel/scatter/donut/gauge/map/matrix/custom measures — §4.3 PRD), dashboard PDF/PPTX export (DB2-01/02), iframe embed (DB2-03), mobile layout (DB2-04). Toolbox touches the **data layer only**.

---

## 12. Detailed work breakdown (Phase A)

**Step 1 — Sidecar + plumbing**
- Add `toolbox` service + `toolbox-config` volume to `docker-compose.yml`; mount `rw` on backend, `depends_on`.
- Add 7 env vars to `EnvironmentVariables` (§8), all optional with defaults.
- `npm i @toolbox-sdk/core js-yaml` (+ `@types/js-yaml`).

**Step 2 — `toolbox.constants.ts` + `toolbox-source.mapper.ts`**
- `sourceKeyFor(params)` (sha256, 16-hex slice).
- Mapper for mysql / postgres / bigquery kinds + field shapes; BigQuery: detect JSON-in-password vs ADC.

**Step 3 — `ToolboxConfigService`**
- `SELECT ... FROM datasource_connections WHERE deleted_at IS NULL AND connector_type = ANY($routed)`; decrypt each via `decrypt(encrypted_password, encKey)`.
- Build `{ sources, tools }`, `js-yaml.dump`, atomic write (tmp → fsync → chmod 600 → rename; Windows-safe unlink-then-rename guard).
- Debounced `scheduleRegen()` (~500ms) subscribed to `@OnEvent('connection.*')`.
- `OnModuleInit`: generate once, poll `TOOLBOX_URL` health (with timeout) before marking ready. Skip entirely if `!TOOLBOX_ENABLED`.
- **Never log file contents**; log `sources.length` only.

**Step 4 — `ToolboxClientService` + normalizer**
- `ToolboxClient(TOOLBOX_URL)`; `invokeExecuteSql(sourceKey, sql)` → `loadTool('<sourceKey>__execute_sql')` → invoke `{ sql }`; wrap in timeout.
- `isHealthy()` cached (`TOOLBOX_HEALTH_TTL_MS`).
- Normalizer → `MCPQueryResult`. **Verify the live `@toolbox-sdk/core` invoke signature and exact tool `kind` names when wiring** (`mysql-execute-sql` etc.).

**Step 5 — Route inside `MCPService`** (§10). Add `EventEmitter` emissions in `persistent-connection.service.ts` create/update/delete/rotate.

**Step 6 — Tests & verification**
- **Unit:** `sourceKeyFor` stability; `toolbox-config.service` (yaml shape, atomic write, debounce, secret injection for mysql/pg/bq, `TOOLBOX_ENABLED=false` no-op); `normalizer`; `MCPService` routing + fallback (Toolbox throws → native runs).
- **Integration/e2e:** seeded MySQL + Postgres → `POST /chats/:id/ask` (autoExecute) and `POST .../widgets/:id/execute` return **identical rows** via Toolbox vs legacy (shadow-diff).
- **Manual:** `docker-compose up`; create a connection in the UI → confirm sidecar hot-reloads and query runs; rotate password → confirm regen; BigQuery service-account connection executes.
- **Rollback drill:** `TOOLBOX_ENABLED=false` → legacy resumes, zero code change.

**Sequencing:** 1 → 2 → 3 → 4 → 5 (mysql/pg) → 6 shadow-diff → flip allowlist for mysql/pg → add BigQuery mapping → validate → add `bigquery` to allowlist.

---

## 13. Files touched (summary)

- **New:** `mcp/toolbox/{toolbox.constants.ts, toolbox-source.mapper.ts, toolbox-config.service.ts, toolbox-client.service.ts, toolbox-result.normalizer.ts}` + tests.
- **Edited:** `mcp/mcp.service.ts` (router), `mcp/mcp.module.ts` (providers + bootstrap), `common/config/env.validation.ts` (env), `connection/persistent-connection.service.ts` (lifecycle events), `docker-compose.yml`, `backend/package.json`.
- **Untouched:** all `chat/`, `combo/`, `dashboard/`, `query/`, `schema/`, `validation/`, every `*.connector.ts`.

**No DB migration for Phase A.** (Optional later: `datasource_connections.execution_transport` column for telemetry.)

---

## 14. Risks & open items

- **Credential exposure in `tools.yaml`** — mitigated by 0600 / tmpfs / co-located trust boundary / never-log (§5).
- **Windows dev vs Linux sidecar** — atomic-rename + volume-mount differences; guard the writer, prefer `TOOLBOX_ENABLED=false` locally (§8).
- **Hot-reload races / many sources in one file** at scale (100s of connections) — debounced atomic writes; consider per-org sharding later.
- **`list_tables` FK gap** — mitigated by keeping native introspection (§7).
- **Fabric/Databricks not native** — hybrid is unavoidable; "100% via Toolbox" is not achievable for the full connector list.
- **Statefulness change** — "session" shifts from per-request native connect to pooled Toolbox handle; verify combo parallelism + timeouts behave under load.
- **Verify at implementation time:** exact Toolbox tool `kind` names and the `@toolbox-sdk/core` invoke signature against live docs (Step 4).

---

## References
- [MCP Toolbox for Databases — GitHub](https://github.com/googleapis/mcp-toolbox)
- [Introduction](https://mcp-toolbox.dev/documentation/introduction/)
- [Prebuilt Configs / supported sources](https://mcp-toolbox.dev/documentation/configuration/prebuilt-configs/)
- [Prebuilt Tools](https://googleapis.github.io/genai-toolbox/reference/prebuilt-tools/)
- [Connect LLMs to BigQuery with MCP — Google Cloud](https://docs.cloud.google.com/bigquery/docs/pre-built-tools-with-mcp-toolbox)
