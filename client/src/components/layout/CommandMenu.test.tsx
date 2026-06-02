import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { CommandMenu } from './CommandMenu';

describe('CommandMenu', () => {
  it('navigates through command selections', async () => {
    const user = userEvent.setup();
    const setRoute = vi.fn();
    const onOpenChange = vi.fn();

    render(<CommandMenu open onOpenChange={onOpenChange} setRoute={setRoute} />);

    const dockerItem = screen
      .getAllByText('Docker')
      .map((item) => item.closest('[cmdk-item]'))
      .find((item) => item?.getAttribute('data-value') === 'Docker docker');

    expect(dockerItem).toBeTruthy();
    await user.click(dockerItem!);

    expect(setRoute).toHaveBeenCalledWith('docker', undefined, undefined);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
