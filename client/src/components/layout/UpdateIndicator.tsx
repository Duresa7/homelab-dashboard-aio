import { useEffect } from 'react';
import { ArrowUpCircle, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { isAdmin, useAuth } from '@/lib/auth';
import {
  getToastSeenVersion,
  setToastSeenVersion,
  useUpdateNotifications,
  useUpdateStatus,
} from '@/lib/use-update';

export function UpdateIndicator({ onOpenDetails }: { onOpenDetails: () => void }) {
  const admin = isAdmin(useAuth().user);
  const notifications = useUpdateNotifications();
  const { data } = useUpdateStatus(admin && notifications);

  const latest = data?.latest ?? null;
  const current = data?.current ?? null;
  const show = admin && notifications && Boolean(data?.isOutdated) && Boolean(latest);

  useEffect(() => {
    if (!show || !latest) return;
    // One toast per newly-detected release; the badge persists until updated.
    if (getToastSeenVersion() === latest) return;
    setToastSeenVersion(latest);
    toast(`Update available: ${latest}`, {
      description: current ? `You're running ${current}.` : undefined,
      action: { label: 'Details', onClick: onOpenDetails },
      duration: 10000,
    });
  }, [show, latest, current, onOpenDetails]);

  if (!show || !data) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative size-8 text-muted-foreground hover:text-foreground"
          aria-label={`Update available: ${latest}`}
        >
          <ArrowUpCircle className="size-4" />
          <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-primary ring-2 ring-background" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-semibold text-foreground">Update available</span>
            <span className="text-xs text-muted-foreground">
              {data.current} → <span className="font-medium text-foreground">{latest}</span>
              {data.publishedAt ? ` · ${new Date(data.publishedAt).toLocaleDateString()}` : ''}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="flex-1" onClick={onOpenDetails}>
              How to update
            </Button>
            {data.releaseUrl ? (
              <Button size="sm" variant="ghost" asChild>
                <a
                  href={data.releaseUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="View release notes"
                >
                  <ExternalLink className="size-4" />
                </a>
              </Button>
            ) : null}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
