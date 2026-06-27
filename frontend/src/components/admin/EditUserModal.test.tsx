import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EditUserModal } from './EditUserModal';
import { userApi, type ManagedUser } from '@/lib/api';

jest.mock('@/lib/api', () => ({
  userApi: { update: jest.fn() },
}));

const mockUpdate = userApi.update as jest.Mock;

const activeUser: ManagedUser = {
  id: 'u1', name: 'Jane', email: 'jane@co.com', role: 'VIEWER', status: 'ACTIVE',
  createdAt: '2026-01-01', updatedAt: '2026-01-01', lastLoginAt: null,
};

const pendingUser: ManagedUser = { ...activeUser, status: 'PENDING_INVITATION' };

describe('EditUserModal', () => {
  beforeEach(() => jest.clearAllMocks());

  it('pre-fills fields from the user', () => {
    render(<EditUserModal user={activeUser} onClose={jest.fn()} onSaved={jest.fn()} />);
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Jane');
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('jane@co.com');
    expect((screen.getByLabelText('Role') as HTMLSelectElement).value).toBe('VIEWER');
  });

  it('saves edits including status for an active user', async () => {
    mockUpdate.mockResolvedValue({ success: true, user: { ...activeUser, role: 'ADMIN' } });
    const onSaved = jest.fn();
    render(<EditUserModal user={activeUser} onClose={jest.fn()} onSaved={onSaved} />);

    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'ADMIN' } });
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'INACTIVE' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith('u1', {
        name: 'Jane', email: 'jane@co.com', role: 'ADMIN', status: 'INACTIVE',
      });
      expect(onSaved).toHaveBeenCalled();
    });
  });

  it('disables status editing for a pending invitation', () => {
    render(<EditUserModal user={pendingUser} onClose={jest.fn()} onSaved={jest.fn()} />);
    expect(screen.getByLabelText('Status')).toBeDisabled();
  });
});
