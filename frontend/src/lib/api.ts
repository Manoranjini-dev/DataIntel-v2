// ──────────────────────────────────────────────
// API Client — Backend Communication Layer
// ──────────────────────────────────────────────

import type {
  ConnectionParams,
  ConnectionResponse,
  QueryPlanResult,
  QueryExecutionResult,
  QueryAskResult,
  StreamEvent,
  StructuredError,
  DashboardWidget,
} from './types';

import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from './auth-store';
import { useOrgStore } from '../store/org';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

class APIError extends Error {
  constructor(
    public readonly status: number,
    public readonly structured: StructuredError,
  ) {
    super(structured.message);
    this.name = 'APIError';
  }
}

export const apiClient = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const currentOrgId = useOrgStore.getState().currentOrgId;
  if (currentOrgId) {
    config.headers['App-Current-Org'] = currentOrgId;
  }

  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      useAuthStore.getState().clearUser();
      if (typeof window !== 'undefined') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

/** Compatibility wrapper to allow existing API methods to work with Axios */
async function apiFetch(path: string, init: RequestInit = {}): Promise<any> {
  try {
    const response = await apiClient.request({
      url: path,
      method: init.method || 'GET',
      data: init.body,
      headers: init.headers as any,
      responseType: path.includes('/stream') ? 'stream' : 'json',
    });
    // Return a mock fetch Response object for handleResponse compatibility
    return {
      ok: true,
      json: async () => response.data,
      body: response.data,
    };
  } catch (error: any) {
    if (error.isAxiosError && error.response) {
      return {
        ok: false,
        status: error.response.status,
        statusText: error.response.statusText,
        json: async () => error.response.data,
      };
    }
    throw error;
  }
}

async function handleResponse<T>(response: any): Promise<T> {
  if (!response.ok) {
    let structured: StructuredError;
    try {
      structured = await response.json();
    } catch {
      structured = {
        type: 'InternalError',
        message: `HTTP ${response.status}: ${response.statusText}`,
        timestamp: new Date().toISOString(),
      };
    }
    throw new APIError(response.status, structured);
  }
  return response.json();
}

// ── Auth API ────────────────────────────────

export const authApi = {
  register: async (displayName: string, email: string, password: string) => {
    const r = await apiFetch('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ displayName, email, password }),
    });
    return handleResponse<{ success: boolean; account: any }>(r);
  },

  login: async (email: string, password: string) => {
    const r = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    return handleResponse<{ success: boolean; account: any }>(r);
  },

  logout: async () => {
    const r = await apiFetch('/auth/logout', { method: 'POST' });
    return handleResponse<{ success: boolean }>(r);
  },

  me: async () => {
    const r = await apiFetch('/auth/me');
    return handleResponse<{ success: boolean; account: any }>(r);
  },
};

// ── Org API ─────────────────────────────────

export const orgApi = {
  list: async () => {
    const r = await apiFetch('/orgs');
    return handleResponse<{ orgs: any[] }>(r);
  },

  create: async (data: { name: string; slug: string; description?: string }) => {
    const r = await apiFetch('/orgs', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return handleResponse<{ org: any }>(r);
  },

  get: async (slug: string) => {
    const r = await apiFetch(`/orgs/${slug}`);
    return handleResponse<{ org: any }>(r);
  },

  update: async (id: string, data: any) => {
    const r = await apiFetch(`/orgs/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    return handleResponse<{ org: any }>(r);
  },

  getMembers: async (orgId: string) => {
    const r = await apiFetch(`/orgs/${orgId}/members`);
    return handleResponse<{ members: any[] }>(r);
  },

  inviteMember: async (orgId: string, email: string, role: string) => {
    const r = await apiFetch(`/orgs/${orgId}/members`, {
      method: 'POST',
      body: JSON.stringify({ email, role }),
    });
    return handleResponse<{ member: any }>(r);
  },

  removeMember: async (orgId: string, accountId: string) => {
    const r = await apiFetch(`/orgs/${orgId}/members/${accountId}`, { method: 'DELETE' });
    return handleResponse<{ success: boolean }>(r);
  },

  getOverview: async (orgId: string) => {
    const r = await apiFetch(`/orgs/${orgId}/overview`);
    return handleResponse<any>(r);
  },
};

// ── Connection API ────────────────────────

export const connectionApi = {
  list: async (orgId: string) => {
    const r = await apiFetch(`/orgs/${orgId}/connections`);
    return handleResponse<{ connections: any[] }>(r);
  },

  create: async (orgId: string, data: any) => {
    const r = await apiFetch(`/orgs/${orgId}/connections`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return handleResponse<{ connection: any }>(r);
  },

  get: async (orgId: string, connId: string) => {
    const r = await apiFetch(`/orgs/${orgId}/connections/${connId}`);
    return handleResponse<{ connection: any }>(r);
  },

  update: async (orgId: string, connId: string, data: any) => {
    const r = await apiFetch(`/orgs/${orgId}/connections/${connId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    return handleResponse<{ connection: any }>(r);
  },

  delete: async (orgId: string, connId: string) => {
    const r = await apiFetch(`/orgs/${orgId}/connections/${connId}`, { method: 'DELETE' });
    return handleResponse<{ success: boolean }>(r);
  },

  test: async (orgId: string, connId: string) => {
    const r = await apiFetch(`/orgs/${orgId}/connections/${connId}/test`, { method: 'POST' });
    return handleResponse<{ success: boolean; latencyMs: number }>(r);
  },

  getSchema: async (orgId: string, connId: string) => {
    const r = await apiFetch(`/orgs/${orgId}/connections/${connId}/schema`);
    return handleResponse<{ tables: any[] }>(r);
  },

  syncSchema: async (orgId: string, connId: string) => {
    const r = await apiFetch(`/orgs/${orgId}/connections/${connId}/schema/sync`, { method: 'POST' });
    return handleResponse<{ success: boolean }>(r);
  },
};

// ── Chat API ──────────────────────────────

export const chatApi = {
  list: async (orgId: string, params: { connectionId?: string; comboId?: string; isArchived?: boolean }) => {
    // Strip undefined/null so they never appear as "key=undefined" in the URL
    const filtered: Record<string, string> = {};
    if (params.connectionId) filtered.connectionId = params.connectionId;
    if (params.comboId)      filtered.comboId      = params.comboId;
    if (params.isArchived !== undefined) filtered.isArchived = String(params.isArchived);
    const qs = new URLSearchParams(filtered).toString();
    const r = await apiFetch(`/orgs/${orgId}/chats${qs ? `?${qs}` : ''}`);
    return handleResponse<{ chats: any[] }>(r);
  },

  create: async (orgId: string, data: { connectionId?: string; comboId?: string; title?: string }) => {
    const r = await apiFetch(`/orgs/${orgId}/chats`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return handleResponse<{ chat: any }>(r);
  },

  getMessages: async (orgId: string, chatId: string) => {
    const r = await apiFetch(`/orgs/${orgId}/chats/${chatId}/messages`);
    return handleResponse<{ messages: any[] }>(r);
  },

  ask: async (orgId: string, chatId: string, prompt: string, autoExecute: boolean = true) => {
    const r = await apiFetch(`/orgs/${orgId}/chats/${chatId}/ask`, {
      method: 'POST',
      body: JSON.stringify({ prompt, autoExecute }),
    });
    return handleResponse<any>(r);
  },
  executeDraft: async (orgId: string, chatId: string, executionId: string, sql: string) => {
    const r = await apiFetch(`/orgs/${orgId}/chats/${chatId}/execute-draft`, {
      method: 'POST',
      body: JSON.stringify({ executionId, sql }),
    });
    return handleResponse<any>(r);
  },

  /**
   * Re-execute stored SQL for a list of execution IDs against the live DB.
   * Returns fresh rows without overwriting the stored result_preview snapshots.
   */
  refreshMessages: async (orgId: string, chatId: string, executionIds: string[]) => {
    const r = await apiFetch(`/orgs/${orgId}/chats/${chatId}/refresh-messages`, {
      method: 'POST',
      body: JSON.stringify({ executionIds }),
    });
    return handleResponse<{ results: Array<{
      executionId: string;
      rows: any[];
      columns: string[];
      row_count: number;
      execution_time_ms: number;
      status: 'success' | 'failed';
      error?: string;
    }> }>(r);
  },

  /**
   * Re-execute stored sub-queries for a COMBO chat and return merged live rows.
   * Returns fresh rows without overwriting the stored result_preview snapshots.
   */
  refreshComboMessages: async (orgId: string, chatId: string, executionIds: string[]) => {
    const r = await apiFetch(`/orgs/${orgId}/chats/${chatId}/refresh-combo-messages`, {
      method: 'POST',
      body: JSON.stringify({ executionIds }),
    });
    return handleResponse<{ results: Array<{
      executionId: string;
      rows: any[];
      columns: string[];
      row_count: number;
      execution_time_ms: number;
      status: 'success' | 'failed';
      error?: string;
    }> }>(r);
  },

  suggestTitle: async (orgId: string, prompt: string) => {
    const r = await apiFetch(`/orgs/${orgId}/chats/suggest-title`, {
      method: 'POST',
      body: JSON.stringify({ prompt }),
    });
    return handleResponse<{ title: string; fallback?: boolean }>(r);
  },

  archive: async (orgId: string, chatId: string) => {
    const r = await apiFetch(`/orgs/${orgId}/chats/${chatId}/archive`, { method: 'POST' });
    return handleResponse<{ success: boolean }>(r);
  },

  unarchive: async (orgId: string, chatId: string) => {
    const r = await apiFetch(`/orgs/${orgId}/chats/${chatId}/unarchive`, { method: 'POST' });
    return handleResponse<{ success: boolean }>(r);
  },

  delete: async (orgId: string, chatId: string) => {
    const r = await apiFetch(`/orgs/${orgId}/chats/${chatId}`, { method: 'DELETE' });
    return handleResponse<any>(r);
  },

  updateTitle: async (orgId: string, chatId: string, title: string) => {
    const r = await apiFetch(`/orgs/${orgId}/chats/${chatId}/title`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    });
    return handleResponse<{ chat: any }>(r);
  },
};

// ── Dashboard API ─────────────────────────

export const dashboardApi = {
  list: async (orgId: string) => {
    const r = await apiFetch(`/orgs/${orgId}/dashboards`);
    const data = await handleResponse<{ dashboards: any[] }>(r);
    data.dashboards.forEach(d => {
      if (d.context_type === 'connection') d.connection_id = d.context_id;
      if (d.context_type === 'combo') d.combo_id = d.context_id;
    });
    return data;
  },

  create: async (orgId: string, data: any) => {
    const payload = {
      name: data.name,
      description: data.description,
      contextType: data.comboId ? 'combo' : 'connection',
      contextId: data.comboId || data.connectionId
    };
    const r = await apiFetch(`/orgs/${orgId}/dashboards`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return handleResponse<{ dashboard: any }>(r);
  },

  get: async (orgId: string, dashId: string) => {
    const r = await apiFetch(`/orgs/${orgId}/dashboards/${dashId}`);
    const data = await handleResponse<{ dashboard: any; pages: any[] }>(r);
    if (data.dashboard) {
      if (data.dashboard.context_type === 'connection') {
        data.dashboard.connection_id = data.dashboard.context_id;
      }
      if (data.dashboard.context_type === 'combo') {
        data.dashboard.combo_id = data.dashboard.context_id;
      }
    }
    return data;
  },

  update: async (orgId: string, dashId: string, data: { name?: string; description?: string }) => {
    const r = await apiFetch(`/orgs/${orgId}/dashboards/${dashId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    return handleResponse<{ dashboard: any }>(r);
  },

  delete: async (orgId: string, dashId: string) => {
    const r = await apiFetch(`/orgs/${orgId}/dashboards/${dashId}`, { method: 'DELETE' });
    return handleResponse<any>(r);
  },

  save: async (orgId: string, dashId: string) => {
    const r = await apiFetch(`/orgs/${orgId}/dashboards/${dashId}/publish`, { method: 'POST' });
    return handleResponse<{ dashboard: any }>(r);
  },

  updateLayout: async (orgId: string, dashId: string, layout: any[]) => {
    const r = await apiFetch(`/orgs/${orgId}/dashboards/${dashId}/layout`, {
      method: 'POST',
      body: JSON.stringify({ layout }),
    });
    return handleResponse<{ success: boolean }>(r);
  },

  addPage: async (orgId: string, dashId: string, name: string) => {
    const r = await apiFetch(`/orgs/${orgId}/dashboards/${dashId}/pages`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    return handleResponse<{ page: any }>(r);
  },

  deletePage: async (orgId: string, dashId: string, pageId: string) => {
    const r = await apiFetch(`/orgs/${orgId}/dashboards/${dashId}/pages/${pageId}`, { method: 'DELETE' });
    return handleResponse<{ success: boolean }>(r);
  },

  // Rename a page (or set default). Backend validates non-empty + uniqueness.
  updatePage: async (orgId: string, dashId: string, pageId: string, data: { name?: string; isDefault?: boolean }) => {
    const r = await apiFetch(`/orgs/${orgId}/dashboards/${dashId}/pages/${pageId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    return handleResponse<{ page: any }>(r);
  },

  // Persist a new page order. `order` is the full array of page IDs in the
  // desired sequence.
  reorderPages: async (orgId: string, dashId: string, order: string[]) => {
    const r = await apiFetch(`/orgs/${orgId}/dashboards/${dashId}/pages/reorder`, {
      method: 'PUT',
      body: JSON.stringify({ order }),
    });
    return handleResponse<{ success: boolean }>(r);
  },

  addWidget: async (orgId: string, dashId: string, pageId: string, data: any) => {
    const payload = {
      widgetType: data.widget_type || 'table',
      title: data.title,
      cardId: data.cardId,
      gridX: data.gridX || 0,
      gridY: data.gridY || 0,
      gridW: data.gridW || 4,
      gridH: data.gridH || 3,
      datasourceContextType: data.datasourceScopeType || data.datasourceContextType,
      datasourceContextId: data.datasourceContextId,
      queryDefinition: {
        prompt: data.queryPrompt,
        sql: data.sql || '',
        result_rows: data.resultRows,
        result_columns: data.resultColumns,
        ui_hint: data.uiHint,
      }
    };
    const r = await apiFetch(`/orgs/${orgId}/dashboards/${dashId}/pages/${pageId}/widgets`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return handleResponse<{ widget: any }>(r);
  },

  deleteWidget: async (orgId: string, dashId: string, pageId: string, widgetId: string) => {
    const r = await apiFetch(`/orgs/${orgId}/dashboards/${dashId}/pages/${pageId}/widgets/${widgetId}`, { method: 'DELETE' });
    return handleResponse<{ success: boolean }>(r);
  },

  /**
   * Re-execute a widget's query against the live database via the backend's
   * WidgetExecutionService. Pass forceRefresh=true to bypass the Redis cache.
   */
  executeWidget: async (orgId: string, dashId: string, pageId: string, widgetId: string, forceRefresh = false) => {
    const r = await apiFetch(`/orgs/${orgId}/dashboards/${dashId}/pages/${pageId}/widgets/${widgetId}/execute`, {
      method: 'POST',
      body: JSON.stringify({ forceRefresh }),
    });
    return handleResponse<{ rows: any[]; columns: string[]; executionTimeMs: number; status: string; isCached?: boolean }>(r);
  },

  updateWidget: async (orgId: string, dashId: string, pageId: string, widgetId: string, data: any) => {
    const payload = {
      title: data.title,
      widget_type: data.widget_type,
      gridX: data.position_x, gridY: data.position_y, gridW: data.width, gridH: data.height,
      queryDefinition: {
        prompt: data.query_prompt,
        sql: data.sql || '',
        result_rows: data.result_rows,
        result_columns: data.result_columns,
        ui_hint: data.ui_hint,
      },
    };
    const r = await apiFetch(`/orgs/${orgId}/dashboards/${dashId}/pages/${pageId}/widgets/${widgetId}`, {
      method: 'PUT', body: JSON.stringify(payload),
    });
    return handleResponse<{ widget: any }>(r);
  },

  inspect: async (orgId: string, dashId: string, pageId: string, widgetId: string) => {
    const r = await apiFetch(`/orgs/${orgId}/dashboards/${dashId}/pages/${pageId}/widgets/${widgetId}/inspect`);
    return handleResponse<{ execution: any }>(r);
  },

  // AI assist — suggest an analytics question for an empty widget prompt.
  suggestQuestion: async (orgId: string, dashId: string, pageId: string, widgetId: string) => {
    const r = await apiFetch(`/orgs/${orgId}/dashboards/${dashId}/pages/${pageId}/widgets/${widgetId}/suggest-question`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    return handleResponse<{ question: string }>(r);
  },

  // AI assist — rephrase a user prompt into a clearer analytical request.
  improvePrompt: async (orgId: string, dashId: string, pageId: string, widgetId: string, prompt: string) => {
    const r = await apiFetch(`/orgs/${orgId}/dashboards/${dashId}/pages/${pageId}/widgets/${widgetId}/improve-prompt`, {
      method: 'POST',
      body: JSON.stringify({ prompt }),
    });
    return handleResponse<{ prompt: string }>(r);
  },

  listFilters: async (orgId: string, dashId: string) => {
    const r = await apiFetch(`/orgs/${orgId}/dashboards/${dashId}/filters`);
    return handleResponse<{ filters: any[] }>(r);
  },

  addFilter: async (orgId: string, dashId: string, data: any) => {
    const r = await apiFetch(`/orgs/${orgId}/dashboards/${dashId}/filters`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return handleResponse<{ filter: any }>(r);
  },

  removeFilter: async (orgId: string, dashId: string, filterId: string) => {
    const r = await apiFetch(`/orgs/${orgId}/dashboards/${dashId}/filters/${filterId}`, { method: 'DELETE' });
    return handleResponse<{ success: boolean }>(r);
  },

  listVersions: async (orgId: string, dashId: string) => {
    const r = await apiFetch(`/orgs/${orgId}/dashboards/${dashId}/versions`);
    return handleResponse<{ versions: any[] }>(r);
  },

  saveVersion: async (orgId: string, dashId: string, message?: string) => {
    const r = await apiFetch(`/orgs/${orgId}/dashboards/${dashId}/versions`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    });
    return handleResponse<{ version: any }>(r);
  },

  restoreVersion: async (orgId: string, dashId: string, versionId: string) => {
    const r = await apiFetch(`/orgs/${orgId}/dashboards/${dashId}/versions/${versionId}/restore`, {
      method: 'POST',
    });
    return handleResponse<{ success: boolean }>(r);
  },
};

// ── Combo API ──────────────────────────────

export const comboApi = {
  list: async (orgId: string) => {
    const r = await apiFetch(`/orgs/${orgId}/combos`);
    return handleResponse<{ combos: any[] }>(r);
  },

  get: async (orgId: string, comboId: string) => {
    const r = await apiFetch(`/orgs/${orgId}/combos/${comboId}`);
    return handleResponse<{ combo: any }>(r);
  },

  create: async (orgId: string, data: { name: string; description?: string; connectionIds: string[] }) => {
    const r = await apiFetch(`/orgs/${orgId}/combos`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return handleResponse<{ combo: any }>(r);
  },

  delete: async (orgId: string, comboId: string) => {
    const r = await apiFetch(`/orgs/${orgId}/combos/${comboId}`, { method: 'DELETE' });
    return handleResponse<{ success: boolean }>(r);
  },

  query: async (orgId: string, comboId: string, prompt: string, chatId?: string) => {
    const r = await apiFetch(`/orgs/${orgId}/combos/${comboId}/query`, {
      method: 'POST',
      body: JSON.stringify({ prompt, chatId }),
    });
    return handleResponse<any>(r);
  },

  getMergedSchema: async (orgId: string, comboId: string) => {
    const r = await apiFetch(`/orgs/${orgId}/combos/${comboId}/schema`);
    return handleResponse<{ schema: any[] }>(r);
  },
};

// ── Legacy Connection API (backward-compat) ──

export async function testConnection(
  params: ConnectionParams,
): Promise<{ success: boolean; message: string }> {
  const response = await apiFetch('/connection/test', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  return handleResponse(response);
}

export async function connect(params: ConnectionParams): Promise<ConnectionResponse> {
  const response = await apiFetch('/connection/connect', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  const data = await handleResponse<any>(response);
  return {
    sessionId: data.session.sessionId,
    connectorType: data.session.connectorType,
    database: data.session.database,
    host: data.session.host,
    port: data.session.port,
    capabilities: data.session.capabilities,
    tables: data.schema.tables.map((t: any) => ({
      name: t.name,
      columnCount: t.columns?.length || 0,
      primaryKeys: t.primaryKeys || [],
      foreignKeyCount: t.foreignKeys?.length || 0,
    })),
  };
}

export async function getConnectionStatus(
  sessionId: string,
): Promise<{ connected: boolean }> {
  const response = await apiFetch(`/connection/status/${sessionId}`);
  return handleResponse(response);
}

export async function disconnect(sessionId: string): Promise<void> {
  await apiFetch(`/connection/disconnect/${sessionId}`, { method: 'POST' });
}

export async function generatePlan(sessionId: string, prompt: string): Promise<QueryPlanResult> {
  const response = await apiFetch('/query/generate', {
    method: 'POST',
    body: JSON.stringify({ sessionId, prompt }),
  });
  return handleResponse(response);
}

export async function executeQuery(
  sessionId: string, sql: string, prompt?: string, approved = false,
): Promise<QueryExecutionResult> {
  const response = await apiFetch('/query/execute', {
    method: 'POST',
    body: JSON.stringify({ sessionId, sql, approved, prompt }),
  });
  return handleResponse(response);
}

export async function ask(sessionId: string, prompt: string): Promise<QueryAskResult> {
  const response = await apiFetch('/query/ask', {
    method: 'POST',
    body: JSON.stringify({ sessionId, prompt }),
  });
  return handleResponse(response);
}

export async function* streamQuery(sessionId: string, prompt: string): AsyncGenerator<StreamEvent> {
  const response = await apiFetch('/query/stream', {
    method: 'POST',
    body: JSON.stringify({ sessionId, prompt }),
  });
  if (!response.ok) throw new Error(`Stream failed: ${response.statusText}`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('data: ')) {
        try { yield JSON.parse(trimmed.slice(6)) as StreamEvent; } catch { /* skip */ }
      }
    }
  }
}

export async function getQueryHistory(sessionId: string): Promise<{ queries: string[] }> {
  const response = await apiFetch(`/query/history/${sessionId}`);
  return handleResponse(response);
}

export async function getSchema(sessionId: string): Promise<import('./types').SchemaTopology> {
  const response = await apiFetch(`/connection/schema/${sessionId}`);
  return handleResponse(response);
}

export async function explainSchema(
  schemaSummary: string, databaseName: string, connectorFamily?: string,
): Promise<{ explanation: string }> {
  const response = await apiFetch('/query/explain', {
    method: 'POST',
    body: JSON.stringify({ schemaSummary, databaseName, connectorFamily }),
  });
  return handleResponse(response);
}

export async function getDashboardWidgets(sessionId: string): Promise<{ widgets: DashboardWidget[] }> {
  const response = await apiFetch('/query/dashboard/widgets', {
    method: 'POST',
    body: JSON.stringify({ sessionId }),
  });
  return handleResponse(response);
}

export async function executeDashboardWidget(sessionId: string, prompt: string): Promise<QueryExecutionResult> {
  const response = await apiFetch('/query/dashboard/execute', {
    method: 'POST',
    body: JSON.stringify({ sessionId, prompt }),
  });
  return handleResponse(response);
}

// ── Card API ─────────────────────────────────

export const cardApi = {
  list: async (orgId: string, params?: Record<string, any>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    const r = await apiFetch(`/orgs/${orgId}/cards${qs}`);
    return handleResponse<{ cards: any[], total: number }>(r);
  },
  create: async (orgId: string, data: any) => {
    const r = await apiFetch(`/orgs/${orgId}/cards`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return handleResponse<{ card: any }>(r);
  },
  get: async (orgId: string, cardId: string) => {
    const r = await apiFetch(`/orgs/${orgId}/cards/${cardId}`);
    return handleResponse<{ card: any }>(r);
  },
  update: async (orgId: string, cardId: string, data: any) => {
    const r = await apiFetch(`/orgs/${orgId}/cards/${cardId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
    return handleResponse<{ card: any }>(r);
  },
  publish: async (orgId: string, cardId: string) => {
    const r = await apiFetch(`/orgs/${orgId}/cards/${cardId}/publish`, {
      method: 'POST',
    });
    return handleResponse<{ card: any }>(r);
  },
};

export { APIError };
