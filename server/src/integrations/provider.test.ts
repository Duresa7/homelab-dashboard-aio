import express from 'express';
import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';

import { registerProvider, type Provider } from './provider.js';

interface Payload {
  value: number;
}

function fakeProvider(overrides: Partial<Provider<Payload>> = {}): Provider<Payload> {
  return {
    id: 'fake',
    capabilityId: 'fake-capability',
    logName: 'Fake',
    status: { enabled: true, configured: true },
    configure() {},
    async fetch() {
      return { value: 1 };
    },
    notConfiguredMessage: 'Fake not configured',
    ...overrides,
  };
}

describe('registerProvider', () => {
  it('returns disabled payloads before checking configuration', async () => {
    const app = express();
    registerProvider(app, fakeProvider({ status: { enabled: false, configured: false } }));

    await request(app).get('/api/fake').expect(200, { disabled: true });
  });

  it('returns 503 when enabled but not configured', async () => {
    const app = express();
    registerProvider(app, fakeProvider({ status: { enabled: true, configured: false } }));

    await request(app).get('/api/fake').expect(503, { error: 'Fake not configured' });
  });

  it('returns fetched payloads when configured', async () => {
    const app = express();
    registerProvider(app, fakeProvider());

    await request(app).get('/api/fake').expect(200, { value: 1 });
  });

  it('maps upstream failures to 502', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {
      void 0;
    });
    const app = express();
    registerProvider(
      app,
      fakeProvider({
        async fetch() {
          throw new Error('upstream failed');
        },
      }),
    );

    try {
      const res = await request(app).get('/api/fake').expect(502);
      expect(res.body.error).toBe('upstream failed');
    } finally {
      errorSpy.mockRestore();
    }
  });
});
