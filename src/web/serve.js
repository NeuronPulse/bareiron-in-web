/*
 * serve.js — local static server for the bareiron-in-web control panel.
 *
 * Serves the contents of this directory (index.html, bridge.js, app.js,
 * styles.css, and dist/bareiron.js + bareiron.wasm). Uses HTTPS when mkcert
 * certificates are found (recommended for Tailscale Funnel / OAuth); otherwise
 * falls back to plain HTTP on localhost.
 *
 * Usage:  node serve.js [port]            (HTTP on port, default 8090)
 *         node serve.js [port] --https     (HTTPS if certs exist, else HTTP)
 */
'use strict';
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = parseInt(process.argv[2] || '8090', 10);
const WANT_HTTPS = process.argv.includes('--https');
function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}
const HOST = arg('--host', '0.0.0.0');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function serveFile(req, res) {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); return res.end('forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('not found: ' + urlPath);
    }
    const type = MIME[path.extname(filePath)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

const certDir = path.join(ROOT, '..', '..', 'certs');
const keyPath = path.join(certDir, 'localhost-key.pem');
const certPath = path.join(certDir, 'localhost.pem');

if (WANT_HTTPS && fs.existsSync(keyPath) && fs.existsSync(certPath)) {
  const server = https.createServer({
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  }, serveFile);
  server.listen(PORT, HOST, () => {
    console.log('[serve] HTTPS  →  https://' + HOST + ':' + PORT);
  });
} else {
  const server = http.createServer(serveFile);
  server.listen(PORT, HOST, () => {
    console.log('[serve] HTTP   →  http://' + HOST + ':' + PORT +
      (WANT_HTTPS ? '  (certs not found, fell back to HTTP)' : ''));
  });
}
