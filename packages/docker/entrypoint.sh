#!/bin/sh

set -eu

vision_proxy_pid=
if [ -f /app/python/qwen_vision_proxy.py ]; then
  python3 /app/python/qwen_vision_proxy.py &
  vision_proxy_pid=$!
else
  echo "vision proxy script not found; starting Node service only" >&2
fi

cleanup() {
  if [ "${vision_proxy_pid:-}" ]; then
    kill -TERM "$vision_proxy_pid" 2>/dev/null || true
  fi
  if [ "${node_pid:-}" ]; then
    kill -TERM "$node_pid" 2>/dev/null || true
  fi
}

trap cleanup INT TERM EXIT

node /app/dist/main.js &
node_pid=$!

wait "$node_pid"
