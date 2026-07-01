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

import { registerWol } from './wol.js';
import { bootstrapAdmin } from '../test/auth.js';
import { loadServerApp } from '../test/serverApp.js';

function makeApp() {
  const app = express();
  registerWol(app);
  return request(app);
}

function sentPackets() {
  return dgramMock.socket.send.mock.calls.map(([packet, port, target]) => ({
    packet,
    port,
    target,
  }));
}

function expectMagicPacketFor(packet: Buffer, mac: number[]) {
  expect(packet).toHaveLength(102);
  expect([...packet.subarray(0, 6)]).toEqual([0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
  for (let i = 0; i < 16; i += 1) {
    const offset = 6 + i * 6;
    expect([...packet.subarray(offset, offset + 6)]).toEqual(mac);
  }
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

  it('sends repeated magic packets to the default broadcast target', async () => {
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
    const packets = sentPackets();
    expect(packets).toHaveLength(3);
    for (const packet of packets) {
      expect(packet.port).toBe(9);
      expect(packet.target).toBe('255.255.255.255');
      expectMagicPacketFor(packet.packet, [0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]);
    }
    expect(dgramMock.socket.close).toHaveBeenCalledTimes(1);
  });

  it.each(['AA:BB:CC:DD:EE:FF', 'AA-BB-CC-DD-EE-FF', 'aabbccddeeff'])(
    'normalizes supported MAC spelling %s',
    async (mac) => {
      const api = makeApp();

      const res = await api.post('/api/wol/wake').send({ mac }).expect(200);

      expect(res.body.mac).toBe('AA:BB:CC:DD:EE:FF');
      expect(sentPackets()).toHaveLength(3);
    },
  );

  it.each([
    { mac: 'not-a-mac', message: /invalid MAC/i },
    { mac: 'AA:BB:CC:DD:EE', message: /invalid MAC/i },
    { mac: 'AA:BB:CC:DD:EE:ZZ', message: /invalid MAC/i },
    { mac: 42, message: /mac must be a string/i },
  ])('rejects invalid MAC route input %# with 400', async ({ mac, message }) => {
    const api = makeApp();

    const res = await api.post('/api/wol/wake').send({ mac }).expect(400);

    expect(res.body.error).toMatch(message);
    expect(dgramMock.createSocket).not.toHaveBeenCalled();
  });

  it('wakes a unicast host IP target on an allowed WOL port', async () => {
    const api = makeApp();

    const res = await api
      .post('/api/wol/wake')
      .send({ mac: 'aa-bb-cc-dd-ee-ff', broadcast: '198.51.100.241', port: '7' })
      .expect(200);

    expect(res.body).toEqual({
      ok: true,
      mac: 'AA:BB:CC:DD:EE:FF',
      broadcast: '198.51.100.241',
      port: 7,
    });
    for (const packet of sentPackets()) {
      expect(packet.port).toBe(7);
      expect(packet.target).toBe('198.51.100.241');
      expectMagicPacketFor(packet.packet, [0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]);
    }
  });

  it.each([
    {
      body: { mac: 'AA:BB:CC:DD:EE:FF', broadcast: 'not-an-ip' },
      message: /broadcast must be an IPv4 address/i,
    },
    {
      body: { mac: 'AA:BB:CC:DD:EE:FF', broadcast: '::1' },
      message: /broadcast must be an IPv4 address/i,
    },
    {
      body: { mac: 'AA:BB:CC:DD:EE:FF', port: 9.5 },
      message: /port must be an integer from 1 to 65535/i,
    },
    {
      body: { mac: 'AA:BB:CC:DD:EE:FF', port: 53 },
      message: /port must be one of/i,
    },
  ])('rejects invalid WOL target input %# before sending UDP', async ({ body, message }) => {
    const api = makeApp();

    const res = await api.post('/api/wol/wake').send(body).expect(400);

    expect(res.body.error).toMatch(message);
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
    expect(dgramMock.socket.send).toHaveBeenCalledTimes(1);
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
