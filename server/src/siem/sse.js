const HEARTBEAT_MS = 25_000;
const REPLAY_LIMIT = 1000;

export function createSseBus({ replayAfter }) {
  // Each client is tracked by an object that carries the response handle,
  // its keepalive interval, and the highest event id we've already sent it.
  // The lastSent counter lets broadcast() skip events the client received
  // during initial replay (replay and live broadcast can overlap if any
  // future code introduces an `await` inside handle()) — and lets us assert
  // strictly-monotonic delivery so a client never sees an out-of-order id.
  const clients = new Set();

  function writeEvent(client, evt, eventName) {
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

  function removeClient(client) {
    if (client.removed) return;
    client.removed = true;
    if (client.ka) clearInterval(client.ka);
    clients.delete(client);
  }

  function broadcast(evt) {
    for (const client of clients) {
      writeEvent(client, evt);
    }
  }

  function handle(req, res) {
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

    const client = { res, lastSent: since, ka: null, removed: false };

    // Subscribe BEFORE replay. broadcast() filters by lastSent so we
    // can't deliver the same event twice, and any live insert during
    // replay is now delivered rather than lost in the race window.
    clients.add(client);

    if (since > 0) {
      let missed;
      try {
        missed = replayAfter(since, REPLAY_LIMIT);
      } catch {
        missed = [];
      }
      for (const evt of missed) {
        if (!writeEvent(client, evt)) return;
      }
      // Signal to the client that the replay window was capped so they
      // can fetch the gap via /api/siem/logs?after_id=<since>&until=<lastSent>
      // before drawing conclusions from the live tail.
      if (missed.length >= REPLAY_LIMIT) {
        const truncMarker = {
          // Reuse the lastSent id so the client knows the high-water mark;
          // the marker itself is not a real event id.
          id: client.lastSent,
          replayTruncated: true,
          replayFromId: since,
          replayThroughId: client.lastSent,
        };
        // Use a named SSE event so it doesn't get fed into the events list.
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
        /* ignore */
      }
    }
    clients.clear();
  }

  return { broadcast, handle, clientCount, shutdown };
}
