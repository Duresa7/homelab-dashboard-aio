import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { OverviewPage } from './OverviewPage';
import { makeDashboardState } from '@/test/fixtures';

describe('OverviewPage', () => {
  it('renders selected DashboardState tiles and forwards tile actions', async () => {
    const data = makeDashboardState();
    const setChartKind = vi.fn();
    const onExpand = vi.fn();
    const user = userEvent.setup();

    render(
      <OverviewPage
        data={data}
        layout={['cpu', 'docker', 'proxmox']}
        chartKinds={{ cpu: 'area' }}
        setChartKind={setChartKind}
        onExpand={onExpand}
      />,
    );

    expect(screen.getByText('System')).toBeInTheDocument();
    expect(screen.getByText('Services')).toBeInTheDocument();
    expect(screen.getByText('CPU')).toBeInTheDocument();
    expect(screen.getByText('Containers')).toBeInTheDocument();
    expect(screen.getByText('Data Center')).toBeInTheDocument();
    expect(screen.getByText('AMD Ryzen 9 9950X3D')).toBeInTheDocument();

    await user.click(screen.getByLabelText('Chart: bars'));
    expect(setChartKind).toHaveBeenCalledWith('cpu', 'bars');

    await user.click(screen.getAllByLabelText('Expand')[0]);
    expect(onExpand).toHaveBeenCalledWith('cpu');
  });
});
