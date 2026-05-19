/* =========================================================
   Inventory — client-side persistent tracker.
   Seeded from `Datacenter/Inventory.md` + `Spare_Parts.md`.
   Stored in localStorage; user can edit, export/import, reset.
   ========================================================= */

export interface MetaRow {
  id: string;
  label: string;
  value: string;
}

export interface SpecRow {
  id: string;
  component: string;
  specification: string;
}

export interface Machine {
  id: string;
  name: string;
  role: string;
  /** Visible badge in the masthead of each card. e.g. "01", "02". */
  ordinal?: string;
  meta: MetaRow[];
  components: SpecRow[];
}

export interface SpareItem {
  id: string;
  /** Keyed by column id. */
  values: Record<string, string>;
}

export interface SpareColumn {
  id: string;
  label: string;
  /** Optional render hint; reserved for future. */
  align?: 'left' | 'right';
}

export interface SpareCategory {
  id: string;
  name: string;
  /** Short blurb / footnote shown under the section header. */
  note?: string;
  columns: SpareColumn[];
  items: SpareItem[];
}

export interface Inventory {
  lastUpdated: string;
  machines: Machine[];
  spares: SpareCategory[];
}

/* ---------- ids ---------- */

let _idTick = 0;
export function genId(prefix = 'x'): string {
  _idTick += 1;
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 6);
  return `${prefix}_${t}${r}${_idTick.toString(36)}`;
}

/* ---------- seed (from markdown) ---------- */

const m = (label: string, value: string): MetaRow => ({ id: genId('m'), label, value });
const c = (component: string, specification: string): SpecRow => ({
  id: genId('c'), component, specification,
});

function makeSeed(): Inventory {
  return {
    lastUpdated: '2026-05-18',
    machines: [
      {
        id: genId('mach'),
        ordinal: '01',
        name: 'Example PC',
        role: 'Windows workstation',
        meta: [
          m('Hostname', 'EXAMPLE-WORKSTATION'),
          m('OS', 'Microsoft Windows 11 Pro'),
        ],
        components: [
          c('CPU',          'AMD Ryzen 9 9950X3D — 16C / 32T, AM5'),
          c('CPU Cooler',   'Arctic 420 mm AIO (Non-RGB)'),
          c('GPU',          'MSI Inspire 3X OC GeForce RTX 5070 Ti — 16 GB'),
          c('Motherboard',  'ASUS TUF Gaming X870-PLUS WiFi — AM5 / X870, ATX'),
          c('RAM',          'G.SKILL Trident Z5 Neo RGB — DDR5-6000 32 GB (2×16 GB), CL30, 1.35 V, AMD EXPO'),
          c('Storage 1',    'Samsung 990 Pro — 2 TB NVMe M.2'),
          c('Storage 2',    'Samsung 980 — 1 TB NVMe M.2'),
          c('PSU',          'CORSAIR RM850e (2025)'),
          c('Case',         'Antec FLUX Wood — Mid-Tower E-ATX, walnut wood front, 5× PWM fans, Type-C'),
          c('Thermal Paste','Thermal Grizzly Kryonaut'),
          c('NIC',          'Realtek 2.5 GbE (onboard)'),
        ],
      },
      {
        id: genId('mach'),
        ordinal: '02',
        name: 'OBI PC',
        role: 'Windows workstation',
        meta: [
          m('Hostname', 'EXAMPLE-PC'),
          m('Domain',   'example.test'),
          m('IP',       '198.51.100.10'),
          m('OS',       'Microsoft Windows 11 Pro'),
        ],
        components: [
          c('CPU',          'AMD Ryzen 7 7700X — 8C / 16T, AM5'),
          c('CPU Cooler',   'Cooler Master 240 mm AIO'),
          c('GPU',          'MSI NVIDIA GeForce RTX 3070 8GB'),
          c('Motherboard',  'ASUS TUF Gaming B650-PLUS WiFi — AM5 / B650'),
          c('RAM',          'G.SKILL F5-6000J3636F16G — DDR5-6000 32 GB (2×16 GB)'),
          c('Storage 1',    'WDC PC SN720 SDAQNTW — 512 GB NVMe SSD'),
          c('Storage 2',    'Crucial CT500P310SSD8 — 500 GB NVMe SSD'),
          c('PSU',          'CORSAIR 750 W'),
          c('Case',         'NZXT H5 Flow (2023)'),
          c('Thermal Paste','Thermal Grizzly Kryonaut'),
          c('NIC',          'Realtek 2.5 GbE (onboard)'),
        ],
      },
      {
        id: genId('mach'),
        ordinal: '03',
        name: 'example-server',
        role: 'Proxmox host',
        meta: [
          m('Hostname', 'example-server'),
          m('IP',       '198.51.100.10'),
          m('OS',       'Proxmox VE 9 (Debian 13 "Trixie")'),
        ],
        components: [
          c('CPU',          'AMD Ryzen 7 3700X — 8C / 16T, AM4'),
          c('CPU Cooler',   'Thermalright Phantom Spirit 120 SE Black — dual-tower, 7 heat pipes, 2× TL-C12B V2'),
          c('GPU',          'NVIDIA GeForce GTX 1080 Ti — 11 GB'),
          c('Motherboard',  'MSI MAG B550 Tomahawk'),
          c('RAM',          'G.SKILL Ripjaws V — DDR4-3600 64 GB (4×16 GB), 2× F4-3600C18D-32GVK kits, CL18, XMP'),
          c('Storage 1',    'Crucial CT1000P310SSD8 — 1 TB NVMe SSD'),
          c('Storage 2',    'Crucial CT2000BX500SSD1 — 2 TB SATA SSD'),
          c('Storage 3',    'WD WD40EFPX-68C6CN0 — 4 TB HDD'),
          c('PSU',          'Powerspec 750 W ATX (Non-Modular)'),
          c('Case',         'NZXT H510i'),
          c('Thermal Paste','Thermal Grizzly Kryonaut'),
          c('NIC 1',        'Realtek RTL8125 — 2.5 GbE (onboard)'),
          c('NIC 2',        'Realtek RTL8111/8168 — 1 GbE (onboard)'),
        ],
      },
      {
        id: genId('mach'),
        ordinal: '04',
        name: 'UNAS 2',
        role: 'Network-attached storage',
        meta: [
          m('Brand / Model', 'Ubiquiti UniFi UNAS 2 (2-bay)'),
        ],
        components: [
          c('CPU',         'Quad-core ARM Cortex-A55 @ 1.7 GHz'),
          c('RAM',         '4 GB'),
          c('Drive Bay 1', 'WD Purple WD40PURX-64GVNY0 — 4 TB 3.5" SATA HDD (surveillance)'),
          c('Drive Bay 2', 'WD Purple WD60PURX-64LZMY0 — 6 TB 3.5" SATA HDD (surveillance)'),
          c('NIC',         '2.5 GbE RJ45 (PoE++ powered)'),
          c('USB',         'USB-C 5 Gbps (front)'),
          c('Display',     '1.47" color LCM'),
          c('Power',       '60 W PoE++ (adapter included)'),
        ],
      },
    ],
    spares: [
      {
        id: genId('cat'),
        name: 'UniFi Network Infrastructure',
        note: 'Active Ubiquiti gear powering the network.',
        columns: [
          { id: 'role',  label: 'Role' },
          { id: 'brand', label: 'Brand' },
          { id: 'model', label: 'Model' },
          { id: 'notes', label: 'Notes' },
          { id: 'qty',   label: 'Qty', align: 'right' },
        ],
        items: [
          { id: genId('s'), values: { role: 'Gateway / Router', brand: 'Ubiquiti', model: 'UCG-Fiber (UniFi Cloud Gateway Fiber)', notes: 'Multi-gig fiber gateway', qty: '1' } },
          { id: genId('s'), values: { role: 'Switch',           brand: 'Ubiquiti', model: 'USW-Flex-2.5G-5 (Flex 2.5G 5-port)',   notes: '2.5 GbE, 5 ports',         qty: '2' } },
          { id: genId('s'), values: { role: 'Switch',           brand: 'Ubiquiti', model: 'USW-Pro-Max-16-PoE (Pro Max 16 PoE)',  notes: '16-port multi-gig PoE',    qty: '1' } },
          { id: genId('s'), values: { role: 'Wi-Fi AP',         brand: 'Ubiquiti', model: 'U7-Pro-XG',                            notes: 'Wi-Fi 7, 10 GbE uplink',   qty: '1' } },
          { id: genId('s'), values: { role: 'Camera',           brand: 'Ubiquiti', model: 'UVC-G6-Bullet (Protect G6 Bullet)',    notes: 'PoE bullet security cam',  qty: '1' } },
        ],
      },
      {
        id: genId('cat'),
        name: 'Laptops',
        columns: [
          { id: 'brand',   label: 'Brand' },
          { id: 'model',   label: 'Model' },
          { id: 'cpu',     label: 'CPU' },
          { id: 'ram',     label: 'RAM' },
          { id: 'storage', label: 'Storage' },
        ],
        items: [
          { id: genId('s'), values: { brand: 'Apple', model: 'MacBook Air (M1)',               cpu: 'Apple M1',     ram: '8 GB',  storage: '256 GB' } },
          { id: genId('s'), values: { brand: 'Apple', model: 'MacBook Pro 15" 2017 (Touch Bar)', cpu: 'Intel Core i7', ram: '16 GB', storage: '1 TB'   } },
        ],
      },
      {
        id: genId('cat'),
        name: 'CPUs',
        columns: [
          { id: 'brand', label: 'Brand' },
          { id: 'model', label: 'Model' },
          { id: 'notes', label: 'Notes' },
        ],
        items: [
          { id: genId('s'), values: { brand: 'Intel', model: 'Core i7-5820K', notes: '6-core, LGA 2011-v3' } },
        ],
      },
      {
        id: genId('cat'),
        name: 'CPU Coolers',
        columns: [
          { id: 'brand', label: 'Brand' },
          { id: 'model', label: 'Model' },
          { id: 'notes', label: 'Notes' },
        ],
        items: [
          { id: genId('s'), values: { brand: 'AMD', model: 'Wraith Prism',   notes: 'Stock cooler, RGB' } },
          { id: genId('s'), values: { brand: 'AMD', model: 'Wraith Stealth', notes: 'Stock cooler' } },
        ],
      },
      {
        id: genId('cat'),
        name: 'SSDs',
        columns: [
          { id: 'brand',    label: 'Brand' },
          { id: 'model',    label: 'Model' },
          { id: 'capacity', label: 'Capacity' },
          { id: 'form',     label: 'Form Factor' },
        ],
        items: [
          { id: genId('s'), values: { brand: 'Samsung',  model: '850 EVO',            capacity: '250 GB', form: '2.5" SATA' } },
          { id: genId('s'), values: { brand: 'Kingston', model: 'RBU-SNS4151S3/16GD', capacity: '16 GB',  form: 'OEM SSD'   } },
        ],
      },
      {
        id: genId('cat'),
        name: 'HDDs',
        columns: [
          { id: 'brand',    label: 'Brand' },
          { id: 'model',    label: 'Model' },
          { id: 'capacity', label: 'Capacity' },
          { id: 'form',     label: 'Form Factor' },
        ],
        items: [
          { id: genId('s'), values: { brand: 'HGST',    model: 'HTS725050A7E630', capacity: '500 GB', form: '2.5"' } },
          { id: genId('s'), values: { brand: 'WD Blue', model: 'WD5000LPVX',      capacity: '500 GB', form: '2.5"' } },
          { id: genId('s'), values: { brand: 'Seagate', model: '(laptop HDD)',    capacity: '1 TB',   form: '2.5"' } },
          { id: genId('s'), values: { brand: 'Toshiba', model: 'DT01ACA200',      capacity: '2 TB',   form: '3.5"' } },
        ],
      },
      {
        id: genId('cat'),
        name: 'RAM',
        columns: [
          { id: 'brand',    label: 'Brand' },
          { id: 'part',     label: 'Part Number' },
          { id: 'capacity', label: 'Capacity' },
          { id: 'type',     label: 'Type' },
        ],
        items: [
          { id: genId('s'), values: { brand: 'SK hynix', part: 'HMT351S6EFR8A',    capacity: '4 GB', type: 'DDR3L-1600 SO-DIMM (PC3L-12800S), 2Rx8' } },
          { id: genId('s'), values: { brand: 'Samsung',  part: 'M471A5644EB0-CPB', capacity: '2 GB', type: 'DDR4-2133 SO-DIMM (PC4-2133P), 1Rx16'  } },
        ],
      },
      {
        id: genId('cat'),
        name: 'Networking (legacy)',
        note: 'Earlier networking gear retained as spares.',
        columns: [
          { id: 'brand', label: 'Brand' },
          { id: 'model', label: 'Model' },
          { id: 'type',  label: 'Type' },
          { id: 'notes', label: 'Notes' },
        ],
        items: [
          { id: genId('s'), values: { brand: 'Cisco',     model: 'Firepower 1000',  type: 'Next-gen firewall / security appliance', notes: 'Specific sub-model TBD' } },
          { id: genId('s'), values: { brand: 'ASUS',      model: 'RT-AX3000',       type: 'Wi-Fi 6 router',                          notes: '' } },
          { id: genId('s'), values: { brand: 'TP-Link',   model: 'TL-SG108E',       type: '8-port managed switch (1 GbE)',           notes: 'Easy Smart, QoS / VLAN / IGMP / LAG' } },
          { id: genId('s'), values: { brand: 'Netgear',   model: 'GS308',           type: '8-port unmanaged switch (1 GbE)',         notes: '' } },
          { id: genId('s'), values: { brand: 'Netgear',   model: 'FS726TP ProSafe', type: '24-port smart switch (10/100) + 2× 1 GbE', notes: 'PoE' } },
          { id: genId('s'), values: { brand: '(Generic)', model: '—',               type: '8-port PoE unmanaged switch (1 GbE)',     notes: '' } },
        ],
      },
      {
        id: genId('cat'),
        name: 'Printers',
        columns: [
          { id: 'brand', label: 'Brand' },
          { id: 'model', label: 'Model' },
          { id: 'type',  label: 'Type' },
          { id: 'notes', label: 'Notes' },
        ],
        items: [
          { id: genId('s'), values: { brand: 'HP', model: 'DeskJet 4255e', type: 'All-in-one inkjet (print/scan/copy)', notes: 'Wi-Fi' } },
        ],
      },
    ],
  };
}

/* ---------- storage ---------- */

const STORAGE_KEY = 'homelab-dashboard.inventory';
const SCHEMA_VERSION = 1;

interface Persisted {
  v: number;
  data: Inventory;
}

export function loadInventory(): Inventory {
  if (typeof window === 'undefined') return makeSeed();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return makeSeed();
    const parsed = JSON.parse(raw) as Persisted;
    if (parsed?.v !== SCHEMA_VERSION || !parsed.data) return makeSeed();
    return parsed.data;
  } catch {
    return makeSeed();
  }
}

export function saveInventory(inv: Inventory): void {
  if (typeof window === 'undefined') return;
  try {
    const payload: Persisted = { v: SCHEMA_VERSION, data: inv };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* quota or unavailable; ignore */
  }
}

export function resetInventory(): Inventory {
  const fresh = makeSeed();
  saveInventory(fresh);
  return fresh;
}

/* ---------- serialization helpers ---------- */

export function exportInventoryJSON(inv: Inventory): string {
  return JSON.stringify({ v: SCHEMA_VERSION, exportedAt: new Date().toISOString(), data: inv }, null, 2);
}

export function tryImportInventoryJSON(text: string): Inventory | null {
  try {
    const parsed = JSON.parse(text) as { v?: number; data?: Inventory } | Inventory;
    const candidate = (parsed as { data?: Inventory }).data ?? (parsed as Inventory);
    if (!candidate || !Array.isArray((candidate as Inventory).machines) || !Array.isArray((candidate as Inventory).spares)) {
      return null;
    }
    return candidate as Inventory;
  } catch {
    return null;
  }
}

/* ---------- summary stats ---------- */

export interface InventoryStats {
  machineCount: number;
  componentCount: number;
  spareCategoryCount: number;
  spareItemCount: number;
}

export function summarize(inv: Inventory): InventoryStats {
  let components = 0;
  for (const ma of inv.machines) components += ma.components.length;
  let spareItems = 0;
  for (const cat of inv.spares) spareItems += cat.items.length;
  return {
    machineCount: inv.machines.length,
    componentCount: components,
    spareCategoryCount: inv.spares.length,
    spareItemCount: spareItems,
  };
}
