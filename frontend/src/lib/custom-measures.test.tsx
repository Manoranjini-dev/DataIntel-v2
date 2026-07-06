import {
  compileFormula,
  validateFormula,
  applyCustomMeasures,
  type CustomMeasure,
} from './custom-measures';
import { applyVisualizationConfig } from './aggregation';

describe('compileFormula / evaluate', () => {
  const row = { revenue: 100, cost: 40, qty: 5, name: 'x' };

  it('evaluates basic arithmetic with bracketed fields', () => {
    expect(compileFormula('[revenue] - [cost]').evaluate(row)).toBe(60);
  });

  it('respects operator precedence and parentheses', () => {
    expect(compileFormula('revenue - cost * 2').evaluate(row)).toBe(20);
    expect(compileFormula('(revenue - cost) * 2').evaluate(row)).toBe(120);
  });

  it('supports bare identifiers and percentages', () => {
    expect(compileFormula('cost / revenue * 100').evaluate(row)).toBe(40);
  });

  it('supports functions', () => {
    expect(compileFormula('round([cost] / [qty], 1)').evaluate(row)).toBe(8);
    expect(compileFormula('max(revenue, cost)').evaluate(row)).toBe(100);
    expect(compileFormula('coalesce([missing], 0)').evaluate(row)).toBe(0);
    expect(compileFormula('abs(cost - revenue)').evaluate(row)).toBe(60);
  });

  it('handles unary minus and exponent (right-assoc)', () => {
    expect(compileFormula('-cost + revenue').evaluate(row)).toBe(60);
    expect(compileFormula('2 ^ 3 ^ 2').evaluate(row)).toBe(512);
  });

  it('returns null on divide-by-zero / non-finite', () => {
    expect(compileFormula('revenue / 0').evaluate(row)).toBeNull();
  });

  it('returns null when a referenced field is missing/non-numeric', () => {
    expect(compileFormula('[name] * 2').evaluate(row)).toBeNull();
  });

  it('collects referenced fields', () => {
    expect(compileFormula('[a] + b * round(c, 2)').referencedFields.sort()).toEqual(['a', 'b', 'c']);
  });

  it('throws on malformed input', () => {
    expect(() => compileFormula('1 +')).toThrow();
    expect(() => compileFormula('foo(')).toThrow();
    expect(() => compileFormula('(1 + 2')).toThrow();
    expect(() => compileFormula('bogus(1)')).toThrow(/Unknown function/);
  });
});

describe('validateFormula', () => {
  const fields = ['revenue', 'cost'];

  it('accepts a valid formula referencing known fields', () => {
    expect(validateFormula('[revenue] - [cost]', fields)).toEqual(
      expect.objectContaining({ valid: true }),
    );
  });

  it('rejects unknown fields (case-insensitive match)', () => {
    const res = validateFormula('[Revenue] - [profit]', fields);
    expect(res.valid).toBe(false);
    expect(res.error).toMatch(/profit/);
  });

  it('rejects syntax errors without throwing', () => {
    const res = validateFormula('revenue +', fields);
    expect(res.valid).toBe(false);
  });
});

describe('applyCustomMeasures', () => {
  const rows = [{ revenue: 100, cost: 40 }, { revenue: 50, cost: 30 }];
  const cols = ['revenue', 'cost'];

  it('adds computed columns', () => {
    const measures: CustomMeasure[] = [{ id: '1', name: 'profit', formula: '[revenue] - [cost]' }];
    const out = applyCustomMeasures(rows, cols, measures);
    expect(out.columns).toContain('profit');
    expect(out.rows.map((r) => r.profit)).toEqual([60, 20]);
  });

  it('lets a later measure reference an earlier one', () => {
    const measures: CustomMeasure[] = [
      { id: '1', name: 'profit', formula: 'revenue - cost' },
      { id: '2', name: 'margin', formula: 'profit / revenue * 100' },
    ];
    const out = applyCustomMeasures(rows, cols, measures);
    expect(out.rows[0].margin).toBe(60);
  });

  it('skips invalid formulas instead of throwing', () => {
    const measures: CustomMeasure[] = [{ id: '1', name: 'bad', formula: 'revenue +' }];
    const out = applyCustomMeasures(rows, cols, measures);
    expect(out.columns).not.toContain('bad');
    expect(out.rows).toEqual(rows);
  });
});

describe('applyVisualizationConfig integration', () => {
  it('computes custom measures then aggregates on them', () => {
    const rows = [
      { region: 'NA', revenue: 100, cost: 40 },
      { region: 'NA', revenue: 60, cost: 20 },
      { region: 'EU', revenue: 30, cost: 10 },
    ];
    const out = applyVisualizationConfig(rows, ['region', 'revenue', 'cost'], {
      customMeasures: [{ id: '1', name: 'profit', formula: 'revenue - cost' }],
      groupBy: 'region',
      yAxis: 'profit',
      aggregation: 'sum',
    });
    // NA profit = 60 + 40 = 100 ; EU = 20
    const na = out.rows.find((r) => r.region === 'NA');
    expect(na?.profit).toBe(100);
    expect(out.columns).toEqual(['region', 'profit']);
  });
});
