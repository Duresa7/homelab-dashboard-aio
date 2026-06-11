import { useState, type FormEvent } from 'react';
import { Loader2, ShieldPlus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { bootstrapAdmin } from '@/lib/auth';
import { AuthShell } from './LoginPage';
import { PasswordStrengthField, type PasswordStrength } from './PasswordStrengthField';

const USERNAME_RE = /^[a-z0-9](?:[a-z0-9._-]{0,30}[a-z0-9])?$/i;

export function CreateAdminScreen() {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [strength, setStrength] = useState<PasswordStrength>({ score: null, acceptable: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const usernameOk = USERNAME_RE.test(username.trim());
  const ready = usernameOk && strength.acceptable && !busy;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await bootstrapAdmin({
        username: username.trim().toLowerCase(),
        displayName: displayName.trim() || username.trim(),
        email: email.trim() || null,
        password,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'account creation failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell>
      <div className="rounded-2xl border bg-card p-6 shadow-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <ShieldPlus strokeWidth={1.75} className="size-5" />
          </div>
          <h1 className="text-lg font-semibold tracking-tight">Create your admin account</h1>
          <p className="text-sm text-muted-foreground">
            This dashboard now requires a login. Set up the first administrator — you can add more
            users later in Settings.
          </p>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="admin-username">Username</Label>
            <Input
              id="admin-username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
            />
            {username && !usernameOk ? (
              <p className="text-xs text-bad">Letters, digits, and . _ - only (max 32 chars).</p>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="admin-display-name">Display name</Label>
            <Input
              id="admin-display-name"
              autoComplete="name"
              placeholder={username.trim() || 'shown in the UI'}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="admin-email">
              Email <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="admin-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <PasswordStrengthField
            id="admin-password"
            value={password}
            onChange={setPassword}
            userInputs={[username, displayName, email]}
            onStrengthChange={setStrength}
          />
          {error ? <p className="text-sm text-bad">{error}</p> : null}
          <Button type="submit" disabled={!ready}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            Create account &amp; sign in
          </Button>
        </form>
      </div>
    </AuthShell>
  );
}
