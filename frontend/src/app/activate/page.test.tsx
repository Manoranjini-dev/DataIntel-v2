import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ActivatePage from './page';
import { authApi } from '@/lib/api';

const push = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams('token=invite-tok'),
}));
jest.mock('@/lib/api', () => ({ authApi: { activateAccount: jest.fn() } }));

const mockActivate = authApi.activateAccount as jest.Mock;

describe('ActivatePage', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects mismatched passwords without calling the API', async () => {
    render(<ActivatePage />);
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'different123' } });
    fireEvent.click(screen.getByRole('button', { name: /activate account/i }));

    expect(await screen.findByText('Passwords do not match.')).toBeInTheDocument();
    expect(mockActivate).not.toHaveBeenCalled();
  });

  it('rejects passwords shorter than 8 characters', async () => {
    render(<ActivatePage />);
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'short' } });
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: /activate account/i }));

    expect(await screen.findByText('Password must be at least 8 characters.')).toBeInTheDocument();
    expect(mockActivate).not.toHaveBeenCalled();
  });

  it('sets the password with the token then directs the user to login (no auto-login)', async () => {
    mockActivate.mockResolvedValue({ success: true, message: 'Password set successfully. Please login.' });
    render(<ActivatePage />);

    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: /activate account/i }));

    await waitFor(() => {
      expect(mockActivate).toHaveBeenCalledWith('invite-tok', 'password123');
      expect(screen.getByText('Password set successfully. Please login.')).toBeInTheDocument();
    });
    // A button to the login page is offered (no workspace redirect / auto-login).
    expect(screen.getByRole('link', { name: /go to login/i })).toHaveAttribute('href', '/login');
  });

  it('shows an error for an invalid or expired invitation token', async () => {
    mockActivate.mockRejectedValue({ structured: { message: 'This invitation link has expired' } });
    render(<ActivatePage />);

    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: /activate account/i }));

    expect(await screen.findByText('This invitation link has expired')).toBeInTheDocument();
  });
});
