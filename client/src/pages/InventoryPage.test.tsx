import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '@/components/ui/tooltip';
import { describe, expect, it } from 'vitest';

import { loadInventory, saveInventory, SPARE, type Inventory } from '../lib/inventory';
import { InventoryPage } from './InventoryPage';

function inventoryFixture(): Inventory {
  return {
    lastUpdated: '2026-06-01',
    machines: [
      {
        id: 'machine-1',
        ordinal: '01',
        name: 'Example Workstation',
        role: 'Windows workstation',
        deployment: 'in-service',
        meta: [{ id: 'meta-1', label: 'IP', value: '198.51.100.10' }],
        ids: { uid: '0801' },
      },
    ],
    components: [
      {
        id: 'component-1',
        type: 'cpu',
        label: 'CPU',
        fields: [{ id: 'field-1', label: 'Model', value: 'Example CPU' }],
        assignment: 'machine-1',
        ids: { uid: '1001' },
      },
      {
        id: 'component-2',
        type: 'cpu',
        label: 'CPU',
        fields: [{ id: 'field-2', label: 'Model', value: 'Spare CPU' }],
        assignment: SPARE,
        ids: { uid: '1002' },
      },
    ],
    spares: [
      {
        id: 'category-network',
        name: 'Network',
        deviceType: 'network',
        prefix: '04',
        columns: [
          { id: 'brand', label: 'Brand' },
          { id: 'model', label: 'Model' },
        ],
        items: [
          {
            id: 'network-1',
            name: 'Gateway',
            deployment: 'in-service',
            values: { brand: 'Example', model: 'Gateway' },
            ids: { uid: '0401' },
          },
        ],
      },
      {
        id: 'category-laptops',
        name: 'Laptops',
        deviceType: 'laptop',
        prefix: '01',
        columns: [
          { id: 'brand', label: 'Brand' },
          { id: 'model', label: 'Model' },
        ],
        items: [
          {
            id: 'laptop-1',
            deployment: 'spare',
            values: { brand: 'Example', model: 'Laptop' },
            ids: { uid: '0101' },
          },
        ],
      },
    ],
  };
}

function renderInventory() {
  return render(
    <TooltipProvider>
      <InventoryPage />
    </TooltipProvider>,
  );
}

describe('InventoryPage', () => {
  it('renders persisted inventory and switches major tabs', async () => {
    const user = userEvent.setup();
    saveInventory(inventoryFixture());
    renderInventory();

    expect(screen.getByText('Inventory')).toBeInTheDocument();
    expect(screen.getByText('Example Workstation')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /Network/i }));
    expect(screen.getAllByText('Gateway').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('tab', { name: /Spare parts/i }));
    expect(screen.getByRole('heading', { name: 'Laptops' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'CPU' })).toBeInTheDocument();
  });

  it('filters visible machines by search text', async () => {
    const user = userEvent.setup();
    saveInventory(inventoryFixture());
    renderInventory();

    await user.type(screen.getByPlaceholderText('Filter…'), 'Example');

    expect(screen.getAllByText('Example Workstation').length).toBeGreaterThan(0);
    expect(screen.queryByText('Gateway')).not.toBeInTheDocument();
  });

  it('repaints when the persisted inventory changes', async () => {
    saveInventory(inventoryFixture());
    renderInventory();

    const next = loadInventory();
    saveInventory({
      ...next,
      machines: next.machines.map((machine, index) =>
        index === 0 ? { ...machine, name: 'Recovered inventory host' } : machine,
      ),
    });

    await waitFor(() => {
      expect(screen.getByText('Recovered inventory host')).toBeInTheDocument();
    });
    expect(screen.queryByText('Example Workstation')).not.toBeInTheDocument();
  });
});
