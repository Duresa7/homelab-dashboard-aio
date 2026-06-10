import { useState, type FormEvent } from 'react';
import { KeyRound, Loader2, ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { login, loginTotp } from '@/lib/auth';
import { useSiteNameRaw, DEFAULT_SITE_NAME } from '@/lib/site-name';

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}

export function LoginPage() {
  const siteName = useSiteNameRaw() || DEFAULT_SITE_NAME;
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [code, setCode] = useState('');
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitCredentials = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !username.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      const result = await login(username.trim(), password, remember);
      if (result.totpRequired && result.pendingToken) {
        setPendingToken(result.pendingToken);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'login failed');
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !pendingToken || !code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await loginTotp(pendingToken, code.trim());
    } catch (err) {
      const message = err instanceof Error ? err.message : 'code rejected';
      setError(message);
      if (/expired/i.test(message)) {
        setPendingToken(null);
        setCode('');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell>
      <div className="rounded-2xl border bg-card p-6 shadow-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            {pendingToken ? (
              <ShieldCheck strokeWidth={1.75} className="size-5" />
            ) : (
              <KeyRound strokeWidth={1.75} className="size-5" />
            )}
          </div>
          <h1 className="text-lg font-semibold tracking-tight">{siteName}</h1>
          <p className="text-sm text-muted-foreground">
            {pendingToken
              ? 'Enter the 6-digit code from your authenticator app, or a recovery code.'
              : 'Sign in to your dashboard.'}
          </p>
        </div>

        {pendingToken ? (
          <form onSubmit={submitCode} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="totp-code">Verification code</Label>
              <Input
                id="totp-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoFocus
              />
            </div>
            {error ? <p className="text-sm text-bad">{error}</p> : null}
            <Button type="submit" disabled={busy || !code.trim()}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              Verify
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setPendingToken(null);
                setCode('');
                setError(null);
              }}
            >
              Back to password
            </Button>
          </form>
        ) : (
          <form onSubmit={submitCredentials} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="login-username">Username</Label>
              <Input
                id="login-username"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="login-password">Password</Label>
              <Input
                id="login-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
              <Checkbox checked={remember} onCheckedChange={(v) => setRemember(v === true)} />
              Remember me for 30 days
            </label>
            {error ? <p className="text-sm text-bad">{error}</p> : null}
            <Button type="submit" disabled={busy || !username.trim() || !password}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              Sign in
            </Button>
          </form>
        )}
      </div>
    </AuthShell>
  );
}
