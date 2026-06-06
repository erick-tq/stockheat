#!/bin/bash
# StockHeat - 一键启动 + 生成公开分享链接
cd "$(dirname "$0")"

echo "📡 启动 StockHeat 后端..."
node server.js &
SERVER_PID=$!
sleep 2

echo ""
echo "🌐 生成公开分享链接..."
echo "   (首次访问需要输入你的公网IP以通过验证)"
echo ""

# Start localtunnel
npx --yes localtunnel --port 3456 2>&1 | while read line; do
  echo "$line"
  if [[ "$line" == *"your url is:"* ]]; then
    URL=$(echo "$line" | grep -o 'https://[^ ]*')
    echo ""
    echo "=================================="
    echo "  分享这个链接给别人:"
    echo "  📎 $URL"
    echo "=================================="
    echo ""
  fi
done &
TUNNEL_PID=$!

# Open local page
open "http://localhost:3456"

echo "按 Ctrl+C 停止所有服务"

trap "echo '停止服务...'; kill $SERVER_PID $TUNNEL_PID 2>/dev/null; exit 0" INT TERM
wait
