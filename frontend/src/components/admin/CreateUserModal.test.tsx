import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CreateUserModal } from './CreateUserModal';
import { userApi } from '@/lib/api';

jest.mock('@/lib/api', () => ({
  userApi: { create: jest.fn() },
}));

const mockCreate = userApi.create as jest.Mock;

describe('CreateUserModal', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders the name, email, and role fields', () => {
    render(<CreateUserModal onClose={jest.fn()} onCreated={jest.fn()} />);
    expect(screen.getByLabelText('Full Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Email Address')).toBeInTheDocument();
    expect(screen.getByLabelText('Role')).toBeInTheDocument();
  });

  it('submits and reports the success message', async () => {
    mockCreate.mockResolvedValue({
      success: true,
      message: 'User created successfully. Invitation email sent.',
      user: {},
    });
    const onCreated = jest.fn();
    render(<CreateUserModal onClose={jest.fn()} onCreated={onCreated} />);

    fireEvent.change(screen.getByLabelText('Full Name'), { target: { value: 'Jane Doe' } });
    fireEvent.change(screen.getByLabelText('Email Address'), { target: { value: 'jane@co.com' } });
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'ANALYST' } });
    fireEvent.click(screen.getByRole('button', { name: /create & invite/i }));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith({ name: 'Jane Doe', email: 'jane@co.com', role: 'ANALYST' });
      expect(onCreated).toHaveBeenCalledWith('User created successfully. Invitation email sent.');
    });
  });

  it('surfaces an API error', async () => {
    mockCreate.mockRejectedValue({ structured: { message: 'Email already exists' } });
    render(<CreateUserModal onClose={jest.fn()} onCreated={jest.fn()} />);

    fireEvent.change(screen.getByLabelText('Full Name'), { target: { value: 'Jane' } });
    fireEvent.change(screen.getByLabelText('Email Address'), { target: { value: 'dupe@co.com' } });
    fireEvent.click(screen.getByRole('button', { name: /create & invite/i }));

    expect(await screen.findByText('Email already exists')).toBeInTheDocument();
  });
});
