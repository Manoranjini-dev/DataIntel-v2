'use client';

import { useMemo } from 'react';
import { ComposableMap, Geographies, Geography, Marker, ZoomableGroup } from 'react-simple-maps';
import type { QueryExecutionResult } from '@/lib/types';

// World country boundaries (TopoJSON). Overridable for air-gapped deployments.
const GEO_URL =
  process.env.NEXT_PUBLIC_MAP_GEO_URL ||
  'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';

interface MapChartCardProps {
  execution: QueryExecutionResult;
  title?: string;
  compact?: boolean;
  /** Column with a country/region name → choropleth. */
  locationField?: string;
  /** Latitude/longitude columns → markers. */
  latField?: string;
  lonField?: string;
  /** Measure column shaded/sized on the map. */
  valueField?: string;
}

function isNumeric(rows: Record<string, unknown>[], col: string): boolean {
  return rows.slice(0, 20).filter((r) => r[col] != null).every((r) => !isNaN(Number(r[col])));
}

const LOCATION_HINTS = /country|nation|state|province|region|city|location|geo|place/i;
const LAT_HINTS = /^(lat|latitude)$/i;
const LON_HINTS = /^(lon|lng|long|longitude)$/i;

/** Light→indigo linear shade for a 0..1 fraction. */
function shade(frac: number): string {
  const from = [224, 231, 255]; // indigo-100
  const to = [79, 70, 229];     // indigo-600
  const c = from.map((f, i) => Math.round(f + (to[i] - f) * frac));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

function norm(name: string): string {
  return name.trim().toLowerCase()
    .replace(/^the\s+/, '')
    .replace('united states of america', 'united states')
    .replace('russian federation', 'russia')
    .replace(/\s+/g, ' ');
}

export function MapChartCard({
  execution, title, compact, locationField, latField, lonField, valueField,
}: MapChartCardProps) {
  const model = useMemo(() => {
    const { rows, columns } = execution;
    if (!rows || rows.length === 0) return null;

    const numericCols = columns.filter((c) => isNumeric(rows, c));
    const value = valueField || numericCols[0];

    // Marker mode when lat/lon are available (explicit or auto-detected).
    const lat = latField || columns.find((c) => LAT_HINTS.test(c));
    const lon = lonField || columns.find((c) => LON_HINTS.test(c));
    if (lat && lon) {
      const markers = rows
        .map((r) => ({
          lat: Number(r[lat]), lon: Number(r[lon]),
          value: value ? Number(r[value]) : 1,
          label: String(r[columns.find((c) => !isNumeric(rows, c)) || columns[0]] ?? ''),
        }))
        .filter((m) => !isNaN(m.lat) && !isNaN(m.lon));
      return { mode: 'markers' as const, markers, value };
    }

    // Choropleth mode by country name.
    const loc = locationField || columns.find((c) => LOCATION_HINTS.test(c));
    if (loc && value) {
      const byCountry = new Map<string, number>();
      for (const r of rows) {
        const key = norm(String(r[loc] ?? ''));
        if (!key) continue;
        byCountry.set(key, (byCountry.get(key) ?? 0) + (Number(r[value]) || 0));
      }
      const vals = Array.from(byCountry.values());
      const lo = Math.min(...vals, 0);
      const hi = Math.max(...vals, 1);
      return { mode: 'choropleth' as const, byCountry, lo, hi, value };
    }

    return { mode: 'unconfigured' as const };
  }, [execution, locationField, latField, lonField, valueField]);

  if (!model) return null;

  if (model.mode === 'unconfigured') {
    return (
      <div className={`w-full flex items-center justify-center bg-white text-center text-xs text-zinc-500 ${compact ? 'h-full p-2' : 'rounded-xl border border-zinc-200 p-6'}`}>
        Configure a location field (country) or latitude/longitude columns to render the map.
      </div>
    );
  }

  return (
    <div className={`w-full flex flex-col bg-white ${compact ? 'h-full p-1' : 'rounded-xl border border-zinc-200 p-3 shadow-sm'}`}>
      {title && (
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 shrink-0">{title}</p>
      )}
      <div className={`w-full ${compact ? 'flex-1 min-h-0' : ''}`}>
        <ComposableMap projectionConfig={{ scale: 130 }} width={800} height={compact ? 400 : 380} style={{ width: '100%', height: compact ? '100%' : 'auto' }}>
          <ZoomableGroup>
            <Geographies geography={GEO_URL}>
              {({ geographies }: any) =>
                geographies.map((geo: any) => {
                  let fill = '#f1f5f9';
                  if (model.mode === 'choropleth') {
                    const v = model.byCountry.get(norm(geo.properties.name || ''));
                    if (v != null) fill = shade(model.hi > model.lo ? (v - model.lo) / (model.hi - model.lo) : 0.5);
                  }
                  return (
                    <Geography
                      key={geo.rsmKey}
                      geography={geo}
                      fill={fill}
                      stroke="#cbd5e1"
                      strokeWidth={0.4}
                      style={{ default: { outline: 'none' }, hover: { fill: '#818cf8', outline: 'none' }, pressed: { outline: 'none' } }}
                    />
                  );
                })
              }
            </Geographies>
            {model.mode === 'markers' && model.markers.map((m, i) => (
              <Marker key={i} coordinates={[m.lon, m.lat]}>
                <circle r={4} fill="#6366f1" fillOpacity={0.75} stroke="#fff" strokeWidth={1} />
              </Marker>
            ))}
          </ZoomableGroup>
        </ComposableMap>
      </div>
    </div>
  );
}
