/*
 * bridge.js — the JS bridge between the C(WASM) bareiron server and a network
 * transport backend.
 *
 * The C server (compiled with -DWASM) calls into this bridge through the EM_JS
 * functions in src/net_wasm.c (globalThis.BareironBridge). Those calls are:
 *
 *   init(port)            -> 0/-1      start listening
 *   accept()              -> fd | -1   pull a queued inbound connection
 *   peek(fd, n, ptr)      -> bytes|null|-1   non-blocking peek (null=EOF, -1=again)
 *   read(fd, n)           -> bytes|null|-2   blocking read (null=EOF, -2=again)
 *   write(fd, data)       -> count|0         send bytes (0=closed)
 *   close(fd)                        close a connection
 *   wait(timeoutUs)       -> Promise          idle wait (resolves on event/timeout)
 *
 * The bridge keeps a connection table (fd -> {incoming[], closed}) and a queue
 * of fds awaiting accept. `wait()` is the single Asyncify wake-up point: it
 * resolves when data arrives, a connection is accepted/closed, or a timeout
 * elapses, letting the suspended C stack resume.
 *
 * Backends:
 *   - RelayBackend: browser-only, tunnels connections over WebSocket to a
 *     local relay (TCP<->WS) for development/testing without Tailscale.
 *   - Tailscale: wired in later; the bridge detects a global TailscaleBridge.
 */

(function (global) {
  'use strict';

  let nextFd = 1;
  const conns = new Map();
  let acceptQueue = [];
  let wakeResolver = null;
  let pollTimer = null;
  let backend = null;

  function wake() {
    if (wakeResolver) {
      const r = wakeResolver;
      wakeResolver = null;
      if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
      r();
    }
  }

  // Called by a backend when a new inbound connection has arrived.
  function onAccept(fd) {
    conns.set(fd, { incoming: [], closed: false });
    acceptQueue.push(fd);
    wake();
  }
  // Called by a backend when bytes arrive for an existing connection.
  function onData(fd, bytes) {
    const c = conns.get(fd);
    if (!c || c.closed) return;
    for (let i = 0; i < bytes.length; i++) c.incoming.push(bytes[i]);
    wake();
  }
  // Called by a backend when a connection is closed by the peer.
  function onClose(fd) {
    const c = conns.get(fd);
    if (!c) return;
    c.closed = true;
    wake();
  }

  const Bridge = {
    setBackend(b) { backend = b; },

    init(port) {
      if (backend && backend.start) {
        backend.start(port, onAccept, onData, onClose);
      }
      return 0;
    },

    accept() {
      if (acceptQueue.length === 0) return -1;
      return acceptQueue.shift();
    },

    peek(fd, n) {
      const c = conns.get(fd);
      if (!c) return -1;
      if (c.closed && c.incoming.length === 0) return null; // EOF
      if (c.incoming.length === 0) return -1;              // would block
      return c.incoming.slice(0, n);                        // Uint8Array (copy)
    },

    read(fd, n) {
      const c = conns.get(fd);
      if (!c) return null;                                  // EOF
      if (c.closed && c.incoming.length === 0) return null; // EOF
      if (c.incoming.length === 0) return -2;               // would block
      const take = Math.min(n, c.incoming.length);
      const out = new Uint8Array(take);
      for (let i = 0; i < take; i++) out[i] = c.incoming.shift();
      return out;
    },

    write(fd, data) {
      const c = conns.get(fd);
      if (!c || c.closed) return 0;
      if (backend && backend.write) backend.write(fd, data);
      return data.length;
    },

    close(fd) {
      const c = conns.get(fd);
      if (c) c.closed = true;
      if (backend && backend.close) backend.close(fd);
      wake();
    },

    wait(timeoutUs) {
      return new Promise((resolve) => {
        wakeResolver = resolve;
        const ms = Number(timeoutUs); // int64 from C arrives as BigInt in JS
        if (ms && ms > 0) {
          pollTimer = setTimeout(() => {
            wakeResolver = null;
            pollTimer = null;
            resolve();
          }, ms / 1000);
        }
      });
    },

    // True if any connection has buffered inbound data or a pending accept.
    hasPending() {
      if (acceptQueue.length > 0) return true;
      for (const c of conns.values()) {
        if (c.incoming.length > 0) return true;
      }
      return false;
    },
  };

  /* ---- RelayBackend ---- */

  // WebSocket relay backend (browser). Connects to a relay that bridges a real
  // TCP port (where a Minecraft client connects) to WebSocket frames.
  function RelayBackend(url) {
    let ws = null;
    const fdByRelay = new Map();
    let nextRelayId = 1;

    this.start = function (port, onAccept, onData, onClose) {
      ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'listen', port: port }));
      };
      ws.onmessage = (ev) => {
        if (typeof ev.data === 'string') {
          const m = JSON.parse(ev.data);
          if (m.type === 'accept') {
            const fd = nextFd++;
            fdByRelay.set(m.id, fd);
            onAccept(fd);
          } else if (m.type === 'close') {
            const fd = fdByRelay.get(m.id);
            if (fd !== undefined) { fdByRelay.delete(m.id); onClose(fd); }
          }
        } else {
          // Binary: first 4 bytes = relay id (uint32 BE), rest = payload.
          const buf = new Uint8Array(ev.data);
          const id = (buf[0] << 24) | (buf[1] << 16) | (buf[2] << 8) | buf[3];
          const fd = fdByRelay.get(id);
          if (fd !== undefined) onData(fd, buf.subarray(4));
        }
      };
    };

    this.write = function (fd, data) {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      // Prefix with relay id (4 bytes BE). Find id by fd.
      let id = null;
      for (const [rid, f] of fdByRelay) if (f === fd) { id = rid; break; }
      if (id === null) return;
      const out = new Uint8Array(4 + data.length);
      out[0] = (id >>> 24) & 0xff; out[1] = (id >>> 16) & 0xff;
      out[2] = (id >>> 8) & 0xff; out[3] = id & 0xff;
      out.set(data, 4);
      ws.send(out);
    };

    this.close = function (fd) {
      let id = null;
      for (const [rid, f] of fdByRelay) if (f === fd) { id = rid; break; }
      if (id !== null && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'close', id: id }));
        fdByRelay.delete(id);
      }
    };
  }

  /* ---- TailscaleBackend ---- */

  // In-browser Tailscale device (via the `tailscale-web` wasm build). The browser
  // becomes a *real* tailnet node: it authenticates to Tailscale's control plane,
  // gets a 100.x IP, and listens for TCP on that IP. Minecraft clients on the
  // same tailnet connect straight to this node's IP:port. There is NO self-hosted
  // relay — the data plane uses Tailscale's own DERP-over-WSS infrastructure.
  //
  // `network` is the singleton exported by `tailscale-web` (e.g. from esm.sh).
  // `options.controlUrl` lets you point at a self-hosted Headscale coordination
  // server instead of Tailscale's default controlplane.tailscale.com (useful on
  // networks where Tailscale is unreachable).
  function TailscaleBackend(network, options) {
    const net = network;
    const controlUrl = options && options.controlUrl ? options.controlUrl : undefined;
    let fdCounter = 1;
    const fdByConn = new Map();   // Connection -> fd
    const connByFd = new Map();   // fd -> Connection
    const conns = new Map();      // fd -> { connectedAt, bytesIn, bytesOut, remote }
    let onAcceptCb = null, onDataCb = null, onCloseCb = null;

    function finish(fd) {
      if (!connByFd.has(fd)) return;
      connByFd.delete(fd);
      for (const [conn, f] of fdByConn) if (f === fd) { fdByConn.delete(conn); break; }
      conns.delete(fd);
      if (window.__bareironOnConn) window.__bareironOnConn(fd, 'close');
      if (onCloseCb) onCloseCb(fd);
    }

    this.start = function (port, onAccept, onData, onClose) {
      onAcceptCb = onAccept; onDataCb = onData; onCloseCb = onClose;

      const opts = {
        hostname: 'bareiron-browser',
        controlUrl: controlUrl,
        onAuthRequired: (url) => {
          // Pop the OAuth page (matching tailscale-web's documented pattern).
          try { window.open(url, '_blank', 'width=600,height=700'); } catch (e) { /* blocked */ }
          if (window.__bareironOnAuth) window.__bareironOnAuth(url);
        },
        onAuthComplete: () => { if (window.__bareironOnAuthComplete) window.__bareironOnAuthComplete(); },
      };

      net.init(opts)
        .then(() => {
          const ipv4 = net.localIPv4();
          if (window.__bareironOnIP) window.__bareironOnIP(ipv4);
          return net.listenTCP(port, (conn) => {
            const fd = fdCounter++;
            fdByConn.set(conn, fd);
            connByFd.set(fd, conn);
            const rec = {
              connectedAt: Date.now(),
              bytesIn: 0,
              bytesOut: 0,
              remote: conn.remoteAddr || conn.remoteAddress || '',
            };
            conns.set(fd, rec);

            try {
              if (typeof conn.onClose === 'function') conn.onClose(() => finish(fd));
            } catch (e) { /* not all builds expose onClose */ }

            conn.onData((data) => {
              if (!data || data.length === 0) { finish(fd); return; }
              const u = data instanceof Uint8Array ? data : new Uint8Array(data);
              rec.bytesIn += u.length;
              onDataCb(fd, u);
            });

            if (window.__bareironOnConn) window.__bareironOnConn(fd, 'open');
            onAcceptCb(fd);
          });
        })
        .then((listener) => { this._listener = listener; })
        .catch((e) => { if (window.__bareironOnError) window.__bareironOnError(e); });
    };

    this.write = function (fd, data) {
      const conn = connByFd.get(fd);
      if (!conn) return;
      const u = data instanceof Uint8Array ? data : new Uint8Array(data);
      try { conn.write(u); const rec = conns.get(fd); if (rec) rec.bytesOut += u.length; }
      catch (e) { /* ignore */ }
    };

    this.close = function (fd) {
      const conn = connByFd.get(fd);
      if (conn) { try { conn.close(); } catch (e) {} }
      finish(fd);
    };

    // Snapshot of active connections for the UI player/connection table.
    this.getConnections = function () {
      const out = [];
      for (const [fd, rec] of conns) {
        out.push({
          id: fd, connectedAt: rec.connectedAt,
          bytesIn: rec.bytesIn, bytesOut: rec.bytesOut, remote: rec.remote,
        });
      }
      return out;
    };
  }

  // Expose both backends; the UI selects TailscaleBackend (no relay) by default.
  Bridge.RelayBackend = RelayBackend;
  Bridge.TailscaleBackend = TailscaleBackend;

  global.BareironBridge = Bridge;
})(typeof globalThis !== 'undefined' ? globalThis : this);
