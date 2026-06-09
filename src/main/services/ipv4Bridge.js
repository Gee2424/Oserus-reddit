// HTTP CONNECT → SOCKS5 bridge with IPv4-only upstream resolution.
//
// Why this exists: proxy-chain forwards CONNECT to the upstream SOCKS5
// with the hostname intact. The upstream then does its own DNS — and
// when the target has an AAAA record (Google, X, IG, etc. all do), the
// upstream connects via IPv6 from a different network block than its
// IPv4 exit. Anti-bot stacks cross-reference and flag the mismatch.
//
// This bridge:
//   1. Accepts HTTP CONNECT from Chromium on a local random port
//   2. Resolves the requested hostname with dns.lookup({ family: 4 })
//   3. Opens a SOCKS5 connection to the upstream with the IPv4 literal
//      as the destination — so no AAAA lookup ever happens upstream
//   4. Pipes the client socket ↔ SOCKS socket
//
// HTTP / HTTPS upstreams keep using proxy-chain — they don't have the
// same IPv6-leak path (CONNECT goes verbatim to the upstream HTTP proxy
// which usually respects the request as-is, and most operators use
// SOCKS5 anyway).

const http = require('http');
const net = require('net');
const dns = require('dns').promises;
const { URL } = require('url');
const { SocksClient } = require('socks');
const elog = require('electron-log');

const bridges = new Map(); // key -> { url, server }

function buildKey({ host, port, username, password }) {
  return `${host}|${port}|${username || ''}|${password ? password.length : 0}`;
}

async function resolveIpv4(host) {
  // If the host is already an IPv4 literal, skip DNS.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return host;
  const { address } = await dns.lookup(host, { family: 4 });
  return address;
}

async function getOrCreateSocks5Bridge({ host, port, username, password }) {
  const key = buildKey({ host, port, username, password });
  const cached = bridges.get(key);
  if (cached) return cached;

  const server = http.createServer();
  server.on('connect', async (req, clientSocket, head) => {
    let socksSocket = null;
    try {
      const [reqHost, reqPort] = req.url.split(':');
      const targetPort = parseInt(reqPort, 10) || 443;

      // IPv4-only resolution. If the host is IPv4-only (no A record),
      // dns.lookup throws — propagate as 502 so Chromium handles it.
      let targetIp;
      try {
        targetIp = await resolveIpv4(reqHost);
      } catch (e) {
        clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
        clientSocket.end();
        return;
      }

      // Open SOCKS5 connection to upstream with the resolved IPv4 as
      // destination. type 0x01 (IPv4) — upstream never sees a hostname.
      const conn = await SocksClient.createConnection({
        proxy: {
          host, port,
          type: 5,
          userId: username || undefined,
          password: password || undefined,
        },
        command: 'connect',
        destination: { host: targetIp, port: targetPort },
        timeout: 15000,
      });
      socksSocket = conn.socket;

      // Tell Chromium the tunnel is open. Then pipe both directions.
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head && head.length) socksSocket.write(head);

      socksSocket.pipe(clientSocket);
      clientSocket.pipe(socksSocket);

      // Either side closing tears down both.
      const teardown = () => {
        try { clientSocket.destroy(); } catch {}
        try { socksSocket.destroy(); } catch {}
      };
      clientSocket.on('error', teardown);
      socksSocket.on('error', teardown);
      clientSocket.on('end', teardown);
      socksSocket.on('end', teardown);
    } catch (err) {
      elog.warn('[ipv4-bridge] tunnel failed', { url: req.url, error: err?.message });
      try { clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n'); } catch {}
      try { clientSocket.end(); } catch {}
      if (socksSocket) try { socksSocket.destroy(); } catch {}
    }
  });

  // Plain HTTP through this bridge (rare — almost everything is HTTPS,
  // which uses CONNECT above). Forward via SOCKS5 the same way.
  server.on('request', async (req, res) => {
    try {
      const target = new URL(req.url);
      const targetIp = await resolveIpv4(target.hostname);
      const targetPort = parseInt(target.port || '80', 10);
      const conn = await SocksClient.createConnection({
        proxy: { host, port, type: 5, userId: username || undefined, password: password || undefined },
        command: 'connect',
        destination: { host: targetIp, port: targetPort },
        timeout: 15000,
      });
      const proxyReq = http.request({
        createConnection: () => conn.socket,
        method: req.method,
        path: target.pathname + target.search,
        headers: req.headers,
      }, (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
        proxyRes.pipe(res);
      });
      proxyReq.on('error', () => { try { res.end(); } catch {} });
      req.pipe(proxyReq);
    } catch (err) {
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
  elog.info('[ipv4-bridge] online', { upstream: `socks5://${host}:${port}`, local: localUrl });
  return entry;
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
  getOrCreateSocks5Bridge,
  closeBridge,
  shutdownAll,
};
