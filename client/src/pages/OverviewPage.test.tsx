import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { OverviewPage } from './OverviewPage';
import { makeDashboardState } from '@/test/fixtures';

describe('OverviewPage', () => {
  it('renders the health command center and navigates from a subsystem card', async () => {
    const data = makeDashboardState();
    const setRoute = vi.fn();
    const user = userEvent.setup();

    render(<OverviewPage data={data} setRoute={setRoute} />);

    // Health bar + section structure.
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('Systems')).toBeInTheDocument();

    // Subsystem cards drill through to their dedicated pages.
    const dataCenter = screen.getByRole('button', { name: /Data Center/i });
    await user.click(dataCenter);
    expect(setRoute).toHaveBeenCalledWith('proxmox', undefined);

    // GPU/Power cards drill into the Sensors sub-tab specifically.
    const gpu = screen.getByRole('button', { name: /GPU/i });
    await user.click(gpu);
    expect(setRoute).toHaveBeenCalledWith('proxmox', 'sensors');
  });
});
