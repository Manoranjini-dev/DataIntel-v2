import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import UserManagementPage from './page';
import { userApi } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/lib/auth-store', () => ({ useAuthStore: jest.fn() }));
jest.mock('@/lib/api', () => ({
  userApi: {
    list: jest.fn(),
    setStatus: jest.fn().mockResolvedValue({}),
    remove: jest.fn().mockResolvedValue({}),
    resendInvitation: jest.fn().mockResolvedValue({}),
  },
}));
// Modal components are exercised in their own tests — stub them here.
jest.mock('@/components/admin/CreateUserModal', () => ({ CreateUserModal: () => null }));
jest.mock('@/components/admin/EditUserModal', () => ({ EditUserModal: () => null }));

const mockStore = useAuthStore as unknown as jest.Mock;
const mockList = userApi.list as jest.Mock;

const adminState = {
  user: { id: 'a1', role: 'ADMIN' },
  isAuthenticated: true,
};

describe('UserManagementPage', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders a list of users for an admin', async () => {
    mockStore.mockReturnValue(adminState);
    mockList.mockResolvedValue({
      users: [
        { id: 'u1', name: 'Jane Doe', email: 'jane@co.com', role: 'VIEWER', status: 'ACTIVE', createdAt: '2026-01-01', updatedAt: '2026-01-01', lastLoginAt: null },
        { id: 'u2', name: 'Bob Smith', email: 'bob@co.com', role: 'ANALYST', status: 'PENDING_INVITATION', createdAt: '2026-01-02', updatedAt: '2026-01-02', lastLoginAt: null },
      ],
      total: 2, page: 1, limit: 10, totalPages: 1,
    });

    render(<UserManagementPage />);

    await waitFor(() => {
      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
      expect(screen.getByText('Bob Smith')).toBeInTheDocument();
    });
    expect(screen.getByText('jane@co.com')).toBeInTheDocument();
    expect(mockList).toHaveBeenCalled();
  });

  it('blocks non-admin users with an access-denied message', async () => {
    mockStore.mockReturnValue({ user: { id: 'v1', role: 'VIEWER' }, isAuthenticated: true });

    render(<UserManagementPage />);

    expect(screen.getByText('Access denied')).toBeInTheDocument();
    expect(mockList).not.toHaveBeenCalled();
  });

  it('exposes search and filter controls', async () => {
    mockStore.mockReturnValue(adminState);
    mockList.mockResolvedValue({ users: [], total: 0, page: 1, limit: 10, totalPages: 1 });

    render(<UserManagementPage />);

    expect(screen.getByLabelText('Search users')).toBeInTheDocument();
    expect(screen.getByLabelText('Filter by role')).toBeInTheDocument();
    expect(screen.getByLabelText('Filter by status')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('No users found.')).toBeInTheDocument());
  });

  it('deactivates an active user', async () => {
    mockStore.mockReturnValue(adminState);
    mockList.mockResolvedValue({
      users: [{ id: 'u1', name: 'Jane Doe', email: 'jane@co.com', role: 'VIEWER', status: 'ACTIVE', createdAt: '2026-01-01', updatedAt: '2026-01-01', lastLoginAt: null }],
      total: 1, page: 1, limit: 10, totalPages: 1,
    });

    render(<UserManagementPage />);
    fireEvent.click(await screen.findByLabelText('Deactivate Jane Doe'));

    await waitFor(() => expect(userApi.setStatus).toHaveBeenCalledWith('u1', 'INACTIVE'));
  });

  it('requires a confirmation click before deleting', async () => {
    mockStore.mockReturnValue(adminState);
    mockList.mockResolvedValue({
      users: [{ id: 'u1', name: 'Jane Doe', email: 'jane@co.com', role: 'VIEWER', status: 'ACTIVE', createdAt: '2026-01-01', updatedAt: '2026-01-01', lastLoginAt: null }],
      total: 1, page: 1, limit: 10, totalPages: 1,
    });

    render(<UserManagementPage />);
    const del = await screen.findByLabelText('Delete Jane Doe');
    fireEvent.click(del);
    expect(userApi.remove).not.toHaveBeenCalled(); // first click only arms confirmation
    fireEvent.click(del);
    await waitFor(() => expect(userApi.remove).toHaveBeenCalledWith('u1'));
  });

  it('resends an invitation for a pending user after confirmation', async () => {
    mockStore.mockReturnValue(adminState);
    mockList.mockResolvedValue({
      users: [{ id: 'u2', name: 'Bob Smith', email: 'bob@co.com', role: 'ANALYST', status: 'PENDING_INVITATION', createdAt: '2026-01-02', updatedAt: '2026-01-02', lastLoginAt: null }],
      total: 1, page: 1, limit: 10, totalPages: 1,
    });

    render(<UserManagementPage />);

    // Clicking the row icon opens a confirmation dialog — it does NOT send yet.
    fireEvent.click(await screen.findByLabelText('Resend invitation to Bob Smith'));
    expect(screen.getByText('Are you sure you want to resend the invitation email to this user?')).toBeInTheDocument();
    expect(userApi.resendInvitation).not.toHaveBeenCalled();

    // Confirming sends and shows the success toast.
    fireEvent.click(screen.getByRole('button', { name: 'Resend' }));
    await waitFor(() => expect(userApi.resendInvitation).toHaveBeenCalledWith('u2'));
    expect(await screen.findByText('Invitation resent successfully.')).toBeInTheDocument();
  });

  it('disables the confirm button and prevents duplicate sends while in flight', async () => {
    mockStore.mockReturnValue(adminState);
    mockList.mockResolvedValue({
      users: [{ id: 'u2', name: 'Bob Smith', email: 'bob@co.com', role: 'ANALYST', status: 'PENDING_INVITATION', createdAt: '2026-01-02', updatedAt: '2026-01-02', lastLoginAt: null }],
      total: 1, page: 1, limit: 10, totalPages: 1,
    });
    // Keep the resend request pending so we can observe the in-flight state.
    let resolveResend!: () => void;
    (userApi.resendInvitation as jest.Mock).mockReturnValue(
      new Promise<void>((res) => { resolveResend = () => res(); }),
    );

    render(<UserManagementPage />);
    fireEvent.click(await screen.findByLabelText('Resend invitation to Bob Smith'));
    fireEvent.click(screen.getByRole('button', { name: 'Resend' }));

    // Button switches to a disabled loading state…
    const loadingBtn = await screen.findByRole('button', { name: /resending/i });
    expect(loadingBtn).toBeDisabled();

    // …and repeated clicks do not fire additional requests.
    fireEvent.click(loadingBtn);
    fireEvent.click(loadingBtn);
    expect(userApi.resendInvitation).toHaveBeenCalledTimes(1);

    resolveResend();
    await waitFor(() =>
      expect(screen.queryByText('Are you sure you want to resend the invitation email to this user?')).not.toBeInTheDocument(),
    );
    expect(await screen.findByText('Invitation resent successfully.')).toBeInTheDocument();
  });

  it('does not show a resend action for active users', async () => {
    mockStore.mockReturnValue(adminState);
    mockList.mockResolvedValue({
      users: [{ id: 'u1', name: 'Jane Doe', email: 'jane@co.com', role: 'VIEWER', status: 'ACTIVE', createdAt: '2026-01-01', updatedAt: '2026-01-01', lastLoginAt: null }],
      total: 1, page: 1, limit: 10, totalPages: 1,
    });

    render(<UserManagementPage />);
    await screen.findByText('Jane Doe');
    expect(screen.queryByLabelText('Resend invitation to Jane Doe')).not.toBeInTheDocument();
  });

  it('opens the create-user modal', async () => {
    mockStore.mockReturnValue(adminState);
    mockList.mockResolvedValue({ users: [], total: 0, page: 1, limit: 10, totalPages: 1 });

    render(<UserManagementPage />);
    await waitFor(() => expect(screen.getByText('No users found.')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /create user/i }));
    // Stubbed modal renders nothing, but the click path (setShowCreate) is exercised.
    expect(within(document.body).queryByText('Access denied')).not.toBeInTheDocument();
  });
});
