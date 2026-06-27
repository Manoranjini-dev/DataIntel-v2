// ──────────────────────────────────────────────
// ConnectionPermissionsService unit tests (ownership-based RBAC)
// ──────────────────────────────────────────────

import { ForbiddenException, NotFoundException, ConflictException } from '@nestjs/common';
import { ConnectionPermissionsService } from './connection-permissions.service';
import type { SafeAccount } from '../auth/auth.service';

function account(overrides: Partial<SafeAccount> = {}): SafeAccount {
  return {
    id: 'user-1',
    email: 'user@company.com',
    displayName: 'User',
    avatarUrl: null,
    role: 'ANALYST',
    status: 'ACTIVE',
    isActive: true,
    emailVerified: true,
    lastLoginAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('ConnectionPermissionsService', () => {
  let service: ConnectionPermissionsService;
  let db: { queryOne: jest.Mock; queryMany: jest.Mock; query: jest.Mock };
  let audit: { log: jest.Mock };

  const connId = 'conn-1';
  const ownerId = 'owner-1';

  beforeEach(() => {
    db = { queryOne: jest.fn(), queryMany: jest.fn(), query: jest.fn() };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    service = new ConnectionPermissionsService(db as any, audit as any);
  });

  describe('getAccessLevel', () => {
    it('throws NotFoundException when the connection does not exist', async () => {
      db.queryOne.mockResolvedValueOnce(null);
      await expect(service.getAccessLevel(connId, 'someone')).rejects.toThrow(NotFoundException);
    });

    it('resolves the creator as owner', async () => {
      db.queryOne.mockResolvedValueOnce({ created_by: ownerId });
      const level = await service.getAccessLevel(connId, ownerId);
      expect(level).toBe('owner');
    });

    it('resolves a platform Admin as owner on a connection they did not create', async () => {
      db.queryOne
        .mockResolvedValueOnce({ created_by: ownerId })       // connection lookup
        .mockResolvedValueOnce({ role: 'ADMIN' });            // account role lookup
      const level = await service.getAccessLevel(connId, 'admin-1');
      expect(level).toBe('owner');
    });

    it('resolves edit/view from an active grant for a non-owner, non-admin user', async () => {
      db.queryOne
        .mockResolvedValueOnce({ created_by: ownerId })
        .mockResolvedValueOnce({ role: 'ANALYST' })
        .mockResolvedValueOnce({ can_view: true, can_edit: true });
      const level = await service.getAccessLevel(connId, 'grantee-1');
      expect(level).toBe('edit');
    });

    it('returns null when there is no ownership, no admin override, and no grant', async () => {
      db.queryOne
        .mockResolvedValueOnce({ created_by: ownerId })
        .mockResolvedValueOnce({ role: 'ANALYST' })
        .mockResolvedValueOnce(null);
      const level = await service.getAccessLevel(connId, 'stranger-1');
      expect(level).toBeNull();
    });
  });

  describe('requireAction', () => {
    it('allows manage only for the owner', async () => {
      db.queryOne.mockResolvedValueOnce({ created_by: ownerId });
      await expect(service.requireAction(connId, ownerId, 'manage')).resolves.toBeUndefined();
    });

    it('forbids manage for a user with only edit access', async () => {
      db.queryOne
        .mockResolvedValueOnce({ created_by: ownerId })
        .mockResolvedValueOnce({ role: 'ANALYST' })
        .mockResolvedValueOnce({ can_view: true, can_edit: true });
      await expect(service.requireAction(connId, 'grantee-1', 'manage')).rejects.toThrow(ForbiddenException);
    });

    it('forbids any action for a user with no access', async () => {
      db.queryOne
        .mockResolvedValueOnce({ created_by: ownerId })
        .mockResolvedValueOnce({ role: 'ANALYST' })
        .mockResolvedValueOnce(null);
      await expect(service.requireAction(connId, 'stranger-1', 'view')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('shareByEmail', () => {
    it('rejects sharing with a Viewer', async () => {
      db.queryOne
        .mockResolvedValueOnce({ created_by: ownerId })          // requireAction: connection lookup
        .mockResolvedValueOnce({ id: 'target-1', role: 'VIEWER' }); // target account lookup

      await expect(
        service.shareByEmail(connId, account({ id: ownerId }), 'viewer@company.com', 'view'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects sharing with yourself', async () => {
      db.queryOne
        .mockResolvedValueOnce({ created_by: ownerId })
        .mockResolvedValueOnce({ id: ownerId, role: 'ANALYST' });

      await expect(
        service.shareByEmail(connId, account({ id: ownerId }), 'me@company.com', 'view'),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects sharing by a non-owner, non-admin user', async () => {
      db.queryOne
        .mockResolvedValueOnce({ created_by: ownerId })
        .mockResolvedValueOnce({ role: 'ANALYST' })
        .mockResolvedValueOnce(null);

      await expect(
        service.shareByEmail(connId, account({ id: 'not-owner' }), 'target@company.com', 'view'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows the owner to share with an Analyst', async () => {
      db.queryOne
        .mockResolvedValueOnce({ created_by: ownerId })
        .mockResolvedValueOnce({ id: 'target-1', role: 'ANALYST' })
        .mockResolvedValueOnce({ connection_id: connId, account_id: 'target-1', can_view: true, can_edit: false });

      const grant = await service.shareByEmail(connId, account({ id: ownerId }), 'target@company.com', 'view');
      expect(grant).toMatchObject({ account_id: 'target-1' });
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'connection_shared' }));
    });
  });

  describe('searchShareTargets', () => {
    it('returns nothing for queries shorter than 2 characters', async () => {
      const results = await service.searchShareTargets('a', 'user-1');
      expect(results).toEqual([]);
      expect(db.queryMany).not.toHaveBeenCalled();
    });

    it('searches accounts restricted to ADMIN/ANALYST, excluding the caller', async () => {
      db.queryMany.mockResolvedValueOnce([{ id: 'target-1', email: 'jane@company.com', display_name: 'Jane', role: 'ANALYST' }]);

      const results = await service.searchShareTargets('jane', 'user-1');

      expect(results).toHaveLength(1);
      const [sql, params] = db.queryMany.mock.calls[0];
      expect(sql).toContain("role IN ('ADMIN', 'ANALYST')");
      expect(params).toEqual(['user-1', '%jane%']);
    });
  });

  describe('leaveSharedConnection', () => {
    it('lets a shared user remove their own grant', async () => {
      db.queryOne.mockResolvedValueOnce({ created_by: ownerId });
      db.query.mockResolvedValueOnce({ rowCount: 1 });

      await service.leaveSharedConnection(connId, 'grantee-1');

      expect(db.query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM datasource_permissions'), [connId, 'grantee-1']);
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ details: { selfRemoved: true } }));
    });

    it('forbids the owner from leaving their own connection', async () => {
      db.queryOne.mockResolvedValueOnce({ created_by: ownerId });
      await expect(service.leaveSharedConnection(connId, ownerId)).rejects.toThrow(ForbiddenException);
    });

    it('404s when the connection was never shared with this user', async () => {
      db.queryOne.mockResolvedValueOnce({ created_by: ownerId });
      db.query.mockResolvedValueOnce({ rowCount: 0 });
      await expect(service.leaveSharedConnection(connId, 'stranger-1')).rejects.toThrow(NotFoundException);
    });
  });
});
