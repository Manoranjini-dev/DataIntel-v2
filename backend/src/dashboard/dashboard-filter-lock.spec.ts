// ──────────────────────────────────────────────
// DashboardBuilderService — DC-04 lockable filters
// Verifies locked filters are persisted, protected from modification/removal
// unless explicitly unlocked, and that viewers can never mutate them.
// ──────────────────────────────────────────────

import { ForbiddenException } from '@nestjs/common';
import { DashboardBuilderService } from './dashboard-builder.service';

function makeService() {
  const db = {
    queryOne: jest.fn(),
    queryMany: jest.fn(),
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    transaction: jest.fn(),
  };
  const audit = { log: jest.fn() };
  const dashboardPermissions = { requireAction: jest.fn().mockResolvedValue(undefined) };
  const cache = { del: jest.fn(), delPattern: jest.fn(), setJson: jest.fn() };
  const events = { emit: jest.fn() };
  const svc = new DashboardBuilderService(db as any, audit as any, dashboardPermissions as any, cache as any, events as any);
  return { svc, db, dashboardPermissions };
}

const editor = { id: 'ed-1', role: 'ANALYST' } as any;

describe('DashboardBuilderService — DC-04 filter locking', () => {
  it('addFilter persists the locked flag', async () => {
    const { svc, db } = makeService();
    db.queryOne.mockResolvedValueOnce({ id: 'f1', locked: true });
    await svc.addFilter('d1', editor, { column: 'region', colType: 'string', operator: 'eq', locked: true });
    const [sql, params] = db.queryOne.mock.calls[0];
    expect(sql).toContain('locked');
    expect(params[5]).toBe(true); // locked column value
  });

  it('updateFilter rejects modifying a locked filter (no unlock in the request)', async () => {
    const { svc, db } = makeService();
    db.queryOne.mockResolvedValueOnce({ locked: true }); // SELECT existing
    await expect(
      svc.updateFilter('f1', 'd1', editor, { column: 'region', colType: 'string', operator: 'eq' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    // never issued the UPDATE
    expect(db.queryOne).toHaveBeenCalledTimes(1);
  });

  it('updateFilter allows an explicit unlock (locked=false) even on a locked filter', async () => {
    const { svc, db } = makeService();
    db.queryOne
      .mockResolvedValueOnce({ locked: true })          // SELECT existing
      .mockResolvedValueOnce({ id: 'f1', locked: false }); // UPDATE result
    const res = await svc.updateFilter('f1', 'd1', editor, { column: 'region', colType: 'string', operator: 'eq', locked: false });
    expect(res).toEqual({ id: 'f1', locked: false });
  });

  it('removeFilter rejects deleting a locked filter', async () => {
    const { svc, db } = makeService();
    db.queryOne.mockResolvedValueOnce({ locked: true });
    await expect(svc.removeFilter('f1', 'd1', editor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.query).not.toHaveBeenCalled(); // no DELETE issued
  });

  it('removeFilter deletes an unlocked filter', async () => {
    const { svc, db } = makeService();
    db.queryOne.mockResolvedValueOnce({ locked: false });
    await svc.removeFilter('f1', 'd1', editor);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM dashboard_filters'), ['f1', 'd1']);
  });

  it('viewers cannot mutate filters — every write path requires can_edit', async () => {
    const { svc, dashboardPermissions } = makeService();
    dashboardPermissions.requireAction.mockRejectedValue(new ForbiddenException('view only'));
    const dto = { column: 'region', colType: 'string' as const, operator: 'eq' };
    await expect(svc.addFilter('d1', editor, dto)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.updateFilter('f1', 'd1', editor, dto)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.removeFilter('f1', 'd1', editor)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.replaceFilters('d1', editor, [dto])).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('replaceFilters persists the whole set (with locks) transactionally', async () => {
    const { svc, db } = makeService();
    const insertRows = [{ id: 'f1', locked: true }, { id: 'f2', locked: false }];
    // Emulate transaction: pass a query fn; capture inserts.
    db.transaction.mockImplementation(async (fn: any) => {
      let call = 0;
      return fn(async (_sql: string, _params: any[]) => {
        if (/INSERT INTO dashboard_filters/.test(_sql)) return { rows: [insertRows[call++]] };
        return { rows: [] };
      });
    });
    const res = await svc.replaceFilters('d1', editor, [
      { column: 'region', colType: 'string', operator: 'eq', locked: true },
      { column: 'amount', colType: 'numeric', operator: 'gt', locked: false },
    ]);
    expect(res).toEqual(insertRows);
  });
});
