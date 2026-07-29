const BASE = 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg';

const BRAND_ICON_URLS = {
  amd: `${BASE}/amd.svg`,
  apple: `${BASE}/apple.svg`,
  asus: `${BASE}/asus.svg`,
  cisco: `${BASE}/cisco.svg`,
  docker: `${BASE}/docker.svg`,
  hp: `${BASE}/hp.svg`,
  intel: `${BASE}/intel.svg`,
  mikrotik: `${BASE}/mikrotik.svg`,
  netgear: `${BASE}/netgear.svg`,
  nvidia: `${BASE}/nvidia.svg`,
  openvpn: `${BASE}/openvpn.svg`,
  portainer: `${BASE}/portainer.svg`,
  proxmox: `${BASE}/proxmox.svg`,
  qnap: `${BASE}/qnap.svg`,
  samsung: `${BASE}/samsung.svg`,
  seagate: `${BASE}/seagate.svg`,
  synology: `${BASE}/synology.svg`,
  tailscale: `${BASE}/tailscale.svg`,
  toshiba: `${BASE}/toshiba.svg`,
  'tp-link': `${BASE}/tp-link.svg`,
  truenas: `${BASE}/truenas.svg`,
  ubiquiti: `${BASE}/ubiquiti.svg`,
  unifi: `${BASE}/unifi.svg`,
  vmware: `${BASE}/vmware.svg`,
  'western-digital': `${BASE}/western-digital.svg`,
  wireguard: `${BASE}/wireguard.svg`,
} as const;

export type BrandIconName = keyof typeof BRAND_ICON_URLS;

export function isBrandIconName(name: string): name is BrandIconName {
  return Object.prototype.hasOwnProperty.call(BRAND_ICON_URLS, name);
}

export function brandIconUrl(name: string): string | null {
  return isBrandIconName(name) ? BRAND_ICON_URLS[name] : null;
}
