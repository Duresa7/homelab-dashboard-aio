import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dgramMock = vi.hoisted(() => {
  const socket = {
    bind: vi.fn((cb: () => void) => cb()),
    once: vi.fn(),
    setBroadcast: vi.fn(),
    send: vi.fn((_packet: Buffer, _port: number, _broadcast: string, cb: (err?: Error) => void) =>
      cb(),
    ),
    close: vi.fn(),
  };
  return {
    socket,
    createSocket: vi.fn(() => socket),
  };
});

vi.mock('node:dgram', () => ({
  default: {
    createSocket: dgramMock.createSocket,
  },
}));

import {
  buildMagicPacket,
  normalizeBroadcast,
  normalizeMac,
  normalizeWolPort,
  registerWol,
} from './wol.js';
import { bootstrapAdmin } from '../test/auth.js';
import { loadServerApp } from '../test/serverApp.js';

function makeApp() {
  const app = express();
  registerWol(app);
  return request(app);
}

describe('Wake-on-LAN integration', () => {
  beforeEach(() => {
    dgramMock.createSocket.mockClear();
    dgramMock.socket.bind.mockClear();
    dgramMock.socket.once.mockClear();
    dgramMock.socket.setBroadcast.mockClear();
    dgramMock.socket.send.mockClear();
    dgramMock.socket.close.mockClear();
  });

  it('normalizes supported MAC formats', () => {
    expect(normalizeMac('aa:bb:cc:dd:ee:ff')).toBe('AA:BB:CC:DD:EE:FF');
    expect(normalizeMac('AA-BB-CC-DD-EE-FF')).toBe('AA:BB:CC:DD:EE:FF');
    expect(normalizeMac('aabbccddeeff')).toBe('AA:BB:CC:DD:EE:FF');
  });

  it('builds a valid 102-byte magic packet', () => {
    const packet = buildMagicPacket('AA:BB:CC:DD:EE:FF');

    expect(packet).toHaveLength(102);
    expect([...packet.subarray(0, 6)]).toEqual([255, 255, 255, 255, 255, 255]);
    expect([...packet.subarray(6, 12)]).toEqual([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]);
    expect([...packet.subarray(96, 102)]).toEqual([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]);
  });

  it('throws on invalid MAC input', () => {
    expect(() => buildMagicPacket('AA:BB:CC:DD:EE')).toThrow(/invalid MAC/i);
    expect(() => buildMagicPacket('AA:BB:CC:DD:EE:ZZ')).toThrow(/invalid MAC/i);
    expect(() => buildMagicPacket('AA:BB-CC:DD:EE:FF')).toThrow(/invalid MAC/i);
  });

  it('allows only IPv4 broadcast-style WOL targets and ports', () => {
    expect(normalizeBroadcast(undefined)).toBe('255.255.255.255');
    expect(normalizeBroadcast('198.51.100.255')).toBe('198.51.100.255');
    expect(() => normalizeBroadcast('198.51.100.10')).toThrow(/subnet broadcast/i);
    expect(() => normalizeBroadcast('wake.example.test')).toThrow(/IPv4/i);
    expect(normalizeWolPort(undefined)).toBe(9);
    expect(normalizeWolPort(7)).toBe(7);
    expect(() => normalizeWolPort(53)).toThrow(/one of/i);
  });

  it('sends a broadcast packet and returns the resolved target', async () => {
    const api = makeApp();

    const res = await api.post('/api/wol/wake').send({ mac: 'aa-bb-cc-dd-ee-ff' }).expect(200);

    expect(res.body).toEqual({
      ok: true,
      mac: 'AA:BB:CC:DD:EE:FF',
      broadcast: '255.255.255.255',
      port: 9,
    });
    expect(dgramMock.createSocket).toHaveBeenCalledWith('udp4');
    // Regression: setBroadcast() throws EBADF on an unbound socket, so bind()
    // must run first.
    expect(dgramMock.socket.bind).toHaveBeenCalled();
    expect(dgramMock.socket.bind.mock.invocationCallOrder[0]).toBeLessThan(
      dgramMock.socket.setBroadcast.mock.invocationCallOrder[0],
    );
    expect(dgramMock.socket.setBroadcast).toHaveBeenCalledWith(true);
    expect(dgramMock.socket.send).toHaveBeenCalledWith(
      expect.any(Buffer),
      9,
      '255.255.255.255',
      expect.any(Function),
    );
    expect(dgramMock.socket.close).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid MAC route input with 400', async () => {
    const api = makeApp();

    const res = await api.post('/api/wol/wake').send({ mac: 'not-a-mac' }).expect(400);

    expect(res.body.error).toMatch(/invalid MAC/i);
    expect(dgramMock.createSocket).not.toHaveBeenCalled();
  });

  it('rejects arbitrary WOL route targets before sending UDP', async () => {
    const api = makeApp();

    await api
      .post('/api/wol/wake')
      .send({ mac: 'AA:BB:CC:DD:EE:FF', broadcast: '198.51.100.10', port: 53 })
      .expect(400);

    expect(dgramMock.createSocket).not.toHaveBeenCalled();
  });

  it('rejects cross-origin wake requests', async () => {
    const api = makeApp();

    await api
      .post('/api/wol/wake')
      .set('Host', 'dashboard.test')
      .set('Origin', 'http://evil.test')
      .send({ mac: 'AA:BB:CC:DD:EE:FF' })
      .expect(403, { error: 'cross-origin write rejected' });

    expect(dgramMock.createSocket).not.toHaveBeenCalled();
  });

  it('returns 500 and closes the socket when the UDP send fails', async () => {
    const api = makeApp();
    dgramMock.socket.send.mockImplementationOnce(
      (_packet: Buffer, _port: number, _broadcast: string, cb: (err?: Error) => void) =>
        cb(new Error('network unreachable')),
    );

    const res = await api.post('/api/wol/wake').send({ mac: 'AA:BB:CC:DD:EE:FF' }).expect(500);

    expect(res.body.error).toMatch(/network unreachable/i);
    expect(dgramMock.socket.close).toHaveBeenCalledTimes(1);
  });

  it('returns 500 and closes the socket when the socket throws synchronously', async () => {
    const api = makeApp();
    dgramMock.socket.setBroadcast.mockImplementationOnce(() => {
      throw new Error('EACCES: broadcast not permitted');
    });

    const res = await api.post('/api/wol/wake').send({ mac: 'AA:BB:CC:DD:EE:FF' }).expect(500);

    expect(res.body.error).toMatch(/EACCES/i);
    expect(dgramMock.socket.send).not.toHaveBeenCalled();
    expect(dgramMock.socket.close).toHaveBeenCalledTimes(1);
  });

  it('returns 503 from the wake route when Wake-on-LAN is disabled', async () => {
    const ctx = await loadServerApp({ WOL_ENABLED: 'off' });
    try {
      const api = await bootstrapAdmin(ctx.app);
      const res = await api.post('/api/wol/wake').send({ mac: 'AA:BB:CC:DD:EE:FF' }).expect(503);
      expect(res.body).toEqual({ error: 'Wake-on-LAN is disabled' });
      expect(dgramMock.createSocket).not.toHaveBeenCalled();
    } finally {
      await ctx.cleanup();
    }
  });

  it('honors a custom WOL_ALLOWED_PORTS allowlist', async () => {
    const ctx = await loadServerApp({ WOL_ENABLED: 'true', WOL_ALLOWED_PORTS: '7,9,4000' });
    try {
      const api = await bootstrapAdmin(ctx.app);
      const ok = await api
        .post('/api/wol/wake')
        .send({ mac: 'AA:BB:CC:DD:EE:FF', port: 4000 })
        .expect(200);
      expect(ok.body).toMatchObject({ ok: true, port: 4000 });

      const rejected = await api
        .post('/api/wol/wake')
        .send({ mac: 'AA:BB:CC:DD:EE:FF', port: 8080 })
        .expect(400);
      expect(rejected.body.error).toMatch(/port must be one of:.*4000/);
    } finally {
      await ctx.cleanup();
    }
  });

  it('reports disabled health status only for explicit false/0/off values', async () => {
    const ctx = await loadServerApp({ WOL_ENABLED: 'off' });
    try {
      const api = await bootstrapAdmin(ctx.app);
      const res = await api.get('/api/health').expect(200);
      expect(res.body.wol).toEqual({ enabled: false, configured: false });
    } finally {
      await ctx.cleanup();
    }
  });

  it('keeps Wake-on-LAN enabled for other WOL_ENABLED values', async () => {
    const ctx = await loadServerApp({ WOL_ENABLED: 'disabled' });
    try {
      const api = await bootstrapAdmin(ctx.app);
      const res = await api.get('/api/health').expect(200);
      expect(res.body.wol).toEqual({ enabled: true, configured: true });
    } finally {
      await ctx.cleanup();
    }
  });
});

describe('Wake-on-LAN validation helpers', () => {
  it('rejects non-string and malformed MAC addresses', () => {
    expect(() => normalizeMac(42)).toThrow(/mac must be a string/i);
    expect(() => normalizeMac('')).toThrow(/invalid MAC/i);
    expect(() => normalizeMac('AA:BB:CC:DD:EE:FF:00')).toThrow(/invalid MAC/i);
    expect(() => normalizeMac('aabbccddee')).toThrow(/invalid MAC/i);
    expect(normalizeMac('  aabbccddeeff  ')).toBe('AA:BB:CC:DD:EE:FF');
  });

  it('repeats the MAC sixteen times after the 0xff header', () => {
    const packet = buildMagicPacket('01:23:45:67:89:AB');
    const mac = [0x01, 0x23, 0x45, 0x67, 0x89, 0xab];
    expect([...packet.subarray(0, 6)]).toEqual([0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
    for (let i = 0; i < 16; i += 1) {
      const offset = 6 + i * 6;
      expect([...packet.subarray(offset, offset + 6)]).toEqual(mac);
    }
  });

  it('defaults, normalizes, and rejects broadcast addresses', () => {
    expect(normalizeBroadcast(undefined)).toBe('255.255.255.255');
    expect(normalizeBroadcast(null)).toBe('255.255.255.255');
    expect(normalizeBroadcast('')).toBe('255.255.255.255');
    expect(normalizeBroadcast('  198.51.100.255  ')).toBe('198.51.100.255');
    expect(() => normalizeBroadcast(123)).toThrow(/broadcast must be a string/i);
    expect(() => normalizeBroadcast('198.51.100.0')).toThrow(/subnet broadcast/i);
    expect(() => normalizeBroadcast('::1')).toThrow(/IPv4/i);
    expect(() => normalizeBroadcast('not-an-ip')).toThrow(/IPv4/i);
  });

  it('defaults, validates, and rejects ports', () => {
    expect(normalizeWolPort(undefined)).toBe(9);
    expect(normalizeWolPort(null)).toBe(9);
    expect(normalizeWolPort('')).toBe(9);
    expect(normalizeWolPort('7')).toBe(7);
    expect(() => normalizeWolPort(9.5)).toThrow(/integer from 1 to 65535/i);
    expect(() => normalizeWolPort(0)).toThrow(/integer from 1 to 65535/i);
    expect(() => normalizeWolPort(70000)).toThrow(/integer from 1 to 65535/i);
    expect(() => normalizeWolPort(8080)).toThrow(/one of/i);
  });
});
