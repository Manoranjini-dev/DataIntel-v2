// ──────────────────────────────────────────────
// DefaultCardsService — chart-shape sanity tests
// Covers the bug where default cards rendered a pie chart sliced by a
// free-text "about" column and a line chart plotting raw "mo"/"yr" columns
// as separate mismatched-scale lines instead of one real trend.
// ──────────────────────────────────────────────

import { DefaultCardsService } from './default-cards.service';

function makeService(): DefaultCardsService {
  const db = {} as any;
  const llm = {} as any;
  const promptBuilder = {} as any;
  const mcp = {} as any;
  const config = { getOrThrow: jest.fn().mockReturnValue('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef') };
  const builder = {} as any;
  return new DefaultCardsService(db, llm, promptBuilder, mcp, config as any, builder);
}

describe('DefaultCardsService — categorical column selection', () => {
  let svc: any;
  beforeEach(() => { svc = makeService(); });

  function col(name: string, dataType: string, overrides: Partial<{ isPrimaryKey: boolean; isForeignKey: boolean }> = {}) {
    return { table: 'clinic', name, dataType, isPrimaryKey: false, isForeignKey: false, ...overrides };
  }

  it('excludes free-text columns (by name) from categorical selection', () => {
    const about = col('about', 'text');
    const status = col('status', 'varchar');
    const picked = svc.pickCategoricalDimension([about, status]);
    expect(picked.name).toBe('status');
  });

  it('excludes unbounded `text` columns even with a categorical-sounding name', () => {
    const notes = col('notes', 'text');
    const region = col('region', 'varchar');
    const picked = svc.pickCategoricalDimension([notes, region]);
    expect(picked.name).toBe('region');
  });

  it('prefers a column with a categorical name hint over a generic varchar', () => {
    const label = col('label', 'varchar');
    const tier = col('tier', 'varchar');
    const picked = svc.pickCategoricalDimension([label, tier]);
    expect(picked.name).toBe('tier');
  });

  it('returns undefined when every categorical candidate is free text', () => {
    const about = col('about', 'text');
    const bio = col('bio', 'varchar');
    expect(svc.pickCategoricalDimension([about, bio])).toBeUndefined();
  });

  it('heuristicSpecs falls back to a table (not a pie chart) when no real category exists', () => {
    const tables = [{
      name: 'clinic',
      rowEstimate: 100,
      columns: [
        col('id', 'uuid', { isPrimaryKey: true }),
        col('about', 'text'),
        col('description', 'text'),
      ],
    }];
    const specs = svc.heuristicSpecs(tables);
    const distribution = specs[3];
    expect(distribution.widgetType).toBe('table');
  });

  it('heuristicSpecs picks the real category for the distribution card when one exists', () => {
    const tables = [{
      name: 'clinic',
      rowEstimate: 100,
      columns: [
        col('id', 'uuid', { isPrimaryKey: true }),
        col('about', 'text'),
        col('status', 'varchar'),
        col('region', 'varchar'),
      ],
    }];
    const specs = svc.heuristicSpecs(tables);
    const distribution = specs[3];
    expect(distribution.widgetType).toBe('pie_chart');
    expect(distribution.prompt).not.toMatch(/about/i);
  });
});

describe('DefaultCardsService — post-execution chart-shape downgrade', () => {
  let svc: any;
  beforeEach(() => { svc = makeService(); });

  it('downgrades a pie_chart to a table when the label column is free-running prose', () => {
    const spec = { title: 'Clinic by About', widgetType: 'pie_chart', prompt: 'x' };
    const execResult = {
      sql: 'x',
      columns: ['about', 'record_count'],
      rows: [
        { about: 'Our clinic is dedicated to providing high-quality, patient-centered care in a welcoming environment.', record_count: 12 },
        { about: 'Very good clinic with experienced staff and modern equipment for every patient.', record_count: 8 },
      ],
    };
    const patch = svc.specFromExecResult(spec, execResult);
    expect(patch.widgetType).toBe('table');
  });

  it('keeps a pie_chart when the label column is a real short category', () => {
    const spec = { title: 'Appointments by Status', widgetType: 'pie_chart', prompt: 'x' };
    const execResult = {
      sql: 'x',
      columns: ['status', 'record_count'],
      rows: [
        { status: 'Confirmed', record_count: 120 },
        { status: 'Pending', record_count: 40 },
        { status: 'Cancelled', record_count: 15 },
      ],
    };
    const patch = svc.specFromExecResult(spec, execResult);
    expect(patch.widgetType).toBeUndefined();
  });

  it('downgrades a line_chart to a table when the result has separate date-fragment columns', () => {
    const spec = { title: 'Coverage Over Time', widgetType: 'line_chart', prompt: 'x' };
    const execResult = {
      sql: 'x',
      columns: ['mo', 'total_coverage', 'yr'],
      rows: [
        { mo: 1, total_coverage: 1000, yr: 2025 },
        { mo: 2, total_coverage: 1200, yr: 2025 },
        { mo: 3, total_coverage: 900, yr: 2026 },
      ],
    };
    const patch = svc.specFromExecResult(spec, execResult);
    expect(patch.widgetType).toBe('table');
  });

  it('keeps a line_chart for a clean single period-label + measure trend', () => {
    const spec = { title: 'Revenue Over Time', widgetType: 'line_chart', prompt: 'x' };
    const execResult = {
      sql: 'x',
      columns: ['month', 'total_revenue'],
      rows: [
        { month: '2025-01', total_revenue: 1000 },
        { month: '2025-02', total_revenue: 1200 },
        { month: '2025-03', total_revenue: 900 },
      ],
    };
    const patch = svc.specFromExecResult(spec, execResult);
    expect(patch.widgetType).toBeUndefined();
  });
});
