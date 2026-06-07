'use client';

import { useDraggable } from '@dnd-kit/core';
import {
  BarChart3,
  LineChart,
  PieChart,
  TrendingUp,
  Hash,
  Table2,
  List,
  LayoutGrid,
  GripVertical,
  Circle,
  AlignLeft,
  Activity,
  Radar,
  Gauge,
  ArrowUpDown,
  GitCompare,
  Filter,
  Clock,
  TreePine,
  type LucideIcon,
} from 'lucide-react';
import type { UIHint } from '@/lib/types';

export interface PaletteItem {
  type: UIHint;
  label: string;
  description: string;
  icon: LucideIcon;
  defaultSize: 'sm' | 'md' | 'lg';
  color: string;
}

export const PALETTE_ITEMS: PaletteItem[] = [
  {
    type: 'metric_card',
    label: 'Metric Card',
    description: 'Single KPI value',
    icon: Hash,
    defaultSize: 'sm',
    color: 'text-success bg-success/10',
  },
  {
    type: 'bar_chart',
    label: 'Bar Chart',
    description: 'Category comparison',
    icon: BarChart3,
    defaultSize: 'md',
    color: 'text-blue-400 bg-blue-500/10',
  },
  {
    type: 'line_chart',
    label: 'Line Chart',
    description: 'Trends over time',
    icon: LineChart,
    defaultSize: 'md',
    color: 'text-primary bg-primary/10',
  },
  {
    type: 'pie_chart',
    label: 'Pie Chart',
    description: 'Proportional data',
    icon: PieChart,
    defaultSize: 'md',
    color: 'text-amber-400 bg-amber-500/10',
  },
  {
    type: 'area_chart',
    label: 'Area Chart',
    description: 'Accumulated trends',
    icon: TrendingUp,
    defaultSize: 'md',
    color: 'text-cyan-400 bg-cyan-500/10',
  },
  {
    type: 'stat_grid',
    label: 'Stat Grid',
    description: 'Multiple KPIs',
    icon: LayoutGrid,
    defaultSize: 'md',
    color: 'text-rose-400 bg-rose-500/10',
  },
  {
    type: 'data_table',
    label: 'Data Table',
    description: 'Tabular data view',
    icon: Table2,
    defaultSize: 'lg',
    color: 'text-zinc-400 bg-zinc-500/10',
  },
  {
    type: 'list',
    label: 'List',
    description: 'Simple text listing',
    icon: List,
    defaultSize: 'md',
    color: 'text-indigo-400 bg-indigo-500/10',
  },
  {
    type: 'donut_chart',
    label: 'Donut Chart',
    description: 'Ring proportional view',
    icon: Circle,
    defaultSize: 'md',
    color: 'text-orange-400 bg-orange-500/10',
  },
  {
    type: 'stacked_bar',
    label: 'Stacked Bar',
    description: 'Layered comparison',
    icon: AlignLeft,
    defaultSize: 'md',
    color: 'text-teal-400 bg-teal-500/10',
  },
  {
    type: 'horizontal_bar',
    label: 'Horizontal Bar',
    description: 'Sideways category bars',
    icon: BarChart3,
    defaultSize: 'md',
    color: 'text-sky-400 bg-sky-500/10',
  },
  {
    type: 'scatter_plot',
    label: 'Scatter Plot',
    description: 'Correlate two variables',
    icon: Activity,
    defaultSize: 'md',
    color: 'text-pink-400 bg-pink-500/10',
  },
  {
    type: 'radar_chart',
    label: 'Radar Chart',
    description: 'Multi-axis overview',
    icon: Radar,
    defaultSize: 'md',
    color: 'text-accent bg-primary/10',
  },
  {
    type: 'gauge',
    label: 'Gauge',
    description: 'Progress / threshold',
    icon: Gauge,
    defaultSize: 'sm',
    color: 'text-lime-400 bg-lime-500/10',
  },
  {
    type: 'number_trend',
    label: 'Number Trend',
    description: 'KPI with trend arrow',
    icon: ArrowUpDown,
    defaultSize: 'sm',
    color: 'text-fuchsia-400 bg-fuchsia-500/10',
  },
  {
    type: 'comparison_card',
    label: 'Comparison',
    description: 'Side-by-side metrics',
    icon: GitCompare,
    defaultSize: 'md',
    color: 'text-yellow-400 bg-yellow-500/10',
  },
  {
    type: 'funnel_chart',
    label: 'Funnel',
    description: 'Conversion pipeline',
    icon: Filter,
    defaultSize: 'md',
    color: 'text-red-400 bg-red-500/10',
  },
  {
    type: 'timeline',
    label: 'Timeline',
    description: 'Chronological events',
    icon: Clock,
    defaultSize: 'lg',
    color: 'text-success bg-success/10',
  },
  {
    type: 'treemap',
    label: 'Treemap',
    description: 'Hierarchical breakdown',
    icon: TreePine,
    defaultSize: 'lg',
    color: 'text-stone-400 bg-stone-500/10',
  },
];

function DraggablePaletteItem({ item }: { item: PaletteItem }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette-${item.type}`,
    data: { paletteItem: item },
  });

  const Icon = item.icon;

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`flex cursor-grab items-center gap-2.5 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2.5 transition-all hover:border-zinc-700 hover:bg-zinc-800/60 active:cursor-grabbing ${
        isDragging ? 'scale-105 opacity-60 shadow-xl ring-2 ring-indigo-500/30' : ''
      }`}
    >
      <GripVertical className="h-3 w-3 shrink-0 text-zinc-600" />
      <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${item.color}`}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium text-zinc-300">{item.label}</p>
        <p className="text-[10px] text-zinc-600">{item.description}</p>
      </div>
    </div>
  );
}

export function WidgetPalette() {
  return (
    <div className="space-y-1.5">
      <p className="px-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        Drag widgets to dashboard
      </p>
      <div className="space-y-1.5">
        {PALETTE_ITEMS.map((item) => (
          <DraggablePaletteItem key={item.type} item={item} />
        ))}
      </div>
    </div>
  );
}
