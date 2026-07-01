import { beforeEach, describe, expect, it } from 'vitest';

import {
  collectPerNode,
  configureSetupNodeTargets,
  resolveNodeTargets,
  type NodeTarget,
} from './node-targets.js';

const DEFAULTS = { mode: 'ssh', host: 'fallback.host', user: 'root', port: 22, keyPath: '/key' };

describe('resolveNodeTargets', () => {
  beforeEach(() => {
    configureSetupNodeTargets({});
  });

  it('builds one target per map entry, inheriting defaults and parsing jump/overrides', () => {
    const targets = resolveNodeTargets({
      targetsJson: JSON.stringify({
        'node-a': { host: '192.168.255.10' },
        'node-c': {
          host: '192.168.255.12',
          jumpHost: '192.168.255.10',
          user: 'admin',
          port: '2222',
        },
      }),
      primaryNode: 'node-a',
      defaults: DEFAULTS,
    });

    expect(targets).toHaveLength(2);
    expect(targets[0]).toEqual({
      node: 'node-a',
      mode: 'ssh',
      host: '192.168.255.10',
      user: 'root',
      port: 22,
      keyPath: '/key',
      jumpHost: undefined,
      jumpUser: undefined,
      jumpPort: undefined,
    });
    expect(targets[1]).toMatchObject({
      node: 'node-c',
      host: '192.168.255.12',
      user: 'admin',
      port: 2222,
      jumpHost: '192.168.255.10',
    });
  });

  it('falls back to a single primary-node target when no map is configured', () => {
    expect(
      resolveNodeTargets({ primaryNode: 'pve', defaults: { ...DEFAULTS, host: 'h', keyPath: '' } }),
    ).toEqual([{ node: 'pve', mode: 'ssh', host: 'h', user: 'root', port: 22, keyPath: '' }]);
  });

  it('uses setup-discovered targets when environment targets are absent', () => {
    configureSetupNodeTargets({
      primaryNode: 'pve1',
      targetsJson: JSON.stringify({
        pve1: { host: '192.168.255.11' },
        pve2: { host: '192.168.255.12' },
      }),
    });

    expect(resolveNodeTargets({ defaults: { ...DEFAULTS, host: '' } }).map((t) => t.node)).toEqual([
      'pve1',
      'pve2',
    ]);
  });

  it('falls back when the map is malformed JSON', () => {
    expect(
      resolveNodeTargets({ targetsJson: '{not json', primaryNode: 'pve', defaults: DEFAULTS }),
    ).toEqual([
      { node: 'pve', mode: 'ssh', host: 'fallback.host', user: 'root', port: 22, keyPath: '/key' },
    ]);
  });

  it('returns no targets for ssh mode with no host anywhere', () => {
    expect(resolveNodeTargets({ defaults: { ...DEFAULTS, host: '' } })).toEqual([]);
  });

  it('skips a map entry that resolves to no host, but keeps others', () => {
    const targets = resolveNodeTargets({
      targetsJson: JSON.stringify({ ghost: { user: 'a' }, real: { host: '192.168.255.5' } }),
      defaults: { ...DEFAULTS, host: '' },
    });
    expect(targets.map((t) => t.node)).toEqual(['real']);
  });

  it('returns a single local target (empty host) for local mode', () => {
    expect(
      resolveNodeTargets({
        defaults: { mode: 'local', host: '', user: '', port: 22, keyPath: '' },
      }),
    ).toEqual([{ node: 'node', mode: 'local', host: '', user: '', port: 22, keyPath: '' }]);
  });
});

describe('collectPerNode', () => {
  const targets: NodeTarget[] = [
    { node: 'a', mode: 'ssh', host: '1', user: 'r', port: 22, keyPath: '' },
    { node: 'b', mode: 'ssh', host: '2', user: 'r', port: 22, keyPath: '' },
    { node: 'c', mode: 'ssh', host: '3', user: 'r', port: 22, keyPath: '' },
  ];

  it('keeps successes (including empty results) and records rejections as unavailable', async () => {
    const { results, unavailable } = await collectPerNode(targets, async (t) => {
      if (t.node === 'b') throw new Error('connect ETIMEDOUT');
      return t.node === 'c' ? [] : [`gpu@${t.node}`];
    });

    expect(results).toEqual([
      { node: 'a', data: ['gpu@a'] },
      { node: 'c', data: [] },
    ]);
    expect(unavailable).toEqual([{ node: 'b', reason: expect.stringContaining('ETIMEDOUT') }]);
  });

  it('never rejects the batch even if every target fails', async () => {
    const { results, unavailable } = await collectPerNode(targets, async () => {
      throw new Error('down');
    });
    expect(results).toEqual([]);
    expect(unavailable.map((u) => u.node)).toEqual(['a', 'b', 'c']);
  });
});
