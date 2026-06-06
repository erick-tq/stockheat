#!/bin/bash
# StockHeat - 板块ETF热度雷达 启动脚本

echo "📡 启动 StockHeat 后端服务..."
cd "$(dirname "$0")"

# Start backend
node server.js &
SERVER_PID=$!
echo "后端 PID: $SERVER_PID"

# Wait for server to start
sleep 2

# Open browser
echo "🌐 打开浏览器..."
open "http://localhost:3456"

echo ""
echo "=================================="
echo "  StockHeat 已启动!"
echo "  后端 API: http://localhost:3456/api/stockheat"
echo "  前端页面: http://localhost:3456"
echo "  按 Ctrl+C 停止"
echo "=================================="

# Wait for interrupt
trap "echo '停止服务...'; kill $SERVER_PID 2>/dev/null; exit 0" INT TERM
wait $SERVER_PID
