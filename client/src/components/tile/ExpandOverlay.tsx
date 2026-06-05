import { ALL_TILES, renderTile, tileData, type TileId } from '../widgets/registry';
import { TempHeatTile } from '../widgets/TempHeatTile';
import type { ChartKind, CPUData, DashboardState, GPUData } from '../../types';
import { useTempUnit } from '../../lib/units';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  ExpandedCPU,
  ExpandedRAM,
  ExpandedGPU,
  ExpandedSmart,
  ExpandedUPS,
  ExpandedDocker,
  ExpandedStorage,
  ExpandedUnas,
  ExpandedBackups,
  ExpandedInternet,
  ExpandedUnifi,
  ExpandedNetwork,
  ExpandedTopTalkers,
  ExpandedProxmox,
  ExpandedFans,
  ExpandedEvents,
} from './expanded';
import { tilePresentationLabel, usePresentation } from '@/lib/presentation';

interface TempHeatData {
  cpu: CPUData;
  gpu: GPUData;
  disks: { name: string; tempC: number }[];
}

interface Props {
  id: TileId | null;
  data: DashboardState;
  chartKind: ChartKind;
  setChartKind: (k: ChartKind) => void;
  onClose: () => void;
}

export function ExpandOverlay({ id, data, chartKind, setChartKind, onClose }: Props) {
  const def = id ? ALL_TILES.find((t) => t.id === id) : null;
  const presentation = usePresentation();

  return (
    <Dialog
      open={!!id}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="grid max-h-[88vh] w-[min(1100px,92vw)] max-w-[min(1100px,92vw)] grid-rows-[auto_1fr] gap-0 overflow-hidden p-0 sm:max-w-[min(1100px,92vw)]">
        {id ? (
          <>
            <DialogHeader className="border-b border-border px-6 py-4 text-left">
              <DialogTitle className="font-display text-lg tracking-tight">
                {def && id ? tilePresentationLabel(id, def.label, presentation) : id}
              </DialogTitle>
            </DialogHeader>
            <div className="overflow-y-auto px-6 py-5">
              <ExpandedBody id={id} data={data} chartKind={chartKind} setChartKind={setChartKind} />
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ExpandedBody({ id, data, chartKind, setChartKind }: Omit<Props, 'onClose'>) {
  if (!id) return null;
  const { unit } = useTempUnit();
  const td = tileData(id, data);

  switch (id) {
    case 'cpu':
      return <ExpandedCPU data={data} />;
    case 'ram':
      return <ExpandedRAM data={data} />;
    case 'gpu':
      return <ExpandedGPU data={data} unit={unit} />;
    case 'smart':
      return <ExpandedSmart data={data} unit={unit} />;
    case 'ups':
      return <ExpandedUPS data={data} />;
    case 'docker':
      return <ExpandedDocker data={data} />;
    case 'storage':
      return <ExpandedStorage data={data} />;
    case 'unas':
      return <ExpandedUnas data={data} unit={unit} />;
    case 'backups':
      return <ExpandedBackups data={data} />;
    case 'internet':
      return <ExpandedInternet data={data} />;
    case 'unifi':
      return <ExpandedUnifi data={data} />;
    case 'network':
      return <ExpandedNetwork data={data} />;
    case 'topTalkers':
      return <ExpandedTopTalkers data={data} />;
    case 'proxmox':
      return <ExpandedProxmox data={data} />;
    case 'fans':
      return <ExpandedFans data={data} />;
    case 'events':
      return <ExpandedEvents data={data} />;
    case 'tempHeat': {
      const { cpu, gpu, disks } = td as TempHeatData;
      return <TempHeatTile cpu={cpu} gpu={gpu} disks={disks} span={12} expandable={false} />;
    }
    default:
      return (
        <>
          {renderTile({
            id,
            span: 12,
            data: td,
            chartKind,
            onChartKind: setChartKind,
            expandable: false,
          })}
        </>
      );
  }
}
