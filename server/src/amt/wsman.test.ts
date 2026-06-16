import { beforeEach, describe, expect, it, vi } from 'vitest';

const httpMock = vi.hoisted(() => ({
  insecureFetch: vi.fn(),
}));

vi.mock('../lib/http.js', () => ({
  insecureFetch: httpMock.insecureFetch,
}));

import { createAmtClient, type AmtConnection } from './wsman.js';

const CONN: AmtConnection = {
  host: 'amt.test',
  port: 16993,
  username: 'admin',
  password: 'S3cr3t!',
  useTls: true,
};

const CHALLENGE =
  'Digest realm="Digest:1A2B3C", nonce="abc123nonce", stale="false", qop="auth", opaque="op-42"';

interface FakeResponse {
  status: number;
  statusText: string;
  ok: boolean;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

function makeResponse(
  status: number,
  body: string,
  headers: Record<string, string> = {},
): FakeResponse {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    status,
    statusText: status === 200 ? 'OK' : status === 401 ? 'Unauthorized' : 'Error',
    ok: status >= 200 && status < 300,
    headers: { get: (name: string) => lower[name.toLowerCase()] ?? null },
    text: async () => body,
  };
}

const FIXTURES = {
  enumerate: (ctx: string) =>
    `<g:EnumerateResponse xmlns:g="http://schemas.xmlsoap.org/ws/2004/09/enumeration">` +
    `<g:EnumerationContext>${ctx}</g:EnumerationContext></g:EnumerateResponse>`,
  power: (state: number) =>
    `<g:PullResponse xmlns:g="urn:enum" xmlns:h="urn:cim">` +
    `<g:Items><h:CIM_AssociatedPowerManagementService>` +
    `<h:PowerState>${state}</h:PowerState>` +
    `</h:CIM_AssociatedPowerManagementService></g:Items><g:EndOfSequence/></g:PullResponse>`,
  rps: (rv: number) =>
    `<g:RequestPowerStateChange_OUTPUT xmlns:g="urn:cim"><g:ReturnValue>${rv}</g:ReturnValue>` +
    `</g:RequestPowerStateChange_OUTPUT>`,
  cpu:
    `<g:PullResponse xmlns:g="urn:enum" xmlns:h="urn:cim"><g:Items>` +
    `<h:CIM_Processor><h:ElementName>Managed System CPU</h:ElementName>` +
    `<h:MaxClockSpeed>3700</h:MaxClockSpeed><h:CoreCount>8</h:CoreCount></h:CIM_Processor>` +
    `</g:Items></g:PullResponse>`,
  mem:
    `<g:PullResponse xmlns:g="urn:enum" xmlns:h="urn:cim"><g:Items>` +
    `<h:CIM_PhysicalMemory><h:BankLabel>DIMM A</h:BankLabel><h:Capacity>17179869184</h:Capacity>` +
    `<h:Speed>3200</h:Speed><h:MemoryType>26</h:MemoryType><h:FormFactor>8</h:FormFactor>` +
    `</h:CIM_PhysicalMemory>` +
    `<h:CIM_PhysicalMemory><h:BankLabel>DIMM B</h:BankLabel><h:Capacity>17179869184</h:Capacity>` +
    `<h:Speed>3200</h:Speed><h:MemoryType>26</h:MemoryType><h:FormFactor>8</h:FormFactor>` +
    `</h:CIM_PhysicalMemory></g:Items></g:PullResponse>`,
  bios:
    `<g:PullResponse xmlns:g="urn:enum" xmlns:h="urn:cim"><g:Items>` +
    `<h:CIM_BIOSElement><h:Manufacturer>Dell Inc.</h:Manufacturer><h:Version>2.18.0</h:Version>` +
    `<h:ReleaseDate>2023-05-01</h:ReleaseDate></h:CIM_BIOSElement></g:Items></g:PullResponse>`,
  nic:
    `<g:PullResponse xmlns:g="urn:enum" xmlns:h="urn:amt"><g:Items>` +
    `<h:AMT_EthernetPortSettings><h:MACAddress>aa:bb:cc:dd:ee:ff</h:MACAddress>` +
    `<h:LinkIsUp>true</h:LinkIsUp></h:AMT_EthernetPortSettings></g:Items></g:PullResponse>`,
  general: `<g:AMT_GeneralSettings xmlns:g="urn:amt"><g:HostName>amt-box-01</g:HostName></g:AMT_GeneralSettings>`,
  setup: `<g:AMT_SetupAndConfigurationService xmlns:g="urn:amt"><g:AMTVersion>16.1.25</g:AMTVersion></g:AMT_SetupAndConfigurationService>`,
};

/**
 * Wire the mock to behave like AMT: a request without an Authorization header
 * is challenged with 401, and authenticated requests are answered by routing
 * on the SOAP action / ResourceURI in the body.
 */
function installAmtMock(opts: { powerState?: number; returnValue?: number } = {}) {
  const calls: Array<{ auth: string | null; body: string }> = [];
  httpMock.insecureFetch.mockImplementation(async (_url: string, init: Record<string, unknown>) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    const auth = headers.Authorization ?? null;
    const body = String(init.body ?? '');
    calls.push({ auth, body });

    if (!auth) return makeResponse(401, '', { 'WWW-Authenticate': CHALLENGE });

    if (body.includes('enumeration/Enumerate'))
      return makeResponse(200, FIXTURES.enumerate('CTX-1'));
    if (body.includes('RequestPowerStateChange'))
      return makeResponse(200, FIXTURES.rps(opts.returnValue ?? 0));

    if (body.includes('enumeration/Pull')) {
      if (body.includes('CIM_ServiceAvailableToElement'))
        return makeResponse(200, FIXTURES.power(opts.powerState ?? 2));
      if (body.includes('CIM_Processor')) return makeResponse(200, FIXTURES.cpu);
      if (body.includes('CIM_PhysicalMemory')) return makeResponse(200, FIXTURES.mem);
      if (body.includes('CIM_BIOSElement')) return makeResponse(200, FIXTURES.bios);
      if (body.includes('AMT_EthernetPortSettings')) return makeResponse(200, FIXTURES.nic);
    }

    if (body.includes('transfer/Get')) {
      if (body.includes('AMT_GeneralSettings')) return makeResponse(200, FIXTURES.general);
      if (body.includes('AMT_SetupAndConfigurationService'))
        return makeResponse(200, FIXTURES.setup);
    }

    return makeResponse(500, 'unexpected request');
  });
  return calls;
}

beforeEach(() => {
  httpMock.insecureFetch.mockReset();
});

describe('AMT WSMAN digest transport', () => {
  it('authenticates on a 401 challenge and retries with a Digest header', async () => {
    const calls = installAmtMock();
    const client = createAmtClient(CONN);

    await client.getPowerState();

    // Enumerate is challenged (no auth), then retried with auth; Pull reuses it.
    expect(calls[0].auth).toBeNull();
    expect(calls[1].auth).toMatch(/^Digest /);
    expect(calls[1].auth).toContain('realm="Digest:1A2B3C"');
    expect(calls[1].auth).toContain('nonce="abc123nonce"');
    expect(calls[1].auth).toContain('opaque="op-42"');
  });

  it('reuses the cached nonce with an incrementing nc and no second 401', async () => {
    const calls = installAmtMock();
    const client = createAmtClient(CONN);

    await client.getPowerState();

    const challenged = calls.filter((c) => c.auth === null);
    expect(challenged).toHaveLength(1); // only the very first request is unauthenticated
    expect(calls[1].auth).toContain('nc=00000001');
    expect(calls[2].auth).toContain('nc=00000002'); // Pull reuses the same nonce
  });

  it('targets the TLS wsman endpoint by default', async () => {
    installAmtMock();
    await createAmtClient(CONN).getPowerState();
    expect(httpMock.insecureFetch).toHaveBeenCalledWith(
      'https://amt.test:16993/wsman',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/soap+xml; charset=UTF-8' },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('uses http when TLS is disabled', async () => {
    installAmtMock();
    await createAmtClient({ ...CONN, useTls: false, port: 16992 }).getPowerState();
    expect(httpMock.insecureFetch.mock.calls[0][0]).toBe('http://amt.test:16992/wsman');
  });

  it('sends the SOAP+XML content type', async () => {
    installAmtMock();
    await createAmtClient(CONN).getPowerState();
    const init = httpMock.insecureFetch.mock.calls[0][1];
    expect(init.headers['Content-Type']).toBe('application/soap+xml; charset=UTF-8');
  });

  it('throws a redacted error on a non-401 failure', async () => {
    httpMock.insecureFetch.mockResolvedValue(makeResponse(500, 'boom'));
    await expect(createAmtClient(CONN).getPowerState()).rejects.toThrow(/WSMAN request failed/);
    await expect(createAmtClient(CONN).getPowerState()).rejects.not.toThrow(/S3cr3t/);
  });

  it('wraps network failures without leaking credentials', async () => {
    httpMock.insecureFetch.mockRejectedValue(new Error('connect ECONNREFUSED'));

    await expect(createAmtClient(CONN).getPowerState()).rejects.toThrow(
      /AMT amt\.test: WSMAN connection failed \(connect ECONNREFUSED\)/,
    );
    await expect(createAmtClient(CONN).getPowerState()).rejects.not.toThrow(/S3cr3t/);
  });
});

describe('AMT WSMAN power state', () => {
  it.each([
    [2, 'on'],
    [4, 'sleep'],
    [7, 'hibernate'],
    [6, 'off'],
    [8, 'off'],
    [99, 'unknown'],
  ])('maps CIM power state %i to %s', async (cim, expected) => {
    installAmtMock({ powerState: cim });
    expect(await createAmtClient(CONN).getPowerState()).toBe(expected);
  });
});

describe('AMT WSMAN power actions', () => {
  it('returns the CIM return value from RequestPowerStateChange', async () => {
    installAmtMock({ returnValue: 0 });
    expect(await createAmtClient(CONN).requestPowerAction('off')).toEqual({ returnValue: 0 });
  });

  it('encodes the correct CIM power value per action', async () => {
    const calls = installAmtMock();
    const client = createAmtClient(CONN);
    await client.requestPowerAction('reset'); // CIM value 10
    const rpsCall = calls.find((c) => c.body.includes('RequestPowerStateChange') && c.auth);
    expect(rpsCall?.body).toContain('<h:PowerState>10</h:PowerState>');
  });

  it('rejects an unknown action', async () => {
    installAmtMock();
    // @ts-expect-error exercising runtime guard for an invalid action
    await expect(createAmtClient(CONN).requestPowerAction('explode')).rejects.toThrow(
      /Unknown AMT power action/,
    );
  });
});

describe('AMT WSMAN hardware inventory', () => {
  it('parses CPU, memory, BIOS, and NIC data', async () => {
    installAmtMock();
    const hw = await createAmtClient(CONN).getHardwareInventory();

    expect(hw.cpu).toEqual({ model: 'Managed System CPU', cores: 8, maxSpeedMhz: 3700 });
    expect(hw.memory).toHaveLength(2);
    expect(hw.memory[0]).toEqual({
      bankLabel: 'DIMM A',
      capacityBytes: 17179869184,
      speedMhz: 3200,
      memoryType: '26',
      formFactor: '8',
    });
    expect(hw.bios).toEqual({ vendor: 'Dell Inc.', version: '2.18.0', releaseDate: '2023-05-01' });
    expect(hw.nics).toEqual([{ mac: 'aa:bb:cc:dd:ee:ff', linkUp: true }]);
  });
});

describe('AMT WSMAN general settings', () => {
  it('returns the AMT hostname and version', async () => {
    installAmtMock();
    expect(await createAmtClient(CONN).getGeneralSettings()).toEqual({
      hostname: 'amt-box-01',
      amtVersion: '16.1.25',
    });
  });
});
