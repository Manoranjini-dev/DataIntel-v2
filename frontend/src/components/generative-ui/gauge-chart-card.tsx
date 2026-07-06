'use client';

import { useMemo } from 'react';
import type { QueryExecutionResult } from '@/lib/types';

interface GaugeChartCardProps {
  execution: QueryExecutionResult;
  title?: string;
  compact?: boolean;
  /** KPI target/threshold; when set, the gauge shows a marker + % of target. */
  target?: number;
  min?: number;
  max?: number;
}

function isNumeric(rows: Record<string, unknown>[], col: string): boolean {
  return rows.slice(0, 20).filter((r) => r[col] != null).every((r) => !isNaN(Number(r[col])));
}

/** Polar → cartesian for a gauge whose sweep is the top semicircle. */
function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const a = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy - r * Math.sin(a) };
}

/** Arc path from startAngle→endAngle (degrees, 180=left … 0=right). */
function arc(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const start = polar(cx, cy, r, startAngle);
  const end = polar(cx, cy, r, endAngle);
  const largeArc = Math.abs(endAngle - startAngle) > 180 ? 1 : 0;
  // sweep=1 draws clockwise from start(180°) to end(0°) across the top.
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}

export function GaugeChartCard({ execution, title, compact, target, min, max }: GaugeChartCardProps) {
  const model = useMemo(() => {
    const { rows, columns } = execution;
    if (!rows || rows.length === 0) return null;
    const numericCol = columns.find((c) => isNumeric(rows, c));
    if (!numericCol) return null;

    // Single KPI: the value if one row, else the total across rows.
    const value = rows.length === 1
      ? Number(rows[0][numericCol])
      : rows.reduce((s, r) => s + (Number(r[numericCol]) || 0), 0);

    const lo = min ?? 0;
    const hi = max ?? (target != null ? Math.max(target * 1.25, value) : Math.max(value * 1.25, 1));
    const frac = hi > lo ? Math.min(1, Math.max(0, (value - lo) / (hi - lo))) : 0;
    const targetFrac = target != null && hi > lo ? Math.min(1, Math.max(0, (target - lo) / (hi - lo))) : null;

    return { value, lo, hi, frac, target, targetFrac, label: numericCol };
  }, [execution, target, min, max]);

  if (!model) return null;

  const W = 200, H = 120, cx = 100, cy = 105, r = 82;
  // Value angle: 180° (empty) → 0° (full).
  const valueAngle = 180 - model.frac * 180;
  const overTarget = model.target != null && model.value >= model.target;
  const valueColor = model.target != null ? (overTarget ? '#10b981' : '#f59e0b') : '#6366f1';

  return (
    <div className={`w-full flex flex-col items-center justify-center bg-white ${compact ? 'h-full p-1' : 'rounded-xl border border-zinc-200 p-3 shadow-sm'}`}>
      {title && (
        <p className="mb-1 self-start text-[11px] font-semibold uppercase tracking-wider text-zinc-500 shrink-0">{title}</p>
      )}
      <div className="flex-1 min-h-0 flex items-center justify-center w-full">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full max-h-[180px]" role="img" aria-label="gauge">
          {/* track */}
          <path d={arc(cx, cy, r, 180, 0)} fill="none" stroke="#e4e4e7" strokeWidth={14} strokeLinecap="round" />
          {/* value */}
          <path d={arc(cx, cy, r, 180, valueAngle)} fill="none" stroke={valueColor} strokeWidth={14} strokeLinecap="round" />
          {/* target marker */}
          {model.targetFrac != null && (() => {
            const a = 180 - model.targetFrac * 180;
            const p1 = polar(cx, cy, r - 11, a);
            const p2 = polar(cx, cy, r + 11, a);
            return <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="#18181b" strokeWidth={2.5} />;
          })()}
          {/* value label */}
          <text x={cx} y={cy - 18} textAnchor="middle" className="fill-zinc-900" style={{ fontSize: 24, fontWeight: 700 }}>
            {model.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </text>
          {model.target != null && (
            <text x={cx} y={cy + 2} textAnchor="middle" className="fill-zinc-500" style={{ fontSize: 11 }}>
              {Math.round((model.value / model.target) * 100)}% of {model.target.toLocaleString()}
            </text>
          )}
        </svg>
      </div>
    </div>
  );
}
