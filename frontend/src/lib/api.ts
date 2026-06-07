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

/** Base fetch with credentials included for cookie-based auth */
async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });
}

async function handleResponse<T>(response: Response): Promise<T> {
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
  list: async (orgId: string, params: { connectionId?: string; comboId?: string }) => {
    const qs = new URLSearchParams(params as any).toString();
    const r = await apiFetch(`/orgs/${orgId}/chats?${qs}`);
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

  ask: async (orgId: string, chatId: string, prompt: string) => {
    const r = await apiFetch(`/orgs/${orgId}/chats/${chatId}/ask`, {
      method: 'POST',
      body: JSON.stringify({ prompt }),
    });
    return handleResponse<any>(r);
  },

  archive: async (orgId: string, chatId: string) => {
    const r = await apiFetch(`/orgs/${orgId}/chats/${chatId}/archive`, { method: 'POST' });
    return handleResponse<{ success: boolean }>(r);
  },
};

// ── Dashboard API ─────────────────────────

export const dashboardApi = {
  list: async (orgId: string) => {
    const r = await apiFetch(`/orgs/${orgId}/dashboards`);
    return handleResponse<{ dashboards: any[] }>(r);
  },

  create: async (orgId: string, data: any) => {
    const r = await apiFetch(`/orgs/${orgId}/dashboards`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return handleResponse<{ dashboard: any }>(r);
  },

  get: async (orgId: string, dashId: string) => {
    const r = await apiFetch(`/orgs/${orgId}/dashboards/${dashId}`);
    return handleResponse<{ dashboard: any; pages: any[] }>(r);
  },

  save: async (orgId: string, dashId: string) => {
    const r = await apiFetch(`/orgs/${orgId}/dashboards/${dashId}/save`, { method: 'POST' });
    return handleResponse<{ success: boolean }>(r);
  },

  addPage: async (orgId: string, dashId: string, name: string) => {
    const r = await apiFetch(`/orgs/${orgId}/dashboards/${dashId}/pages`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    return handleResponse<{ page: any }>(r);
  },

  addWidget: async (orgId: string, dashId: string, pageId: string, data: any) => {
    const r = await apiFetch(`/orgs/${orgId}/dashboards/${dashId}/pages/${pageId}/widgets`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return handleResponse<{ widget: any }>(r);
  },
};

// ── Combo API ──────────────────────────────

export const comboApi = {
  list: async (orgId: string) => {
    const r = await apiFetch(`/orgs/${orgId}/combos`);
    return handleResponse<{ combos: any[] }>(r);
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
  return handleResponse(response);
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

export { APIError };
