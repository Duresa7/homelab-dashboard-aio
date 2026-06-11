import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { CommandMenu } from './CommandMenu';

describe('CommandMenu', () => {
  it('navigates to a section when its command item is selected', async () => {
    const user = userEvent.setup();
    const setRoute = vi.fn();
    const onOpenChange = vi.fn();

    render(<CommandMenu open onOpenChange={onOpenChange} setRoute={setRoute} />);

    await user.click(screen.getByRole('option', { name: 'Containers' }));

    expect(setRoute).toHaveBeenCalledTimes(1);
    expect(setRoute.mock.calls[0][0]).toBe('docker');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
