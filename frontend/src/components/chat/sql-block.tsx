'use client';

import { useState, useMemo } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface SQLBlockProps {
  sql: string;
  /** Override the block label; auto-detected if omitted */
  label?: string;
}

/**
 * QueryBlock — renders validated SQL *or* ES DSL with syntax highlighting.
 * Auto-detects JSON (ES DSL) vs SQL based on content.
 */
export function SQLBlock({ sql, label }: SQLBlockProps) {
  const [copied, setCopied] = useState(false);

  const isJSON = useMemo(() => {
    const trimmed = sql.trim();
    return trimmed.startsWith('{') || trimmed.startsWith('[');
  }, [sql]);

  const displayLabel = label ?? (isJSON ? 'Elasticsearch DSL' : 'Validated SQL');

  const handleCopy = async () => {
    await navigator.clipboard.writeText(sql);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Pretty-print JSON for ES DSL, or highlight SQL
  const highlighted = useMemo(() => {
    if (isJSON) {
      try {
        const parsed = JSON.parse(sql);
        const pretty = JSON.stringify(parsed, null, 2);
        return highlightJSON(pretty);
      } catch {
        return highlightJSON(sql);
      }
    }
    return highlightSQL(sql);
  }, [sql, isJSON]);

  return (
    <div className="group relative rounded-lg border bg-muted/50">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <span className="text-xs font-medium text-muted-foreground">{displayLabel}</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 opacity-0 transition-opacity group-hover:opacity-100"
          onClick={handleCopy}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-success" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
      <pre className="overflow-x-auto p-4 text-sm">
        <code dangerouslySetInnerHTML={{ __html: highlighted }} />
      </pre>
    </div>
  );
}

/** JSON syntax highlighting for ES DSL */
function highlightJSON(json: string): string {
  let result = json
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Highlight property keys: "key":
  result = result.replace(
    /("(?:[^"\\]|\\.)*")\s*:/g,
    '<span class="text-blue-400">$1</span>:',
  );

  // Highlight string values (not keys)
  result = result.replace(
    /:\s*("(?:[^"\\]|\\.)*")/g,
    (match, str) => match.replace(str, `<span class="text-success">${str}</span>`),
  );

  // Highlight numbers
  result = result.replace(
    /:\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/g,
    (match, num) => match.replace(num, `<span class="text-amber-400">${num}</span>`),
  );

  // Highlight booleans and null
  result = result.replace(
    /:\s*(true|false|null)\b/g,
    (match, val) => match.replace(val, `<span class="text-accent">${val}</span>`),
  );

  return result;
}

function highlightSQL(sql: string): string {
  const keywords = [
    'SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER',
    'ON', 'AND', 'OR', 'NOT', 'IN', 'BETWEEN', 'LIKE', 'IS', 'NULL',
    'AS', 'ORDER', 'BY', 'GROUP', 'HAVING', 'LIMIT', 'OFFSET',
    'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'DISTINCT', 'CASE', 'WHEN',
    'THEN', 'ELSE', 'END', 'ASC', 'DESC', 'CROSS', 'FULL',
  ];

  let result = sql
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Highlight strings
  result = result.replace(
    /'[^']*'/g,
    (match) => `<span class="text-success">${match}</span>`,
  );

  // Highlight numbers
  result = result.replace(
    /\b(\d+)\b/g,
    '<span class="text-amber-400">$1</span>',
  );

  // Highlight keywords
  for (const kw of keywords) {
    const regex = new RegExp(`\\b(${kw})\\b`, 'gi');
    result = result.replace(
      regex,
      `<span class="text-blue-400 font-semibold">$1</span>`,
    );
  }

  return result;
}
