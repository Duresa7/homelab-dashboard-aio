import { describe, it, expect } from 'vitest';

import { isNewer } from './index.js';

describe('isNewer', () => {
  it('detects newer major/minor/patch', () => {
    expect(isNewer('1.0.0', '0.9.9')).toBe(true);
    expect(isNewer('0.2.0', '0.1.0')).toBe(true);
    expect(isNewer('0.1.1', '0.1.0')).toBe(true);
  });

  it('returns false for equal or older versions', () => {
    expect(isNewer('0.1.0', '0.1.0')).toBe(false);
    expect(isNewer('0.1.0', '0.2.0')).toBe(false);
    expect(isNewer('0.9.9', '1.0.0')).toBe(false);
  });

  it('ignores a leading v on either side', () => {
    expect(isNewer('v0.2.0', '0.1.0')).toBe(true);
    expect(isNewer('v1.0.0', 'v1.0.0')).toBe(false);
  });

  it('treats a stable release as newer than its prerelease', () => {
    expect(isNewer('1.0.0', '1.0.0-rc.1')).toBe(true);
    expect(isNewer('1.0.0-rc.1', '1.0.0')).toBe(false);
  });

  it('orders prerelease identifiers', () => {
    expect(isNewer('1.0.0-rc.2', '1.0.0-rc.1')).toBe(true);
    expect(isNewer('1.0.0-rc.1', '1.0.0-rc.2')).toBe(false);
    expect(isNewer('1.0.0-beta', '1.0.0-alpha')).toBe(true);
  });

  it('returns false when either version is unparseable', () => {
    expect(isNewer('garbage', '0.1.0')).toBe(false);
    expect(isNewer('0.2.0', 'not-a-version')).toBe(false);
  });
});
