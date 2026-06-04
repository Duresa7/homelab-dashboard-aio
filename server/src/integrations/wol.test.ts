import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dgramMock = vi.hoisted(() => {
  const socket = {
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
import { loadServerApp } from '../test/serverApp.js';

function makeApp() {
  const app = express();
  registerWol(app);
  return request(app);
}

describe('Wake-on-LAN integration', () => {
  beforeEach(() => {
    dgramMock.createSocket.mockClear();
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

  it('reports disabled health status only for explicit false/0/off values', async () => {
    const ctx = await loadServerApp({ WOL_ENABLED: 'off' });
    try {
      const res = await request(ctx.app).get('/api/health').expect(200);
      expect(res.body.wol).toEqual({ enabled: false, configured: false });
    } finally {
      await ctx.cleanup();
    }
  });

  it('keeps Wake-on-LAN enabled for other WOL_ENABLED values', async () => {
    const ctx = await loadServerApp({ WOL_ENABLED: 'disabled' });
    try {
      const res = await request(ctx.app).get('/api/health').expect(200);
      expect(res.body.wol).toEqual({ enabled: true, configured: true });
    } finally {
      await ctx.cleanup();
    }
  });
});
