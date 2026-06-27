import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ForgotPasswordPage from './page';
import { authApi } from '@/lib/api';

jest.mock('@/lib/api', () => ({ authApi: { forgotPassword: jest.fn() } }));
const mockForgot = authApi.forgotPassword as jest.Mock;

describe('ForgotPasswordPage', () => {
  beforeEach(() => jest.clearAllMocks());

  it('submits the email and shows a confirmation', async () => {
    mockForgot.mockResolvedValue({ success: true, message: 'sent' });
    render(<ForgotPasswordPage />);

    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'jane@co.com' } });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));

    await waitFor(() => {
      expect(mockForgot).toHaveBeenCalledWith('jane@co.com');
      expect(screen.getByText('Check your email')).toBeInTheDocument();
    });
  });

  it('shows an error if the request fails', async () => {
    mockForgot.mockRejectedValue({ message: 'Network error' });
    render(<ForgotPasswordPage />);

    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'jane@co.com' } });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));

    expect(await screen.findByText('Network error')).toBeInTheDocument();
  });
});
