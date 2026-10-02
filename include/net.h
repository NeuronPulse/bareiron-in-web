#ifndef H_NET
#define H_NET

#include <stdint.h>
#include <stddef.h>
#include <sys/types.h>

#ifdef __cplusplus
extern "C" {
#endif

/*
 * Transport abstraction layer.
 *
 * The original server talked directly to POSIX/BSD sockets, which don't exist
 * in a browser/WASM context (and a browser cannot accept inbound TCP either).
 * This layer hides the transport behind a small, opaque handle-based API so
 * that:
 *   - the native (gcc) and ESP builds keep using real sockets (net_posix.c);
 *   - the WASM build routes every connection through a JS bridge that talks to
 *     a Tailscale netstack running in the browser (net_wasm.c + bridge.js).
 *
 * `net_fd` intentionally keeps the same meaning as the old `client_fd`: an
 * opaque integer that the caller uses as a connection handle. In the WASM
 * build it indexes into a connection table managed by JS, not an OS fd.
 */

typedef int net_fd;

/* Mirrors MSG_PEEK for net_recv(). */
#define NET_PEEK 0x1

/* Start listening on `port`. Returns 0 on success, -1 on failure. */
int net_init(int port);

/* Accept a new connection. Returns a handle >= 0, or -1 if none is pending
 * (caller should treat -1 as "would block" / EAGAIN). */
net_fd net_accept(void);

/*
 * Receive up to `n` bytes into `buf`.
 *   - When NET_PEEK is set: non-blocking. Returns the number of bytes currently
 *     available (0 .. n), 0 to signal EOF (peer closed), or -1 with errno set
 *     to EAGAIN when the connection is open but no data is available yet.
 *   - Without NET_PEEK: blocking. In the WASM build this suspends (Asyncify)
 *     until data arrives or the peer closes; it returns the number of bytes
 *     copied (> 0) or 0 on EOF. It never returns -1 for a normal short read.
 */
ssize_t net_recv(net_fd fd, void *buf, size_t n, int flags);

/*
 * Send `n` bytes from `buf`. Returns the number of bytes sent (> 0), 0 if the
 * connection is closed, or -1 on error.
 */
ssize_t net_send(net_fd fd, const void *buf, size_t n, int flags);

/* Close a connection (or, if passed the listener handle, stop listening). */
void net_close(net_fd fd);

/* Best-effort shutdown of the write side of a connection. */
void net_shutdown(net_fd fd);

/*
 * Idle wait: suspends until an event occurs (incoming data, a new accepted
 * connection, ...) or `timeout_us` microseconds elapse. A `timeout_us` <= 0
 * waits indefinitely for the next event. On the native build this is a short
 * sleep to avoid busy-spinning; on WASM it is the Asyncify wake-up point.
 */
void net_poll(int64_t timeout_us);

/* Returns non-zero if any connection has buffered inbound data or a pending
 * accept. The WASM main loop uses this to decide whether to keep scanning
 * immediately (work available) or to suspend and wait for an event (idle). */
int net_any_pending(void);

#ifdef __cplusplus
}
#endif

#endif /* H_NET */
