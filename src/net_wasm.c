/*
 * WASM transport implementation.
 *
 * Compiled only for the WASM build (`#ifdef WASM`). Every call is routed to a
 * JavaScript bridge (`globalThis.BareironBridge`) implemented in
 * src/web/bridge.js. The bridge talks to a Tailscale netstack running in the
 * browser (Go -> WASM), so the C server can accept inbound Minecraft
 * connections even though the browser itself has no listening sockets.
 *
 * Concurrency model (Emscripten Asyncify):
 *   - All transport calls EXCEPT net_js_wait are synchronous and return
 *     immediately: data bytes, null (EOF), or -2 / -1 ("would block").
 *   - Only net_js_wait returns a Promise; Asyncify suspends the C stack until
 *     the bridge resolves it (on data arrival, a new accept, a close, or a
 *     timeout). The C wrappers below loop: do a synchronous read/write, and if
 *     it would block, call the async wait and retry.
 */

#ifdef WASM

#include "net.h"

#include <errno.h>
#include <emscripten.h>

/* ---- Synchronous bridge calls (return immediately) --------------------- */

EM_JS(int, net_js_init, (int port), {
  return globalThis.BareironBridge.init(port);
});

EM_JS(net_fd, net_js_accept, (), {
  return globalThis.BareironBridge.accept();
});

EM_JS(ssize_t, net_js_peek, (net_fd fd, void *buf, size_t n), {
  const r = globalThis.BareironBridge.peek(fd, n);
  if (r === null) return 0;   /* EOF */
  if (r === -1)  return -1;   /* would block (open, no data) */
  HEAPU8.set(r, buf);
  return r.length;
});

EM_JS(ssize_t, net_js_read, (net_fd fd, void *buf, size_t n), {
  const r = globalThis.BareironBridge.read(fd, n);
  if (r === null) return 0;   /* EOF */
  if (r === -2)   return -2;  /* would block */
  HEAPU8.set(r, buf);
  return r.length;
});

EM_JS(ssize_t, net_js_write, (net_fd fd, const void *buf, size_t n), {
  const data = HEAPU8.slice(buf, buf + n);
  return globalThis.BareironBridge.write(fd, data);
});

EM_JS(void, net_js_close, (net_fd fd), {
  globalThis.BareironBridge.close(fd);
});

/* ---- Asynchronous bridge call (suspends via Asyncify) ------------------ */

/* EM_ASYNC_JS lets the body use `await` and tells Emscripten to treat this
 * import as async, so the C stack is suspended until the promise resolves. */
EM_ASYNC_JS(void, net_js_wait, (int64_t timeout_us), {
  return await globalThis.BareironBridge.wait(timeout_us);
});

EM_JS(int, net_js_any_pending, (), {
  return globalThis.BareironBridge.hasPending() ? 1 : 0;
});

/* ---- C-side wrappers -------------------------------------------------- */

int net_init (int port) {
  return net_js_init(port);
}

net_fd net_accept (void) {
  return net_js_accept();
}

ssize_t net_recv (net_fd fd, void *buf, size_t n, int flags) {
  if (flags & NET_PEEK) {
    ssize_t r = net_js_peek(fd, buf, n);
    if (r < 0) {
      errno = EAGAIN;
      return -1;
    }
    return r;
  }

  /* Blocking read: loop until data arrives or the peer closes. */
  for (;;) {
    ssize_t r = net_js_read(fd, buf, n);
    if (r > 0) return r;
    if (r == 0) return 0; /* EOF */
    /* r == -2: would block, wait for the next event and retry. */
    net_js_wait(0);
  }
}

ssize_t net_send (net_fd fd, const void *buf, size_t n, int flags) {
  /* The bridge buffers outbound bytes synchronously, so a single call is
   * enough. A 0 return means the connection is closed. */
  return net_js_write(fd, buf, n);
}

void net_close (net_fd fd) {
  net_js_close(fd);
}

void net_shutdown (net_fd fd) {
  net_js_close(fd);
}

void net_poll (int64_t timeout_us) {
  net_js_wait(timeout_us);
}

int net_any_pending (void) {
  return net_js_any_pending();
}

/* In the WASM build, task_yield() is a no-op: the idle suspend is handled
 * explicitly in the main loop via net_any_pending() + net_poll(), so that a
 * single client is served without a 200 ms stall per empty poll slot. */
void task_yield (void) {
}

#endif /* WASM */
