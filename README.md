# bareiron in web

把纯 C 的 Minecraft 服务器 [`bareiron`](https://github.com/p2r3/bareiron) 编译为 **WebAssembly**，直接在**浏览器**里运行一个可被外部 Minecraft 客户端连接的服务器；并通过 **`tailscale-web`** 在浏览器内直接运行一个 **Tailscale 节点** 来接收连接——**全程不需要你自建任何中继服务器**。

> 上游 `bareiron` 是一个面向内存受限嵌入式设备（如 ESP32）的极简 Minecraft 1.21.8（协议 772）服务器。本项目复用其 C 核心，仅替换网络层与运行环境。

---

## 架构

```
Minecraft 客户端（在 tailnet 上）
        │ TCP 25565
        ▼
浏览器内的 Tailscale 节点（tailscale-web，WASM）
        │ listenTCP(25565)
        ▼
bareiron (C→WASM + Asyncify)  ← 真正的 Minecraft 服务器，跑在浏览器里
```

- **bareiron 核心**：C 代码用 Emscripten 编译为 WASM，网络通过 `EM_JS` 桥接层（`src/web/bridge.js`）交给 JS。
- **网络（无中继）**：浏览器以 WASM 直接运行 Tailscale 设备（[`tailscale-web`](https://github.com/adrianosela/tailscale-web)），拿到 `100.x` 的 tailnet IP 并 `listenTCP(25565)`。同 tailnet 的朋友用原生 Minecraft Java 版（1.21.8）直连 `<浏览器节点IP>:25565`；数据面走 Tailscale 自己的 DERP-over-WSS，**不经过你自建的服务器**。
- **面板**：`src/web/` 下的 GitHub 风格、中英双语控制台（左侧栏 + 内容列 + 底部命令栏），展示实时日志、在线玩家/连接、运行状态，并负责触发 Tailscale 登录。

---

## 构建 WASM

需要 [Emscripten](https://emscripten.org/)：

```bash
cd src/web
./build_wasm.sh        # 产出 dist/bareiron.js + dist/bareiron.wasm
```

（C 核心的编译/注册表导出等沿用上游 `build.sh` / `extract_registries.sh` / `build_registries.js`，详见上游 README。）

---

## 运行面板

面板只需一个静态文件服务器（`src/web/serve.js`，基于 Node，默认端口 8090）：

```bash
cd src/web
bash deploy.sh                 # 自动取本机 tailnet IP 并启动 serve.js（可选绑定）
# 或本机直接：
node serve.js 8090             # 浏览器打开 http://127.0.0.1:8090/
```

`deploy.sh` 仅托管 Web 面板。中继（`relay.js`）**已不再是必需组件**，保留仅作可选回退。

### 使用步骤

1. 浏览器打开面板（本机可用 `http://127.0.0.1:8090/`，或部署机上用其 tailnet IP）。
2. 点击 **“连接 Tailscale 并启动”**：面板会按需从 `esm.sh` 动态加载 `tailscale-web`（约 35MB，首次较慢），并弹出 **Tailscale 登录链接**。
3. 在新标签页完成 OAuth 登录（用你拥有该 tailnet 的账号）。登录后浏览器内节点拿到 `100.x` IP 并开始监听 `25565`。
4. 面板显示 **“朋友连接地址 = <100.x IP>:25565”**。把该地址发给同在 tailnet 的朋友，用原生 Minecraft(Java 1.21.8) 直连即可。

---

## 目录结构

```
src/web/
├── index.html        # GitHub 风格、中英双语控制台页面
├── styles.css        # 设计语言（亮/暗主题，CSS 变量）
├── app.js            # ES module：UI 逻辑 + Tailscale 启动 + 实时刷新
├── bridge.js         # JS 桥接层：RelayBackend(可选回退) + TailscaleBackend
├── serve.js          # 静态文件服务器（托管面板）
├── relay.js          # 可选回退：纯 Node TCP↔WS 中继（本项目默认不用）
├── deploy.sh         # 一键启动面板
└── dist/             # 编译产物 bareiron.{js,wasm}
```

---

## 控制台功能

- **概览**：在线玩家数 / 运行时长 / 累计连接 / 总流量 / 世界种子（Hero 卡片），快速操作（启动、停止、复制地址、清空日志），实时控制台（bareiron 的 stdout）。
- **玩家 / 连接**：浏览器内 Tailscale 节点的实时连接（地址、在线时长、流量），昵称取自服务器日志。
- **运行状态**：版本、端口、传输方式、tailnet IP、种子、累计连接、流量、健康度。
- **Tailscale**：登录状态、朋友连接地址、本节点 tailnet IP。
- **世界 / 关于**：版本信息、持久化（IDBFS，浏览器内）。
- **语言**：侧栏底部可切换 **中文 / English**，所有界面文案与提示实时切换（偏好存入 `localStorage`）。

> 说明：当前构建未实现浏览器内控制台输入（RCON）。启动后请使用原生 Minecraft 客户端连入；底部命令栏仅作界面演示。

---

## 已知约束 / 备注

- `tailscale-web` 经 `https://esm.sh/tailscale-web` 加载（首次约 35MB）。若网络无法访问 esm.sh，可在 `app.js` 顶部修改 `TS_MODULE_URL`，或自托管该 wasm。
- 浏览器内 Tailscale 走交互式 OAuth（登录拥有 tailnet 的账号），不使用设备接入密钥（authkey）。
- 浏览器无法做 UDP，数据面经 Tailscale 的 DERP-over-WSS（Tailscale 自有基础设施），延迟高于纯 P2P，但功能完整且无需自建中继。
- 单实例：停止后需刷新页面重新加载（当前 WASM 构建为单例）。
- ⚠️ **实测结论（2026-10-02）**：浏览器内 Tailscale 的 WASM **已确认能加载并启动**（日志 `WASM ready` → `Engine created` → 节点进入 `NeedsLogin`）。此前登录页不弹出的根因是**面板以 HTTP 不安全上下文提供**——`tailscale-web` 做 Noise 握手依赖 `crypto.subtle`，而该 API 仅在安全上下文（HTTPS）可用，于是控制平面 `wss://controlplane.tailscale.com/ts2021` 握手即断。改为 HTTPS（如 GitHub Pages）即可。
- **部署即修复**：见下方“部署 / GitHub Pages”。仓库已含 `.github/workflows/deploy.yml`，推送 `main` 即构建并发布到 GH Pages（`https://<user>.github.io/<repo>/`），自动获得安全上下文，`tailscale-web` 可正常工作。
- **可选：自建控制平面**：`tailscale-web` 支持 `network.init({ controlUrl })` 指向自建 **Headscale**。在面板地址后加 `?controlUrl=https://你的-headscale` 再点“连接并启动”即可；仅在你确有需要时使用。

## Tailscale 登录失败排查

- 控制台出现 `WebSocket ... controlplane.tailscale.com ... failed` → 浏览器连不上 Tailscale 控制平面（网络封锁/代理）。先在浏览器里直接打开 `https://login.tailscale.com` 验证。
- 解决：① 本机用 VPN/代理使浏览器能直连 Tailscale；或 ② 自建 Headscale 并用 `?controlUrl=` 指向它。
- `onAuthRequired(url)` 被触发时，面板会自动 `window.open` 登录页并同时在“Tailscale”视图给出可点击链接。
- 若 `tailscale-web` 经 `esm.sh` 加载失败，可在 `app.js` 顶部改 `TS_MODULE_URL`，或自托管该 wasm。

---

## 部署 / GitHub Pages

面板是纯静态文件（`src/web/`：`index.html`、`app.js`、`bridge.js`、`styles.css`、`dist/bareiron.{js,wasm}`）。`tailscale-web` 运行时从 `esm.sh` 动态加载，无需打包。

因 `tailscale-web` 需要 **HTTPS 安全上下文**，请通过 GitHub Pages 提供（不要用 `http://localhost` 或 `http://<IP>` 直接打开）：

1. 推送 `main` 触发 `.github/workflows/deploy.yml`，它会把 `src/web` 发布到 GitHub Pages。
2. 仓库 **Settings → Pages → Source** 选择 **GitHub Actions**。
3. 稍候片刻，访问 `https://<user>.github.io/<repo>/`，点 “Connect Tailscale & start”，在弹出的 Tailscale 登录页完成 OAuth 即可。
4. 登录后页面显示本节点 `100.x` IP；朋友用 Minecraft(Java 1.21.8) 直连 `<100.x IP>:25565`（须同在 tailnet）。

> 本地想用 HTTPS 自测：`node src/web/serve.js 8090 --https`（需 `certs/` 下的证书）。

---

## 致谢

- 服务器核心：[`bareiron`](https://github.com/p2r3/bareiron)（p2r3）。
- 浏览器内 Tailscale 节点：[`tailscale-web`](https://github.com/adrianosela/tailscale-web)（adrianosela）。
