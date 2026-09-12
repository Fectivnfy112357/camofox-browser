// ---------------------------------------------------------------------------
// Proxy-aware global fetch
// ---------------------------------------------------------------------------
//
// camoufox-js performs several outbound HTTP requests with the *global*
// `fetch()`: the uBlock Origin XPI download, the Camoufox release manifest and
// the browser bundle download (see `camoufox-js/dist/pkgman.js` -> `webdl`).
//
// Node's global fetch is backed by its internal undici and does NOT honour
// HTTP_PROXY / HTTPS_PROXY, and Node 22 has no `NODE_USE_ENV_PROXY` support
// (verified: the flag is ignored on v22.23.2). Since the server's mihomo
// transparent-proxy rules now only cover the *host* — containers go out
// directly unless they opt in — those requests leave the container
// unproxied and fail on geo-blocked hosts:
//
//   https://addons.mozilla.org/.../latest.xpi  ->  HTTP 451 (direct)
//   https://addons.mozilla.org/.../latest.xpi  ->  HTTP 200 (via proxy)
//
// camoufox-js already depends on `impit` — a Rust HTTP client that speaks to
// upstream proxies and exposes a fetch-compatible API — so we reuse it here
// instead of pulling in another dependency.
//
// Install order matters: call `installProxyFetch()` before the first browser
// launch, because camoufox-js downloads the addons while launching.

import { createRequire } from 'node:module';

// impit ships as a camoufox-js dependency; resolve it defensively so a future
// dependency reshuffle degrades to "unrouted fetch" instead of a boot failure.
const require = createRequire(import.meta.url);
let Impit = null;
try {
  ({ Impit } = require('impit'));
} catch {
  Impit = null;
}

const BYPASS_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);

let installed = false;

/**
 * Build an `http://[user:pass@]host[:port]` upstream URL from the parsed
 * proxy config produced by `loadConfig()`.
 *
 * @returns {string|null} null when no usable upstream proxy is configured.
 */
export function proxyUrlFromConfig(proxy) {
  if (!proxy) return null;
  const host = proxy.host || '';
  if (!host) return null;
  const port = proxy.port
    || (Array.isArray(proxy.ports) && proxy.ports.length > 0 ? proxy.ports[0] : '');
  const auth = proxy.username
    ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password || '')}@`
    : '';
  return `http://${auth}${host}${port ? `:${port}` : ''}`;
}

function proxyUrlFromEnv() {
  const raw = process.env.HTTPS_PROXY || process.env.https_proxy
    || process.env.HTTP_PROXY || process.env.http_proxy
    || '';
  return raw.trim() || null;
}

function isBypassHost(url) {
  try {
    return BYPASS_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

function redact(proxyUrl) {
  return proxyUrl.replace(/\/\/[^@/]*@/, '//***@');
}

/**
 * Route the process-global `fetch()` through the configured upstream proxy.
 *
 * Idempotent. Returns true when the global fetch is (now) proxy-routed.
 */
export function installProxyFetch(proxy, log = () => {}) {
  if (installed) return true;

  if (!Impit) {
    log('warn', 'proxy-fetch: impit unavailable, global fetch left unrouted');
    return false;
  }

  const proxyUrl = proxyUrlFromConfig(proxy) || proxyUrlFromEnv();
  if (!proxyUrl) {
    log('info', 'proxy-fetch: no upstream proxy configured, global fetch left unrouted');
    return false;
  }

  let client;
  try {
    // Generous timeout: this instance also carries browser bundle downloads.
    client = new Impit({ proxyUrl, timeout: 300000 });
  } catch (err) {
    log('warn', 'proxy-fetch: could not create impit client, global fetch left unrouted', {
      error: String((err && err.message) || err),
    });
    return false;
  }

  const originalFetch = globalThis.fetch;

  globalThis.fetch = function proxyRoutedFetch(resource, init) {
    const url = typeof resource === 'string'
      ? resource
      : resource instanceof URL
        ? resource.href
        : (resource && resource.url) || '';

    // Leave non-HTTP schemes and loopback targets to the runtime.
    if (!/^https?:\/\//i.test(url) || isBypassHost(url)) {
      return originalFetch.call(this, resource, init);
    }
    return client.fetch(resource, init);
  };

  installed = true;
  log('info', 'proxy-fetch: global fetch routed through upstream proxy', {
    proxy: redact(proxyUrl),
  });
  return true;
}

export function isProxyFetchInstalled() {
  return installed;
}
