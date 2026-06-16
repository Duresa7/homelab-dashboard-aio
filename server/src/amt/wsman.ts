import { randomBytes } from 'node:crypto';

import { AMT, CIM } from '@open-amt-cloud-toolkit/wsman-messages';

import { insecureFetch } from '../lib/http.js';
import {
  buildAuthorizationHeader,
  parseWwwAuthenticate,
  type DigestChallenge,
} from './digest-auth.js';

/** Connection details for a single AMT-managed machine. */
export interface AmtConnection {
  host: string;
  port: number; // default 16993 (TLS) / 16992 (plain)
  username: string; // default 'admin'
  password: string;
  useTls: boolean; // default true
}

export type AmtPowerState = 'on' | 'off' | 'sleep' | 'hibernate' | 'unknown';

export type AmtPowerAction = 'on' | 'off' | 'cycle' | 'reset' | 'shutdown' | 'graceful-reset';

export interface AmtCpu {
  model: string;
  cores: number | null;
  maxSpeedMhz: number | null;
}

export interface AmtMemoryModule {
  bankLabel: string | null;
  capacityBytes: number | null;
  speedMhz: number | null;
  memoryType: string | null;
  formFactor: string | null;
}

export interface AmtBios {
  vendor: string | null;
  version: string | null;
  releaseDate: string | null;
}

export interface AmtNic {
  mac: string | null;
  linkUp: boolean | null;
}

export interface AmtDeviceHardware {
  cpu: AmtCpu | null;
  memory: AmtMemoryModule[];
  bios: AmtBios | null;
  nics: AmtNic[];
}

export interface AmtClient {
  getPowerState(): Promise<AmtPowerState>;
  requestPowerAction(action: AmtPowerAction): Promise<{ returnValue: number }>;
  getHardwareInventory(): Promise<AmtDeviceHardware>;
  getGeneralSettings(): Promise<{ hostname: string; amtVersion: string }>;
}

/** Map a friendly action to its CIM RequestPowerStateChange value. */
const POWER_ACTION_VALUES: Record<AmtPowerAction, number> = {
  on: 2,
  off: 8,
  cycle: 5,
  reset: 10,
  shutdown: 12,
  'graceful-reset': 14,
};

const WSMAN_TIMEOUT_MS = 10_000;
const WSMAN_PATH = '/wsman';

// ---------------------------------------------------------------------------
// XML extraction — AMT response shapes are well-known, so simple, namespace-
// agnostic tag matching is sufficient and avoids pulling in an XML parser.
// ---------------------------------------------------------------------------

/** First inner text of `<...:Tag>value</...:Tag>`, ignoring XML namespace prefix. */
function tagText(xml: string, localName: string): string | null {
  const re = new RegExp(
    `<(?:[\\w.-]+:)?${localName}(?:\\s[^>]*)?>([^<]*)</(?:[\\w.-]+:)?${localName}>`,
    'i',
  );
  const m = xml.match(re);
  return m ? m[1].trim() : null;
}

function tagNumber(xml: string, localName: string): number | null {
  const t = tagText(xml, localName);
  if (t == null || t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Split a Pull response into one XML block per enumerated instance. */
function pullItems(xml: string, className: string): string[] {
  const re = new RegExp(
    `<(?:[\\w.-]+:)?${className}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${className}>`,
    'gi',
  );
  const items: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) items.push(m[1]);
  return items;
}

function newCnonce(): string {
  return randomBytes(8).toString('hex');
}

export function createAmtClient(conn: AmtConnection): AmtClient {
  const cim = new CIM.Messages();
  const amt = new AMT.Messages();

  const scheme = conn.useTls ? 'https' : 'http';
  const url = `${scheme}://${conn.host}:${conn.port}${WSMAN_PATH}`;

  // Per-connection digest state. AMT supports reusing a nonce across requests
  // as long as the nonce count (nc) increments, so we cache the challenge and
  // only re-authenticate when the server rejects a cached nonce with a 401.
  let challenge: DigestChallenge | null = null;
  let ncCounter = 0;

  function authorizationHeader(): string {
    if (!challenge) throw new Error('No digest challenge cached');
    ncCounter += 1;
    const nc = ncCounter.toString(16).padStart(8, '0');
    return buildAuthorizationHeader({
      username: conn.username,
      password: conn.password,
      realm: challenge.realm,
      nonce: challenge.nonce,
      nc,
      cnonce: newCnonce(),
      qop: challenge.qop,
      method: 'POST',
      uri: WSMAN_PATH,
      opaque: challenge.opaque,
    });
  }

  async function rawPost(xml: string, authHeader?: string) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/soap+xml; charset=UTF-8',
    };
    if (authHeader) headers.Authorization = authHeader;
    return insecureFetch(url, {
      method: 'POST',
      headers,
      body: xml,
      signal: AbortSignal.timeout(WSMAN_TIMEOUT_MS),
    });
  }

  /** Send a WSMAN envelope, performing the digest challenge/response dance. */
  async function send(xml: string): Promise<string> {
    let res = challenge ? await rawPost(xml, authorizationHeader()) : await rawPost(xml);

    // No cached challenge, or the cached nonce was rejected → (re)authenticate.
    if (res.status === 401) {
      const wwwAuth = res.headers.get('www-authenticate');
      if (!wwwAuth) {
        throw new Error(`AMT ${conn.host}: 401 without WWW-Authenticate challenge`);
      }
      challenge = parseWwwAuthenticate(wwwAuth);
      ncCounter = 0;
      res = await rawPost(xml, authorizationHeader());
    }

    if (!res.ok) {
      // Never include credentials in surfaced errors.
      throw new Error(`AMT ${conn.host}: WSMAN request failed (${res.status} ${res.statusText})`);
    }
    return res.text();
  }

  /** Enumerate → Pull a CIM/AMT class, returning the Pull response XML. */
  async function enumeratePull(
    enumerateXml: string,
    pull: (ctx: string) => string,
  ): Promise<string> {
    const enumResponse = await send(enumerateXml);
    const ctx = tagText(enumResponse, 'EnumerationContext');
    if (!ctx) throw new Error(`AMT ${conn.host}: missing EnumerationContext in response`);
    return send(pull(ctx));
  }

  function mapPowerState(value: number | null): AmtPowerState {
    switch (value) {
      case 2:
        return 'on';
      case 4:
        return 'sleep';
      case 7:
        return 'hibernate';
      case 6:
      case 8:
        return 'off';
      default:
        return 'unknown';
    }
  }

  return {
    async getPowerState() {
      // The power state lives on CIM_AssociatedPowerManagementService instances,
      // surfaced through the CIM_ServiceAvailableToElement enumeration.
      const xml = await enumeratePull(cim.ServiceAvailableToElement.Enumerate(), (ctx) =>
        cim.ServiceAvailableToElement.Pull(ctx),
      );
      return mapPowerState(tagNumber(xml, 'PowerState'));
    },

    async requestPowerAction(action) {
      const value = POWER_ACTION_VALUES[action];
      if (value == null) throw new Error(`Unknown AMT power action: ${action}`);
      const xml = await send(
        cim.PowerManagementService.RequestPowerStateChange(
          value as Parameters<typeof cim.PowerManagementService.RequestPowerStateChange>[0],
        ),
      );
      const returnValue = tagNumber(xml, 'ReturnValue');
      return { returnValue: returnValue ?? -1 };
    },

    async getHardwareInventory() {
      const [cpuXml, memXml, biosXml, nicXml] = await Promise.all([
        enumeratePull(cim.Processor.Enumerate(), (ctx) => cim.Processor.Pull(ctx)),
        enumeratePull(cim.PhysicalMemory.Enumerate(), (ctx) => cim.PhysicalMemory.Pull(ctx)),
        enumeratePull(cim.BIOSElement.Enumerate(), (ctx) => cim.BIOSElement.Pull(ctx)),
        enumeratePull(amt.EthernetPortSettings.Enumerate(), (ctx) =>
          amt.EthernetPortSettings.Pull(ctx),
        ),
      ]);

      const cpuItems = pullItems(cpuXml, 'CIM_Processor');
      const cpu: AmtCpu | null = cpuItems.length
        ? {
            model:
              tagText(cpuItems[0], 'ElementName') ??
              tagText(cpuItems[0], 'OtherFamilyDescription') ??
              'Unknown CPU',
            cores: tagNumber(cpuItems[0], 'CoreCount'),
            maxSpeedMhz: tagNumber(cpuItems[0], 'MaxClockSpeed'),
          }
        : null;

      const memory: AmtMemoryModule[] = pullItems(memXml, 'CIM_PhysicalMemory').map((item) => ({
        bankLabel: tagText(item, 'BankLabel'),
        capacityBytes: tagNumber(item, 'Capacity'),
        speedMhz: tagNumber(item, 'Speed'),
        memoryType: tagText(item, 'MemoryType'),
        formFactor: tagText(item, 'FormFactor'),
      }));

      const biosItems = pullItems(biosXml, 'CIM_BIOSElement');
      const bios: AmtBios | null = biosItems.length
        ? {
            vendor: tagText(biosItems[0], 'Manufacturer'),
            version: tagText(biosItems[0], 'Version'),
            releaseDate: tagText(biosItems[0], 'ReleaseDate') ?? tagText(biosItems[0], 'Datetime'),
          }
        : null;

      const nics: AmtNic[] = pullItems(nicXml, 'AMT_EthernetPortSettings').map((item) => {
        const linkUp = tagText(item, 'LinkIsUp');
        return {
          mac: tagText(item, 'MACAddress'),
          linkUp: linkUp == null ? null : linkUp.toLowerCase() === 'true',
        };
      });

      return { cpu, memory, bios, nics };
    },

    async getGeneralSettings() {
      const [generalXml, setupXml] = await Promise.all([
        send(amt.GeneralSettings.Get()),
        send(amt.SetupAndConfigurationService.Get()),
      ]);
      return {
        hostname: tagText(generalXml, 'HostName') ?? '',
        amtVersion: tagText(setupXml, 'AMTVersion') ?? '',
      };
    },
  };
}
