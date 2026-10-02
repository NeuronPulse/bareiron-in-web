/*
 * Native (POSIX / Windows / ESP-IDF) transport implementation.
 *
 * This file is compiled only for non-WASM builds (it is wrapped in
 * `#ifndef WASM`; the WASM build compiles net_wasm.c instead). It reproduces
 * the original socket setup that used to live inline in main.c, but behind the
 * net_* abstraction in net.h so the game logic no longer touches sockets.
 */

#ifndef WASM

#include "net.h"

#include <stdio.h>
#include <string.h>
#include <errno.h>
#include <time.h>

#ifdef ESP_PLATFORM
  #include "lwip/sockets.h"
  #include "lwip/netdb.h"
#else
  #ifdef _WIN32
    #include <winsock2.h>
    #include <ws2tcpip.h>
  #else
    #include <sys/socket.h>
    #include <netinet/in.h>
    #include <arpa/inet.h>
    #include <fcntl.h>
  #endif
  #include <unistd.h>
#endif

#include "globals.h"

/* The listening socket, kept internal to this translation unit. */
static int server_fd = -1;

static void set_nonblocking (int fd) {
  #ifdef _WIN32
    u_long mode = 1;
    ioctlsocket(fd, FIONBIO, &mode);
  #elif defined(ESP_PLATFORM)
    /* lwip sockets are already non-blocking by default; nothing to do. */
  #else
    int flags = fcntl(fd, F_GETFL, 0);
    fcntl(fd, F_SETFL, flags | O_NONBLOCK);
  #endif
}

int net_init (int port) {
  server_fd = socket(AF_INET, SOCK_STREAM, 0);
  if (server_fd == -1) {
    perror("socket failed");
    return -1;
  }

  int opt = 1;
  #ifdef _WIN32
    if (setsockopt(server_fd, SOL_SOCKET, SO_REUSEADDR,
        (const char *)&opt, sizeof(opt)) < 0) {
  #else
    if (setsockopt(server_fd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt)) < 0) {
  #endif
    perror("socket options failed");
    close(server_fd);
    server_fd = -1;
    return -1;
  }

  struct sockaddr_in addr;
  memset(&addr, 0, sizeof(addr));
  addr.sin_family = AF_INET;
  addr.sin_addr.s_addr = INADDR_ANY;
  addr.sin_port = htons((uint16_t)port);

  if (bind(server_fd, (struct sockaddr *)&addr, sizeof(addr)) < 0) {
    perror("bind failed");
    close(server_fd);
    server_fd = -1;
    return -1;
  }

  if (listen(server_fd, 5) < 0) {
    perror("listen failed");
    close(server_fd);
    server_fd = -1;
    return -1;
  }

  set_nonblocking(server_fd);
  return 0;
}

net_fd net_accept (void) {
  if (server_fd < 0) return -1;

  struct sockaddr_in client_addr;
  socklen_t addr_len = sizeof(client_addr);
  int client = accept(server_fd, (struct sockaddr *)&client_addr, &addr_len);
  if (client == -1) return -1;

  set_nonblocking(client);
  return client;
}

ssize_t net_recv (net_fd fd, void *buf, size_t n, int flags) {
  int sock_flags = (flags & NET_PEEK) ? MSG_PEEK : 0;
  #ifdef _WIN32
    return recv(fd, (char *)buf, (int)n, sock_flags);
  #else
    return recv(fd, buf, n, sock_flags);
  #endif
}

ssize_t net_send (net_fd fd, const void *buf, size_t n, int flags) {
  #ifdef _WIN32
    return send(fd, (const char *)buf, (int)n, 0);
  #else
    return send(fd, buf, n, MSG_NOSIGNAL);
  #endif
}

void net_close (net_fd fd) {
  if (fd < 0) return;
  #ifdef _WIN32
    closesocket(fd);
  #else
    close(fd);
  #endif
}

void net_shutdown (net_fd fd) {
  if (fd < 0) return;
  #ifdef _WIN32
    closesocket(fd);
  #else
    shutdown(fd, SHUT_WR);
  #endif
}

void net_poll (int64_t timeout_us) {
  /* On ESP, hand control back to the idle task. Elsewhere, a short sleep
   * keeps the idle loop from busy-spinning the CPU. */
  #ifdef ESP_PLATFORM
    task_yield();
  #else
    struct timespec ts;
    ts.tv_sec = 0;
    ts.tv_nsec = 1000000; /* 1 ms */
    nanosleep(&ts, NULL);
  #endif
}

int net_any_pending (void) {
  /* Native builds never suspend on idle, so always report "pending". */
  return 1;
}

#endif /* !WASM */
