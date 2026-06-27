'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface TextCardProps {
  /** Markdown/rich-text content authored by the user (static annotation, not query-driven). */
  content: string;
  title?: string;
  compact?: boolean;
}

/** Free Text card — a static markdown annotation, not backed by a query result. */
export function TextCard({ content, title, compact }: TextCardProps) {
  return (
    <div className={`w-full flex flex-col bg-white ${compact ? 'h-full p-3 overflow-y-auto' : 'rounded-xl border border-zinc-200 p-4 shadow-sm'}`}>
      {title && (
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 shrink-0">
          {title}
        </p>
      )}
      <div className="text-sm text-zinc-700 leading-relaxed prose prose-sm max-w-none prose-p:my-1.5 prose-strong:text-zinc-900 prose-headings:text-zinc-900 prose-code:text-indigo-600 prose-code:bg-zinc-100 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
    </div>
  );
}
