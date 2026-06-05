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

    // Select by the visible, accessible option name rather than cmdk-internal
    // attributes (`[cmdk-item]` / `data-value`) so the test survives a cmdk
    // bump or a label tweak. The exact name "Containers" matches the top-level
    // nav item, not the "Containers / <sub>" sub-pages.
    await user.click(screen.getByRole('option', { name: 'Containers' }));

    // Assert the observable contract (navigate to docker + close) without
    // coupling to the exact optional-argument arity of setRoute.
    expect(setRoute).toHaveBeenCalledTimes(1);
    expect(setRoute.mock.calls[0][0]).toBe('docker');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
