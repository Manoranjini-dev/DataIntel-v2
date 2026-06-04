// ──────────────────────────────────────────────
// useDashboard Hook — Dashboard State Binding
// ──────────────────────────────────────────────

'use client';

import { useSyncExternalStore, useCallback } from 'react';
import {
  getDashboardState,
  subscribeToDashboard,
  addDashboardWidget as storeAddWidget,
  removeDashboardWidget as storeRemoveWidget,
  setDashboardWidgets,
  setDashboardLayouts,
  clearDashboardState,
} from '@/lib/store';
import type { LayoutItem } from '@/lib/store';
import type { DashboardWidgetResult } from '@/lib/types';

export function useDashboard() {
  const state = useSyncExternalStore(subscribeToDashboard, getDashboardState, getDashboardState);

  const addWidget = useCallback((widget: DashboardWidgetResult, layout: LayoutItem) => {
    storeAddWidget(widget, layout);
  }, []);

  const removeWidget = useCallback((id: string) => {
    storeRemoveWidget(id);
  }, []);

  const setWidgets = useCallback((widgets: DashboardWidgetResult[]) => {
    setDashboardWidgets(widgets);
  }, []);

  const setLayouts = useCallback((layouts: LayoutItem[]) => {
    setDashboardLayouts(layouts);
  }, []);

  const clear = useCallback(() => {
    clearDashboardState();
  }, []);

  return {
    widgets: state.widgets,
    layouts: state.layouts,
    addWidget,
    removeWidget,
    setWidgets,
    setLayouts,
    clear,
  };
}
