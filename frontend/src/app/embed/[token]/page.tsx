'use client';

// ──────────────────────────────────────────────
// Public embedded dashboard (DB2-03)
// Chrome-less, read-only render of a published + embed-enabled dashboard,
// authenticated purely by the opaque token in the URL. Responsive: desktop
// keeps the saved layout; phones/tablets stack cards in a single column.
// ──────────────────────────────────────────────

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { Responsive, WidthProvider } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import { dashboardApi } from '@/lib/api';
import { applyVisualizationConfig } from '@/lib/aggregation';
import { GenerativeUIRenderer } from '@/components/generative-ui';
import { TextCard } from '@/components/generative-ui/text-card';
import { ImageCard } from '@/components/generative-ui/image-card';

const ResponsiveGridLayout = WidthProvider(Responsive);
const GRID_COLS = 12;
const ROW_H = 80;

interface EmbWidget {
  id: string;
  title?: string;
  widget_type?: string;
  ui_hint?: string;
  visualization_config?: any;
  result_rows?: Record<string, unknown>[];
  result_columns?: string[];
  text_content?: string;
  image_url?: string;
  image_caption?: string;
  query_definition?: any;
  grid_x?: number; grid_y?: number; grid_w?: number; grid_h?: number;
}

function EmbeddedWidget({ widget }: { widget: EmbWidget }) {
  const qd = typeof widget.query_definition === 'string'
    ? (() => { try { return JSON.parse(widget.query_definition); } catch { return {}; } })()
    : (widget.query_definition || {});
  const rawRows = widget.result_rows || qd.rows || [];
  const rawColumns = widget.result_columns || qd.columns || [];
  const { rows, columns } = applyVisualizationConfig(rawRows, rawColumns, widget.visualization_config);
  const hint = widget.visualization_config?.vizType || widget.ui_hint || widget.widget_type || 'table';

  return (
    <div className="h-full w-full rounded-xl border border-border bg-card overflow-hidden flex flex-col">
      {widget.title && (
        <div className="px-3 pt-2.5 pb-1 shrink-0">
          <p className="text-xs font-semibold text-foreground truncate">{widget.title}</p>
        </div>
      )}
      <div className="flex-1 min-h-0 p-2">
        {widget.widget_type === 'text' ? (
          <TextCard content={String(widget.text_content ?? qd.text_content ?? '')} />
        ) : widget.widget_type === 'image' ? (
          <ImageCard imageUrl={String(widget.image_url ?? qd.image_url ?? '')} caption={String(widget.image_caption ?? qd.image_caption ?? '')} />
        ) : rows.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-muted-foreground">No data</div>
        ) : (
          <GenerativeUIRenderer
            execution={{ rows, columns, rowCount: rows.length, executionTimeMs: 0 } as any}
            uiHint={hint as any}
            compact
            showLegend={widget.visualization_config?.showLegend}
            config={widget.visualization_config}
          />
        )}
      </div>
    </div>
  );
}

export default function EmbeddedDashboardPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<{ dashboard: any; pages: any[] } | null>(null);
  const [error, setError] = useState('');
  const [activePage, setActivePage] = useState(0);

  useEffect(() => {
    dashboardApi.getEmbedded(token)
      .then((r) => { setData(r); })
      .catch((e) => setError(e?.structured?.message || e?.message || 'This dashboard is not available.'));
  }, [token]);

  const page = data?.pages?.[activePage];
  const widgets: EmbWidget[] = page?.widgets || [];

  // Desktop keeps saved positions; phones/tablets stack full-width in order.
  const layouts = useMemo(() => {
    const desktop = widgets.map((w) => ({
      i: String(w.id), x: w.grid_x ?? 0, y: w.grid_y ?? 0,
      w: w.grid_w ?? 4, h: w.grid_h ?? 4,
    }));
    let stackY = 0;
    const stacked = (cols: number) => widgets.map((w) => {
      const h = Math.max(3, w.grid_h ?? 4);
      const item = { i: String(w.id), x: 0, y: stackY, w: cols, h };
      stackY += h;
      return item;
    });
    const md = desktop;
    const sm = widgets.map((w) => ({ i: String(w.id), x: 0, y: (w.grid_y ?? 0), w: Math.min(6, w.grid_w ?? 6), h: w.grid_h ?? 4 }));
    stackY = 0; const xs = stacked(4);
    stackY = 0; const xxs = stacked(2);
    return { lg: desktop, md, sm, xs, xxs };
  }, [widgets]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6 text-center">
        <div>
          <p className="text-sm font-semibold text-foreground">Dashboard unavailable</p>
          <p className="text-xs text-muted-foreground mt-1">{error}</p>
        </div>
      </div>
    );
  }
  if (!data) {
    return <div className="min-h-screen flex items-center justify-center bg-background text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
        <h1 className="text-sm font-bold text-foreground truncate">{data.dashboard?.name}</h1>
        {data.pages.length > 1 && (
          <div className="flex gap-1 overflow-x-auto">
            {data.pages.map((p, i) => (
              <button
                key={p.id}
                onClick={() => setActivePage(i)}
                className={`px-2.5 py-1 rounded-lg text-[11px] whitespace-nowrap transition-colors ${i === activePage ? 'bg-primary/15 text-primary font-semibold' : 'text-muted-foreground hover:bg-muted'}`}
              >
                {p.name || `Page ${i + 1}`}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="p-3">
        {widgets.length === 0 ? (
          <div className="py-20 text-center text-sm text-muted-foreground">This page has no widgets.</div>
        ) : (
          <ResponsiveGridLayout
            className="layout"
            layouts={layouts}
            breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
            cols={{ lg: GRID_COLS, md: GRID_COLS, sm: 6, xs: 4, xxs: 2 }}
            rowHeight={ROW_H}
            margin={[12, 12]}
            containerPadding={[0, 0]}
            isDraggable={false}
            isResizable={false}
          >
            {widgets.map((w) => (
              <div key={String(w.id)}>
                <EmbeddedWidget widget={w} />
              </div>
            ))}
          </ResponsiveGridLayout>
        )}
      </div>

      <div className="px-4 py-2 text-center">
        <span className="text-[10px] text-muted-foreground">Powered by C1X DataIntel</span>
      </div>
    </div>
  );
}
