import type { Upstream } from '../types.js';
import type { SensorsData } from '../../../shared/wire.ts';

export interface CoreReading {
  name: string;
  tempC: number;
}
export interface DiskReading {
  name: string;
  tempC: number;
  type: string;
}
export interface MemReading {
  name: string;
  tempC: number;
  type: string;
}
export interface NetReading {
  name: string;
  tempC: number;
  type: string;
}
export interface FanReading {
  chip: string;
  name: string;
  rpm: number;
}
export interface OtherReading {
  chip: string;
  name: string;
  tempC: number;
}

export type SensorTree = SensorsData;

export interface DiskInfo {
  kind: 'nvme' | 'sata';
  name: string;
  path: string | null;
  serial: string | null;
}

export interface DetectedDisk {
  vendor: string;
  model: string;
}

function cleanDiskPart(value: unknown): string {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanUsefulDiskPart(value: unknown): string {
  const cleaned = cleanDiskPart(value);
  return /^(unknown|n\/a|none|null|-+)$/i.test(cleaned) ? '' : cleaned;
}

function diskToken(...parts: unknown[]): string {
  return parts
    .map(cleanUsefulDiskPart)
    .filter(Boolean)
    .join(' ')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function capacityFromGb(gb: number | string): string {
  const n = Number(gb);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n >= 1000) {
    const tb = n / 1000;
    return Number.isInteger(tb) ? `${tb}TB` : `${tb.toFixed(1)}TB`;
  }
  return `${n}GB`;
}

function wdCapacityFromDigits(digits: string): string {
  const n = Number(digits);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (digits.length >= 4) {
    const gb = n / 10;
    return Number.isInteger(gb) ? `${gb}GB` : `${gb.toFixed(0)}GB`;
  }
  const tb = n / 10;
  return Number.isInteger(tb) ? `${tb}TB` : `${tb.toFixed(1)}TB`;
}

const WD_FAMILY: Record<string, string> = {
  EFRX: 'Red',
  EFAX: 'Red',
  EFGX: 'Red',

  EFBX: 'Red Plus',
  EFPX: 'Red Plus',
  EFZX: 'Red Plus',
  EFZZ: 'Red Plus',

  FFBX: 'Red Pro',
  KFGX: 'Red Pro',
  PFBX: 'Red Pro',

  EZRZ: 'Blue',
  EZEX: 'Blue',
  AZLW: 'Blue',
  AZLX: 'Blue',
  AZRZ: 'Blue',
  AZBX: 'Blue',

  FZWX: 'Black',
  LSAX: 'Black SN',
  LSBX: 'Black SN',
  PLAX: 'Black SN850',

  PURX: 'Purple',
  PURZ: 'Purple',
  PURP: 'Purple Pro',

  FRYZ: 'Gold',
  VRYZ: 'Gold',

  EZRS: 'Green',
  AZRX: 'Green',
};

const SEAGATE_FAMILY: Record<string, string> = {
  VN: 'IronWolf',
  NE: 'IronWolf Pro',
  NT: 'IronWolf Pro',
  DM: 'BarraCuda',
  LM: 'BarraCuda',
  GX: 'FireCuda',
  LX: 'FireCuda',
  NM: 'Exos',
  VX: 'SkyHawk',
  AS: 'BarraCuda',
};

const CRUCIAL_FAMILY: Record<string, { label: string; bus: string }> = {
  P3P: { label: 'P3 Plus', bus: 'NVMe' },
  P5P: { label: 'P5 Plus', bus: 'NVMe' },
  P3: { label: 'P3', bus: 'NVMe' },
  P5: { label: 'P5', bus: 'NVMe' },
  P1: { label: 'P1', bus: 'NVMe' },
  P2: { label: 'P2', bus: 'NVMe' },
  T700: { label: 'T700', bus: 'NVMe' },
  T705: { label: 'T705', bus: 'NVMe' },
  T500: { label: 'T500', bus: 'NVMe' },
  MX500: { label: 'MX500', bus: 'SATA' },
  MX300: { label: 'MX300', bus: 'SATA' },
  MX200: { label: 'MX200', bus: 'SATA' },
  BX500: { label: 'BX500', bus: 'SATA' },
  BX300: { label: 'BX300', bus: 'SATA' },
  BX200: { label: 'BX200', bus: 'SATA' },
  M4: { label: 'M4', bus: 'SATA' },
};
const CRUCIAL_FAMILY_REGEX = new RegExp(
  'CT(\\d+)(' +
    Object.keys(CRUCIAL_FAMILY)
      .sort((a, b) => b.length - a.length)
      .join('|') +
    ')SSD\\d?',
);

function detectCrucial(token: string): DetectedDisk | null {
  const m = token.match(CRUCIAL_FAMILY_REGEX);
  if (!m) return null;
  const sizeGb = Number(m[1]);
  const fam = CRUCIAL_FAMILY[m[2]];
  if (!fam) return null;
  const kind = fam.bus === 'NVMe' ? 'NVMe SSD' : 'SATA SSD';
  return {
    vendor: 'Crucial',
    model: [fam.label, capacityFromGb(sizeGb), kind].filter(Boolean).join(' '),
  };
}

function detectWesternDigital(token: string): DetectedDisk | null {
  if (!/WD/.test(token)) return null;
  const m = token.match(/(?:WDC)?WD(\d{2,4})([A-Z]+)/);
  if (!m) return null;
  const capStr = wdCapacityFromDigits(m[1]);
  const suffix = m[2];

  let family: string | null = null;

  for (let i = 0; i + 4 <= suffix.length; i++) {
    const code = suffix.slice(i, i + 4);
    if (WD_FAMILY[code]) {
      family = WD_FAMILY[code];
      break;
    }
  }

  if (!family) {
    if (/^EF/.test(suffix)) family = 'Red';
    else if (/^EZ/.test(suffix)) family = 'Blue';
    else if (/^FZ/.test(suffix)) family = 'Black';
    else if (/^PUR/.test(suffix)) family = 'Purple';
  }

  return {
    vendor: 'Western Digital',
    model: [family, capStr].filter(Boolean).join(' ') || `WD ${capStr}`.trim(),
  };
}

function detectSeagate(token: string): DetectedDisk | null {
  const m = token.match(/ST(\d{3,5})([A-Z]{2})\d/);
  if (!m) return null;
  const gb = Number(m[1]);
  const family = SEAGATE_FAMILY[m[2]] || null;
  const capStr = capacityFromGb(gb);
  return {
    vendor: 'Seagate',
    model: [family, capStr].filter(Boolean).join(' ') || `Seagate ${capStr}`,
  };
}

function detectSamsung(token: string, rawModel: string): DetectedDisk | null {
  if (!/SAMSUNG|^MZ[VN]|^MZQL/.test(token)) return null;

  const cleaned = String(rawModel || '')
    .replace(/^samsung[\s_]*ssd[\s_]*/i, '')
    .replace(/^samsung[\s_]*/i, '')
    .trim();
  return { vendor: 'Samsung', model: cleaned || rawModel || '' };
}

function detectKingston(token: string, rawModel: string): DetectedDisk | null {
  if (!/KINGSTON|^(KC|SKC|SA400|SNV|NV[12])/.test(token)) return null;
  const cleaned = String(rawModel || '')
    .replace(/^kingston[\s_]*/i, '')
    .trim();
  return { vendor: 'Kingston', model: cleaned || rawModel || '' };
}

function detectToshibaKioxia(token: string, rawModel: string): DetectedDisk | null {
  if (!/TOSHIBA|KIOXIA|^MG\d|^MQ\d|^DT\d/.test(token)) return null;
  const isKioxia = /KIOXIA/.test(token);
  const cleaned = String(rawModel || '')
    .replace(/^toshiba[\s_]*/i, '')
    .replace(/^kioxia[\s_]*/i, '')
    .trim();
  return { vendor: isKioxia ? 'Kioxia' : 'Toshiba', model: cleaned || rawModel || '' };
}

function detectHgstHitachi(token: string, rawModel: string): DetectedDisk | null {
  if (!/HITACHI|HGST|^HUS|^HDN/.test(token)) return null;
  const cleaned = String(rawModel || '')
    .replace(/^(hitachi|hgst)[\s_]*/i, '')
    .trim();
  return { vendor: 'HGST', model: cleaned || rawModel || '' };
}

export function normalizeDiskParts(disk: Upstream): DetectedDisk {
  const rawModel = cleanUsefulDiskPart(disk?.model);
  const rawVendor = cleanUsefulDiskPart(disk?.vendor);

  const vendor = /^(ata|nvme|scsi|usb)$/i.test(rawVendor) ? '' : rawVendor;
  const token = diskToken(vendor, rawModel);

  const detected =
    detectCrucial(token) ||
    detectWesternDigital(token) ||
    detectSeagate(token) ||
    detectSamsung(token, rawModel) ||
    detectKingston(token, rawModel) ||
    detectToshibaKioxia(token, rawModel) ||
    detectHgstHitachi(token, rawModel);

  if (detected && detected.model) return detected;
  return { vendor, model: rawModel };
}

function diskDisplayName(disk: Upstream): string | null {
  const { model, vendor } = normalizeDiskParts(disk);
  if (!model) return vendor || null;
  if (!vendor || model.toLowerCase().includes(vendor.toLowerCase())) return model;
  return `${vendor} ${model}`;
}

function friendlySystemSensorLabel(chipKey: string, sensorName?: string): string {
  const chip = String(chipKey || '').toLowerCase();
  const sensor = String(sensorName || '').trim();
  if (/^(chipset|pch)$/i.test(sensor)) return 'Chipset';
  if (/^pch/i.test(chip)) return 'Chipset';
  if (/^(nct|it86|w836|f718|nuvoton|asus|ec_sys|asusec)/.test(chip)) return 'Motherboard';
  if (chip.startsWith('acpitz') || chip.startsWith('thermal_zone')) return 'System';
  return 'System';
}

function diskKind(disk: Upstream): 'nvme' | 'sata' {
  const name = String(disk.name || '').toLowerCase();
  const path = String(disk.path || '').toLowerCase();
  const tran = String(disk.tran || '').toLowerCase();
  if (tran === 'nvme' || name.startsWith('nvme') || path.includes('/nvme')) return 'nvme';
  return 'sata';
}

function deviceShortName(path: string | null | undefined): string {
  return (
    String(path || '')
      .split(/[\\/]/)
      .filter(Boolean)
      .pop() || ''
  );
}

function withUniqueDiskDisplayNames(disks: DiskInfo[]): DiskInfo[] {
  const counts = disks.reduce((acc, d) => {
    acc.set(d.name, (acc.get(d.name) || 0) + 1);
    return acc;
  }, new Map<string, number>());

  return disks.map((d, idx) => {
    if ((counts.get(d.name) || 0) <= 1) return d;
    const suffix =
      deviceShortName(d.path) || (d.serial ? String(d.serial).slice(-4) : `${idx + 1}`);
    return { ...d, name: `${d.name} (${suffix})` };
  });
}

export function parseDiskInventory(lsblkRaw: string | object): DiskInfo[] {
  const json: Upstream = typeof lsblkRaw === 'string' ? JSON.parse(lsblkRaw) : lsblkRaw;
  const devices = Array.isArray(json.blockdevices) ? json.blockdevices : [];
  const disks = devices
    .filter((d: Upstream) => d?.type === 'disk')
    .map((d: Upstream): DiskInfo => ({
      kind: diskKind(d),
      name: diskDisplayName(d) ?? '',
      path: d.path || (d.name ? `/dev/${d.name}` : null),
      serial: d.serial || null,
    }))
    .filter((d: DiskInfo) => d.name);
  return withUniqueDiskDisplayNames(disks);
}

function diskNameQueues(inventory: DiskInfo[]): { nvme: string[]; sata: string[] } {
  return inventory.reduce(
    (acc, d) => {
      acc[d.kind === 'nvme' ? 'nvme' : 'sata'].push(d.name);
      return acc;
    },
    { nvme: [] as string[], sata: [] as string[] },
  );
}

function findFirstNumeric(obj: unknown, predicate: (key: string) => boolean): number | null {
  if (!obj || typeof obj !== 'object') return null;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'number' && predicate(k)) return v;
  }
  return null;
}

export function parseSensorsJson(raw: string | object, diskInventory: DiskInfo[] = []): SensorTree {
  const json: Upstream = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const diskNames = diskNameQueues(diskInventory);

  let cpuTempC: number | null = null;
  let systemTempC: number | null = null;
  let systemTempLabel: string | null = null;
  let acpiTempC: number | null = null;
  let nvmeCount = 0;
  let dimmCount = 0;
  const cores: CoreReading[] = [];
  const disks: DiskReading[] = [];
  const memory: MemReading[] = [];
  const network: NetReading[] = [];
  const fans: FanReading[] = [];
  const other: OtherReading[] = [];

  const SYSTEM_LABEL_PATTERNS = [
    /^systin$/i,
    /^mb[ _\-]?temp/i,
    /^motherboard$/i,
    /^board[ _\-]?temp/i,
    /^system$/i,
    /^chipset$/i,
    /^pch$/i,

    /^thermistor[ _]*0$/i,
    /^diode[ _]*0/i,
  ];

  for (const [chipKey, rawChip] of Object.entries(json || {})) {
    if (!rawChip || typeof rawChip !== 'object') continue;
    const chip: Upstream = rawChip;

    const lcChip = chipKey.toLowerCase();

    if (lcChip.startsWith('k10temp') || lcChip.startsWith('zenpower')) {
      const tctl = findFirstNumeric(chip.Tctl, (k) => k.endsWith('_input'));
      const tdie = findFirstNumeric(chip.Tdie, (k) => k.endsWith('_input'));
      cpuTempC = tctl ?? tdie ?? cpuTempC;

      for (const [k, v] of Object.entries(chip)) {
        if (/^Tccd\d+$/.test(k)) {
          const t = findFirstNumeric(v, (kk) => kk.endsWith('_input'));
          if (t != null) cores.push({ name: k, tempC: t });
        }
      }
      continue;
    }

    if (lcChip.startsWith('coretemp')) {
      for (const [sensorName, sensor] of Object.entries(chip)) {
        if (typeof sensor !== 'object') continue;
        const t = findFirstNumeric(sensor, (kk) => kk.endsWith('_input'));
        if (t == null) continue;
        if (/^Package/i.test(sensorName)) cpuTempC = t;
        else if (/^Core/i.test(sensorName)) cores.push({ name: sensorName, tempC: t });
      }
      continue;
    }

    if (lcChip.startsWith('nvme')) {
      const composite = findFirstNumeric(chip.Composite, (k) => k.endsWith('_input'));
      if (composite != null) {
        nvmeCount++;
        disks.push({
          name: diskNames.nvme[nvmeCount - 1] || `NVMe ${nvmeCount}`,
          tempC: composite,
          type: 'nvme',
        });
      }
      continue;
    }

    if (lcChip.startsWith('drivetemp')) {
      const t = findFirstNumeric(chip.temp1, (k) => k.endsWith('_input'));
      if (t != null) {
        const num = disks.filter((d) => d.type === 'sata').length + 1;
        disks.push({
          name: diskNames.sata[num - 1] || `SATA ${num}`,
          tempC: t,
          type: 'sata',
        });
      }
      continue;
    }

    if (lcChip.startsWith('jc42')) {
      const t = findFirstNumeric(chip.temp1, (k) => k.endsWith('_input'));
      if (t != null) {
        dimmCount++;
        memory.push({ name: `DIMM ${dimmCount}`, tempC: t, type: 'dimm' });
      }
      continue;
    }

    if (/^(r8169|e1000|igb|igc|ixgbe|bnx|mlx|tg3)/.test(lcChip)) {
      const t = findFirstNumeric(chip.temp1, (k) => k.endsWith('_input'));
      if (t != null) {
        const family = lcChip.split(/[_\-]/)[0];
        const friendly =
          family === 'r8169'
            ? 'Realtek NIC'
            : /^(e1000|igb|igc|ixgbe)$/.test(family)
              ? `Intel NIC (${family})`
              : `${family.toUpperCase()} NIC`;
        network.push({ name: friendly, tempC: t, type: family });
      }
      continue;
    }

    if (lcChip.startsWith('acpitz')) {
      const t = findFirstNumeric(chip.temp1, (k) => k.endsWith('_input'));
      if (t != null) acpiTempC = t;
      continue;
    }

    const fanSource =
      lcChip.startsWith('nct') || lcChip.startsWith('it86') || lcChip.startsWith('w836')
        ? 'Mobo'
        : lcChip.startsWith('nzxt')
          ? 'NZXT'
          : lcChip.startsWith('corsair')
            ? 'Corsair'
            : lcChip.startsWith('asus')
              ? 'Asus'
              : null;
    for (const [sensorName, sensor] of Object.entries(chip)) {
      if (typeof sensor !== 'object') continue;
      const tempVal = findFirstNumeric(sensor, (k) => /^temp\d+_input$/.test(k));
      const fanVal = findFirstNumeric(sensor, (k) => /^fan\d+_input$/.test(k));
      if (tempVal != null) {
        other.push({ chip: chipKey, name: sensorName, tempC: tempVal });

        if (systemTempC == null && SYSTEM_LABEL_PATTERNS.some((rx) => rx.test(sensorName))) {
          systemTempC = tempVal;
          systemTempLabel = friendlySystemSensorLabel(chipKey, sensorName);
        }
      }
      if (fanVal != null) {
        const fanNum = sensorName.replace(/^fan[\s_]*/i, '').trim();
        const friendlyName = fanSource ? `${fanSource} fan ${fanNum}` : `${chipKey} ${sensorName}`;
        fans.push({ chip: chipKey, name: friendlyName, rpm: fanVal });
      }
    }
  }

  if (systemTempC == null && acpiTempC != null) {
    systemTempC = acpiTempC;
    systemTempLabel = friendlySystemSensorLabel('acpitz');
  }

  return { cpuTempC, systemTempC, systemTempLabel, cores, disks, memory, network, fans, other };
}
