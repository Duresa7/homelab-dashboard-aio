import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '@/components/ui/tooltip';
import { describe, expect, it } from 'vitest';

import { InventoryPage } from './InventoryPage';

function renderInventory() {
  return render(
    <TooltipProvider>
      <InventoryPage />
    </TooltipProvider>,
  );
}

describe('InventoryPage', () => {
  it('renders the seed inventory and switches major tabs', async () => {
    const user = userEvent.setup();
    renderInventory();

    expect(screen.getByText('Inventory')).toBeInTheDocument();
    expect(screen.getByText('Example PC')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /Network/i }));
    expect(screen.getByText('Gateway Gateway')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /Spare parts/i }));
    expect(screen.getByRole('heading', { name: 'Laptops' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'CPU' })).toBeInTheDocument();
  });

  it('filters visible machines by search text', async () => {
    const user = userEvent.setup();
    renderInventory();

    await user.type(screen.getByPlaceholderText('Filter…'), 'example-server');

    expect(screen.getAllByText('example-server').length).toBeGreaterThan(0);
    expect(screen.queryByText('Example PC')).not.toBeInTheDocument();
  });
});
