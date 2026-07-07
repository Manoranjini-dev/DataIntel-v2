import { humanizeField, xAxisLabel, yAxisLabel } from './chart-format';

describe('humanizeField', () => {
  it('title-cases snake_case column names', () => {
    expect(humanizeField('total_travel_insurance_coverage')).toBe('Total Travel Insurance Coverage');
    expect(humanizeField('city')).toBe('City');
    expect(humanizeField('number_of_clinics')).toBe('Number Of Clinics');
  });

  it('splits camelCase', () => {
    expect(humanizeField('customerCity')).toBe('Customer City');
  });

  it('strips a table/alias prefix and quoting', () => {
    expect(humanizeField('orders.created_at')).toBe('Created At');
    expect(humanizeField('"revenue"')).toBe('Revenue');
  });

  it('humanizes SQL aggregate wrappers', () => {
    expect(humanizeField('COUNT(*)')).toBe('Count');
    expect(humanizeField('SUM(total_amount)')).toBe('Sum of Total Amount');
    expect(humanizeField('AVG(price)')).toBe('Average of Price');
    expect(humanizeField('count(distinct customer_id)')).toBe('Count of Customer ID');
  });

  it('keeps known acronyms upper-cased', () => {
    expect(humanizeField('customer_id')).toBe('Customer ID');
    expect(humanizeField('roi')).toBe('ROI');
  });

  it('handles empty / null input', () => {
    expect(humanizeField('')).toBe('');
    expect(humanizeField(null)).toBe('');
    expect(humanizeField(undefined)).toBe('');
  });
});

describe('axis label props', () => {
  it('produce a humanized value with consistent positioning', () => {
    expect(xAxisLabel('sales_month')).toMatchObject({ value: 'Sales Month', position: 'insideBottom' });
    expect(yAxisLabel('total_revenue')).toMatchObject({ value: 'Total Revenue', angle: -90, position: 'insideLeft' });
  });

  it('return undefined for empty fields (so no empty label renders)', () => {
    expect(xAxisLabel('')).toBeUndefined();
    expect(yAxisLabel(null)).toBeUndefined();
  });
});
