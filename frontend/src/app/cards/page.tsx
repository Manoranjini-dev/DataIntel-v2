'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { cardApi, connectionApi, chatApi } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { ShareCardModal } from '@/components/cards/ShareCardModal';
import { GenerativeUIRenderer } from '@/components/generative-ui';
import type { QueryExecutionResult, UIHint } from '@/lib/types';
import {
  Plus, Pencil, X, Check, ChevronRight, Sparkles, MoreHorizontal,
  BarChart2, TrendingUp, PieChart, Table2, Hash, RefreshCw, Share2,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────
type ChartType =
  | 'bar_chart' | 'line_chart' | 'pie_chart' | 'table'
  | 'metric_card' | 'area_chart' | 'donut_chart';

const CHART_OPTIONS: { type: ChartType; label: string; icon: React.ReactNode; desc: string }[] = [
  { type: 'bar_chart',   label: 'Bar Chart',   icon: <BarChart2 className="w-5 h-5" />,  desc: 'Compare categories' },
  { type: 'line_chart',  label: 'Line Chart',  icon: <TrendingUp className="w-5 h-5" />, desc: 'Trends over time'  },
  { type: 'pie_chart',   label: 'Pie Chart',   icon: <PieChart className="w-5 h-5" />,   desc: 'Part-to-whole'     },
  { type: 'donut_chart', label: 'Donut Chart', icon: <PieChart className="w-5 h-5" />,   desc: 'Ring chart'        },
  { type: 'area_chart',  label: 'Area Chart',  icon: <TrendingUp className="w-5 h-5" />, desc: 'Volume over time'  },
  { type: 'metric_card', label: 'Metric',      icon: <Hash className="w-5 h-5" />,       desc: 'Single KPI value'  },
  { type: 'table',       label: 'Data Table',  icon: <Table2 className="w-5 h-5" />,     desc: 'Tabular rows'      },
];

const CHART_ICON_MAP: Record<string, React.ReactNode> = {
  bar_chart:   <BarChart2 className="w-4 h-4" />,
  line_chart:  <TrendingUp className="w-4 h-4" />,
  pie_chart:   <PieChart className="w-4 h-4" />,
  donut_chart: <PieChart className="w-4 h-4" />,
  area_chart:  <TrendingUp className="w-4 h-4" />,
  metric_card: <Hash className="w-4 h-4" />,
  table:       <Table2 className="w-4 h-4" />,
};

const inputCls =
  'w-full px-3 py-2.5 bg-muted/60 border border-border rounded-xl text-sm text-foreground ' +
  'placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all';

const selectCls =
  'w-full px-3 py-2.5 bg-muted/60 border border-border rounded-xl text-sm text-foreground ' +
  'focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all';

// ── Helpers ────────────────────────────────────────────────────

/** Build a default visualization config from chart type + available column names. */
function buildDefaultVizConfig(
  chartType: ChartType,
  columns: string[],
): Record<string, unknown> {
  if (columns.length < 1) return {};
  switch (chartType) {
    case 'bar_chart':
    case 'line_chart':
    case 'area_chart':
      return columns.length >= 2
        ? { xAxis: columns[0], yAxis: columns[1] }
        : {};
    case 'pie_chart':
    case 'donut_chart':
      return columns.length >= 2
        ? { dimension: columns[0], value: columns[1] }
        : {};
    case 'metric_card':
      return { valueField: columns[columns.length - 1] };
    default:
      return {};
  }
}

/** Parse stored visualization_config safely. */
function parseVizConfig(raw: any): Record<string, string> {
  if (!raw) return {};
  try {
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return (obj as Record<string, string>) || {};
  } catch { return {}; }
}

/** Parse stored query_definition and return result_columns if present. */
function parseResultColumns(raw: any): string[] {
  try {
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(obj?.result_columns) ? obj.result_columns : [];
  } catch { return []; }
}

/** Map card chart_type to a valid UIHint (table → data_table). */
function chartTypeToUiHint(chartType: string): UIHint {
  if (chartType === 'table') return 'data_table';
  return chartType as UIHint;
}

/** Reconstruct a QueryExecutionResult from the stored card data for local rendering. */
function buildExecutionFromCard(card: any): QueryExecutionResult | null {
  let rows: Record<string, unknown>[] = [];
  let columns: string[] = [];

  // Prefer the last_result_preview from the query_executions join
  if (card.last_result_preview && Array.isArray(card.last_result_columns) && card.last_result_columns.length > 0) {
    try {
      const parsed = JSON.parse(card.last_result_preview);
      if (Array.isArray(parsed) && parsed.length > 0) {
        rows    = parsed;
        columns = card.last_result_columns;
      }
    } catch {}
  }

  // Fall back to rows stored inside query_definition
  if (!rows.length || !columns.length) {
    try {
      const qd = typeof card.query_definition === 'string'
        ? JSON.parse(card.query_definition)
        : card.query_definition;
      if (Array.isArray(qd?.result_rows) && qd.result_rows.length > 0) {
        rows    = qd.result_rows;
        columns = Array.isArray(qd.result_columns) ? qd.result_columns : [];
      }
    } catch {}
  }

  if (!rows.length || !columns.length) return null;

  return {
    sql: card.raw_query || '',
    explanation: '',
    tables_used: [],
    confidence: 1,
    executionTime: 0,
    rowCount: rows.length,
    rows,
    columns,
    ui_hint: chartTypeToUiHint(card.chart_type),
  };
}

// ── Axis Config Section ───────────────────────────────────────
// Shared between EditCardModal and NewCardModal step 4.
function AxisConfig({
  chartType,
  columns,
  xAxis, setXAxis,
  yAxis, setYAxis,
}: {
  chartType: ChartType;
  columns: string[];
  xAxis: string; setXAxis: (v: string) => void;
  yAxis: string; setYAxis: (v: string) => void;
}) {
  if (chartType === 'table' || columns.length < 2) return null;

  const isMetric = chartType === 'metric_card';
  const isPie    = chartType === 'pie_chart' || chartType === 'donut_chart';

  return (
    <div className={`grid gap-3 ${isMetric ? 'grid-cols-1' : 'grid-cols-2'}`}>
      {!isMetric && (
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1.5">
            {isPie ? 'Category column' : 'X Axis column'}
          </label>
          <select value={xAxis} onChange={e => setXAxis(e.target.value)} className={selectCls}>
            <option value="">— select —</option>
            {columns.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      )}
      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1.5">
          {isMetric ? 'Value field' : isPie ? 'Value column' : 'Y Axis column'}
        </label>
        <select value={yAxis} onChange={e => setYAxis(e.target.value)} className={selectCls}>
          <option value="">— select —</option>
          {columns.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
    </div>
  );
}

// ── Edit Card Modal ────────────────────────────────────────────
function EditCardModal({
  card,
  isOwner,
  onSave,
  onClose,
}: {
  card: any;
  isOwner: boolean;
  onSave: (updated: any) => void;
  onClose: () => void;
}) {
  const resolvedQuery = (() => {
    if (card.raw_query) return card.raw_query;
    try {
      const qd = typeof card.query_definition === 'string'
        ? JSON.parse(card.query_definition)
        : card.query_definition;
      return qd?.sql || '';
    } catch { return ''; }
  })();

  const storedColumns = parseResultColumns(card.query_definition);
  const storedViz     = parseVizConfig(card.visualization_config);

  const [name,      setName]      = useState(card.name || '');
  const [query,     setQuery]     = useState(resolvedQuery);
  const [chartType, setChartType] = useState<ChartType>(card.chart_type || 'table');
  const [xAxis,     setXAxis]     = useState(
    storedViz.xAxis || storedViz.dimension || storedColumns[0] || '',
  );
  const [yAxis,     setYAxis]     = useState(
    storedViz.yAxis || storedViz.value || storedViz.valueField || storedColumns[1] || '',
  );
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const vizConfig: Record<string, unknown> = {};
      if (chartType !== 'table') {
        if (chartType === 'metric_card') {
          if (yAxis) vizConfig.valueField = yAxis;
        } else if (chartType === 'pie_chart' || chartType === 'donut_chart') {
          if (xAxis) vizConfig.dimension = xAxis;
          if (yAxis) vizConfig.value = yAxis;
        } else {
          if (xAxis) vizConfig.xAxis = xAxis;
          if (yAxis) vizConfig.yAxis = yAxis;
        }
      }

      const { card: updated } = await cardApi.update(card.id, {
        name,
        rawQuery: query,
        chartType,
        ...(Object.keys(vizConfig).length ? { visualizationConfig: vizConfig } : {}),
      });

      // Auto-publish when the owner saves — keeps Cards consistent with Dashboard
      // (which also persists immediately). Non-owner editors leave it as draft.
      if (isOwner) {
        try {
          await cardApi.publish(updated.id);
          onSave({ ...updated, status: 'published' });
        } catch {
          onSave(updated);
        }
      } else {
        onSave(updated);
      }
      onClose();
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  }

  return (
    <div
      className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-2xl w-full max-w-lg shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-border">
          <h2 className="text-base font-semibold text-foreground">Edit Card</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Card name */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              Card name
            </label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              className={inputCls}
            />
          </div>

          {/* Visualization type */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              Visualization
            </label>
            <div className="grid grid-cols-4 gap-2">
              {CHART_OPTIONS.map(opt => (
                <button
                  key={opt.type}
                  onClick={() => setChartType(opt.type)}
                  className={`flex flex-col items-center gap-1 p-2.5 rounded-xl border-2 transition-all text-center
                    ${chartType === opt.type
                      ? 'border-[#2B2B2B] bg-[#2B2B2B]/5'
                      : 'border-border hover:border-border/80 hover:bg-muted/40'}`}
                >
                  <div className={chartType === opt.type ? 'text-[#F5A623]' : 'text-muted-foreground'}>
                    {opt.icon}
                  </div>
                  <p className="text-[10px] font-semibold text-foreground leading-tight">
                    {opt.label}
                  </p>
                </button>
              ))}
            </div>
          </div>

          {/* Axis / field configuration */}
          {storedColumns.length >= 2 && (
            <AxisConfig
              chartType={chartType}
              columns={storedColumns}
              xAxis={xAxis} setXAxis={setXAxis}
              yAxis={yAxis} setYAxis={setYAxis}
            />
          )}

          {/* Query */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              Query
            </label>
            <textarea
              value={query}
              onChange={e => setQuery(e.target.value)}
              rows={6}
              placeholder="SELECT ..."
              className={`${inputCls} font-mono resize-none`}
            />
          </div>
        </div>

        <div className="flex gap-2 px-6 pb-6">
          <button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="flex-1 py-2.5 bg-[#2B2B2B] hover:bg-[#3a3a3a] text-white rounded-xl text-sm font-semibold disabled:opacity-40 transition-colors"
          >
            {saving ? 'Saving…' : isOwner ? 'Save & Publish' : 'Save Changes'}
          </button>
          <button
            onClick={onClose}
            className="px-5 py-2.5 bg-muted hover:bg-muted/80 rounded-xl text-sm text-muted-foreground transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── New Card Modal (multi-step) ────────────────────────────────
function NewCardModal({
  connections,
  onCreated,
  onClose,
}: {
  connections: any[];
  onCreated: (card: any) => void;
  onClose: () => void;
}) {
  const [step,         setStep]         = useState<1 | 2 | 3 | 4>(1);
  const [query,        setQuery]        = useState('');
  const [chartType,    setChartType]    = useState<ChartType>('bar_chart');
  const [connectionId, setConnectionId] = useState(connections[0]?.id || '');
  const [preview,      setPreview]      = useState<any>(null);
  const [previewErr,   setPreviewErr]   = useState('');
  const [cardName,     setCardName]     = useState('');
  const [xAxis,        setXAxis]        = useState('');
  const [yAxis,        setYAxis]        = useState('');
  const [loading,      setLoading]      = useState(false);
  const [saving,       setSaving]       = useState(false);

  async function runPreview() {
    if (!query.trim() || !connectionId) return;
    setLoading(true);
    setPreviewErr('');
    try {
      const { chat } = await chatApi.create({ connectionId });
      const result   = await chatApi.ask(chat.id, query, true);
      const exec     = (result as any)?.execution;
      if (!exec?.rows?.length) {
        setPreviewErr('Query returned no data.');
      } else {
        setPreview(exec);
        // Pre-fill axis defaults from the returned columns
        const cols: string[] = exec.columns || [];
        const defaults = buildDefaultVizConfig(chartType, cols);
        setXAxis(
          (defaults as any).xAxis || (defaults as any).dimension || cols[0] || '',
        );
        setYAxis(
          (defaults as any).yAxis || (defaults as any).value ||
          (defaults as any).valueField || cols[1] || '',
        );
        setStep(4);
      }
    } catch (e: any) {
      setPreviewErr(e?.message || 'Query failed');
    } finally { setLoading(false); }
  }

  async function handleSave() {
    if (!cardName.trim()) return;
    setSaving(true);
    try {
      // Build visualization config from axis selections
      const vizConfig: Record<string, unknown> = (() => {
        if (chartType === 'table') return {};
        if (chartType === 'metric_card') return yAxis ? { valueField: yAxis } : {};
        if (chartType === 'pie_chart' || chartType === 'donut_chart') {
          return { ...(xAxis ? { dimension: xAxis } : {}), ...(yAxis ? { value: yAxis } : {}) };
        }
        return { ...(xAxis ? { xAxis } : {}), ...(yAxis ? { yAxis } : {}) };
      })();

      const { card } = await cardApi.create({
        name:                  cardName,
        chartType:             chartType,
        rawQuery:              query,
        visualizationConfig:   vizConfig,
        datasourceContextType: 'connection',
        datasourceContextId:   connectionId,
        queryDefinition: {
          prompt:         query,
          result_rows:    preview?.rows?.slice(0, 100),
          result_columns: preview?.columns,
          ui_hint:        chartType,
        },
      });

      // Auto-publish so Cards always start as complete visualizations
      try {
        await cardApi.publish(card.id);
        onCreated({ ...card, status: 'published' });
      } catch {
        onCreated(card);
      }
      onClose();
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  }

  const steps = ['Query', 'Chart type', 'Data source', 'Preview & save'];

  return (
    <div
      className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-2xl w-full max-w-xl shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header + stepper */}
        <div className="px-6 py-5 border-b border-border">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-foreground">New Card</h2>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex items-center gap-1">
            {steps.map((s, i) => {
              const n    = i + 1;
              const done = n < step;
              const cur  = n === step;
              return (
                <div key={s} className="flex items-center gap-1 flex-1">
                  <div className={`flex items-center gap-1.5 ${cur ? '' : done ? 'opacity-100' : 'opacity-40'}`}>
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 transition-colors
                      ${done ? 'bg-[#F5A623] text-[#2B2B2B]' : cur ? 'bg-[#2B2B2B] text-white' : 'bg-muted text-muted-foreground'}`}>
                      {done ? <Check className="w-3 h-3" /> : n}
                    </div>
                    <span className={`text-xs font-medium hidden sm:block ${cur ? 'text-foreground' : 'text-muted-foreground'}`}>
                      {s}
                    </span>
                  </div>
                  {i < steps.length - 1 && (
                    <div className={`flex-1 h-px mx-1 ${done ? 'bg-[#F5A623]/60' : 'bg-border'}`} />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Step content */}
        <div className="p-6">
          {/* Step 1: Query */}
          {step === 1 && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Write the SQL or natural-language query for this card.
              </p>
              <textarea
                value={query}
                onChange={e => setQuery(e.target.value)}
                rows={7}
                placeholder="SELECT region, SUM(revenue) AS total FROM sales GROUP BY region ORDER BY total DESC"
                className={`${inputCls} font-mono resize-none`}
                autoFocus
              />
            </div>
          )}

          {/* Step 2: Chart type */}
          {step === 2 && (
            <div className="grid grid-cols-3 gap-3">
              {CHART_OPTIONS.map(opt => (
                <button
                  key={opt.type}
                  onClick={() => setChartType(opt.type)}
                  className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all text-center
                    ${chartType === opt.type
                      ? 'border-[#2B2B2B] bg-[#2B2B2B]/5'
                      : 'border-border hover:border-border/80 hover:bg-muted/40'}`}
                >
                  <div className={chartType === opt.type ? 'text-[#F5A623]' : 'text-muted-foreground'}>
                    {opt.icon}
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-foreground">{opt.label}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{opt.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Step 3: Data source */}
          {step === 3 && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Choose the data source to run this query against.
              </p>
              {connections.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  No data sources configured yet.{' '}
                  <span className="text-primary underline cursor-pointer" onClick={onClose}>
                    Add one first
                  </span>
                </div>
              ) : (
                connections.map((conn: any) => (
                  <button
                    key={conn.id}
                    onClick={() => setConnectionId(conn.id)}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all text-left
                      ${connectionId === conn.id
                        ? 'border-[#2B2B2B] bg-[#2B2B2B]/5'
                        : 'border-border hover:border-border/80 hover:bg-muted/30'}`}
                  >
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-sm font-bold text-primary shrink-0">
                      {conn.connector_type?.[0]?.toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground">{conn.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {conn.connector_type} · {conn.host}
                      </p>
                    </div>
                    {connectionId === conn.id && (
                      <Check className="w-4 h-4 text-[#F5A623] shrink-0" />
                    )}
                  </button>
                ))
              )}
              {previewErr && (
                <p className="text-xs text-destructive bg-destructive/5 border border-destructive/20 rounded-xl px-3 py-2">
                  {previewErr}
                </p>
              )}
            </div>
          )}

          {/* Step 4: Preview & save */}
          {step === 4 && preview && (
            <div className="space-y-4">
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1.5">Card name</p>
                <input
                  value={cardName}
                  onChange={e => setCardName(e.target.value)}
                  placeholder="e.g. Revenue by Region"
                  className={inputCls}
                  autoFocus
                />
              </div>

              {/* Chart type badge */}
              <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/40 rounded-xl px-3 py-2">
                <span className="text-primary">{CHART_ICON_MAP[chartType]}</span>
                Saved as{' '}
                <span className="font-semibold text-foreground">
                  {CHART_OPTIONS.find(o => o.type === chartType)?.label}
                </span>
              </div>

              {/* Axis configuration (if applicable and columns available) */}
              {preview.columns?.length >= 2 && (
                <AxisConfig
                  chartType={chartType}
                  columns={preview.columns}
                  xAxis={xAxis} setXAxis={setXAxis}
                  yAxis={yAxis} setYAxis={setYAxis}
                />
              )}

              {/* Preview table */}
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1.5">
                  Preview{' '}
                  <span className="font-normal">
                    — {preview.rows.length} row{preview.rows.length !== 1 ? 's' : ''}
                  </span>
                </p>
                <div className="border border-border rounded-xl overflow-hidden">
                  <div className="overflow-x-auto max-h-48">
                    <table className="text-xs w-full">
                      <thead className="bg-muted/50 sticky top-0">
                        <tr>
                          {(preview.columns as string[]).map(c => (
                            <th
                              key={c}
                              className="px-3 py-2 text-left font-semibold text-muted-foreground whitespace-nowrap"
                            >
                              {c}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/50">
                        {preview.rows.slice(0, 10).map((row: any, i: number) => (
                          <tr key={i} className="hover:bg-muted/30">
                            {(preview.columns as string[]).map(c => (
                              <td
                                key={c}
                                className="px-3 py-2 text-foreground truncate max-w-[120px]"
                              >
                                {String(row[c] ?? '')}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-2 px-6 pb-6">
          {step > 1 && (
            <button
              onClick={() => setStep(s => (s - 1) as any)}
              className="px-4 py-2.5 bg-muted hover:bg-muted/80 rounded-xl text-sm text-muted-foreground transition-colors"
            >
              Back
            </button>
          )}

          {step < 3 && (
            <button
              onClick={() => setStep(s => (s + 1) as any)}
              disabled={step === 1 && !query.trim()}
              className="flex-1 py-2.5 bg-[#2B2B2B] hover:bg-[#3a3a3a] text-white rounded-xl text-sm font-semibold disabled:opacity-40 transition-colors flex items-center justify-center gap-2"
            >
              Next <ChevronRight className="w-4 h-4" />
            </button>
          )}

          {step === 3 && (
            <button
              onClick={runPreview}
              disabled={loading || !connectionId}
              className="flex-1 py-2.5 bg-[#2B2B2B] hover:bg-[#3a3a3a] text-white rounded-xl text-sm font-semibold disabled:opacity-40 transition-colors flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Running…
                </>
              ) : (
                <><ChevronRight className="w-4 h-4" /> Preview</>
              )}
            </button>
          )}

          {step === 4 && (
            <button
              onClick={handleSave}
              disabled={!cardName.trim() || saving}
              className="flex-1 py-2.5 bg-[#2B2B2B] hover:bg-[#3a3a3a] text-white rounded-xl text-sm font-semibold disabled:opacity-40 transition-colors"
            >
              {saving ? 'Saving…' : 'Save Card'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Card Actions Three-Dot Menu ────────────────────────────────
function CardActionsMenu({
  canEdit,
  isOwner,
  onEdit,
  onShare,
  onSuggestTitle,
}: {
  canEdit: boolean;
  isOwner: boolean;
  onEdit: () => void;
  onShare: () => void;
  onSuggestTitle: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors"
        title="More actions"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-44 bg-card border border-border rounded-xl shadow-xl z-50 overflow-hidden py-1">
          <button
            onClick={() => { setOpen(false); onSuggestTitle(); }}
            className="w-full text-left px-3 py-2 text-xs hover:bg-muted flex items-center gap-2 text-foreground transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5 text-primary" /> AI Suggest Title
          </button>
          {canEdit && (
            <button
              onClick={() => { setOpen(false); onEdit(); }}
              className="w-full text-left px-3 py-2 text-xs hover:bg-muted flex items-center gap-2 text-foreground transition-colors"
            >
              <Pencil className="w-3.5 h-3.5 text-muted-foreground" /> Edit Card
            </button>
          )}
          {isOwner && (
            <button
              onClick={() => { setOpen(false); onShare(); }}
              className="w-full text-left px-3 py-2 text-xs hover:bg-muted flex items-center gap-2 text-foreground transition-colors"
            >
              <Share2 className="w-3.5 h-3.5 text-muted-foreground" /> Share Card
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Live Card Tile ─────────────────────────────────────────────
function LiveCardTile({
  card,
  onEdit,
  onShare,
  onSave,
  canEdit,
  isOwner,
}: {
  card: any;
  onEdit: () => void;
  onShare: () => void;
  onSave: (updated: any) => void;
  canEdit: boolean;
  isOwner: boolean;
}) {
  const [execution, setExecution] = useState<QueryExecutionResult | null>(
    () => buildExecutionFromCard(card),
  );
  const [refreshing, setRefreshing]     = useState(false);
  const [suggestingTitle, setSuggestingTitle] = useState(false);
  const tileRef     = useRef<HTMLDivElement>(null);
  const executedRef = useRef(false);

  const runRefresh = useCallback(async () => {
    if (!card.raw_query || !card.connection_id || refreshing) return;
    setRefreshing(true);
    try {
      const { chats } = await chatApi.list({ connectionId: card.connection_id });
      let chatId: string;
      if (chats.length > 0) {
        chatId = chats[0].id;
      } else {
        const { chat } = await chatApi.create({ connectionId: card.connection_id });
        chatId = chat.id;
      }
      const result = await chatApi.executeDraft(chatId, '', card.raw_query);
      const exec   = result.execution ?? result;
      if (exec?.rows?.length > 0 && exec?.columns?.length > 0) {
        setExecution(prev => ({
          sql: card.raw_query || '',
          explanation: '',
          tables_used: [],
          confidence: 1,
          executionTime: exec.executionTime ?? 0,
          rowCount: exec.rows.length,
          rows: exec.rows,
          columns: exec.columns,
          ui_hint: chartTypeToUiHint(card.chart_type),
          ...(prev ? {} : {}),
        }));
      }
    } catch { /* silently fall back to stored data */ }
    finally { setRefreshing(false); }
  }, [card.raw_query, card.connection_id, card.chart_type, refreshing]);

  useEffect(() => {
    if (!card.raw_query || !card.connection_id) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !executedRef.current) {
          executedRef.current = true;
          runRefresh();
        }
      },
      { threshold: 0.1 },
    );
    if (tileRef.current) observer.observe(tileRef.current);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id]);

  async function handleSuggestTitle() {
    const prompt = card.raw_query || card.name || '';
    if (!prompt) return;
    setSuggestingTitle(true);
    try {
      const { title } = await chatApi.suggestTitle(prompt);
      if (title && title !== card.name) {
        const { card: updated } = await cardApi.update(card.id, { name: title });
        if (isOwner) {
          try { await cardApi.publish(updated.id); } catch {}
        }
        onSave({ ...card, ...updated, name: title });
      }
    } catch (e) { console.error(e); }
    finally { setSuggestingTitle(false); }
  }

  return (
    <div
      ref={tileRef}
      className="group bg-card border border-border rounded-2xl hover:border-[#2B2B2B]/20 hover:shadow-md transition-all flex flex-col"
    >
      {/* Header */}
      <div className="px-4 pt-4 pb-2 flex items-start justify-between shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center text-muted-foreground shrink-0">
            {CHART_ICON_MAP[card.chart_type] ?? <Table2 className="w-4 h-4" />}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-foreground line-clamp-1">
              {suggestingTitle ? '✨ Generating title…' : card.name}
            </p>
            <p className="text-[10px] text-muted-foreground capitalize">
              {card.chart_type?.replace(/_/g, ' ')}
              {!isOwner && card.created_by_name && (
                <span className="ml-1 text-muted-foreground/70">· by {card.created_by_name}</span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={() => { executedRef.current = false; runRefresh(); }}
            disabled={refreshing}
            title="Refresh live data"
            className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-all"
          >
            <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
          <CardActionsMenu
            canEdit={canEdit}
            isOwner={isOwner}
            onEdit={onEdit}
            onShare={onShare}
            onSuggestTitle={handleSuggestTitle}
          />
        </div>
      </div>

      {/* Visualization — actual chart/table via GenerativeUIRenderer */}
      <div className="px-3 pb-2" style={{ height: '220px' }}>
        {refreshing && !execution ? (
          <div className="h-full flex items-center justify-center gap-2">
            <div className="w-4 h-4 border-2 border-primary/40 border-t-primary rounded-full animate-spin" />
            <span className="text-xs text-muted-foreground">Loading…</span>
          </div>
        ) : execution ? (
          <GenerativeUIRenderer
            execution={execution}
            uiHint={chartTypeToUiHint(card.chart_type)}
            compact
          />
        ) : (
          <div className="h-full flex flex-col items-center justify-center gap-2">
            <p className="text-xs text-muted-foreground">No saved data</p>
            {card.raw_query && card.connection_id && (
              <button
                onClick={() => { executedRef.current = false; runRefresh(); }}
                className="text-xs text-primary hover:underline font-medium"
              >
                Load live data
              </button>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 pb-3 pt-1 flex items-center justify-between shrink-0">
        <p className="text-[10px] text-muted-foreground">
          v{card.current_version} · {new Date(card.updated_at).toLocaleDateString()}
        </p>
        {refreshing && (
          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
            <div className="w-2 h-2 border border-muted-foreground/40 border-t-muted-foreground rounded-full animate-spin" />
            Refreshing
          </span>
        )}
      </div>
    </div>
  );
}

// ── Cards Page ─────────────────────────────────────────────────
export default function CardsPage() {
  const currentUser = useAuthStore(s => s.user);
  const isViewer    = currentUser?.role === 'VIEWER';

  const [cards,       setCards]       = useState<any[]>([]);
  const [total,       setTotal]       = useState(0);
  const [connections, setConnections] = useState<any[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [search,      setSearch]      = useState('');
  // Viewers default to shared_with_me — they can't own cards
  const [activeTab,   setActiveTab]   = useState<'my_cards' | 'shared_with_me'>(
    isViewer ? 'shared_with_me' : 'my_cards',
  );
  const [editingCard, setEditingCard] = useState<any>(null);
  const [sharingCard, setSharingCard] = useState<any>(null);
  const [showNew,     setShowNew]     = useState(false);

  const loadCards = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { view: activeTab };
      if (search) params.search = search;
      const [{ cards: c, total: t }, { connections: conns }] = await Promise.all([
        cardApi.list(params),
        connectionApi.list(),
      ]);
      setCards(c);
      setTotal(t);
      setConnections(conns);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [search, activeTab]);

  useEffect(() => { loadCards(); }, [loadCards]);

  function handleCardSaved(updated: any) {
    setCards(cs => cs.map(c => c.id === updated.id ? { ...c, ...updated } : c));
  }

  function handleCardCreated(card: any) {
    if (activeTab === 'my_cards') {
      setCards(cs => [card, ...cs]);
      setTotal(t => t + 1);
    }
  }

  const tabCounts = activeTab === 'my_cards' ? total : undefined;

  return (
    <div className="flex-1 overflow-auto bg-background">
      <div className="max-w-5xl mx-auto px-8 py-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-2xl font-bold text-foreground tracking-tight">Cards</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Reusable chart widgets backed by a query
            </p>
          </div>
          {!isViewer && activeTab === 'my_cards' && (
            <button
              onClick={() => setShowNew(true)}
              className="flex items-center gap-2 px-4 py-2.5 bg-[#2B2B2B] hover:bg-[#3a3a3a] text-white rounded-xl text-sm font-semibold transition-colors"
            >
              <Plus className="w-4 h-4" /> New Card
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 mb-5 border-b border-border">
          {(['my_cards', 'shared_with_me'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors -mb-px border-b-2 ${
                activeTab === tab
                  ? 'border-[#2B2B2B] text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab === 'my_cards' ? 'My Cards' : 'Shared With Me'}
              {activeTab === tab && total > 0 && (
                <span className="ml-1.5 text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full">
                  {total}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="mb-6">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={activeTab === 'my_cards' ? 'Search my cards…' : 'Search shared cards…'}
            className="w-full max-w-sm px-3 py-2.5 bg-card border border-border rounded-xl text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
          />
        </div>

        {/* Grid */}
        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : cards.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 border-2 border-dashed border-border rounded-2xl">
            <div className="text-4xl mb-3">
              {activeTab === 'my_cards' ? '📋' : '🔗'}
            </div>
            <p className="text-sm font-semibold text-foreground mb-1">
              {activeTab === 'my_cards' ? 'No cards yet' : 'Nothing shared with you yet'}
            </p>
            <p className="text-xs text-muted-foreground mb-5">
              {activeTab === 'my_cards'
                ? 'Cards are reusable chart widgets backed by a query'
                : 'Cards that others share with you will appear here'}
            </p>
            {!isViewer && activeTab === 'my_cards' && (
              <button
                onClick={() => setShowNew(true)}
                className="flex items-center gap-2 px-4 py-2.5 bg-[#2B2B2B] text-white rounded-xl text-sm font-semibold hover:bg-[#3a3a3a] transition-colors"
              >
                <Plus className="w-4 h-4" /> New Card
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {cards.map((card: any) => {
              const isOwner  = card.is_owner !== false;
              const canEdit  = card.can_edit !== false;
              return (
                <LiveCardTile
                  key={card.id}
                  card={card}
                  isOwner={isOwner}
                  canEdit={canEdit}
                  onEdit={() => setEditingCard(card)}
                  onShare={() => setSharingCard(card)}
                  onSave={handleCardSaved}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Edit modal */}
      {editingCard && (
        <EditCardModal
          card={editingCard}
          isOwner={editingCard.is_owner !== false}
          onSave={handleCardSaved}
          onClose={() => setEditingCard(null)}
        />
      )}

      {/* Share modal */}
      {sharingCard && (
        <ShareCardModal
          cardId={sharingCard.id}
          cardName={sharingCard.name}
          onClose={() => setSharingCard(null)}
        />
      )}

      {/* New card modal */}
      {showNew && (
        <NewCardModal
          connections={connections}
          onCreated={handleCardCreated}
          onClose={() => setShowNew(false)}
        />
      )}
    </div>
  );
}
