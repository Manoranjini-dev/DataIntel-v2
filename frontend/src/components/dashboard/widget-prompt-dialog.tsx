'use client';

import { useState, useRef, useEffect } from 'react';
import { X, Zap } from 'lucide-react';
import type { PaletteItem } from './widget-palette';

interface WidgetPromptDialogProps {
  paletteItem: PaletteItem;
  onConfirm: (prompt: string) => void;
  onCancel: () => void;
  tables: string[];
}

export function WidgetPromptDialog({
  paletteItem,
  onConfirm,
  onCancel,
  tables,
}: WidgetPromptDialogProps) {
  const [prompt, setPrompt] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const Icon = paletteItem.icon;

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  // Quick suggestions based on widget type and tables
  const suggestions = getSuggestions(paletteItem.type, tables);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className={`flex h-8 w-8 items-center justify-center rounded-xl ${paletteItem.color}`}>
              <Icon className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">Add {paletteItem.label}</h3>
              <p className="text-[11px] text-zinc-500">Describe what data to visualize</p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <input
          ref={inputRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && prompt.trim()) onConfirm(prompt.trim());
            if (e.key === 'Escape') onCancel();
          }}
          placeholder="e.g., Show total revenue this month"
          className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
        />

        <div className="mt-3 flex flex-wrap gap-1.5">
          {suggestions.map((s, i) => (
            <button
              key={i}
              onClick={() => setPrompt(s)}
              className="rounded-full border border-zinc-800 px-2.5 py-1 text-[11px] text-zinc-500 transition-colors hover:border-indigo-500/30 hover:text-indigo-300"
            >
              {s}
            </button>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-300"
          >
            Cancel
          </button>
          <button
            onClick={() => prompt.trim() && onConfirm(prompt.trim())}
            disabled={!prompt.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-40"
          >
            <Zap className="h-3 w-3" />
            Add Widget
          </button>
        </div>
      </div>
    </div>
  );
}

function getSuggestions(type: string, tables: string[]): string[] {
  const t = tables[0] || 'data';
  const t2 = tables[1] || tables[0] || 'records';

  switch (type) {
    case 'metric_card':
      return [`Total records in ${t}`, `Count of ${t2}`, 'Total revenue'];
    case 'bar_chart':
      return [`${t} by category`, `Top 10 ${t}`, `Compare ${t} vs ${t2}`];
    case 'line_chart':
      return [`${t} trends over time`, 'Monthly growth', 'Daily activity'];
    case 'pie_chart':
      return [`${t} distribution`, 'Status breakdown', 'Category share'];
    case 'area_chart':
      return ['Cumulative growth', `${t} over time`, 'Revenue trend'];
    case 'stat_grid':
      return ['Key metrics overview', `${t} summary stats`, 'KPI dashboard'];
    case 'data_table':
      return [`Recent ${t}`, `Top ${t2} by value`, `All ${t} details`];
    case 'list':
      return [`List all emails`, `Names from ${t}`, 'Recent entries'];
    default:
      return [`Show ${t} data`, `Analyze ${t2}`];
  }
}
