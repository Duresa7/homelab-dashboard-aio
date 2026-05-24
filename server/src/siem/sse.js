const HEARTBEAT_MS = 25_000;

export function createSseBus({ replayAfter }) {
  const clients = new Set();

  function broadcast(evt) {
    const payload = `id: ${evt.id}\ndata: ${JSON.stringify(evt)}\n\n`;
    for (const res of clients) {
      try {
        res.write(payload);
      } catch {
        clients.delete(res);
      }
    }
  }

  function handle(req, res) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    res.write('retry: 3000\n\n');

    // Replay missed events via Last-Event-ID; cap so a long-gone client doesn't flood.
    const lastEventIdHeader = req.headers['last-event-id'];
    const lastEventIdQuery = req.query?.lastEventId;
    const since = Number(lastEventIdHeader ?? lastEventIdQuery ?? 0);
    if (Number.isFinite(since) && since > 0) {
      const missed = replayAfter(since, 1000);
      for (const evt of missed) {
        res.write(`id: ${evt.id}\ndata: ${JSON.stringify(evt)}\n\n`);
      }
    }

    clients.add(res);

    const ka = setInterval(() => {
      try { res.write(':ka\n\n'); } catch { /* dropped */ }
    }, HEARTBEAT_MS);

    req.on('close', () => {
      clearInterval(ka);
      clients.delete(res);
    });
  }

  function clientCount() {
    return clients.size;
  }

  function shutdown() {
    for (const res of clients) {
      try { res.end(); } catch { /* ignore */ }
    }
    clients.clear();
  }

  return { broadcast, handle, clientCount, shutdown };
}
