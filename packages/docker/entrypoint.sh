#!/bin/sh

set -u

vision_proxy_pid=
if [ -f /app/python/qwen_vision_proxy.py ]; then
  /opt/vision-venv/bin/python /app/python/qwen_vision_proxy.py &
  vision_proxy_pid=$!
else
  echo "vision proxy script not found; starting Node service only" >&2
fi

node_pid=
cleaned_up=false

wait_for_pid() {
  pid="${1:-}"
  if [ -n "$pid" ]; then
    wait "$pid" 2>/dev/null || true
  fi
}

cleanup() {
  if [ "$cleaned_up" = true ]; then
    return
  fi
  cleaned_up=true
  trap - INT TERM EXIT

  if [ "${vision_proxy_pid:-}" ]; then
    kill -TERM "$vision_proxy_pid" 2>/dev/null || true
  fi
  if [ "${node_pid:-}" ]; then
    kill -TERM "$node_pid" 2>/dev/null || true
  fi

  wait_for_pid "${node_pid:-}"
  wait_for_pid "${vision_proxy_pid:-}"
}

trap cleanup INT TERM EXIT

node /app/dist/main.js &
node_pid=$!

node_exit=0
wait "$node_pid" || node_exit=$?
cleanup
exit "$node_exit"
