// ──────────────────────────────────────────────
// Session Store — Client-Side Session State
// ──────────────────────────────────────────────

'use client';

// Module-level singleton store using useSyncExternalStore pattern.
// Hydrates initial state from localStorage on first load.

import type { ConnectionResponse, TableInfo, ChatMessage, DashboardWidgetResult } from './types';
import {
  saveConnection,
  loadConnection,
  clearPersistedConnection,
  saveMessages,
  loadMessages,
  saveDashboardState,
  loadDashboardState,
} from './storage';

interface LayoutItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  maxW?: number;
  maxH?: number;
}

interface SessionState {
  sessionId: string | null;
  connection: ConnectionResponse | null;
  tables: TableInfo[];
  messages: ChatMessage[];
  isConnected: boolean;
}

interface DashboardState {
  widgets: DashboardWidgetResult[];
  layouts: LayoutItem[];
}

function initState(): SessionState {
  const connection = loadConnection();
  if (connection) {
    return {
      sessionId: connection.sessionId,
      connection,
      tables: connection.tables,
      messages: loadMessages(),
      isConnected: true,
    };
  }
  return {
    sessionId: null,
    connection: null,
    tables: [],
    messages: [],
    isConnected: false,
  };
}

// Hydrate from localStorage on module load
let state: SessionState = initState();

// In-memory dashboard state (survives page navigations within tab)
let dashboardState: DashboardState = loadDashboardState() || { widgets: [], layouts: [] };

const listeners: Set<() => void> = new Set();
const dashboardListeners: Set<() => void> = new Set();

function notify() {
  listeners.forEach((l) => l());
}

function notifyDashboard() {
  dashboardListeners.forEach((l) => l());
}

export function getSessionState(): SessionState {
  return state;
}

export function setConnection(connection: ConnectionResponse) {
  state = {
    ...state,
    sessionId: connection.sessionId,
    connection,
    tables: connection.tables,
    isConnected: true,
  };
  saveConnection(connection);
  notify();
}

export function clearConnection() {
  state = {
    sessionId: null,
    connection: null,
    tables: [],
    messages: [],
    isConnected: false,
  };
  clearPersistedConnection();
  notify();
}

export function addMessage(message: ChatMessage) {
  state = {
    ...state,
    messages: [...state.messages, message],
  };
  saveMessages(state.messages);
  notify();
}

export function updateLastMessage(update: Partial<ChatMessage>) {
  const messages = [...state.messages];
  if (messages.length > 0) {
    messages[messages.length - 1] = { ...messages[messages.length - 1], ...update };
    state = { ...state, messages };
    saveMessages(state.messages);
    notify();
  }
}

export function updateMessageById(id: string, update: Partial<ChatMessage>) {
  const messages = state.messages.map((m) => (m.id === id ? { ...m, ...update } : m));
  state = { ...state, messages };
  saveMessages(state.messages);
  notify();
}

export function subscribeToSession(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ── Dashboard In-Memory Store ────────────────

export function getDashboardState(): DashboardState {
  return dashboardState;
}

export function setDashboardWidgets(widgets: DashboardWidgetResult[]) {
  dashboardState = { ...dashboardState, widgets };
  saveDashboardState(dashboardState);
  notifyDashboard();
}

export function setDashboardLayouts(layouts: LayoutItem[]) {
  dashboardState = { ...dashboardState, layouts };
  saveDashboardState(dashboardState);
  notifyDashboard();
}

export function addDashboardWidget(widget: DashboardWidgetResult, layout: LayoutItem) {
  dashboardState = {
    widgets: [...dashboardState.widgets, widget],
    layouts: [...dashboardState.layouts, layout],
  };
  saveDashboardState(dashboardState);
  notifyDashboard();
}

export function removeDashboardWidget(id: string) {
  dashboardState = {
    widgets: dashboardState.widgets.filter((w) => w.id !== id),
    layouts: dashboardState.layouts.filter((l) => l.i !== id),
  };
  saveDashboardState(dashboardState);
  notifyDashboard();
}

export function clearDashboardState() {
  dashboardState = { widgets: [], layouts: [] };
  saveDashboardState(dashboardState);
  notifyDashboard();
}

export function subscribeToDashboard(listener: () => void) {
  dashboardListeners.add(listener);
  return () => dashboardListeners.delete(listener);
}

export type { LayoutItem, DashboardState };

