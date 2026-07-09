import {
  humanizeField, xAxisLabel, yAxisLabel,
  isIdentifierColumn, measureColumns, pickLabelColumn,
} from './chart-format';

describe('isIdentifierColumn', () => {
  it('detects id / *_id / uuid identifier columns', () => {
    ['id', 'clinic_id', 'doctor_id', 'patient_id', 'user_id', 'clinicId', 'order_uuid', 'uuid', 'guid']
      .forEach((c) => expect(isIdentifierColumn(c)).toBe(true));
  });

  it('strips table prefixes and quoting before matching', () => {
    expect(isIdentifierColumn('appointments.clinic_id')).toBe(true);
    expect(isIdentifierColumn('"clinic_id"')).toBe(true);
  });

  it('does NOT flag real measures that merely end in "id"', () => {
    ['paid', 'amount_paid', 'valid', 'grid', 'revenue', 'cancellations', 'total', 'covid_cases']
      .forEach((c) => expect(isIdentifierColumn(c)).toBe(false));
  });
});

describe('measureColumns', () => {
  const rows = [
    { clinic_name: 'North', clinic_id: 1, cancellations: 12 },
    { clinic_name: 'South', clinic_id: 2, cancellations: 7 },
  ];
  const columns = ['clinic_name', 'clinic_id', 'cancellations'];

  it('excludes identifier columns from the plotted measures', () => {
    expect(measureColumns(rows, columns)).toEqual(['cancellations']);
  });

  it('falls back to raw numerics if excluding ids would leave nothing', () => {
    // Only numeric column is an id → keep it so the chart still renders.
    expect(measureColumns([{ name: 'x', clinic_id: 1 }], ['name', 'clinic_id'])).toEqual(['clinic_id']);
  });
});

describe('pickLabelColumn', () => {
  it('prefers a non-identifier label over an id', () => {
    expect(pickLabelColumn(['clinic_id', 'clinic_name', 'cancellations'], ['cancellations']))
      .toBe('clinic_name');
  });

  it('falls back to an id only when nothing else is available', () => {
    expect(pickLabelColumn(['clinic_id', 'cancellations'], ['cancellations'])).toBe('clinic_id');
  });
});

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
