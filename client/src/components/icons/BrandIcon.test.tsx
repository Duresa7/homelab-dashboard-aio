import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BrandIcon } from './BrandIcon';

describe('BrandIcon', () => {
  it('renders a known dashboard icon from its fixed URL', () => {
    render(<BrandIcon name="proxmox" alt="Proxmox" />);

    expect(screen.getByRole('img', { name: 'Proxmox' })).toHaveAttribute(
      'src',
      'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/proxmox.svg',
    );
  });

  it('does not reinterpret an untrusted icon name as a resource URL', () => {
    render(<BrandIcon name={'proxmox.svg"><svg onload="alert(1)'} alt="Untrusted" />);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
