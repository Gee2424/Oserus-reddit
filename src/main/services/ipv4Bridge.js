// Universal IPv4-only proxy bridge. Accepts HTTP CONNECT (and plain
// HTTP) from Chromium on a local 127.0.0.1 port, resolves the target
// hostname to IPv4, and forwards to the upstream proxy with the
// IPv4 literal as destination so no AAAA lookup ever happens upstream.
//
// Supports every scheme operators paste in:
//   - socks5 + socks5h    (with or without auth)
//   - socks4 + socks4a    (with or without userid)
//   - http                (with or without auth)
//   - https               (with or without auth, TLS to upstream)
//
// The bridge URL handed to Chromium is always plain 'http://127.0.0.1:N'
// — Chromium speaks HTTP to the bridge; the bridge speaks whatever the
// upstream expects.

const http = require('http');
const https = require('https');
const net = require('net');
const tls = require('tls');
const dns = require('dns').promises;
const { URL } = require('url');
const { SocksClient } = require('socks');
const elog = require('electron-log');

const bridges = new Map(); // key -> { url, server }

function buildKey({ scheme, host, port, username, password }) {
  return `${scheme}|${host}|${port}|${username || ''}|${password ? password.length : 0}`;
}

// Local DNS is ONLY used as a last resort (for plain SOCKS4 which has
// no remote-resolution mode). For every other upstream scheme we hand
// the hostname to the proxy and let IT resolve, so the operator's ISP
// resolver never sees a lookup for reddit.com / instagram.com / etc.
// That eliminates the DNS-leak finding on BrowserScan.
async function resolveIpv4(host) {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return host;
  const { address } = await dns.lookup(host, { family: 4 });
  return address;
}

// --- Per-scheme upstream connectors. Each returns a Node socket that's
//     already tunneled to (targetHost, targetPort) via the upstream proxy.
//     targetHost may be an IP or a hostname — the connector picks the
//     right representation for its scheme so DNS happens remotely. ---

async function connectViaSocks(upstream, targetHost, targetPort) {
  // SOCKS5 supports a "domain" address type → the proxy resolves. The
  // `socks` library auto-picks domain when destination.host is not an
  // IP literal. SOCKS4 has no remote DNS, so for that one path we fall
  // back to local resolution via socks4a-style or — if scheme is
  // strictly 'socks4' — pre-resolve to v4 before we get here (handled
  // upstream of this call).
  const conn = await SocksClient.createConnection({
    proxy: {
      host: upstream.host,
      port: upstream.port,
      type: upstream.scheme === 'socks4' || upstream.scheme === 'socks4a' ? 4 : 5,
      userId: upstream.username || undefined,
      password: upstream.password || undefined,
    },
    command: 'connect',
    destination: { host: targetHost, port: targetPort },
    timeout: 15000,
  });
  return conn.socket;
}

async function connectViaHttpProxy(upstream, targetHost, targetPort) {
  // CONNECT carries the destination as `host:port`. HTTP proxies (squid,
  // 3proxy, every commercial residential gateway) resolve that hostname
  // themselves — so handing them the hostname (not a pre-resolved IP)
  // keeps DNS off the operator's machine.
  return new Promise((resolve, reject) => {
    const useTls = upstream.scheme === 'https';
    const headers = [
      `CONNECT ${targetHost}:${targetPort} HTTP/1.1`,
      `Host: ${targetHost}:${targetPort}`,
    ];
    if (upstream.username) {
      const auth = Buffer.from(`${upstream.username}:${upstream.password || ''}`).toString('base64');
      headers.push(`Proxy-Authorization: Basic ${auth}`);
    }
    headers.push('Proxy-Connection: Keep-Alive', '', '');

    const opts = { host: upstream.host, port: upstream.port, timeout: 15000 };
    const sock = useTls
      ? tls.connect({ ...opts, servername: upstream.host, rejectUnauthorized: false })
      : net.connect(opts);

    let buf = '';
    const onError = (err) => {
      sock.removeAllListeners();
      try { sock.destroy(); } catch {}
      reject(err);
    };
    sock.once('error', onError);
    sock.once('timeout', () => onError(new Error('Upstream CONNECT timed out')));

    const onConnect = () => sock.write(headers.join('\r\n'));
    if (useTls) sock.once('secureConnect', onConnect); else sock.once('connect', onConnect);

    sock.on('data', (chunk) => {
      buf += chunk.toString('binary');
      const i = buf.indexOf('\r\n\r\n');
      if (i === -1) return;
      const head = buf.slice(0, i);
      const remainder = buf.slice(i + 4);
      sock.removeAllListeners('data');
      sock.removeAllListeners('error');
      sock.removeAllListeners('timeout');
      const m = /^HTTP\/1\.[01] (\d{3})/.exec(head);
      const status = m ? Number(m[1]) : 0;
      if (status === 200) {
        // If the upstream sent some app bytes already, unshift them back
        // into the socket so the consumer sees a clean tunnel start.
        if (remainder.length) sock.unshift(Buffer.from(remainder, 'binary'));
        resolve(sock);
      } else {
        try { sock.destroy(); } catch {}
        reject(new Error(`Upstream CONNECT returned ${status || 'no status'}`));
      }
    });
  });
}

async function dialUpstream(upstream, targetHost, targetPort) {
  if (upstream.scheme === 'http' || upstream.scheme === 'https') {
    return connectViaHttpProxy(upstream, targetHost, targetPort);
  }
  // socks4 / socks4a / socks5 / socks5h all funnel through socks lib.
  // For plain socks4 (no remote-resolution), pre-resolve to IPv4 here
  // since the protocol can't carry a hostname. For everything else, hand
  // the hostname over so the proxy resolves it.
  if (upstream.scheme === 'socks4' && !/^\d+\.\d+\.\d+\.\d+$/.test(targetHost)) {
    targetHost = await resolveIpv4(targetHost);
  }
  return connectViaSocks(upstream, targetHost, targetPort);
}

// --- Bridge server ---

async function getOrCreateBridge(upstream) {
  // Normalize scheme aliases.
  const sch = (upstream.scheme || 'http').toLowerCase();
  const normalized = {
    ...upstream,
    scheme: sch === 'socks5h' ? 'socks5'
          : sch === 'socks4a' ? 'socks4'
          : sch,
    port: Number(upstream.port),
  };
  const key = buildKey(normalized);
  const cached = bridges.get(key);
  if (cached) return cached;

  const server = http.createServer();

  server.on('connect', async (req, clientSocket, head) => {
    let upSock = null;
    try {
      const [reqHost, reqPort] = req.url.split(':');
      const targetPort = parseInt(reqPort, 10) || 443;
      // Hand the hostname directly to dialUpstream — it only falls back
      // to local DNS when the scheme literally cannot carry one (socks4).
      upSock = await dialUpstream(normalized, reqHost, targetPort);
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head && head.length) upSock.write(head);
      upSock.pipe(clientSocket);
      clientSocket.pipe(upSock);
      const teardown = () => { try { clientSocket.destroy(); } catch {} try { upSock.destroy(); } catch {} };
      clientSocket.on('error', teardown);
      upSock.on('error', teardown);
      clientSocket.on('end', teardown);
      upSock.on('end', teardown);
    } catch (err) {
      elog.warn('[bridge] CONNECT failed', { url: req.url, upstream: `${normalized.scheme}://${normalized.host}:${normalized.port}`, error: err?.message });
      try { clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n'); } catch {}
      try { clientSocket.end(); } catch {}
      if (upSock) try { upSock.destroy(); } catch {}
    }
  });

  // Plain HTTP. Rare since almost everything is HTTPS.
  server.on('request', async (req, res) => {
    try {
      const target = new URL(req.url);
      const targetPort = parseInt(target.port || '80', 10);
      const upSock = await dialUpstream(normalized, target.hostname, targetPort);
      const proxyReq = http.request({
        createConnection: () => upSock,
        method: req.method,
        path: target.pathname + target.search,
        headers: req.headers,
      }, (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
        proxyRes.pipe(res);
      });
      proxyReq.on('error', () => { try { res.end(); } catch {} });
      req.pipe(proxyReq);
    } catch {
      try { res.writeHead(502); res.end(); } catch {}
    }
  });

  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve());
    server.on('error', reject);
  });
  const addr = server.address();
  const localUrl = `http://127.0.0.1:${addr.port}`;
  const entry = { url: localUrl, server, key };
  bridges.set(key, entry);
  elog.info('[bridge] online', { upstream: `${normalized.scheme}://${normalized.host}:${normalized.port}`, local: localUrl });
  return entry;
}

// Backward-compat alias — older callers import getOrCreateSocks5Bridge.
async function getOrCreateSocks5Bridge({ host, port, username, password }) {
  return getOrCreateBridge({ scheme: 'socks5', host, port, username, password });
}

async function closeBridge(key) {
  const entry = bridges.get(key);
  if (!entry) return;
  try { entry.server.close(); } catch {}
  bridges.delete(key);
}

async function shutdownAll() {
  const entries = Array.from(bridges.values());
  bridges.clear();
  for (const e of entries) {
    try { e.server.close(); } catch {}
  }
}

module.exports = {
  getOrCreateBridge,
  getOrCreateSocks5Bridge, // alias
  closeBridge,
  shutdownAll,
};
