// ──────────────────────────────────────────────
// UserController unit tests
// ──────────────────────────────────────────────

import { UserController } from './user.controller';
import { PlatformRoleEnum, SettableUserStatus } from './dto/user.dto';
import type { SafeAccount } from '../auth/auth.service';

const admin: SafeAccount = {
  id: 'admin-1', email: 'admin@company.com', displayName: 'Admin', avatarUrl: null,
  role: 'ADMIN', status: 'ACTIVE', isActive: true, emailVerified: true,
  lastLoginAt: null, createdAt: '2026-01-01T00:00:00Z',
};

const req: any = { ip: '127.0.0.1', headers: { 'user-agent': 'jest' } };
const fakeUser = { id: 'u1', name: 'Jane', email: 'j@co.com', role: 'VIEWER', status: 'ACTIVE' };

describe('UserController', () => {
  let controller: UserController;
  let userService: any;
  let audit: any;

  beforeEach(() => {
    userService = {
      createUser: jest.fn().mockResolvedValue(fakeUser),
      listUsers: jest.fn().mockResolvedValue({ users: [fakeUser], total: 1, page: 1, limit: 20, totalPages: 1 }),
      getUser: jest.fn().mockResolvedValue(fakeUser),
      updateUser: jest.fn().mockResolvedValue(fakeUser),
      setStatus: jest.fn().mockResolvedValue(fakeUser),
      deleteUser: jest.fn().mockResolvedValue(undefined),
      resendInvitation: jest.fn().mockResolvedValue(fakeUser),
    };
    audit = { getUserManagementLogs: jest.fn().mockResolvedValue([]) };
    controller = new UserController(userService, audit);
  });

  it('create returns the PRD success message', async () => {
    const res = await controller.create(admin, { name: 'Jane', email: 'j@co.com', role: PlatformRoleEnum.VIEWER }, req);
    expect(res).toEqual({
      success: true,
      message: 'User created successfully. Invitation email sent.',
      user: fakeUser,
    });
    expect(userService.createUser).toHaveBeenCalled();
  });

  it('list delegates the query through', async () => {
    const res = await controller.list({ page: 1, limit: 20 });
    expect(res.total).toBe(1);
    expect(userService.listUsers).toHaveBeenCalledWith({ page: 1, limit: 20 });
  });

  it('getOne wraps the user', async () => {
    const res = await controller.getOne('u1');
    expect(res).toEqual({ user: fakeUser });
  });

  it('update returns the saved user', async () => {
    const res = await controller.update(admin, 'u1', { name: 'Jane 2' }, req);
    expect(res).toEqual({ success: true, user: fakeUser });
    expect(userService.updateUser).toHaveBeenCalledWith(admin, 'u1', { name: 'Jane 2' }, req.ip, 'jest');
  });

  it('setStatus passes the requested status', async () => {
    await controller.setStatus(admin, 'u1', { status: SettableUserStatus.INACTIVE }, req);
    expect(userService.setStatus).toHaveBeenCalledWith(admin, 'u1', 'INACTIVE', req.ip, 'jest');
  });

  it('remove returns a deletion confirmation', async () => {
    const res = await controller.remove(admin, 'u1', req);
    expect(res).toEqual({ success: true, message: 'User deleted' });
  });

  it('resendInvitation returns confirmation', async () => {
    const res = await controller.resendInvitation(admin, 'u1', req);
    expect(res.message).toBe('Invitation email resent.');
  });

  it('auditLogs paginates', async () => {
    const res = await controller.auditLogs('2', '25');
    expect(audit.getUserManagementLogs).toHaveBeenCalledWith({ limit: 25, offset: 25 });
    expect(res.page).toBe(2);
  });
});
