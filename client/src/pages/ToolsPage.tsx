import { ComputeWakeCard } from '@/components/tools/ComputeWakeCard';

/** Utilities → Tools — operational helpers like Wake-on-LAN. */
export function ToolsPage() {
  return (
    <div className="grid grid-cols-12 gap-[var(--gap)]">
      <ComputeWakeCard />
    </div>
  );
}
