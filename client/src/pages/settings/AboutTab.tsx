import { useState, type ReactNode } from 'react';
import { CheckCircle2, ExternalLink, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { ApiError } from '@/lib/http';
import { isAdmin, useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import {
  forceUpdateCheck,
  setUpdateNotifications,
  useUpdateNotifications,
  useUpdateStatus,
} from '@/lib/use-update';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-3 py-2.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-foreground">{children}</span>
    </div>
  );
}

export function AboutTab() {
  const admin = isAdmin(useAuth().user);
  const notifications = useUpdateNotifications();
  const { data, loading, refresh } = useUpdateStatus(true);
  const [checking, setChecking] = useState(false);

  const onCheckNow = async () => {
    setChecking(true);
    try {
      await forceUpdateCheck();
      await refresh();
      toast.success('Checked for updates');
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        toast.message('Checked recently — try again shortly.');
      } else {
        toast.error(err instanceof Error ? err.message : 'Update check failed');
      }
    } finally {
      setChecking(false);
    }
  };

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-lg tracking-tight text-foreground">About</h2>
        {data?.isDevBuild ? (
          <Badge variant="outline">development build</Badge>
        ) : data?.isOutdated ? (
          <Badge variant="default">update available</Badge>
        ) : data && !loading ? (
          <Badge variant="outline" className="text-muted-foreground">
            <CheckCircle2 className="size-3" /> up to date
          </Badge>
        ) : null}
      </header>

      <div className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card p-1 shadow-card">
        <Row label="Version">{data ? (data.isDevBuild ? 'dev' : `v${data.current}`) : '—'}</Row>
        {data?.commit ? (
          <Row label="Commit">
            <code className="font-mono text-xs">{data.commit.slice(0, 7)}</code>
          </Row>
        ) : null}
        {data?.buildTime ? (
          <Row label="Built">{new Date(data.buildTime).toLocaleString()}</Row>
        ) : null}
      </div>

      {admin ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card p-1 shadow-card">
            <Row label="Latest release">
              {data?.latest ? (
                data.releaseUrl ? (
                  <a
                    href={data.releaseUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    {data.latest} <ExternalLink className="size-3" />
                  </a>
                ) : (
                  data.latest
                )
              ) : data?.enabled === false ? (
                'checking disabled'
              ) : (
                '—'
              )}
            </Row>
            <Row label="Last checked">
              {data?.lastCheckedAt ? new Date(data.lastCheckedAt).toLocaleString() : 'never'}
            </Row>
            <div className="flex items-center justify-between gap-4 px-3 py-2.5">
              <div className="flex flex-col">
                <span className="text-sm text-foreground">Update notifications</span>
                <span className="text-xs text-muted-foreground">
                  Show a badge and toast when a new release is out.
                </span>
              </div>
              <Switch
                checked={notifications}
                onCheckedChange={setUpdateNotifications}
                aria-label="Update notifications"
              />
            </div>
          </div>

          {data?.isOutdated ? (
            <div className="rounded-xl border border-border bg-muted/40 p-4 text-sm">
              <p className="font-medium text-foreground">Update to {data.latest}</p>
              <p className="mt-1 text-muted-foreground">
                Pull the new image and recreate the container:
              </p>
              <pre className="mt-2 overflow-x-auto rounded-md bg-background px-3 py-2 font-mono text-xs text-foreground">
                {'docker compose pull\n'}
                {'docker compose up -d'}
              </pre>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={onCheckNow}
              disabled={checking || data?.enabled === false}
            >
              <RefreshCw className={cn('size-3.5', checking && 'animate-spin')} />
              Check now
            </Button>
            {data?.enabled === false ? (
              <span className="text-xs text-muted-foreground">
                Set <code className="font-mono">UPDATE_CHECK_ENABLED=true</code> to enable update
                checks.
              </span>
            ) : null}
            {data?.error ? (
              <span className="text-xs text-destructive">Last check failed: {data.error}</span>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
