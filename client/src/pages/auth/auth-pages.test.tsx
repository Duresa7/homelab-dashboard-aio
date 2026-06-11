import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMock = vi.hoisted(() => ({
  login: vi.fn(),
  loginTotp: vi.fn(),
  bootstrapAdmin: vi.fn(),
}));

vi.mock('@/lib/auth', () => authMock);

import { LoginPage } from './LoginPage';
import { PasswordStrengthField, type PasswordStrength } from './PasswordStrengthField';

describe('LoginPage', () => {
  beforeEach(() => {
    authMock.login.mockReset();
    authMock.loginTotp.mockReset();
  });

  it('submits credentials with remember-me', async () => {
    const user = userEvent.setup();
    authMock.login.mockResolvedValue({});
    render(<LoginPage />);

    await user.type(screen.getByLabelText('Username'), 'admin');
    await user.type(screen.getByLabelText('Password'), 'plasma otter veranda 9 quilt');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(authMock.login).toHaveBeenCalledWith('admin', 'plasma otter veranda 9 quilt', true);
  });

  it('shows the server error on rejected credentials', async () => {
    const user = userEvent.setup();
    authMock.login.mockRejectedValue(new Error('invalid username or password'));
    render(<LoginPage />);

    await user.type(screen.getByLabelText('Username'), 'admin');
    await user.type(screen.getByLabelText('Password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('invalid username or password')).toBeInTheDocument();
  });

  it('walks the TOTP step when the account has 2FA', async () => {
    const user = userEvent.setup();
    authMock.login.mockResolvedValue({ totpRequired: true, pendingToken: 'pt-1' });
    authMock.loginTotp.mockResolvedValue(undefined);
    render(<LoginPage />);

    await user.type(screen.getByLabelText('Username'), 'admin');
    await user.type(screen.getByLabelText('Password'), 'plasma otter veranda 9 quilt');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    const codeInput = await screen.findByLabelText('Verification code');
    await user.type(codeInput, '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    expect(authMock.loginTotp).toHaveBeenCalledWith('pt-1', '123456');
  });
});

function StrengthHarness({ onStrength }: { onStrength: (s: PasswordStrength) => void }) {
  const [value, setValue] = useState('');
  return (
    <PasswordStrengthField
      value={value}
      onChange={setValue}
      userInputs={['admin']}
      onStrengthChange={onStrength}
    />
  );
}

describe('PasswordStrengthField', () => {
  it('flags weak passwords and accepts strong passphrases', async () => {
    const user = userEvent.setup();
    let latest: PasswordStrength = { score: null, acceptable: false };
    render(<StrengthHarness onStrength={(s) => (latest = s)} />);

    const input = screen.getByLabelText('Password');

    await user.type(input, 'password12345');
    await waitFor(() => expect(latest.score).not.toBeNull(), { timeout: 10_000 });
    expect(latest.acceptable).toBe(false);

    await user.clear(input);
    await user.type(input, 'plasma otter veranda 9 quilt');
    await waitFor(() => expect(latest.acceptable).toBe(true), { timeout: 10_000 });
  }, 30_000);

  it('reports short passwords as unacceptable', async () => {
    const user = userEvent.setup();
    let latest: PasswordStrength = { score: null, acceptable: true };
    render(<StrengthHarness onStrength={(s) => (latest = s)} />);

    await user.type(screen.getByLabelText('Password'), 'abc');
    await waitFor(() => expect(latest.acceptable).toBe(false));
    expect(screen.getByText(/more character/)).toBeInTheDocument();
  });
});
