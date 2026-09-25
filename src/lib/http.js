// Plain HTTP / TLS / DNS helpers used by the availability scenarios and the
// hourly uptime check. No browser involved, so they are fast and cheap.

const tls = require('tls');
const dns = require('dns').promises;
const { performance } = require('perf_hooks');

const UA =
  process.env.SENTINEL_USER_AGENT ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 SiteSentinel/1.0';

/**
 * GET/HEAD a URL with a timeout. Redirects are NOT followed by default so the
 * caller can check status codes and Location headers.
 */
async function timedFetch(url, { method = 'GET', timeout = 15000, redirect = 'manual', headers = {} } = {}) {
  const started = performance.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      method,
      redirect,
      signal: ctrl.signal,
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,*/*;q=0.8', ...headers },
    });
    const ms = Math.round(performance.now() - started);
    const text = method === 'HEAD' ? '' : await res.text().catch(() => '');
    return {
      ok: res.ok,
      status: res.status,
      ms,
      url: res.url || url,
      headers: res.headers,
      location: res.headers.get('location'),
      text,
    };
  } catch (err) {
    const ms = Math.round(performance.now() - started);
    const reason = err.name === 'AbortError' ? `timeout after ${timeout} ms` : err.cause?.code || err.message;
    return { ok: false, status: 0, ms, url, headers: new Headers(), location: null, text: '', error: reason };
  } finally {
    clearTimeout(timer);
  }
}

/** Follow up to `max` redirects manually and return the chain. */
async function followRedirects(url, max = 6) {
  const chain = [];
  let current = url;
  for (let i = 0; i <= max; i++) {
    const res = await timedFetch(current, { method: 'GET' });
    chain.push({ url: current, status: res.status, location: res.location, error: res.error });
    if (res.status >= 300 && res.status < 400 && res.location) {
      current = new URL(res.location, current).toString();
      continue;
    }
    return { chain, final: current, status: res.status };
  }
  return { chain, final: current, status: chain[chain.length - 1].status, tooMany: true };
}

/** Certificate details for a host on 443. */
function certInfo(host, port = 443, timeout = 10000) {
  return new Promise((resolve) => {
    const socket = tls.connect({ host, port, servername: host, timeout, rejectUnauthorized: false }, () => {
      const cert = socket.getPeerCertificate();
      const authorized = socket.authorized;
      const authError = socket.authorizationError ? String(socket.authorizationError) : null;
      socket.end();
      if (!cert || !cert.valid_to) return resolve({ error: 'no certificate returned' });
      const validTo = new Date(cert.valid_to);
      const validFrom = new Date(cert.valid_from);
      const daysLeft = (validTo.getTime() - Date.now()) / 86400000;
      resolve({
        authorized,
        authError,
        validFrom: validFrom.toISOString(),
        validTo: validTo.toISOString(),
        daysLeft: Math.floor(daysLeft),
        issuer: cert.issuer && (cert.issuer.O || cert.issuer.CN),
        subject: cert.subject && cert.subject.CN,
        altNames: cert.subjectaltname,
      });
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve({ error: 'TLS handshake timeout' });
    });
    socket.on('error', (err) => resolve({ error: err.message }));
  });
}

/** A and AAAA records for a host. */
async function resolveDns(host) {
  const [a, aaaa] = await Promise.all([
    dns.resolve4(host).catch(() => []),
    dns.resolve6(host).catch(() => []),
  ]);
  return { a: a.sort(), aaaa: aaaa.sort() };
}

function hostOf(url) {
  return new URL(url).hostname;
}

module.exports = { UA, timedFetch, followRedirects, certInfo, resolveDns, hostOf };
