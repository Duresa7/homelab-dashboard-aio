import type { Request, Response } from 'express';
import type { SyslogEvent } from './types.js';

const HEARTBEAT_MS = 25_000;
const REPLAY_LIMIT = 1000;

interface Client {
  res: Response;
  lastSent: number;
  ka: NodeJS.Timeout | null;
  removed: boolean;
}

export interface SseBusOpts {
  replayAfter: (lastId: number, limit?: number) => Promise<SyslogEvent[]>;
}

export function createSseBus({ replayAfter }: SseBusOpts) {
  const clients = new Set<Client>();

  function writeEvent(client: Client, evt: SyslogEvent, eventName?: string): boolean | undefined {
    if (evt.id != null && evt.id <= client.lastSent) return;
    const header = eventName ? `event: ${eventName}\n` : '';
    const payload = `${header}id: ${evt.id}\ndata: ${JSON.stringify(evt)}\n\n`;
    try {
      client.res.write(payload);
      if (evt.id != null) client.lastSent = evt.id;
      return true;
    } catch {
      removeClient(client);
      return false;
    }
  }

  function removeClient(client: Client) {
    if (client.removed) return;
    client.removed = true;
    if (client.ka) clearInterval(client.ka);
    clients.delete(client);
  }

  function broadcast(evt: SyslogEvent) {
    for (const client of clients) {
      writeEvent(client, evt);
    }
  }

  async function handle(req: Request, res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    res.write('retry: 3000\n\n');

    const lastEventIdHeader = req.headers['last-event-id'];
    const lastEventIdQuery = req.query?.lastEventId;
    const sinceRaw = Number(lastEventIdHeader ?? lastEventIdQuery ?? 0);
    const since = Number.isFinite(sinceRaw) && sinceRaw > 0 ? sinceRaw : 0;

    const client: Client = { res, lastSent: since, ka: null, removed: false };

    clients.add(client);

    if (since > 0) {
      let missed: SyslogEvent[];
      try {
        missed = await replayAfter(since, REPLAY_LIMIT);
      } catch {
        missed = [];
      }
      for (const evt of missed) {
        if (!writeEvent(client, evt)) return;
      }

      if (missed.length >= REPLAY_LIMIT) {
        const truncMarker = {
          id: client.lastSent,
          replayTruncated: true,
          replayFromId: since,
          replayThroughId: client.lastSent,
        };

        try {
          client.res.write(
            `event: replay-truncated\nid: ${client.lastSent}\ndata: ${JSON.stringify(truncMarker)}\n\n`,
          );
        } catch {
          removeClient(client);
          return;
        }
      }
    }

    client.ka = setInterval(() => {
      try {
        client.res.write(':ka\n\n');
      } catch {
        removeClient(client);
      }
    }, HEARTBEAT_MS);

    const cleanup = () => removeClient(client);
    req.on('close', cleanup);
    req.on('error', cleanup);
    res.on('error', cleanup);
  }

  function clientCount() {
    return clients.size;
  }

  function shutdown() {
    for (const client of clients) {
      if (client.ka) clearInterval(client.ka);
      try {
        client.res.end();
      } catch {
        void 0;
      }
    }
    clients.clear();
  }

  return { broadcast, handle, clientCount, shutdown };
}
