import { useCallback, useEffect, useState } from 'react';
import {
  Copy,
  KeyRound,
  LogOut,
  MonitorSmartphone,
  ShieldCheck,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusBadge } from '@/components/common';
import {
  changePassword,
  listSessions,
  logout,
  revokeSession,
  totpDisable,
  totpEnable,
  totpSetup,
  updateProfile,
  useAuth,
  type AuthSessionInfo,
  type TotpSetup,
} from '@/lib/auth';
import { PasswordStrengthField, type PasswordStrength } from '@/pages/auth/PasswordStrengthField';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function copyText(text: string, label: string): void {
  navigator.clipboard.writeText(text).then(
    () => toast.success(`${label} copied to clipboard`),
    () => toast.error('Copy failed'),
  );
}

function whenLabel(ts: number): string {
  const minutes = Math.round((Date.now() - ts) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

function SectionCard({
  icon: Icon,
  title,
  description,
  actions,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-card">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="grid size-8 shrink-0 place-items-center rounded-md border border-border bg-muted text-muted-foreground">
            <Icon className="size-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          </div>
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

function ProfileCard() {
  const { user } = useAuth();
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [saving, setSaving] = useState(false);
  if (!user) return null;

  const dirty = displayName !== user.displayName || (email.trim() || null) !== user.email;

  const save = async () => {
    setSaving(true);
    try {
      await updateProfile({ displayName: displayName.trim(), email: email.trim() || null });
      toast.success('Profile updated');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard
      icon={UserRound}
      title="Profile"
      description="Your display name and email. Username and role are managed by an admin."
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="account-username">Username</Label>
          <Input id="account-username" value={user.username} disabled />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="account-role">Role</Label>
          <Input id="account-role" value={user.role} disabled className="capitalize" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="account-display-name">Display name</Label>
          <Input
            id="account-display-name"
            value={displayName}
            maxLength={120}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="account-email">Email (optional)</Label>
          <Input
            id="account-email"
            type="email"
            value={email}
            maxLength={254}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
      </div>
      <div className="mt-4 flex justify-end">
        <Button
          type="button"
          disabled={!dirty || !displayName.trim() || saving}
          onClick={() => void save()}
        >
          {saving ? 'Saving...' : 'Save profile'}
        </Button>
      </div>
    </SectionCard>
  );
}

function ChangePasswordCard() {
  const { user } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [strength, setStrength] = useState<PasswordStrength>({ score: null, acceptable: false });
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await changePassword(current, next);
      setCurrent('');
      setNext('');
      toast.success('Password changed');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard
      icon={KeyRound}
      title="Change password"
      description="Changing your password signs out your other sessions."
    >
      <form className="flex flex-col gap-3" onSubmit={(e) => void submit(e)}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="account-current-password">Current password</Label>
          <Input
            id="account-current-password"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </div>
        <PasswordStrengthField
          id="account-new-password"
          label="New password"
          value={next}
          onChange={setNext}
          userInputs={[user?.username ?? '', user?.displayName ?? '', user?.email ?? '']}
          onStrengthChange={setStrength}
          disabled={saving}
        />
        <div className="flex justify-end">
          <Button type="submit" disabled={!current || !strength.acceptable || saving}>
            {saving ? 'Changing...' : 'Change password'}
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}

function TwoFactorCard() {
  const { user } = useAuth();
  const [setup, setSetup] = useState<TotpSetup | null>(null);
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [disablePassword, setDisablePassword] = useState('');
  const [busy, setBusy] = useState(false);

  const startSetup = async () => {
    setBusy(true);
    try {
      setSetup(await totpSetup());
      setCode('');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const enable = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const codes = await totpEnable(code.trim());
      setSetup(null);
      setCode('');
      setRecoveryCodes(codes);
      toast.success('Two-factor auth enabled');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const disable = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await totpDisable(disablePassword);
      setDisablePassword('');
      toast.success('Two-factor auth disabled');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard
      icon={ShieldCheck}
      title="Two-factor authentication"
      description="Require a one-time code from an authenticator app at sign-in."
      actions={
        <StatusBadge kind={user?.totpEnabled ? 'ok' : 'info'}>
          {user?.totpEnabled ? 'enabled' : 'disabled'}
        </StatusBadge>
      }
    >
      {recoveryCodes ? (
        <div className="flex flex-col gap-3">
          <div className="rounded-lg border border-warn/50 bg-warn/10 px-3 py-2 text-sm text-foreground">
            <b className="font-semibold">Save these recovery codes now.</b> Each works once if you
            lose your authenticator — they will not be shown again.
          </div>
          <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-muted/40 p-3">
            <pre className="font-mono text-sm leading-6 text-foreground">
              {recoveryCodes.join('\n')}
            </pre>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => copyText(recoveryCodes.join('\n'), 'Recovery codes')}
            >
              <Copy className="size-3.5" />
              Copy
            </Button>
          </div>
          <div className="flex justify-end">
            <Button type="button" variant="outline" onClick={() => setRecoveryCodes(null)}>
              I saved them
            </Button>
          </div>
        </div>
      ) : user?.totpEnabled ? (
        <form className="flex flex-col gap-3" onSubmit={(e) => void disable(e)}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="totp-disable-password">Confirm with your password</Label>
            <Input
              id="totp-disable-password"
              type="password"
              autoComplete="current-password"
              value={disablePassword}
              onChange={(e) => setDisablePassword(e.target.value)}
            />
          </div>
          <div className="flex justify-end">
            <Button type="submit" variant="outline" disabled={!disablePassword || busy}>
              {busy ? 'Disabling...' : 'Disable two-factor auth'}
            </Button>
          </div>
        </form>
      ) : setup ? (
        <form className="flex flex-col gap-4" onSubmit={(e) => void enable(e)}>
          <div className="flex flex-wrap items-start gap-4">
            <img
              src={setup.qrDataUrl}
              alt="Two-factor setup QR code"
              className="size-40 rounded-lg border border-border bg-white p-2"
            />
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                Scan the QR code with your authenticator app, or enter the secret manually.
              </p>
              <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
                <code className="min-w-0 flex-1 break-all font-mono text-xs text-foreground">
                  {setup.secret}
                </code>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0"
                  aria-label="Copy secret"
                  onClick={() => copyText(setup.secret, 'Secret')}
                >
                  <Copy className="size-3.5" />
                </Button>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="totp-code">6-digit code</Label>
                <Input
                  id="totp-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  className="w-32 font-mono tracking-widest"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                />
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setSetup(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={code.length !== 6 || busy}>
              {busy ? 'Verifying...' : 'Verify & enable'}
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex justify-start">
          <Button type="button" variant="outline" disabled={busy} onClick={() => void startSetup()}>
            <ShieldCheck className="size-4" />
            Enable two-factor auth
          </Button>
        </div>
      )}
    </SectionCard>
  );
}

function SessionsCard() {
  const [sessions, setSessions] = useState<AuthSessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSessions(await listSessions());
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const revoke = async (id: string) => {
    try {
      await revokeSession(id);
      toast.success('Session revoked');
      await load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <SectionCard
      icon={MonitorSmartphone}
      title="Sessions"
      description="Devices currently signed in to your account."
      actions={
        <Button type="button" variant="outline" size="sm" onClick={() => void logout()}>
          <LogOut className="size-3.5" />
          Sign out
        </Button>
      }
    >
      {error ? (
        <div className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-foreground">
          {error}
        </div>
      ) : loading ? (
        <div className="text-sm text-muted-foreground">Loading sessions...</div>
      ) : (
        <div className="flex flex-col divide-y divide-border">
          {sessions.map((session) => (
            <div key={session.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className="truncate text-sm font-medium text-foreground"
                    title={session.userAgent ?? undefined}
                  >
                    {session.userAgent || 'Unknown device'}
                  </span>
                  {session.current ? <StatusBadge kind="ok">current</StatusBadge> : null}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {session.ip || 'unknown IP'} · last used {whenLabel(session.lastUsedAt)}
                  {session.remember ? ' · remembered' : ''}
                </div>
              </div>
              {!session.current ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void revoke(session.id)}
                >
                  Revoke
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

export function AccountTab() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <div className="flex flex-col gap-3">
      <ProfileCard />
      <ChangePasswordCard />
      <TwoFactorCard />
      <SessionsCard />
    </div>
  );
}
