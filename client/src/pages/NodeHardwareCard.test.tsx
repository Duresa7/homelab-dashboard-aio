import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { NodeHardwareCard } from './ProxmoxPage';
import { makeDashboardState } from '@/test/fixtures';
import type { NodeGpu, NodeSensors } from '@/types';

// useTempUnit reads the store; a passthrough mock keeps the default unit.
vi.mock('@/lib/store', () => ({
  getState: vi.fn((_key: string, fallback: unknown) => fallback),
  setState: vi.fn(),
  subscribe: vi.fn(() => () => {}),
}));

const NODE_A_GPU: NodeGpu = {
  node: 'node-a',
  index: 0,
  model: 'Example GPU A',
  usage: 0,
  target: 0,
  memUsedGB: 6.3,
  memTotalGB: 11,
  tempC: 31,
  powerW: 12,
  powerMaxW: 275,
  fanPct: 0,
  gpuClockMHz: 139,
  memClockMHz: 405,
};

const NODE_A_SENSORS: NodeSensors = {
  node: 'node-a',
  cpuTempC: 42,
  systemTempC: 35,
  systemTempLabel: null,
  cores: [],
  disks: [],
  memory: [],
  network: [],
  fans: [],
  other: [],
};

describe('NodeHardwareCard', () => {
  it('attributes a GPU + sensors to the node', () => {
    const data = makeDashboardState();
    data.gpus = [NODE_A_GPU];
    data.sensorNodes = [NODE_A_SENSORS];

    render(<NodeHardwareCard data={data} nodeName="node-a" />);

    expect(screen.getByText('node-a')).toBeInTheDocument();
    expect(screen.getByText(/Example GPU A/)).toBeInTheDocument();
    expect(screen.queryByText('No GPU')).not.toBeInTheDocument();
    expect(screen.queryByText('No sensors')).not.toBeInTheDocument();
  });

  it('shows explicit "No GPU" / "No sensors" for a bare node', () => {
    const data = makeDashboardState();
    data.gpus = [];
    data.sensorNodes = [];

    render(<NodeHardwareCard data={data} nodeName="node-c" />);

    expect(screen.getByText('No GPU')).toBeInTheDocument();
    expect(screen.getByText('No sensors')).toBeInTheDocument();
  });

  it('flags an unreachable node', () => {
    const data = makeDashboardState();
    data.gpuUnavailable = [{ node: 'node-b', reason: 'Connection timed out' }];

    render(<NodeHardwareCard data={data} nodeName="node-b" />);

    expect(screen.getByText('unavailable')).toBeInTheDocument();
  });
});
