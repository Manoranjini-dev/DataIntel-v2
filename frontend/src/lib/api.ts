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

import axios, { AxiosError } from 'axios';
import { useAuthStore } from './auth-store';

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
  // Bound every request so a hung backend/LLM call surfaces as a clear
  // timeout error instead of leaving the UI spinning forever. Sits above
  // the backend's own 30s LLM timeout, leaving headroom for SQL execution
  // and result interpretation.
  timeout: 60_000,
  headers: {
    'Content-Type': 'application/json',
  },
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

  activateAccount: async (token: string, password: string) => {
    const r = await apiFetch('/auth/activate-account', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    });
    return handleResponse<{ success: boolean; account: any }>(r);
  },

  forgotPassword: async (email: string) => {
    const r = await apiFetch('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
    return handleResponse<{ success: boolean; message: string }>(r);
  },

  resetPassword: async (token: string, password: string) => {
    const r = await apiFetch('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    });
    return handleResponse<{ success: boolean; message: string }>(r);
  },
};

// ── User Management API (ADMIN only) ─────────

export interface ManagedUser {
  id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'ANALYST' | 'VIEWER';
  status: 'PENDING_INVITATION' | 'ACTIVE' | 'INACTIVE' | 'DELETED';
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}

export interface ListUsersParams {
  page?: number;
  limit?: number;
  search?: string;
  role?: string;
  status?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface ListUsersResult {
  users: ManagedUser[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export const userApi = {
  list: async (params: ListUsersParams = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') qs.append(k, String(v));
    });
    const r = await apiFetch(`/users?${qs.toString()}`);
    return handleResponse<ListUsersResult>(r);
  },

  get: async (id: string) => {
    const r = await apiFetch(`/users/${id}`);
    return handleResponse<{ user: ManagedUser }>(r);
  },

  create: async (data: { name: string; email: string; role: string }) => {
    const r = await apiFetch('/users', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return handleResponse<{ success: boolean; message: string; user: ManagedUser }>(r);
  },

  update: async (
    id: string,
    data: { name?: string; email?: string; role?: string; status?: string },
  ) => {
    const r = await apiFetch(`/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    return handleResponse<{ success: boolean; user: ManagedUser }>(r);
  },

  setStatus: async (id: string, status: 'ACTIVE' | 'INACTIVE') => {
    const r = await apiFetch(`/users/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    return handleResponse<{ success: boolean; user: ManagedUser }>(r);
  },

  remove: async (id: string) => {
    const r = await apiFetch(`/users/${id}`, { method: 'DELETE' });
    return handleResponse<{ success: boolean; message: string }>(r);
  },

  resendInvitation: async (id: string) => {
    const r = await apiFetch(`/users/${id}/resend-invitation`, { method: 'POST' });
    return handleResponse<{ success: boolean; message: string; user: ManagedUser }>(r);
  },

  auditLogs: async (page = 1, limit = 50) => {
    const r = await apiFetch(`/users/audit-logs?page=${page}&limit=${limit}`);
    return handleResponse<{ logs: any[]; page: number; limit: number }>(r);
  },
};

// ── Connection API ────────────────────────

export const connectionApi = {
  list: async () => {
    const r = await apiFetch(`/connections`);
    return handleResponse<{ connections: any[] }>(r);
  },

  create: async (data: any) => {
    const r = await apiFetch(`/connections`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return handleResponse<{ connection: any }>(r);
  },

  get: async (connId: string) => {
    const r = await apiFetch(`/connections/${connId}`);
    return handleResponse<{ connection: any }>(r);
  },

  update: async (connId: string, data: any) => {
    const r = await apiFetch(`/connections/${connId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    return handleResponse<{ connection: any }>(r);
  },

  delete: async (connId: string) => {
    const r = await apiFetch(`/connections/${connId}`, { method: 'DELETE' });
    return handleResponse<{ success: boolean }>(r);
  },

  test: async (connId: string) => {
    const r = await apiFetch(`/connections/${connId}/test`, { method: 'POST' });
    return handleResponse<{ success: boolean; latencyMs: number }>(r);
  },

  getSchema: async (connId: string) => {
    const r = await apiFetch(`/connections/${connId}/schema`);
    return handleResponse<{ tables: any[] }>(r);
  },

  syncSchema: async (connId: string) => {
    const r = await apiFetch(`/connections/${connId}/schema/sync`, { method: 'POST' });
    return handleResponse<{ success: boolean }>(r);
  },

  // ── Sharing ──────────────────────────────

  /** Search Admins/Analysts that a connection can be shared with (excludes Viewers and the caller). */
  searchShareTargets: async (q: string) => {
    const r = await apiFetch(`/connections/share-targets?q=${encodeURIComponent(q)}`);
    return handleResponse<{ users: any[] }>(r);
  },

  listShares: async (connId: string) => {
    const r = await apiFetch(`/connections/${connId}/share`);
    return handleResponse<{ shares: any[] }>(r);
  },

  share: async (connId: string, data: { email: string; accessLevel: 'view' | 'edit'; expiresAt?: string }) => {
    const r = await apiFetch(`/connections/${connId}/share`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return handleResponse<{ share: any }>(r);
  },

  updateShare: async (connId: string, accountId: string, data: { accessLevel: 'view' | 'edit'; expiresAt?: string }) => {
    const r = await apiFetch(`/connections/${connId}/share/${accountId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    return handleResponse<{ share: any }>(r);
  },

  revokeShare: async (connId: string, accountId: string) => {
    const r = await apiFetch(`/connections/${connId}/share/${accountId}`, { method: 'DELETE' });
    return handleResponse<{ success: boolean }>(r);
  },

  /** Remove a connection that was shared with the caller from their own workspace (does not delete it). */
  leaveShared: async (connId: string) => {
    const r = await apiFetch(`/connections/${connId}/share/me`, { method: 'DELETE' });
    return handleResponse<{ success: boolean }>(r);
  },

  // ── Auto-refresh ─────────────────────────

  getRefreshSchedule: async (connId: string) => {
    const r = await apiFetch(`/connections/${connId}/refresh-schedule`);
    return handleResponse<{ schedule: any }>(r);
  },

  setRefreshSchedule: async (connId: string, data: { enabled: boolean; intervalMinutes?: number }) => {
    const r = await apiFetch(`/connections/${connId}/refresh-schedule`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    return handleResponse<{ schedule: any }>(r);
  },

  triggerRefresh: async (connId: string) => {
    const r = await apiFetch(`/connections/${connId}/refresh-schedule/trigger`, { method: 'POST' });
    return handleResponse<{ success: boolean; error?: string }>(r);
  },
};

// ── Chat API ──────────────────────────────

export const chatApi = {
  list: async (params: { connectionId?: string; comboId?: string; isArchived?: boolean }) => {
    // Strip undefined/null so they never appear as "key=undefined" in the URL
    const filtered: Record<string, string> = {};
    if (params.connectionId) filtered.connectionId = params.connectionId;
    if (params.comboId)      filtered.comboId      = params.comboId;
    if (params.isArchived !== undefined) filtered.isArchived = String(params.isArchived);
    const qs = new URLSearchParams(filtered).toString();
    const r = await apiFetch(`/chats${qs ? `?${qs}` : ''}`);
    return handleResponse<{ chats: any[] }>(r);
  },

  create: async (data: { connectionId?: string; comboId?: string; title?: string }) => {
    const r = await apiFetch(`/chats`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return handleResponse<{ chat: any }>(r);
  },

  getMessages: async (chatId: string) => {
    const r = await apiFetch(`/chats/${chatId}/messages`);
    return handleResponse<{ messages: any[] }>(r);
  },

  ask: async (chatId: string, prompt: string, autoExecute: boolean = true) => {
    const r = await apiFetch(`/chats/${chatId}/ask`, {
      method: 'POST',
      body: JSON.stringify({ prompt, autoExecute }),
    });
    return handleResponse<any>(r);
  },
  executeDraft: async (chatId: string, executionId: string, sql: string) => {
    const r = await apiFetch(`/chats/${chatId}/execute-draft`, {
      method: 'POST',
      body: JSON.stringify({ executionId, sql }),
    });
    return handleResponse<any>(r);
  },

  /**
   * Re-execute stored SQL for a list of execution IDs against the live DB.
   * Returns fresh rows without overwriting the stored result_preview snapshots.
   */
  refreshMessages: async (chatId: string, executionIds: string[]) => {
    const r = await apiFetch(`/chats/${chatId}/refresh-messages`, {
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
  refreshComboMessages: async (chatId: string, executionIds: string[]) => {
    const r = await apiFetch(`/chats/${chatId}/refresh-combo-messages`, {
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

  suggestTitle: async (prompt: string) => {
    const r = await apiFetch(`/chats/suggest-title`, {
      method: 'POST',
      body: JSON.stringify({ prompt }),
    });
    return handleResponse<{ title: string; fallback?: boolean }>(r);
  },

  archive: async (chatId: string) => {
    const r = await apiFetch(`/chats/${chatId}/archive`, { method: 'POST' });
    return handleResponse<{ success: boolean }>(r);
  },

  unarchive: async (chatId: string) => {
    const r = await apiFetch(`/chats/${chatId}/unarchive`, { method: 'POST' });
    return handleResponse<{ success: boolean }>(r);
  },

  delete: async (chatId: string) => {
    const r = await apiFetch(`/chats/${chatId}`, { method: 'DELETE' });
    return handleResponse<any>(r);
  },

  updateTitle: async (chatId: string, title: string) => {
    const r = await apiFetch(`/chats/${chatId}/title`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    });
    return handleResponse<{ chat: any }>(r);
  },
};

// ── Dashboard API ─────────────────────────

export const dashboardApi = {
  list: async (params: { origin?: 'manual' | 'datasource'; contextType?: string; contextId?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.origin) qs.set('origin', params.origin);
    if (params.contextType) qs.set('contextType', params.contextType);
    if (params.contextId) qs.set('contextId', params.contextId);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    const r = await apiFetch(`/dashboards${suffix}`);
    const data = await handleResponse<{ dashboards: any[] }>(r);
    data.dashboards.forEach(d => {
      if (d.context_type === 'connection') d.connection_id = d.context_id;
      if (d.context_type === 'combo') d.combo_id = d.context_id;
    });
    return data;
  },

  create: async (data: any) => {
    let contextType = 'org_overview';
    let contextId = null;

    if (data.comboId) {
      contextType = 'combo';
      contextId = data.comboId;
    } else if (data.connectionId) {
      contextType = 'connection';
      contextId = data.connectionId;
    }

    const payload = {
      name: data.name,
      description: data.description,
      contextType,
      contextId,
      // 'manual' = Dashboards module; 'datasource' = data source / combo workflow.
      origin: data.origin || 'manual',
    };
    const r = await apiFetch(`/dashboards`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return handleResponse<{ dashboard: any }>(r);
  },

  get: async (dashId: string) => {
    const r = await apiFetch(`/dashboards/${dashId}`);
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

  update: async (dashId: string, data: { name?: string; description?: string }) => {
    const r = await apiFetch(`/dashboards/${dashId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    return handleResponse<{ dashboard: any }>(r);
  },

  delete: async (dashId: string) => {
    const r = await apiFetch(`/dashboards/${dashId}`, { method: 'DELETE' });
    return handleResponse<any>(r);
  },

  save: async (dashId: string) => {
    const r = await apiFetch(`/dashboards/${dashId}/publish`, { method: 'POST' });
    return handleResponse<{ dashboard: any }>(r);
  },

  updateLayout: async (dashId: string, layout: any[]) => {
    const r = await apiFetch(`/dashboards/${dashId}/layout`, {
      method: 'POST',
      body: JSON.stringify({ layout }),
    });
    return handleResponse<{ success: boolean }>(r);
  },

  addPage: async (dashId: string, name: string) => {
    const r = await apiFetch(`/dashboards/${dashId}/pages`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    return handleResponse<{ page: any }>(r);
  },

  deletePage: async (dashId: string, pageId: string) => {
    const r = await apiFetch(`/dashboards/${dashId}/pages/${pageId}`, { method: 'DELETE' });
    return handleResponse<{ success: boolean }>(r);
  },

  // Rename a page (or set default). Backend validates non-empty + uniqueness.
  updatePage: async (dashId: string, pageId: string, data: { name?: string; isDefault?: boolean }) => {
    const r = await apiFetch(`/dashboards/${dashId}/pages/${pageId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    return handleResponse<{ page: any }>(r);
  },

  // Persist a new page order. `order` is the full array of page IDs in the
  // desired sequence.
  reorderPages: async (dashId: string, order: string[]) => {
    const r = await apiFetch(`/dashboards/${dashId}/pages/reorder`, {
      method: 'PUT',
      body: JSON.stringify({ order }),
    });
    return handleResponse<{ success: boolean }>(r);
  },

  addWidget: async (dashId: string, pageId: string, data: any) => {
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
        // Static content for non-query widgets (Free Text / Image cards) — optional, additive.
        ...(data.textContent !== undefined ? { text_content: data.textContent } : {}),
        ...(data.imageUrl !== undefined ? { image_url: data.imageUrl } : {}),
        ...(data.imageCaption !== undefined ? { image_caption: data.imageCaption } : {}),
      }
    };
    const r = await apiFetch(`/dashboards/${dashId}/pages/${pageId}/widgets`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return handleResponse<{ widget: any }>(r);
  },

  deleteWidget: async (dashId: string, pageId: string, widgetId: string) => {
    const r = await apiFetch(`/dashboards/${dashId}/pages/${pageId}/widgets/${widgetId}`, { method: 'DELETE' });
    return handleResponse<{ success: boolean }>(r);
  },

  /**
   * Re-execute a widget's query against the live database via the backend's
   * WidgetExecutionService. Pass forceRefresh=true to bypass the Redis cache.
   */
  executeWidget: async (dashId: string, pageId: string, widgetId: string, forceRefresh = false) => {
    const r = await apiFetch(`/dashboards/${dashId}/pages/${pageId}/widgets/${widgetId}/execute`, {
      method: 'POST',
      body: JSON.stringify({ forceRefresh }),
    });
    return handleResponse<{ rows: any[]; columns: string[]; executionTimeMs: number; status: string; isCached?: boolean }>(r);
  },

  updateWidget: async (dashId: string, pageId: string, widgetId: string, data: any) => {
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
        // Static content for non-query widgets (Free Text / Image cards) — optional, additive.
        ...(data.text_content !== undefined ? { text_content: data.text_content } : {}),
        ...(data.image_url !== undefined ? { image_url: data.image_url } : {}),
        ...(data.image_caption !== undefined ? { image_caption: data.image_caption } : {}),
      },
      // Client-side chart/aggregation settings — omitted entirely (not even `{}`)
      // unless explicitly provided, so saves that don't touch it leave the
      // stored config untouched (backend treats a missing key as "no change").
      ...(data.visualization_config !== undefined ? { visualizationConfig: data.visualization_config } : {}),
    };
    const r = await apiFetch(`/dashboards/${dashId}/pages/${pageId}/widgets/${widgetId}`, {
      method: 'PUT', body: JSON.stringify(payload),
    });
    return handleResponse<{ widget: any }>(r);
  },

  inspect: async (dashId: string, pageId: string, widgetId: string) => {
    const r = await apiFetch(`/dashboards/${dashId}/pages/${pageId}/widgets/${widgetId}/inspect`);
    return handleResponse<{ execution: any }>(r);
  },

  // AI assist — suggest an analytics question for an empty widget prompt.
  suggestQuestion: async (dashId: string, pageId: string, widgetId: string) => {
    const r = await apiFetch(`/dashboards/${dashId}/pages/${pageId}/widgets/${widgetId}/suggest-question`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    return handleResponse<{ question: string }>(r);
  },

  // AI assist — rephrase a user prompt into a clearer analytical request.
  improvePrompt: async (dashId: string, pageId: string, widgetId: string, prompt: string) => {
    const r = await apiFetch(`/dashboards/${dashId}/pages/${pageId}/widgets/${widgetId}/improve-prompt`, {
      method: 'POST',
      body: JSON.stringify({ prompt }),
    });
    return handleResponse<{ prompt: string }>(r);
  },

  listFilters: async (dashId: string) => {
    const r = await apiFetch(`/dashboards/${dashId}/filters`);
    return handleResponse<{ filters: any[] }>(r);
  },

  addFilter: async (dashId: string, data: any) => {
    const r = await apiFetch(`/dashboards/${dashId}/filters`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return handleResponse<{ filter: any }>(r);
  },

  removeFilter: async (dashId: string, filterId: string) => {
    const r = await apiFetch(`/dashboards/${dashId}/filters/${filterId}`, { method: 'DELETE' });
    return handleResponse<{ success: boolean }>(r);
  },

  listVersions: async (dashId: string) => {
    const r = await apiFetch(`/dashboards/${dashId}/versions`);
    return handleResponse<{ versions: any[] }>(r);
  },

  saveVersion: async (dashId: string, message?: string) => {
    const r = await apiFetch(`/dashboards/${dashId}/versions`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    });
    return handleResponse<{ version: any }>(r);
  },

  restoreVersion: async (dashId: string, versionId: string) => {
    const r = await apiFetch(`/dashboards/${dashId}/versions/${versionId}/restore`, {
      method: 'POST',
    });
    return handleResponse<{ success: boolean }>(r);
  },
};

// ── Combo API ──────────────────────────────

export const comboApi = {
  list: async () => {
    const r = await apiFetch(`/combos`);
    return handleResponse<{ combos: any[] }>(r);
  },

  get: async (comboId: string) => {
    const r = await apiFetch(`/combos/${comboId}`);
    return handleResponse<{ combo: any }>(r);
  },

  create: async (data: { name: string; description?: string; connectionIds: string[] }) => {
    const r = await apiFetch(`/combos`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return handleResponse<{ combo: any }>(r);
  },

  delete: async (comboId: string) => {
    const r = await apiFetch(`/combos/${comboId}`, { method: 'DELETE' });
    return handleResponse<{ success: boolean }>(r);
  },

  query: async (comboId: string, prompt: string, chatId?: string) => {
    const r = await apiFetch(`/combos/${comboId}/query`, {
      method: 'POST',
      body: JSON.stringify({ prompt, chatId }),
    });
    return handleResponse<any>(r);
  },

  getMergedSchema: async (comboId: string) => {
    const r = await apiFetch(`/combos/${comboId}/schema`);
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
  list: async (params?: Record<string, any>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    const r = await apiFetch(`/cards${qs}`);
    return handleResponse<{ cards: any[], total: number }>(r);
  },
  create: async (data: any) => {
    const r = await apiFetch(`/cards`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return handleResponse<{ card: any }>(r);
  },
  get: async (cardId: string) => {
    const r = await apiFetch(`/cards/${cardId}`);
    return handleResponse<{ card: any }>(r);
  },
  update: async (cardId: string, data: any) => {
    const r = await apiFetch(`/cards/${cardId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
    return handleResponse<{ card: any }>(r);
  },
  publish: async (cardId: string) => {
    const r = await apiFetch(`/cards/${cardId}/publish`, {
      method: 'POST',
    });
    return handleResponse<{ card: any }>(r);
  },
};

export { APIError };
