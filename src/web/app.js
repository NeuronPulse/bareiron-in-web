/*
 * app.js — bareiron in web 控制台（中英双语 / GitHub 风格字段）
 *
 * 传输：浏览器以 WASM 运行 Tailscale 设备（tailscale-web），拿到 100.x IP 并 listenTCP(25565)。
 * 朋友（同 tailnet）直连该 IP，数据面走 Tailscale 自有 DERP-over-WSS —— 无自建中继。
 * 启动时通过 bridge.setBackend(new Bridge.TailscaleBackend(network)) 注入。
 *
 * 诚实说明：浏览器内 Tailscale 客户端的集成代码已写好，但端到端未经本环境实测
 *（沙箱无法启动服务、也无法加载 35MB wasm）。API 名称按 tailscale-web 文档假设。
 */
(function () {
  'use strict';

  const TS_MODULE_URL = 'https://esm.sh/tailscale-web';
  // 自定义控制平面：在地址后加 ?controlUrl=https://你的-headscale 即可改用自建
  // Headscale（绕开对 controlplane.tailscale.com 的网络封锁）。
  const CONTROL_URL = new URLSearchParams(location.search).get('controlUrl') || '';

  const $ = (id) => document.getElementById(id);
  const B = window.BareironBridge;
  const root = document.documentElement;
  const app = $('app');

  /* ============================================================
     双语文案（zh / en）
     ============================================================ */
  const I18N = {
    zh: {
      'title': 'bareiron in web · 控制台',
      'sb.server': '服务器', 'sb.manage': '管理',
      'nav.bareiron': 'bareiron', 'nav.players': '玩家 / 连接', 'nav.status': '运行状态',
      'nav.network': 'Tailscale', 'nav.world': '世界', 'nav.about': '关于',
      'nav.overview': '概览', 'product.name': 'bareiron in web',
      'top.connect': '连接 Tailscale 并启动', 'top.stop': '停止',
      'overview.sub': 'Minecraft 1.21.8 · 协议 772',
      'hero.lab': '玩家 / 连接',
      'm.uptime': '运行时长', 'm.conns': '累计连接', 'm.bytes': '总流量', 'm.seed': '世界种子',
      'sec.actions': '快速操作', 'sec.players': '在线玩家 / 连接', 'sec.console': '实时控制台',
      'act.start': '启动 / 连接', 'act.stop': '停止', 'act.copy': '复制地址', 'act.clear': '清空日志',
      'term.clear': '清空',
      'players.desc': '来自浏览器内 Tailscale 节点的实时连接（地址、时长、流量）。玩家昵称取自服务器日志。',
      'status.title': '运行状态',
      'kv.version': '版本', 'kv.port': '监听端口', 'kv.transport': '传输方式', 'kv.relay': '中继地址',
      'kv.tailip': 'tailnet IP', 'kv.seed': '世界种子', 'kv.rng': 'RNG 种子', 'kv.uptime': '运行时长',
      'kv.totalConns': '累计连接', 'kv.bytes': '总流量', 'kv.health': '运行健康',
      'network.title': 'Tailscale（浏览器内节点）', 'network.tag': '无中继',
      'network.desc': '浏览器内 WASM 运行 Tailscale 节点（tailscale-web），获取 <code>100.x</code> IP 并监听 <code>25565</code>；同 tailnet 的 MC 客户端直连 <code>&lt;本节点IP&gt;:25565</code>。',
      'net.notConnected': '未连接 Tailscale',
      'net.authRequired': '需要登录 Tailscale',
      'net.loginHere': '点击此处登录',
      'net.loggedIn': '已登录 Tailscale',
      'net.node': 'Tailscale（浏览器内 wasm 节点）',
      'net.direct': 'Tailscale 直连（无中继）',
      'kv.peer': '朋友连接地址', 'kv.nodeip': '本节点 tailnet IP',
      'world.title': '世界', 'world.protocol': '协议版本', 'world.seed': '世界种子', 'world.persist': '持久化',
      'world.persistVal': 'IDBFS（浏览器内）',
      'about.title': '关于',
      'about.desc': 'bareiron（纯 C 的 Minecraft 1.21.8 服务器）编译为 WASM 在浏览器运行；tailscale-web 在浏览器内运行 Tailscale 节点，无需自建中继。',
      'composer.ph': '命令输入（bareiron 暂未开放浏览器内控制台输入）',
      'composer.disclaimer': '提示：当前构建未实现浏览器内控制台输入；启动后请使用原生 Minecraft 客户端连入。',
      'lang.switch': 'English',
      'online': '在线', 'noConn': '暂无连接',
      'status.offline': '离线', 'status.connecting': '连接中…', 'status.online': '运行中',
      'log.ready': '就绪。点击“连接 Tailscale 并启动”，登录后朋友即可直连。',
      'toast.cleared': '控制台已清空',
      'toast.alreadyRun': '服务器已在运行',
      'toast.noBackend': '桥接层未加载（bridge.js）',
      'toast.loadingTS': '正在加载浏览器内 Tailscale（wasm，约 35MB，首次较慢）…',
      'toast.tsFail': '加载 tailscale-web 失败：',
      'toast.tsFailHint': '请检查网络是否能访问 esm.sh，或在 app.js 顶部修改 TS_MODULE_URL。',
      'toast.noModule': 'WASM 模块未加载（dist/bareiron.js）',
      'toast.started': 'bareiron 模块已启动，等待 Tailscale 登录与监听…',
      'toast.moduleErr': '模块异常: ',
      'toast.moduleStartFail': '模块启动失败: ',
      'toast.stopHint': '停止需刷新页面重新加载（当前构建为单实例）。',
      'toast.copyOk': '已复制：',
      'toast.copyNone': '尚无连接地址（请先登录 Tailscale）',
      'toast.copyFail': '复制失败：',
      'toast.cmdEmpty': '先输入一条指令',
      'toast.cmdNoInput': 'bareiron 暂未开放浏览器内控制台输入（RCON 未实现）',
      'toast.themeLight': '已切换到浅色',
      'toast.themeDark': '已切换到深色',
      'toast.langZh': '已切换到中文',
      'toast.langEn': 'Switched to English',
      'toast.authRequired': '需要在 Tailscale 完成登录：',
      'toast.authDone': 'Tailscale 登录完成，正在建立监听…',
      'toast.tsErr': 'Tailscale 错误：',
      'toast.tsIp': '本节点 tailnet IP：',
    },
    en: {
      'title': 'bareiron in web · Console',
      'sb.server': 'Server', 'sb.manage': 'Manage',
      'nav.bareiron': 'bareiron', 'nav.players': 'Players / connections', 'nav.status': 'Status',
      'nav.network': 'Tailscale', 'nav.world': 'World', 'nav.about': 'About',
      'nav.overview': 'Overview', 'product.name': 'bareiron in web',
      'top.connect': 'Connect Tailscale & start', 'top.stop': 'Stop',
      'overview.sub': 'Minecraft 1.21.8 · protocol 772',
      'hero.lab': 'Players / connections',
      'm.uptime': 'Uptime', 'm.conns': 'Total connections', 'm.bytes': 'Total traffic', 'm.seed': 'World seed',
      'sec.actions': 'Quick actions', 'sec.players': 'Online players / connections', 'sec.console': 'Live console',
      'act.start': 'Start / connect', 'act.stop': 'Stop', 'act.copy': 'Copy address', 'act.clear': 'Clear log',
      'term.clear': 'Clear',
      'players.desc': 'Live connections from the in-browser Tailscale node (address, duration, traffic). Player names come from server logs.',
      'status.title': 'Status',
      'kv.version': 'Version', 'kv.port': 'Listen port', 'kv.transport': 'Transport', 'kv.relay': 'Relay address',
      'kv.tailip': 'tailnet IP', 'kv.seed': 'World seed', 'kv.rng': 'RNG seed', 'kv.uptime': 'Uptime',
      'kv.totalConns': 'Total connections', 'kv.bytes': 'Total traffic', 'kv.health': 'Health',
      'network.title': 'Tailscale (in-browser node)', 'network.tag': 'No relay',
      'network.desc': 'In-browser WASM Tailscale node (tailscale-web): gets a <code>100.x</code> IP and listens on <code>25565</code>; peers on the same tailnet connect directly to <code>&lt;node IP&gt;:25565</code>.',
      'net.notConnected': 'Not connected to Tailscale',
      'net.authRequired': 'Tailscale login required',
      'net.loginHere': 'Click here to log in',
      'net.loggedIn': 'Logged in to Tailscale',
      'net.node': 'Tailscale (in-browser wasm node)',
      'net.direct': 'Tailscale direct (no relay)',
      'kv.peer': 'Friend connect address', 'kv.nodeip': 'This node tailnet IP',
      'world.title': 'World', 'world.protocol': 'Protocol version', 'world.seed': 'World seed', 'world.persist': 'Persistence',
      'world.persistVal': 'IDBFS (in-browser)',
      'about.title': 'About',
      'about.desc': 'bareiron (a pure-C Minecraft 1.21.8 server) compiled to WASM and run in the browser; tailscale-web runs a Tailscale node in-browser, no self-hosted relay needed.',
      'composer.ph': 'Command input (bareiron does not yet expose in-browser console input)',
      'composer.disclaimer': 'Note: this build does not yet expose in-browser console input; use a native Minecraft client after starting.',
      'lang.switch': '中文',
      'online': 'online', 'noConn': 'No connections',
      'status.offline': 'Offline', 'status.connecting': 'Connecting…', 'status.online': 'Running',
      'log.ready': 'Ready. Click "Connect Tailscale & start"; friends can connect after login.',
      'toast.cleared': 'Console cleared',
      'toast.alreadyRun': 'Server already running',
      'toast.noBackend': 'Bridge layer not loaded (bridge.js)',
      'toast.loadingTS': 'Loading in-browser Tailscale (wasm, ~35MB, slow on first load)…',
      'toast.tsFail': 'Failed to load tailscale-web: ',
      'toast.tsFailHint': 'Check network access to esm.sh, or edit TS_MODULE_URL at top of app.js.',
      'toast.noModule': 'WASM module not loaded (dist/bareiron.js)',
      'toast.started': 'bareiron module started, waiting for Tailscale login & listen…',
      'toast.moduleErr': 'Module error: ',
      'toast.moduleStartFail': 'Module start failed: ',
      'toast.stopHint': 'Stop requires reloading the page (current build is single-instance).',
      'toast.copyOk': 'Copied: ',
      'toast.copyNone': 'No connect address yet (login to Tailscale first)',
      'toast.copyFail': 'Copy failed: ',
      'toast.cmdEmpty': 'Enter a command first',
      'toast.cmdNoInput': 'bareiron does not yet expose in-browser console input (RCON not implemented)',
      'toast.themeLight': 'Switched to light',
      'toast.themeDark': 'Switched to dark',
      'toast.langZh': '已切换到中文',
      'toast.langEn': 'Switched to English',
      'toast.authRequired': 'Tailscale login required: ',
      'toast.authDone': 'Tailscale login complete, setting up listener…',
      'toast.tsErr': 'Tailscale error: ',
      'toast.tsIp': 'This node tailnet IP: ',
    },
  };

  let LANG = localStorage.getItem('lang') || 'zh';
  function t(k) {
    if (I18N[LANG] && I18N[LANG][k] != null) return I18N[LANG][k];
    if (I18N.zh[k] != null) return I18N.zh[k];
    return k;
  }
  function applyLang() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const k = el.getAttribute('data-i18n');
      if (el.hasAttribute('data-i18n-html')) el.innerHTML = t(k);
      else el.textContent = t(k);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
    });
    root.lang = (LANG === 'zh') ? 'zh-CN' : 'en';
    document.title = t('title');
  }

  const state = {
    started: false, listening: false, listenAt: 0, lastActivity: 0,
    worldSeed: null, rngSeed: null, names: [], totalConns: 0, conns: [], tailIp: '',
    authState: 'none', authUrl: '',
  };

  const els = {
    statusBadge: $('status-badge'), statusText: $('status-text'),
    connectBtn: $('connect-btn'), stopBtn: $('stop-btn'),
    connectBtn2: $('connect-btn-2'), stopBtn2: $('stop-btn-2'),
    copyPeer: $('copy-peer'), clearLog: $('clear-log'),
    tsLogin: $('ts-login'), peerAddr: $('peer-addr'), tsIp: $('ts-ip'),
    termBody: $('termBody'),
    heroPlayers: $('hero-players'),
    mUptime: $('m-uptime'), mConns: $('m-conns'), mBytes: $('m-bytes'), mSeed: $('m-seed'),
    players: $('players'), players2: $('players-2'),
    playersCount: $('players-count'), playersTag: $('players-count-tag'),
    kvTransport: $('kv-transport'), kvRelay: $('kv-relay'), kvTailip: $('kv-tailip'),
    kvSeed: $('kv-seed'), kvRng: $('kv-rng'), kvUptime: $('kv-uptime'),
    kvTotalConns: $('kv-totalConns'), kvBytes: $('kv-bytes'), kvHealth: $('kv-health'),
    kvSeed2: $('kv-seed-2'),
    pageTitle: $('page-title'),
    composer: $('composer'), send: $('send'),
    langBtn: $('lang-btn'),
  };

  /* ---------- Tailscale <-> UI 钩子 ---------- */
  function renderTsLogin() {
    if (state.authState === 'required' && state.authUrl) {
      els.tsLogin.innerHTML = t('net.authRequired') + '：<a id="ts-login-link" href="' +
        escapeHtml(state.authUrl) + '" target="_blank" rel="noopener">' + t('net.loginHere') + ' ↗</a>';
    } else if (state.authState === 'done') {
      els.tsLogin.textContent = t('net.loggedIn');
    } else {
      els.tsLogin.textContent = t('net.notConnected');
    }
  }
  window.__bareironOnAuth = (url) => {
    state.authUrl = url; state.authState = 'required';
    renderTsLogin();
    appendLog(t('toast.authRequired') + url, 'sys');
    setStatus('connecting');
  };
  window.__bareironOnAuthComplete = () => {
    state.authState = 'done';
    renderTsLogin();
    appendLog(t('toast.authDone'), 'sys');
  };
  window.__bareironOnIP = (ip) => {
    if (!ip) return;
    state.tailIp = ip;
    els.tsIp.textContent = ip;
    els.peerAddr.textContent = ip + ':25565';
    els.kvTailip.textContent = ip;
    els.kvRelay.textContent = t('net.direct');
    appendLog(t('toast.tsIp') + ip, 'sys');
  };
  window.__bareironOnError = (e) => {
    const msg = (e && e.message) ? e.message : String(e);
    appendLog(t('toast.tsErr') + msg, 'err');
    const blocked = /controlplane\.tailscale\.com|closed network connection|use of closed|failed to WebSocket dial|60 seconds|auth url|timed out/i.test(msg);
    if (blocked) {
      const tip = (LANG === 'zh')
        ? '无法连接 Tailscale 控制平面（controlplane.tailscale.com）。你的网络可能屏蔽了 Tailscale。可改用自建 Headscale：在页面地址后加 ?controlUrl=https://你的-headscale 再启动。'
        : 'Cannot reach Tailscale control plane (controlplane.tailscale.com). Your network may be blocking Tailscale. Use a self-hosted Headscale: append ?controlUrl=https://your-headscale to the page URL, then start.';
      appendLog(tip, 'warn');
      els.tsLogin.textContent = (LANG === 'zh') ? '无法连接 Tailscale 控制平面' : 'Cannot reach Tailscale control plane';
    }
  };
  window.__bareironOnConn = (fd, kind) => {
    if (kind === 'open') { state.totalConns++; }
  };

  /* ---------- 视图路由 ---------- */
  const VTITLE = {
    overview: 'product.name', players: 'nav.players', status: 'status.title',
    network: 'network.title', world: 'world.title', about: 'about.title',
  };
  function showView(name) {
    document.querySelectorAll('.sb-item[data-view]').forEach((a) =>
      a.classList.toggle('active', a.dataset.view === name));
    document.querySelectorAll('.view').forEach((v) =>
      v.classList.toggle('active', v.id === 'view-' + name));
    if (VTITLE[name]) els.pageTitle.textContent = t(VTITLE[name]);
  }
  document.querySelectorAll('.sb-item[data-view]').forEach((a) =>
    a.addEventListener('click', () => showView(a.dataset.view)));

  /* ---------- 状态 ---------- */
  function setStatus(name) {
    const map = { online: ['status.online', false], connecting: ['status.connecting', false], offline: ['status.offline', true] };
    const [key, off] = map[name] || map.offline;
    els.statusText.textContent = t(key);
    els.statusBadge.classList.toggle('off', !!off);
  }

  /* ---------- 工具 ---------- */
  function now() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return '[' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + ']';
  }
  function humanBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
  }
  function humanDuration(ms) {
    if (ms <= 0) return '0s';
    const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (h) return h + 'h ' + m + 'm';
    if (m) return m + 'm ' + sec + 's';
    return sec + 's';
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ---------- 日志 ---------- */
  const term = els.termBody;
  function appendLog(text, level) {
    const cls = ({ warn: 't-warn', err: 't-err', sys: 't-ok' })[level] || 't-info';
    const tm = now();
    for (const ln of String(text).split('\n')) {
      const div = document.createElement('div');
      div.className = 'l';
      div.innerHTML = '<span class="t-time">' + tm + '</span> <span class="' + cls + '">' + escapeHtml(ln) + '</span>';
      term.appendChild(div);
    }
    while (term.childElementCount > 300) term.removeChild(term.firstChild);
    term.scrollTop = term.scrollHeight;
  }
  function logCmd(text) {
    const div = document.createElement('div');
    div.className = 'l t-cmd';
    div.textContent = text;
    term.appendChild(div);
    term.scrollTop = term.scrollHeight;
  }

  function parseLog(s, isErr) {
    appendLog(s, isErr ? 'err' : null);
    state.lastActivity = Date.now();
    let m;
    if ((m = s.match(/World seed \(hashed\): ([0-9A-F]+)/))) {
      state.worldSeed = m[1];
      els.kvSeed.textContent = m[1]; els.mSeed.textContent = m[1]; els.kvSeed2.textContent = m[1];
    }
    if ((m = s.match(/RNG seed \(hashed\): ([0-9A-F]+)/))) {
      state.rngSeed = m[1]; els.kvRng.textContent = m[1];
    }
    if (s.includes('Server listening on port')) {
      state.listening = true; state.listenAt = Date.now(); setStatus('online');
    }
    if ((m = s.match(/Player name: (.*)/))) {
      const name = m[1].trim();
      if (name && !state.names.includes(name)) state.names.push(name);
    }
  }

  /* ---------- 玩家 / 连接 ---------- */
  function playerRow(c, i) {
    const name = state.names[i] || ('Tailscale 节点 #' + c.id);
    const addr = c.remote || 'Tailscale 对等节点';
    const dur = c.connectedAt ? humanDuration(Date.now() - c.connectedAt) : '—';
    const bytes = humanBytes((c.bytesIn || 0) + (c.bytesOut || 0));
    return '<div class="player" data-k="' + escapeHtml(name.toLowerCase()) + '">' +
      '<span class="p-skin"></span>' +
      '<div class="p-info"><div class="p-name">' + escapeHtml(name) + '</div>' +
      '<div class="p-meta">' + escapeHtml(addr) + ' · ' + t('m.uptime') + ' ' + dur + '</div></div>' +
      '<span class="ping"><i><b></b><b></b><b></b></i>' + bytes + '</span>' +
      '</div>';
  }
  function renderPlayers() {
    const rows = state.conns;
    els.playersCount.textContent = rows.length;
    els.playersTag.textContent = rows.length + ' ' + t('online');
    els.heroPlayers.innerHTML = rows.length + '<small> ' + t('online') + '</small>';
    if (!rows.length) {
      const empty = '<div class="player" style="justify-content:center;color:var(--text-3)">' + t('noConn') + '</div>';
      els.players.innerHTML = empty; els.players2.innerHTML = empty;
      return;
    }
    let html = '';
    rows.forEach((c, i) => { html += playerRow(c, i); });
    els.players.innerHTML = html; els.players2.innerHTML = html;
  }

  /* ---------- 实时刷新 ---------- */
  setInterval(() => {
    if (state.listening) {
      const u = humanDuration(Date.now() - state.listenAt);
      els.mUptime.textContent = u; els.kvUptime.textContent = u;
    }
    const stale = Date.now() - state.lastActivity > 6000;
    const health = !state.listening ? '—' : (stale ? '空闲' : '正常');
    els.kvHealth.textContent = (LANG === 'zh') ? health : (health === '空闲' ? 'Idle' : health === '正常' ? 'OK' : health);

    const be = window.__bareironBackend;
    if (be && typeof be.getConnections === 'function') {
      state.conns = be.getConnections();
      renderPlayers();
      let total = 0;
      for (const c of state.conns) total += (c.bytesIn || 0) + (c.bytesOut || 0);
      els.mBytes.textContent = humanBytes(total);
      els.kvBytes.textContent = humanBytes(total);
      els.mConns.textContent = state.totalConns;
      els.kvTotalConns.textContent = state.totalConns;
    }
  }, 2000);

  /* ---------- 启动 / 停止 ---------- */
  async function startServer() {
    if (state.started) { appendLog(t('toast.alreadyRun'), 'warn'); setStatus('online'); return; }
    setStatus('connecting');
    if (!B) { appendLog(t('toast.noBackend'), 'err'); setStatus('offline'); return; }

    appendLog(t('toast.loadingTS'), 'sys');
    let network;
    try {
      const mod = await import(TS_MODULE_URL);
      network = mod.network;
    } catch (e) {
      appendLog(t('toast.tsFail') + (e && e.message ? e.message : e), 'err');
      appendLog(t('toast.tsFailHint'), 'warn');
      setStatus('offline');
      return;
    }

    const backend = new B.TailscaleBackend(network, { controlUrl: CONTROL_URL });
    B.setBackend(backend);
    window.__bareironBackend = backend;

    const opts = {
      print: (s) => parseLog(s, false),
      printErr: (s) => parseLog(s, true),
      locateFile: (f) => 'dist/' + f,
    };
    try {
      if (typeof window.BareironModule !== 'function') {
        appendLog(t('toast.noModule'), 'err'); setStatus('offline'); return;
      }
      state.started = true;
      [els.connectBtn, els.connectBtn2].forEach((b) => b && (b.disabled = true));
      [els.stopBtn, els.stopBtn2].forEach((b) => b && (b.disabled = false));
      appendLog(t('toast.started'), 'sys');
      window.BareironModule(opts).catch((e) =>
        appendLog(t('toast.moduleErr') + (e && e.message ? e.message : e), 'err'));
    } catch (e) {
      appendLog(t('toast.moduleStartFail') + (e && e.message ? e.message : e), 'err');
      setStatus('offline');
    }
  }
  function stopServer() {
    appendLog(t('toast.stopHint'), 'warn');
  }

  /* ---------- Toast ---------- */
  const toasts = $('toasts');
  function toast(msg) {
    const el = document.createElement('div');
    el.className = 'toast'; el.textContent = msg;
    toasts.appendChild(el);
    setTimeout(() => { el.style.transition = 'opacity .22s,transform .22s'; el.style.opacity = '0'; el.style.transform = 'translateY(6px)'; }, 1600);
    setTimeout(() => el.remove(), 1860);
  }

  /* ---------- 主题 / 侧边栏 ---------- */
  $('theme').addEventListener('click', (e) => {
    e.stopPropagation();
    const dark = root.dataset.theme === 'dark';
    root.dataset.theme = dark ? 'light' : 'dark';
    toast(dark ? t('toast.themeLight') : t('toast.themeDark'));
  });
  $('collapse').addEventListener('click', () => { app.classList.add('collapsed'); $('expand').style.display = 'flex'; });
  $('expand').addEventListener('click', () => { app.classList.remove('collapsed'); $('expand').style.display = 'none'; });
  $('scrim').addEventListener('click', () => { app.classList.add('collapsed'); $('expand').style.display = 'flex'; });

  /* ---------- 语言切换 ---------- */
  els.langBtn.addEventListener('click', () => {
    LANG = (LANG === 'zh') ? 'en' : 'zh';
    localStorage.setItem('lang', LANG);
    applyLang();
    setStatus(state.listening ? 'online' : (state.started ? 'connecting' : 'offline'));
    renderTsLogin();
    els.kvTransport.textContent = t('net.node');
    if (state.tailIp) els.kvRelay.textContent = t('net.direct');
    renderPlayers();
    toast(LANG === 'zh' ? t('toast.langZh') : t('toast.langEn'));
  });

  /* ---------- 控制台 / Composer ---------- */
  $('clear-term').addEventListener('click', () => { term.innerHTML = ''; appendLog(t('toast.cleared'), 'sys'); });
  els.clearLog.addEventListener('click', () => { term.innerHTML = ''; appendLog(t('toast.cleared'), 'sys'); });
  els.copyPeer.addEventListener('click', async () => {
    const v = els.peerAddr.textContent;
    if (!v || v === '—') { toast(t('toast.copyNone')); return; }
    try { await navigator.clipboard.writeText(v); toast(t('toast.copyOk') + v); }
    catch (e) { toast(t('toast.copyFail') + v); }
  });
  els.connectBtn.addEventListener('click', startServer);
  if (els.connectBtn2) els.connectBtn2.addEventListener('click', startServer);
  els.stopBtn.addEventListener('click', stopServer);
  if (els.stopBtn2) els.stopBtn2.addEventListener('click', stopServer);

  const ci = els.composer;
  function execComposer() {
    const v = ci.value.trim(); if (!v) { toast(t('toast.cmdEmpty')); return; }
    logCmd(v); ci.value = '';
    toast(t('toast.cmdNoInput'));
  }
  els.send.addEventListener('click', execComposer);
  ci.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); execComposer(); } });

  /* ---------- 键盘 ---------- */
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === '/') {
      e.preventDefault(); app.classList.toggle('collapsed');
      $('expand').style.display = app.classList.contains('collapsed') ? 'flex' : 'none';
    }
  });

  /* ---------- 初始化 ---------- */
  applyLang();
  els.kvTransport.textContent = t('net.node');
  renderTsLogin();
  appendLog(t('log.ready'), 'sys');
  setStatus('offline');
  showView('overview');
})();
