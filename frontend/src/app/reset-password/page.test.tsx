import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ResetPasswordPage from './page';
import { authApi } from '@/lib/api';

const push = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams('token=reset-tok'),
}));
jest.mock('@/lib/api', () => ({ authApi: { resetPassword: jest.fn() } }));

const mockReset = authApi.resetPassword as jest.Mock;

describe('ResetPasswordPage', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects mismatched passwords', async () => {
    render(<ResetPasswordPage />);
    fireEvent.change(screen.getByLabelText('New Password'), { target: { value: 'password123' } });
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'nope12345' } });
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }));

    expect(await screen.findByText('Passwords do not match.')).toBeInTheDocument();
    expect(mockReset).not.toHaveBeenCalled();
  });

  it('rejects passwords shorter than 8 characters', async () => {
    render(<ResetPasswordPage />);
    fireEvent.change(screen.getByLabelText('New Password'), { target: { value: 'short' } });
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }));

    expect(await screen.findByText('Password must be at least 8 characters.')).toBeInTheDocument();
  });

  it('resets with the token from the URL and confirms success', async () => {
    mockReset.mockResolvedValue({ success: true, message: 'ok' });
    render(<ResetPasswordPage />);
    fireEvent.change(screen.getByLabelText('New Password'), { target: { value: 'password123' } });
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }));

    await waitFor(() => {
      expect(mockReset).toHaveBeenCalledWith('reset-tok', 'password123');
      expect(screen.getByText('Password reset')).toBeInTheDocument();
    });
  });
});
