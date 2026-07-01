import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IconSection } from './IconSection';

const imageMock = vi.hoisted(() => ({
  uploadImage: vi.fn(),
  deleteIcon: vi.fn(),
}));

vi.mock('@/lib/images', () => ({
  imageUrl: (id: string, thumb = false) => `/api/images/${id}${thumb ? '/thumb' : ''}`,
  uploadImage: imageMock.uploadImage,
  deleteIcon: imageMock.deleteIcon,
}));

describe('IconSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the automatic vendor icon when no custom icon is set', () => {
    render(
      <IconSection
        isEditing
        label="Primary Proxmox node"
        autoBrandText="Proxmox node"
        onChange={vi.fn()}
      />,
    );

    const icon = screen.getByAltText('proxmox') as HTMLImageElement;
    expect(icon.src).toContain('/proxmox.svg');
  });

  it('replaces an uploaded icon with a picked dashboard icon', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const uploaded = { kind: 'image' as const, id: 'aaaaaaaaaaaaaaaa', w: 24, h: 24 };
    render(<IconSection icon={uploaded} isEditing label="Gateway" onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'Use cisco icon' }));

    expect(imageMock.deleteIcon).toHaveBeenCalledWith(uploaded);
    expect(onChange).toHaveBeenCalledWith({ kind: 'dashboard', name: 'cisco' });
  });

  it('uploads an image icon through the existing image API helper', async () => {
    const onChange = vi.fn();
    imageMock.uploadImage.mockResolvedValueOnce({ id: 'bbbbbbbbbbbbbbbb', w: 64, h: 64 });
    const { container } = render(<IconSection isEditing label="GPU" onChange={onChange} />);

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: {
        files: [new File(['icon'], 'icon.png', { type: 'image/png' })],
      },
    });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith({
        kind: 'image',
        id: 'bbbbbbbbbbbbbbbb',
        w: 64,
        h: 64,
      });
    });
  });
});
