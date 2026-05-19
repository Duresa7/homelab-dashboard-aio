import type { CSSProperties } from 'react';

const BASE = 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg';

interface Props {
  name: string;
  size?: number;
  alt?: string;
  className?: string;
  style?: CSSProperties;
}

export function BrandIcon({ name, size = 18, alt, className, style }: Props) {
  return (
    <img
      src={`${BASE}/${name}.svg`}
      width={size}
      height={size}
      alt={alt ?? name}
      draggable={false}
      loading="lazy"
      className={className}
      style={{ flexShrink: 0, display: 'inline-block', verticalAlign: 'middle', ...style }}
    />
  );
}

const VPN_BRAND_MAP: Record<string, string> = {
  wireguard: 'wireguard',
  wg: 'wireguard',
  openvpn: 'openvpn',
  ovpn: 'openvpn',
  tailscale: 'tailscale',
};

export function vpnBrand(type: string | null | undefined): string | null {
  if (!type) return null;
  const key = type.toLowerCase().replace(/[^a-z]/g, '');
  for (const k of Object.keys(VPN_BRAND_MAP)) {
    if (key.includes(k)) return VPN_BRAND_MAP[k];
  }
  return null;
}
