/**
 * Tests for lib/proxy-fetch.js.
 *
 * This module routes the process-global `fetch()` through the configured
 * upstream proxy so camoufox-js's proxy-unaware downloads (uBlock Origin XPI,
 * Camoufox release manifest / bundle) don't leave the container direct and hit
 * geo-blocks such as `addons.mozilla.org` -> HTTP 451.
 *
 * Network-free: the only call made against the installed wrapper targets a
 * loopback URL, which must fall through to the pre-install fetch unchanged.
 */
import { describe, test, expect, afterAll } from '@jest/globals';
import {
  proxyUrlFromConfig,
  installProxyFetch,
  isProxyFetchInstalled,
} from '../../lib/proxy-fetch.js';

const REAL_FETCH = globalThis.fetch;
afterAll(() => { globalThis.fetch = REAL_FETCH; });

describe('proxyUrlFromConfig', () => {
  test('builds a plain http URL from host + port', () => {
    expect(proxyUrlFromConfig({ host: 'proxy.internal', port: '7890' }))
      .toBe('http://proxy.internal:7890');
  });

  test('falls back to the first entry of `ports`', () => {
    expect(proxyUrlFromConfig({ host: 'h', ports: ['7890', '7891'] }))
      .toBe('http://h:7890');
  });

  test('omits the port when none is configured', () => {
    expect(proxyUrlFromConfig({ host: 'h' })).toBe('http://h');
  });

  test('embeds url-encoded credentials', () => {
    expect(proxyUrlFromConfig({ host: 'h', port: '1', username: 'u@x', password: 'p/q' }))
      .toBe('http://u%40x:p%2Fq@h:1');
  });

  test('returns null when no upstream host is configured', () => {
    expect(proxyUrlFromConfig({})).toBeNull();
    expect(proxyUrlFromConfig({ host: '' })).toBeNull();
    expect(proxyUrlFromConfig(null)).toBeNull();
    expect(proxyUrlFromConfig(undefined)).toBeNull();
  });
});

// NOTE: installProxyFetch() is deliberately a process-wide singleton, so the
// order of these tests matters: the "no proxy" case must run before a
// successful install, after which the global fetch stays wrapped.
describe('installProxyFetch', () => {
  test('leaves global fetch untouched when no proxy is configured', () => {
    const before = globalThis.fetch;
    expect(installProxyFetch({}, () => {})).toBe(false);
    expect(installProxyFetch(null, () => {})).toBe(false);
    expect(isProxyFetchInstalled()).toBe(false);
    expect(globalThis.fetch).toBe(before);
  });

  test('installs a wrapper that bypasses loopback targets', async () => {
    // Stand in for the runtime's fetch so we can prove the loopback branch
    // hands off to it instead of going through impit.
    const original = async () => { throw new Error('original-fetch-called'); };
    globalThis.fetch = original;

    expect(installProxyFetch({ host: '127.0.0.1', port: '7890' }, () => {})).toBe(true);
    expect(isProxyFetchInstalled()).toBe(true);

    const wrapped = globalThis.fetch;
    expect(wrapped).not.toBe(original);

    await expect(wrapped('http://127.0.0.1:9/')).rejects.toThrow('original-fetch-called');
    await expect(wrapped('http://localhost:9/')).rejects.toThrow('original-fetch-called');
  });

  test('is idempotent and never re-wraps an installed fetch', () => {
    const wrapped = globalThis.fetch;
    expect(installProxyFetch({ host: 'other.internal', port: '1' }, () => {})).toBe(true);
    expect(globalThis.fetch).toBe(wrapped);
  });
});
