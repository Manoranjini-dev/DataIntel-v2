// ──────────────────────────────────────────────
// Chart formatting helpers — human-friendly axis titles
// ──────────────────────────────────────────────
//
// Charts receive already-transformed result columns (raw DB column names or
// aggregation aliases). These helpers turn a column name into a readable axis
// title and produce consistent Recharts `label` props so every chart labels its
// axes the same way. Titles derive from the fields being plotted, so they update
// automatically whenever the visualization config changes the columns.

/** Acronyms to keep upper-cased when title-casing a field name. */
const ACRONYMS = new Set([
  'id', 'url', 'kpi', 'sku', 'roi', 'ctr', 'arpu', 'ltv', 'api', 'sql',
  'usd', 'eur', 'gbp', 'inr', 'ppc', 'cpc', 'cpm', 'aov', 'mrr', 'arr', 'yoy', 'mom',
]);

/**
 * Turn a database column name / alias into a user-friendly title.
 *   total_travel_insurance_coverage → "Total Travel Insurance Coverage"
 *   orders.created_at               → "Created At"
 *   customerCity                    → "Customer City"
 *   COUNT(*)                        → "Count"
 */
export function humanizeField(name?: string | null): string {
  if (name == null) return '';
  let s = String(name).trim();
  if (!s) return '';

  // Common SQL aggregate wrappers → readable verb.
  const aggMatch = s.match(/^(count|sum|avg|average|min|max|median)\s*\((.*)\)$/i);
  if (aggMatch) {
    const fn = aggMatch[1].toLowerCase();
    const inner = aggMatch[2].replace(/^distinct\s+/i, '').trim();
    const label = inner === '*' || inner === '' ? '' : humanizeField(inner);
    const verb = fn === 'avg' ? 'Average' : fn.charAt(0).toUpperCase() + fn.slice(1);
    return label ? `${verb} of ${label}` : verb;
  }

  s = s.replace(/^[a-z0-9_]+\./i, '');       // strip table/alias prefix
  s = s.replace(/["'`\[\]]/g, '');            // strip quoting
  s = s.replace(/[_\-]+/g, ' ');              // snake / kebab → spaces
  s = s.replace(/([a-z0-9])([A-Z])/g, '$1 $2'); // camelCase → spaced
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) return '';

  return s
    .split(' ')
    .map((w) => {
      const lw = w.toLowerCase();
      if (ACRONYMS.has(lw)) return w.toUpperCase();
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');
}

/** Consistent styling for the axis title text across every chart. */
export const AXIS_TITLE_STYLE = {
  fill: '#3f3f46',
  fontSize: 11,
  fontWeight: 600,
} as const;

/** Recharts `label` prop for an X-axis title (sits below the tick labels). */
export function xAxisLabel(text?: string | null) {
  const value = humanizeField(text);
  if (!value) return undefined;
  return {
    value,
    position: 'insideBottom' as const,
    offset: 0,
    style: { ...AXIS_TITLE_STYLE, textAnchor: 'middle' as const },
  };
}

/** Recharts `label` prop for a Y-axis title (rotated, beside the tick labels). */
export function yAxisLabel(text?: string | null) {
  const value = humanizeField(text);
  if (!value) return undefined;
  return {
    value,
    angle: -90,
    position: 'insideLeft' as const,
    offset: 0,
    style: { ...AXIS_TITLE_STYLE, textAnchor: 'middle' as const },
  };
}

/** Recharts `label` prop for a right-side Y-axis title (dual-axis combo charts). */
export function yAxisLabelRight(text?: string | null) {
  const value = humanizeField(text);
  if (!value) return undefined;
  return {
    value,
    angle: 90,
    position: 'insideRight' as const,
    offset: 0,
    style: { ...AXIS_TITLE_STYLE, textAnchor: 'middle' as const },
  };
}

/** Extra vertical space (px) an X-axis title needs below the ticks. */
export const X_TITLE_SPACE = 20;
/** Extra horizontal space (px) a rotated Y-axis title needs beside the ticks. */
export const Y_TITLE_SPACE = 18;
