import {
  applyFilters,
  evaluateCondition,
  inferColumnType,
  operatorsForType,
  isConditionActive,
  mergeFilterSets,
  type FilterCondition,
  type FilterSet,
} from './filters';

const NOW = new Date('2026-07-07T12:00:00'); // local time reference

function cond(partial: Partial<FilterCondition> & Pick<FilterCondition, 'column' | 'colType' | 'operator'>): FilterCondition {
  return { id: 'c1', ...partial };
}

describe('inferColumnType', () => {
  it('detects numeric', () => {
    expect(inferColumnType([{ x: 1 }, { x: '2' }, { x: 3 }], 'x')).toBe('numeric');
  });
  it('detects date by value', () => {
    expect(inferColumnType([{ d: '2026-01-01' }, { d: '2026-02-15T09:00:00Z' }], 'd')).toBe('date');
  });
  it('detects date by name when values are datey', () => {
    expect(inferColumnType([{ created_at: '2026-01-01 10:00:00' }], 'created_at')).toBe('date');
  });
  it('falls back to string', () => {
    expect(inferColumnType([{ name: 'alice' }, { name: 'bob' }], 'name')).toBe('string');
  });
});

describe('operatorsForType', () => {
  it('numeric has null / not-null', () => {
    const ops = operatorsForType('numeric').map((o) => o.value);
    expect(ops).toEqual(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_null', 'is_not_null']);
  });
  it('string has in / not_in and contains family', () => {
    const ops = operatorsForType('string').map((o) => o.value);
    expect(ops).toContain('in');
    expect(ops).toContain('not_in');
    expect(ops).toContain('not_starts_with');
  });
  it('date has relative/today/current/custom', () => {
    const ops = operatorsForType('date').map((o) => o.value);
    expect(ops).toEqual(['relative', 'today', 'current_week', 'current_month', 'custom_range']);
  });
});

describe('numeric operators', () => {
  const row = { n: 10 };
  const cases: [FilterCondition['operator'], number, boolean][] = [
    ['eq', 10, true], ['eq', 9, false],
    ['neq', 9, true], ['neq', 10, false],
    ['gt', 5, true], ['gt', 10, false],
    ['gte', 10, true], ['gte', 11, false],
    ['lt', 20, true], ['lt', 10, false],
    ['lte', 10, true], ['lte', 9, false],
  ];
  it.each(cases)('%s %d → %s', (operator, value, expected) => {
    expect(evaluateCondition(cond({ column: 'n', colType: 'numeric', operator, value }), row, NOW)).toBe(expected);
  });
  it('is_null / is_not_null', () => {
    expect(evaluateCondition(cond({ column: 'n', colType: 'numeric', operator: 'is_null' }), { n: null }, NOW)).toBe(true);
    expect(evaluateCondition(cond({ column: 'n', colType: 'numeric', operator: 'is_not_null' }), { n: 3 }, NOW)).toBe(true);
    expect(evaluateCondition(cond({ column: 'n', colType: 'numeric', operator: 'is_null' }), { n: 3 }, NOW)).toBe(false);
  });
});

describe('string operators', () => {
  const row = { s: 'Hello World' };
  const cases: [FilterCondition['operator'], string, boolean][] = [
    ['eq', 'hello world', true],
    ['neq', 'x', true],
    ['contains', 'lo wo', true],
    ['not_contains', 'zzz', true],
    ['starts_with', 'hel', true],
    ['not_starts_with', 'wor', true],
    ['ends_with', 'rld', true],
    ['not_ends_with', 'hel', true],
  ];
  it.each(cases)('%s %s → %s (case-insensitive)', (operator, value, expected) => {
    expect(evaluateCondition(cond({ column: 's', colType: 'string', operator, value }), row, NOW)).toBe(expected);
  });
  it('in / not_in', () => {
    expect(evaluateCondition(cond({ column: 's', colType: 'string', operator: 'in', values: ['a', 'hello world'] }), row, NOW)).toBe(true);
    expect(evaluateCondition(cond({ column: 's', colType: 'string', operator: 'not_in', values: ['a', 'b'] }), row, NOW)).toBe(true);
    expect(evaluateCondition(cond({ column: 's', colType: 'string', operator: 'in', values: ['a', 'b'] }), row, NOW)).toBe(false);
  });
});

describe('date operators', () => {
  it('today', () => {
    const c = cond({ column: 'd', colType: 'date', operator: 'today' });
    expect(evaluateCondition(c, { d: '2026-07-07T08:00:00' }, NOW)).toBe(true);
    expect(evaluateCondition(c, { d: '2026-07-06T23:00:00' }, NOW)).toBe(false);
  });
  it('current_week (Mon-based)', () => {
    // 2026-07-07 is a Tuesday; Monday is 2026-07-06.
    const c = cond({ column: 'd', colType: 'date', operator: 'current_week' });
    expect(evaluateCondition(c, { d: '2026-07-06T00:00:00' }, NOW)).toBe(true);
    expect(evaluateCondition(c, { d: '2026-07-05T23:59:00' }, NOW)).toBe(false);
  });
  it('current_month', () => {
    const c = cond({ column: 'd', colType: 'date', operator: 'current_month' });
    expect(evaluateCondition(c, { d: '2026-07-01T00:00:00' }, NOW)).toBe(true);
    expect(evaluateCondition(c, { d: '2026-06-30T23:00:00' }, NOW)).toBe(false);
  });
  it('relative last N days', () => {
    const c = cond({ column: 'd', colType: 'date', operator: 'relative', relativeN: 3, relativeUnit: 'day' });
    expect(evaluateCondition(c, { d: '2026-07-05T12:00:00' }, NOW)).toBe(true);
    expect(evaluateCondition(c, { d: '2026-07-01T12:00:00' }, NOW)).toBe(false);
  });
  it('custom_range with both bounds', () => {
    const c = cond({ column: 'd', colType: 'date', operator: 'custom_range', from: '2026-07-01T00:00:00', to: '2026-07-10T00:00:00' });
    expect(evaluateCondition(c, { d: '2026-07-05T00:00:00' }, NOW)).toBe(true);
    expect(evaluateCondition(c, { d: '2026-07-20T00:00:00' }, NOW)).toBe(false);
  });
  it('custom_range with only a from-bound', () => {
    const c = cond({ column: 'd', colType: 'date', operator: 'custom_range', from: '2026-07-01T00:00:00' });
    expect(evaluateCondition(c, { d: '2026-07-05T00:00:00' }, NOW)).toBe(true);
    expect(evaluateCondition(c, { d: '2026-06-05T00:00:00' }, NOW)).toBe(false);
  });
});

describe('applyFilters combination + activeness', () => {
  const rows = [
    { region: 'US', revenue: 100 },
    { region: 'EU', revenue: 50 },
    { region: 'US', revenue: 20 },
  ];
  it('AND combines conditions', () => {
    const fs: FilterSet = {
      conjunction: 'and',
      conditions: [
        cond({ id: 'a', column: 'region', colType: 'string', operator: 'eq', value: 'US' }),
        cond({ id: 'b', column: 'revenue', colType: 'numeric', operator: 'gt', value: 50 }),
      ],
    };
    expect(applyFilters(rows, fs, NOW)).toEqual([{ region: 'US', revenue: 100 }]);
  });
  it('OR combines conditions', () => {
    const fs: FilterSet = {
      conjunction: 'or',
      conditions: [
        cond({ id: 'a', column: 'region', colType: 'string', operator: 'eq', value: 'EU' }),
        cond({ id: 'b', column: 'revenue', colType: 'numeric', operator: 'gte', value: 100 }),
      ],
    };
    expect(applyFilters(rows, fs, NOW)).toHaveLength(2);
  });
  it('ignores incomplete conditions (no value typed)', () => {
    const fs: FilterSet = {
      conjunction: 'and',
      conditions: [cond({ id: 'a', column: 'revenue', colType: 'numeric', operator: 'gt', value: undefined })],
    };
    expect(applyFilters(rows, fs, NOW)).toHaveLength(3);
  });
  it('returns rows unchanged when no filter set', () => {
    expect(applyFilters(rows, undefined, NOW)).toBe(rows);
  });
});

describe('isConditionActive', () => {
  it('null operators are always active', () => {
    expect(isConditionActive(cond({ column: 'n', colType: 'numeric', operator: 'is_null' }))).toBe(true);
  });
  it('in needs at least one value', () => {
    expect(isConditionActive(cond({ column: 's', colType: 'string', operator: 'in', values: [] }))).toBe(false);
    expect(isConditionActive(cond({ column: 's', colType: 'string', operator: 'in', values: ['a'] }))).toBe(true);
  });
  it('relative needs N and unit', () => {
    expect(isConditionActive(cond({ column: 'd', colType: 'date', operator: 'relative', relativeN: 3 }))).toBe(false);
    expect(isConditionActive(cond({ column: 'd', colType: 'date', operator: 'relative', relativeN: 3, relativeUnit: 'day' }))).toBe(true);
  });
});

describe('mergeFilterSets', () => {
  it('concatenates conditions under AND', () => {
    const merged = mergeFilterSets(
      { conjunction: 'and', conditions: [cond({ id: 'a', column: 'x', colType: 'numeric', operator: 'eq', value: 1 })] },
      { conjunction: 'or', conditions: [cond({ id: 'b', column: 'y', colType: 'string', operator: 'eq', value: 'z' })] },
    );
    expect(merged.conjunction).toBe('and');
    expect(merged.conditions).toHaveLength(2);
  });
});
