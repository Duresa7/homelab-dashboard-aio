import type { ComponentType } from './component-registry';
import { genId } from './inventory-id';

export interface SpecField {
  id: string;
  label: string;
  value: string;
}

export function createSpecField(label: string, value: string): SpecField {
  return { id: genId('f'), label, value };
}

export function splitSpec(spec: string): { name: string; detail: string } {
  const sep = (spec ?? '').match(/\s+[—–]\s+/);
  if (!sep || sep.index == null) return { name: (spec ?? '').trim(), detail: '' };
  return {
    name: spec.slice(0, sep.index).trim(),
    detail: spec.slice(sep.index + sep[0].length).trim(),
  };
}

const COMPONENT_BRANDS = [
  'Thermal Grizzly',
  'Cooler Master',
  'Western Digital',
  'SK hynix',
  'Lian Li',
  'G.SKILL',
  'TEAMGROUP',
  'Thermalright',
  'Sabrent',
  'Phanteks',
  'Deepcool',
  'SilverStone',
  'AMD',
  'Intel',
  'NVIDIA',
  'MSI',
  'ASUS',
  'ASRock',
  'Gigabyte',
  'Corsair',
  'CORSAIR',
  'Crucial',
  'Samsung',
  'Seagate',
  'Toshiba',
  'HGST',
  'WDC',
  'WD',
  'Kingston',
  'Micron',
  'Arctic',
  'Noctua',
  'NZXT',
  'Antec',
  'Fractal',
  'Realtek',
  'Powerspec',
  'Lenovo',
  'HP',
  'TP-Link',
  'Netgear',
  'Cisco',
  'Ubiquiti',
  'ADATA',
  'Patriot',
  'EVGA',
  'PNY',
  'Zotac',
  'Palit',
  'Sapphire',
  'XFX',
  'Gainward',
];

function escRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function detectBrand(text: string): string | undefined {
  const t = text ?? '';
  let best: string | undefined;
  let bestIdx = Infinity;
  for (const b of COMPONENT_BRANDS) {
    const idx = t.search(new RegExp(`(?:^|\\b)${escRe(b)}\\b`, 'i'));
    if (idx >= 0 && (idx < bestIdx || (idx === bestIdx && b.length > (best?.length ?? 0)))) {
      bestIdx = idx;
      best = b;
    }
  }
  return best;
}

export function splitMultiUnit(spec: string): { count: number; perUnit?: string } {
  const m = (spec ?? '').match(/(\d+)\s*[×x]\s*(\d+(?:\.\d+)?)\s*(GB|TB)/i);
  if (!m) return { count: 1 };
  const count = parseInt(m[1], 10);
  if (!count || count < 2) return { count: 1 };
  return { count, perUnit: `${m[2]} ${m[3].toUpperCase()}` };
}

interface Extractor {
  label: string;
  types: ComponentType[] | '*';
  re: RegExp;
  fmt?: (m: RegExpMatchArray) => string;
}

const EXTRACTORS: Extractor[] = [
  {
    label: 'Socket',
    types: ['cpu', 'motherboard'],
    re: /\b(AM[45]|LGA\s?\d+(?:-v\d+)?|sTRX?4|TR4|FM2\+?)\b/i,
  },
  { label: 'Chipset', types: ['motherboard'], re: /\b([XBZH]\d{3}[A-Z]?)\b/ },
  { label: 'Timing', types: ['ram'], re: /\bCL(\d+)\b/i, fmt: (m) => `CL${m[1]}` },
  { label: 'Voltage', types: ['ram'], re: /\b(\d\.\d+)\s*V\b/i, fmt: (m) => `${m[1]} V` },
  { label: 'Profile', types: ['ram'], re: /\b(AMD EXPO|EXPO|Intel XMP|XMP)\b/i },
  {
    label: 'VRAM',
    types: ['gpu'],
    re: /\b(\d+(?:\.\d+)?)\s*(GB|MB)\b/i,
    fmt: (m) => `${m[1]} ${m[2].toUpperCase()}`,
  },
  {
    label: 'Capacity',
    types: ['ram', 'storage'],
    re: /\b(\d+(?:\.\d+)?)\s*(GB|TB)\b/i,
    fmt: (m) => `${m[1]} ${m[2].toUpperCase()}`,
  },
  {
    label: 'Form Factor',
    types: ['storage', 'motherboard', 'case'],
    re: /\b(2\.5"|3\.5"|M\.2|E-ATX|Micro-ATX|Mini-ITX|ATX|SFF)\b/i,
  },
  {
    label: 'Interface',
    types: ['storage'],
    re: /\b(NVMe|SATA(?:\s?6\s?Gb\/s)?|PCIe[^,;]*)\b/i,
  },
  { label: 'Wattage', types: ['psu'], re: /\b(\d{3,4})\s*W\b/i, fmt: (m) => `${m[1]} W` },
  { label: 'Speed', types: ['nic'], re: /\b(\d+(?:\.\d+)?\s*(?:GbE|Gbps|Gbit|MbE|Mbps))\b/i },
];

export function parseSpecToFields(type: ComponentType, spec: string): SpecField[] {
  const { name, detail } = splitSpec(spec);
  const brand = detectBrand(spec);
  let model = name;
  if (brand) model = name.replace(new RegExp(`^\\s*${escRe(brand)}\\s*`, 'i'), '').trim();

  const fields: SpecField[] = [];
  if (brand) fields.push(createSpecField('Brand', brand));
  if (model) fields.push(createSpecField('Model', model));

  const seen = new Set(fields.map((f) => f.label));
  let work = detail || '';

  if (type === 'cpu') {
    const ct = work.match(/(\d+)\s*C\s*\/\s*(\d+)\s*T/i);
    if (ct) {
      fields.push(createSpecField('Cores', ct[1]));
      fields.push(createSpecField('Threads', ct[2]));
      seen.add('Cores');
      seen.add('Threads');
      work = work.replace(ct[0], '');
    }
  }

  if (type === 'ram') {
    const ddr = work.match(/\bDDR(\d)[A-Z]*(?:[\s-]?(\d{3,5}))?\b/i);
    if (ddr) {
      fields.push(createSpecField('Type', `DDR${ddr[1]}`));
      seen.add('Type');
      if (ddr[2]) {
        fields.push(createSpecField('Speed', `${ddr[2]} MT/s`));
        seen.add('Speed');
      }
      work = work.replace(ddr[0], '');
    }
  }

  for (const ex of EXTRACTORS) {
    if (ex.types !== '*' && !ex.types.includes(type)) continue;
    if (seen.has(ex.label)) continue;
    const mm = work.match(ex.re);
    if (!mm) continue;
    fields.push(createSpecField(ex.label, ex.fmt ? ex.fmt(mm) : (mm[1] ?? mm[0])));
    seen.add(ex.label);
    work = work.replace(mm[0], '');
  }

  const notes = work
    .split(/\s*[,;]\s*/)
    .map((s) =>
      s
        .trim()
        .replace(/^\(|\)$/g, '')
        .trim(),
    )
    .filter((s) => s && !/^[—–-]+$/.test(s));
  if (notes.length) fields.push(createSpecField('Notes', notes.join(', ')));

  if (fields.length === 0 && spec.trim()) fields.push(createSpecField('Spec', spec.trim()));
  return fields;
}

export function fieldValue(fields: SpecField[], label: string): string | undefined {
  return fields.find((f) => f.label.toLowerCase() === label.toLowerCase())?.value || undefined;
}
