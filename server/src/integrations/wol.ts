import express from 'express';
import dgram from 'node:dgram';
import net from 'node:net';
import type { Express, Request, Response } from 'express';

import { errorMessage } from '../lib/errors.js';
import { makeSameOriginGuard } from '../state/index.js';

function isWolEnabled(value: string | undefined | null): boolean {
  if (value === undefined || value === null || value === '') return true;
  return !['false', '0', 'off'].includes(value.trim().toLowerCase());
}

const WOL_ENABLED = isWolEnabled(process.env.WOL_ENABLED);
const DEFAULT_BROADCAST = '255.255.255.255';
const DEFAULT_PORT = 9;
const MAGIC_PACKET_REPETITIONS = 3;
const ALLOWED_WOL_PORTS = new Set(
  String(process.env.WOL_ALLOWED_PORTS || '7,9')
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value >= 1 && value <= 65535),
);

export const wolStatus = {
  enabled: WOL_ENABLED,
  configured: WOL_ENABLED,
};

function normalizeMac(mac: unknown): string {
  if (typeof mac !== 'string') throw new Error('mac must be a string');
  const value = mac.trim();
  const colonOrHyphen =
    /^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/.test(value) ||
    /^([0-9a-fA-F]{2}-){5}[0-9a-fA-F]{2}$/.test(value);
  const bare = /^[0-9a-fA-F]{12}$/.test(value);
  if (!colonOrHyphen && !bare) {
    throw new Error(
      'invalid MAC address; expected AA:BB:CC:DD:EE:FF, AA-BB-CC-DD-EE-FF, or 12 hex digits',
    );
  }
  return value.replace(/[:-]/g, '').toUpperCase().match(/.{2}/g)!.join(':');
}

function macBytes(mac: string): number[] {
  return normalizeMac(mac)
    .split(':')
    .map((part) => Number.parseInt(part, 16));
}

function buildMagicPacket(mac: string): Buffer {
  const bytes = macBytes(mac);
  return Buffer.from([
    ...Array.from({ length: 6 }, () => 0xff),
    ...Array.from({ length: 16 }).flatMap(() => bytes),
  ]);
}

function normalizeBroadcast(broadcast: unknown): string {
  if (broadcast === undefined || broadcast === null || broadcast === '') return DEFAULT_BROADCAST;
  if (typeof broadcast !== 'string') throw new Error('broadcast must be a string');
  const value = broadcast.trim();
  // Accept any IPv4 target: a subnet broadcast (e.g. 198.51.100.255) or a unicast
  // host IP. Unicast is required to wake a host across a VLAN whose gateway drops
  // directed broadcasts — the magic packet then routes to the host like normal
  // traffic. net.isIP validates the dotted-quad form and 0-255 octet range.
  if (net.isIP(value) !== 4) throw new Error('broadcast must be an IPv4 address');
  return value;
}

function normalizeWolPort(port: unknown): number {
  if (port === undefined || port === null || port === '') return DEFAULT_PORT;
  const value = Number(port);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error('port must be an integer from 1 to 65535');
  }
  if (!ALLOWED_WOL_PORTS.has(value)) {
    throw new Error(`port must be one of: ${[...ALLOWED_WOL_PORTS].sort().join(', ')}`);
  }
  return value;
}

function sendMagicPacket(packet: Buffer, broadcast: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      socket.close();
      if (err) reject(err);
      else resolve();
    };
    // bind() must come first: setBroadcast() acts on the socket's underlying
    // handle, which Node only creates on bind — calling it on a fresh socket
    // throws EBADF. A bound ephemeral socket is also what lets the OS pick the
    // egress interface for the (often directed) broadcast.
    socket.once('error', finish);
    const sendNext = (remaining: number) => {
      if (settled) return;
      if (remaining <= 0) {
        finish();
        return;
      }
      socket.send(packet, port, broadcast, (err) => {
        if (settled) return;
        if (err) finish(err);
        else sendNext(remaining - 1);
      });
    };
    socket.bind(() => {
      try {
        socket.setBroadcast(true);
        sendNext(MAGIC_PACKET_REPETITIONS);
      } catch (err) {
        finish(err as Error);
      }
    });
  });
}

export function probeWol() {
  return Promise.resolve(wolStatus.configured);
}

export function registerWol(app: Express) {
  const parseJsonBody = express.json({ limit: '32kb' });
  const sameOrigin = makeSameOriginGuard();

  app.post('/api/wol/wake', sameOrigin, parseJsonBody, async (req: Request, res: Response) => {
    if (!WOL_ENABLED) return res.status(503).json({ error: 'Wake-on-LAN is disabled' });
    try {
      const body = req.body as { mac?: unknown; broadcast?: unknown; port?: unknown };
      const mac = normalizeMac(body?.mac);
      const broadcast = normalizeBroadcast(body?.broadcast);
      const port = normalizeWolPort(body?.port);
      const packet = buildMagicPacket(mac);
      await sendMagicPacket(packet, broadcast, port);
      res.json({ ok: true, mac, broadcast, port });
    } catch (err) {
      const message = errorMessage(err);
      const status = /^(invalid MAC|mac must|broadcast must|port must)/i.test(message) ? 400 : 500;
      res.status(status).json({ error: message });
    }
  });
}
