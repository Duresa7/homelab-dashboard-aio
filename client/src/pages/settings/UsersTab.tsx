import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Plus, ShieldCheck, Trash2, UsersRound } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { StatusBadge } from '@/components/common';
import {
  createUser,
  deleteUser,
  listUsers,
  resetUserPassword,
  revokeUserSessions,
  updateUser,
  useAuth,
  type AuthUser,
  type UserRole,
} from '@/lib/auth';
import { PasswordStrengthField, type PasswordStrength } from '@/pages/auth/PasswordStrengthField';

const ROLES: UserRole[] = ['admin', 'member', 'viewer'];

const ROLE_HINTS: Record<UserRole, string> = {
  admin: 'Everything, including users and integrations',
  member: 'Can edit inventory and wake machines',
  viewer: 'Read-only dashboard access',
};

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface AddUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

function AddUserDialog({ open, onOpenChange, onCreated }: AddUserDialogProps) {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('member');
  const [password, setPassword] = useState('');
  const [strength, setStrength] = useState<PasswordStrength>({ score: null, acceptable: false });
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setUsername('');
    setDisplayName('');
    setEmail('');
    setRole('member');
    setPassword('');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await createUser({
        username: username.trim().toLowerCase(),
        displayName: displayName.trim() || username.trim(),
        email: email.trim() || null,
        password,
        role,
      });
      toast.success(`User "${username.trim().toLowerCase()}" created`);
      reset();
      onOpenChange(false);
      onCreated();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add user</DialogTitle>
          <DialogDescription>
            They can change their password and enable two-factor auth after signing in.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={(e) => void submit(e)}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-user-username">Username</Label>
              <Input
                id="new-user-username"
                autoComplete="off"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-user-display-name">Display name</Label>
              <Input
                id="new-user-display-name"
                autoComplete="off"
                placeholder={username.trim() || undefined}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-user-email">Email (optional)</Label>
            <Input
              id="new-user-email"
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as UserRole)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    <span className="capitalize">{r}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{ROLE_HINTS[r]}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <PasswordStrengthField
            id="new-user-password"
            value={password}
            onChange={setPassword}
            userInputs={[username, displayName, email]}
            onStrengthChange={setStrength}
            disabled={busy}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!username.trim() || !strength.acceptable || busy}>
              {busy ? 'Creating...' : 'Create user'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface ResetPasswordDialogProps {
  user: AuthUser | null;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}

function ResetPasswordDialog({ user, onOpenChange, onDone }: ResetPasswordDialogProps) {
  const [password, setPassword] = useState('');
  const [strength, setStrength] = useState<PasswordStrength>({ score: null, acceptable: false });
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setBusy(true);
    try {
      await resetUserPassword(user.id, password);
      toast.success(`Password reset for "${user.username}" — their sessions were signed out`);
      setPassword('');
      onOpenChange(false);
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={user !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reset password{user ? ` — ${user.username}` : ''}</DialogTitle>
          <DialogDescription>
            Sets a new password and signs the user out everywhere.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={(e) => void submit(e)}>
          <PasswordStrengthField
            id="reset-user-password"
            label="New password"
            value={password}
            onChange={setPassword}
            userInputs={user ? [user.username, user.displayName, user.email ?? ''] : []}
            onStrengthChange={setStrength}
            disabled={busy}
            autoFocus
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!strength.acceptable || busy}>
              {busy ? 'Resetting...' : 'Reset password'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function UsersTab() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<AuthUser | null>(null);

  const load = useCallback(async () => {
    try {
      setUsers(await listUsers());
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

  const changeRole = async (target: AuthUser, role: UserRole) => {
    if (role === target.role) return;
    try {
      await updateUser(target.id, { role });
      toast.success(`"${target.username}" is now ${role}`);
      await load();
    } catch (err) {
      toast.error(errorMessage(err));
      await load();
    }
  };

  const remove = async (target: AuthUser) => {
    if (!window.confirm(`Delete "${target.username}"? This cannot be undone.`)) return;
    try {
      await deleteUser(target.id);
      toast.success(`User "${target.username}" deleted`);
      await load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const revokeSessions = async (target: AuthUser) => {
    try {
      await revokeUserSessions(target.id);
      toast.success(`Signed "${target.username}" out everywhere`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-card">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="grid size-8 shrink-0 place-items-center rounded-md border border-border bg-muted text-muted-foreground">
            <UsersRound className="size-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">Users</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Admins manage everything; members edit inventory and wake machines; viewers are
              read-only.
            </p>
          </div>
        </div>
        <Button type="button" size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="size-3.5" />
          Add user
        </Button>
      </div>

      {error ? (
        <div className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-foreground">
          {error}
        </div>
      ) : loading ? (
        <div className="text-sm text-muted-foreground">Loading users...</div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>2FA</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u.id}>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-foreground">
                      {u.displayName}
                      {me?.id === u.id ? (
                        <span className="ml-1.5 text-xs text-muted-foreground">(you)</span>
                      ) : null}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">{u.username}</span>
                  </div>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{u.email || '—'}</TableCell>
                <TableCell>
                  <Select value={u.role} onValueChange={(v) => void changeRole(u, v as UserRole)}>
                    <SelectTrigger size="sm" className="w-28 capitalize">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLES.map((r) => (
                        <SelectItem key={r} value={r} className="capitalize">
                          {r}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <StatusBadge kind={u.totpEnabled ? 'ok' : 'idle'}>
                    {u.totpEnabled ? 'on' : 'off'}
                  </StatusBadge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Reset password for ${u.username}`}
                      title="Reset password"
                      onClick={() => setResetTarget(u)}
                    >
                      <KeyRound className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Sign ${u.username} out everywhere`}
                      title="Sign out everywhere"
                      onClick={() => void revokeSessions(u)}
                    >
                      <ShieldCheck className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Delete ${u.username}`}
                      title="Delete user"
                      onClick={() => void remove(u)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <AddUserDialog open={addOpen} onOpenChange={setAddOpen} onCreated={() => void load()} />
      <ResetPasswordDialog
        user={resetTarget}
        onOpenChange={(open) => !open && setResetTarget(null)}
        onDone={() => void load()}
      />
    </section>
  );
}
