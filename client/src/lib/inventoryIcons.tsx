import {
  Box,
  Camera,
  CircuitBoard,
  Cpu,
  Disc,
  Droplet,
  Fan,
  Gpu,
  HardDrive,
  Keyboard,
  Laptop,
  MemoryStick,
  Monitor,
  Network,
  Power,
  Printer,
  Router,
  Server,
  Smartphone,
  Thermometer,
  Usb,
  Wifi,
  Zap,
  type LucideIcon,
} from 'lucide-react';

import { BrandIcon } from '../components/icons/BrandIcon';
import { imageUrl } from './images';
import type { ItemIcon } from './inventory';

type BrandSource =
  | { kind: 'dashboard'; name: string }
  | { kind: 'simple'; slug: string }
  | { kind: 'wvl'; slug: string };

const BRAND_MAP: Array<[RegExp, BrandSource]> = [
  [/proxmox/i, { kind: 'dashboard', name: 'proxmox' }],
  [/portainer/i, { kind: 'dashboard', name: 'portainer' }],
  [/western[\s-]?digital|^wd\b|\bwd\s/i, { kind: 'dashboard', name: 'western-digital' }],
  [/wd[\s-]?(blue|purple|red|black|green|gold)/i, { kind: 'dashboard', name: 'western-digital' }],
  [/tp[\s-]?link/i, { kind: 'dashboard', name: 'tp-link' }],
  [/ubiquiti|unifi/i, { kind: 'dashboard', name: 'ubiquiti' }],
  [/nvidia|geforce|\bgtx\b|\brtx\b/i, { kind: 'dashboard', name: 'nvidia' }],
  [/\bamd\b|ryzen|radeon|wraith/i, { kind: 'dashboard', name: 'amd' }],
  [/apple|macbook/i, { kind: 'dashboard', name: 'apple' }],
  [/asus/i, { kind: 'dashboard', name: 'asus' }],
  [/cisco/i, { kind: 'dashboard', name: 'cisco' }],
  [/netgear/i, { kind: 'dashboard', name: 'netgear' }],
  [/toshiba/i, { kind: 'dashboard', name: 'toshiba' }],
  [/\bhp\b|hewlett/i, { kind: 'dashboard', name: 'hp' }],

  [/intel/i, { kind: 'simple', slug: 'intel' }],
  [/samsung/i, { kind: 'simple', slug: 'samsung' }],
  [/corsair/i, { kind: 'simple', slug: 'corsair' }],
  [/\bmsi\b/i, { kind: 'simple', slug: 'msi' }],
  [/kingston/i, { kind: 'simple', slug: 'kingstontechnology' }],
  [/cooler[\s-]?master/i, { kind: 'simple', slug: 'coolermaster' }],
  [/seagate/i, { kind: 'simple', slug: 'seagate' }],
  [/nzxt/i, { kind: 'simple', slug: 'nzxt' }],

  [/g[\s.-]?skill/i, { kind: 'wvl', slug: 'gskill' }],
  [/sk[\s-]?hynix|\bhynix\b/i, { kind: 'wvl', slug: 'sk-hynix' }],
  [/crucial/i, { kind: 'wvl', slug: 'crucial' }],
  [/gigabyte|aorus/i, { kind: 'wvl', slug: 'gigabyte' }],
  [/sandisk/i, { kind: 'wvl', slug: 'sandisk' }],
  [/\bevga\b/i, { kind: 'wvl', slug: 'evga' }],
  [/sapphire/i, { kind: 'wvl', slug: 'sapphire' }],
];

export function resolveBrand(text: string | null | undefined): BrandSource | null {
  if (!text) return null;
  for (const [re, src] of BRAND_MAP) {
    if (re.test(text)) return src;
  }
  return null;
}

function resolveBrandFrom(text: string | null | undefined | Array<string | null | undefined>) {
  const values = Array.isArray(text) ? text : [text];
  for (const value of values) {
    const hit = resolveBrand(value);
    if (hit) return hit;
  }
  return null;
}

const SIMPLE_BASE = 'https://cdn.simpleicons.org';
const WVL_BASE = 'https://cdn.worldvectorlogo.com/logos';

interface BrandGlyphProps {
  text: string | null | undefined;
  size?: number;

  reserveSpace?: boolean;
}

export function BrandGlyph({ text, size = 18, reserveSpace = false }: BrandGlyphProps) {
  const hit = resolveBrandFrom(text);
  if (!hit) {
    return reserveSpace ? (
      <span
        className="inv-brand inv-brand-empty"
        style={{ width: size, height: size }}
        aria-hidden
      />
    ) : null;
  }
  if (hit.kind === 'dashboard') {
    return (
      <span className="inv-brand" style={{ width: size, height: size }}>
        <BrandIcon name={hit.name} size={size} />
      </span>
    );
  }
  if (hit.kind === 'simple') {
    return (
      <span className="inv-brand inv-brand-simple" style={{ width: size, height: size }}>
        <img
          src={`${SIMPLE_BASE}/${hit.slug}`}
          width={size}
          height={size}
          alt={hit.slug}
          draggable={false}
          loading="lazy"
        />
      </span>
    );
  }
  return (
    <span className="inv-brand inv-brand-wvl" style={{ width: size, height: size }}>
      <img
        src={`${WVL_BASE}/${hit.slug}.svg`}
        width={size}
        height={size}
        alt={hit.slug}
        draggable={false}
        loading="lazy"
      />
    </span>
  );
}

interface InventoryIconProps {
  icon?: ItemIcon;
  brandText?: string | null | undefined | Array<string | null | undefined>;
  fallback?: LucideIcon | null;
  label: string;
  size?: number;
  reserveSpace?: boolean;
}

export function InventoryIcon({
  icon,
  brandText,
  fallback: Fallback,
  label,
  size = 18,
  reserveSpace = false,
}: InventoryIconProps) {
  if (icon?.kind === 'image') {
    return (
      <span className="inv-brand inv-brand-upload" style={{ width: size, height: size }}>
        <img src={imageUrl(icon.id, true)} alt={`${label} icon`} draggable={false} loading="lazy" />
      </span>
    );
  }
  if (icon?.kind === 'dashboard') {
    return (
      <span className="inv-brand" style={{ width: size, height: size }}>
        <BrandIcon name={icon.name} size={size} alt={`${label} icon`} />
      </span>
    );
  }

  const brand = resolveBrandFrom(brandText);
  if (brand)
    return (
      <BrandGlyph text={Array.isArray(brandText) ? brandText.join(' ') : brandText} size={size} />
    );

  if (Fallback) {
    return (
      <span
        className="inv-brand inv-brand-lucide text-muted-foreground"
        style={{ width: size, height: size }}
      >
        <Fallback size={Math.max(12, size - 2)} strokeWidth={1.75} aria-hidden />
      </span>
    );
  }
  return reserveSpace ? (
    <span className="inv-brand inv-brand-empty" style={{ width: size, height: size }} aria-hidden />
  ) : null;
}

export function componentIcon(label: string): LucideIcon | null {
  const k = label.toLowerCase();
  if (/^cpu\b|processor/.test(k)) return Cpu;
  if (/cooler|fan|aio|heatsink|radiator/.test(k)) return Fan;
  if (/^gpu\b|graphics|video card/.test(k)) return Gpu;
  if (/motherboard|mobo|mainboard/.test(k)) return CircuitBoard;
  if (/\bram\b|memory|dimm|dram/.test(k)) return MemoryStick;
  if (/storage|drive bay|\bssd\b|\bhdd\b|\bnvme\b/.test(k)) return HardDrive;
  if (/\bpsu\b|power\s*supply/.test(k)) return Zap;
  if (/case|chassis|tower/.test(k)) return Box;
  if (/\bnic\b|ethernet|lan/.test(k)) return Network;
  if (/wifi|wireless/.test(k)) return Wifi;
  if (/router|gateway/.test(k)) return Router;
  if (/display|screen|monitor|\blcm\b|\blcd\b/.test(k)) return Monitor;
  if (/usb/.test(k)) return Usb;
  if (/thermal\s*paste|tim/.test(k)) return Droplet;
  if (/power\b|wattage/.test(k)) return Power;
  if (/temp/.test(k)) return Thermometer;
  return null;
}

export function categoryIcon(name: string): LucideIcon {
  const k = name.toLowerCase();
  if (/network|switch|router|gateway|wi[- ]?fi/.test(k)) return Network;
  if (/laptop|notebook/.test(k)) return Laptop;
  if (/phone/.test(k)) return Smartphone;
  if (/camera|\bcam\b|protect/.test(k)) return Camera;
  if (/monitor|display|screen/.test(k)) return Monitor;
  if (/peripheral|keyboard|mouse|dock/.test(k)) return Keyboard;
  if (/\bcpus?\b|processor/.test(k)) return Cpu;
  if (/cooler|fan/.test(k)) return Fan;
  if (/\bssds?\b|nvme/.test(k)) return HardDrive;
  if (/\bhdds?\b|hard\s*drive|disk/.test(k)) return Disc;
  if (/\bram\b|memory/.test(k)) return MemoryStick;
  if (/gpu|graphics/.test(k)) return Gpu;
  if (/motherboard|mobo/.test(k)) return CircuitBoard;
  if (/psu|power/.test(k)) return Zap;
  if (/case|chassis/.test(k)) return Box;
  if (/print/.test(k)) return Printer;
  return Box;
}

export function roleIcon(role: string, name?: string): LucideIcon {
  const k = `${role} ${name ?? ''}`.toLowerCase();
  if (/proxmox|server|host|hypervisor/.test(k)) return Server;
  if (/nas|storage|drive\s*bay|unas/.test(k)) return HardDrive;
  if (/laptop|macbook/.test(k)) return Laptop;
  if (/router|gateway|switch|firewall/.test(k)) return Router;
  if (/workstation|desktop|gaming|pc/.test(k)) return Monitor;
  return Cpu;
}
