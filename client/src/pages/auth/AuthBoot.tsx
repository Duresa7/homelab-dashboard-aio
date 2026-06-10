import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

import { fetchAuthStatus, useAuth } from '@/lib/auth';
import { hydrateStore } from '@/lib/store';
import { AuthShell, LoginPage } from './LoginPage';
import { CreateAdminScreen } from './CreateAdminScreen';

export function AuthBoot({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const [statusFailed, setStatusFailed] = useState(false);
  const [hydratedFor, setHydratedFor] = useState<number | null>(null);
  const hydrating = useRef(false);

  useEffect(() => {
    void fetchAuthStatus().catch(() => setStatusFailed(true));
  }, []);

  // Hydrate the persistent store once per login (user id) — it 401s before.
  const userId = auth.user?.id ?? null;
  useEffect(() => {
    if (userId === null || hydratedFor === userId || hydrating.current) return;
    hydrating.current = true;
    void hydrateStore().finally(() => {
      hydrating.current = false;
      setHydratedFor(userId);
    });
  }, [userId, hydratedFor]);

  if (statusFailed) {
    return (
      <AuthShell>
        <div className="rounded-2xl border bg-card p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold tracking-tight">Backend unreachable</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The dashboard server did not respond. Start it with{' '}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">npm run server</code>{' '}
            and reload.
          </p>
        </div>
      </AuthShell>
    );
  }

  if (auth.usersExist === null) {
    return (
      <AuthShell>
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </div>
      </AuthShell>
    );
  }

  if (!auth.usersExist) return <CreateAdminScreen />;
  if (!auth.user) return <LoginPage />;

  if (hydratedFor !== userId) {
    return (
      <AuthShell>
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading your dashboard…
        </div>
      </AuthShell>
    );
  }

  return <>{children}</>;
}
