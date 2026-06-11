import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SubTabs } from './SubTabs';

const tabs = [
  { id: 'a', label: 'A' },
  { id: 'b', label: 'B' },
  { id: 'c', label: 'C' },
];

describe('SubTabs', () => {
  it('exposes tab roles, selection, and a roving tabindex', () => {
    render(
      <SubTabs
        tabs={tabs}
        active="b"
        onChange={() => {
          void 0;
        }}
      />,
    );
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    const b = screen.getByRole('tab', { name: 'B' });
    expect(b).toHaveAttribute('aria-selected', 'true');

    expect(b).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'A' })).toHaveAttribute('tabindex', '-1');
  });

  it('navigates with arrow keys (wrapping) and Home/End', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<SubTabs tabs={tabs} active="a" onChange={onChange} />);
    screen.getByRole('tab', { name: 'A' }).focus();

    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('b');

    await user.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith('c');

    await user.keyboard('{End}');
    expect(onChange).toHaveBeenLastCalledWith('c');

    await user.keyboard('{Home}');
    expect(onChange).toHaveBeenLastCalledWith('a');
  });
});
