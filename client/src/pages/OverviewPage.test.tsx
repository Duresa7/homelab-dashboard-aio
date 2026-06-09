import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OverviewPage } from './OverviewPage';
import { makeDashboardState } from '@/test/fixtures';
import type { DashboardState, NodeGpu, NodeSensors, ProxmoxClusterNode } from '@/types';

const storeMock = vi.hoisted(() => {
  const values = new Map<string, unknown>();
  const listeners = new Map<string, Set<() => void>>();
  return {
    values,
    getState: vi.fn((key: string, fallback: unknown) =>
      values.has(key) ? values.get(key) : fallback,
    ),
    setState: vi.fn((key: string, value: unknown) => {
      values.set(key, value);
      listeners.get(key)?.forEach((fn) => fn());
    }),
    subscribe: vi.fn((key: string, fn: () => void) => {
      const set = listeners.get(key) ?? new Set<() => void>();
      set.add(fn);
      listeners.set(key, set);
      return () => set.delete(fn);
    }),
    reset() {
      values.clear();
      listeners.clear();
      this.getState.mockClear();
      this.setState.mockClear();
    },
  };
});

vi.mock('@/lib/store', () => ({
  getState: storeMock.getState,
  setState: storeMock.setState,
  subscribe: storeMock.subscribe,
}));

function node(name: string, over: Partial<ProxmoxClusterNode> = {}): ProxmoxClusterNode {
  return {
    name,
    cpu: 10,
    maxcpu: 8,
    ram: 30,
    ramUsedGB: 8,
    ramTotalGB: 32,
    disk: 20,
    diskUsedTB: 0.1,
    diskTotalTB: 0.5,
    uptime: '1d',
    uptimeSec: 86400,
    status: 'online',
    level: null,
    ...over,
  };
}

function sensors(name: string, cpuTempC: number | null): NodeSensors {
  return {
    node: name,
    cpuTempC,
    systemTempC: null,
    systemTempLabel: null,
    cores: [],
    disks: [],
    memory: [],
    network: [],
    fans: [],
    other: [],
  };
}

const GREY_GPU: NodeGpu = {
  node: 'node-a',
  index: 0,
  model: 'NVIDIA GeForce GTX 1080 Ti',
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

function clusterState(): DashboardState {
  const data = makeDashboardState();
  data.proxmox.nodes = [node('node-a'), node('node-c', { maxcpu: 4 })];
  data.gpus = [GREY_GPU]; // only grey has a GPU
  data.sensorNodes = [sensors('node-a', 42), sensors('node-c', 38)];
  return data;
}

beforeEach(() => storeMock.reset());

describe('OverviewPage', () => {
  it('renders the health command center and navigates from a subsystem card', async () => {
    const data = makeDashboardState(); // single node → no Nodes section
    const setRoute = vi.fn();
    const user = userEvent.setup();

    render(<OverviewPage data={data} setRoute={setRoute} />);

    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('Systems')).toBeInTheDocument();
    expect(screen.queryByText('Nodes')).not.toBeInTheDocument();

    const dataCenter = screen.getByRole('button', { name: /Data Center/i });
    await user.click(dataCenter);
    expect(setRoute).toHaveBeenCalledWith('proxmox', undefined);

    const gpu = screen.getByRole('button', { name: /GPU/i });
    await user.click(gpu);
    expect(setRoute).toHaveBeenCalledWith('proxmox', 'sensors');
  });

  it('shows a per-node tile for each node with node-attributed GPU and temps', () => {
    render(<OverviewPage data={clusterState()} setRoute={vi.fn()} />);

    expect(screen.getByText('Nodes')).toBeInTheDocument();
    // grey is GPU-labeled; blue explicitly has no GPU — no ambiguity.
    expect(screen.getByText('NVIDIA GeForce GTX 1080 Ti')).toBeInTheDocument();
    expect(screen.getByText('No GPU')).toBeInTheDocument();
    // temps attributed per node
    expect(screen.getByText(/GPU 0%.*31°C/)).toBeInTheDocument();
    expect(screen.getByText('CPU 42°C')).toBeInTheDocument();
    expect(screen.getByText('CPU 38°C')).toBeInTheDocument();
  });

  it('toggling a node off hides its tile and persists the selection', async () => {
    const user = userEvent.setup();
    render(<OverviewPage data={clusterState()} setRoute={vi.fn()} />);

    expect(screen.getByText('No GPU')).toBeInTheDocument(); // blue visible

    // The selector chip's accessible name is exactly the node name (exact match
    // avoids colliding with the node card whose name embeds extra metrics).
    await user.click(screen.getByRole('button', { name: 'node-c' }));

    expect(storeMock.setState).toHaveBeenCalledWith('overviewSelectedNodes', ['node-a']);
    expect(screen.queryByText('No GPU')).not.toBeInTheDocument(); // blue's tile gone
    expect(screen.getByText('NVIDIA GeForce GTX 1080 Ti')).toBeInTheDocument(); // grey remains
  });
});
