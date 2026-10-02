#!/usr/bin/env bash
# 部署 bareiron-in-web 的 Web 面板(serve) 到本机。
#
# 架构：浏览器以 WASM 直接运行一个 Tailscale 节点（tailscale-web），无需自建中继。
# 朋友的 Minecraft 客户端（同 tailnet）直接连浏览器节点的 100.x:25565；
# 数据面走 Tailscale 自己的 DERP-over-WSS。
#
# 前置：本机需能访问面板（可在本机用浏览器打开，或把面板托管到 tailnet IP）。
#   若想让其他设备访问面板，本机需已加入 tailnet（tailscale up），或用设备接入密钥加入：
#     sudo tailscale up --authkey tskey-auth-xxxx   （密钥在 .codebuddy/memory/ts_auth_key.txt）
#
# 用法：
#   bash deploy.sh            # 自动取本机 tailnet IP（用于托管面板）
#   bash deploy.sh 100.1.2.3  # 手动指定 tailnet IP
#
# 说明：relay.js 现已不再是必需组件（浏览器内 Tailscale 直连），保留仅作可选回退。
set -e
cd "$(dirname "$0")"

TSIP="${1:-$(tailscale ip -1 2>/dev/null | head -1)}"
if [ -z "$TSIP" ]; then
  echo "无法确定 tailnet IP；本机托管可忽略，或手动传入: bash deploy.sh 100.81.92.74" >&2
  TSIP="127.0.0.1"
fi
echo "面板托管地址(可选): $TSIP:8090"

pkill -f "node serve.js" 2>/dev/null || true
sleep 0.3

setsid nohup node serve.js 8090 --host "$TSIP" > /tmp/serve.log 2>&1 &
sleep 1.5

echo "--- serve.log ---"; cat /tmp/serve.log
echo
echo "== 使用方式 =="
echo "1) 浏览器打开面板:  http://$TSIP:8090/   （本机访问可用 http://127.0.0.1:8090/）"
echo "2) 点击“连接 Tailscale 并启动”，在弹出的 Tailscale 登录页完成登录"
echo "3) 登录后面板显示本节点 100.x IP；朋友用 Minecraft(Java 1.21.8) 直连: <面板显示的100.x IP>:25565"
echo "   （朋友必须也在同一 tailnet）"
