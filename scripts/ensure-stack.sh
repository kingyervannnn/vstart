#!/usr/bin/env bash
set -euo pipefail

# Bring up local voice services and app stack so the UI works after rebuilds.

# 1) Ensure STT (Faster-Whisper) on host
if [ -x "$HOME/Desktop/sys/voice/STT/stt" ]; then
  export STT_HOST=${STT_HOST:-0.0.0.0}
  export STT_TOKEN=${STT_TOKEN:-stt-local}
  export IDLE_TIMEOUT_SEC=${IDLE_TIMEOUT_SEC:-3600}
  "$HOME/Desktop/sys/voice/STT/stt" ensure || true
fi

# 2) Ensure XTTS on host (optional)
if [ -x "$HOME/Desktop/sys/xtts/xtts" ]; then
  "$HOME/Desktop/sys/xtts/xtts" ensure || true
fi

# 3) Recreate containers with healthchecks
if command -v docker-compose >/dev/null 2>&1; then
  docker-compose up -d ai-api voice-api vivaldi-hybrid-startpage
  echo "Waiting for services…"
  sleep 2
  # Probe through nginx
  curl -sf http://localhost:3000/ai/health >/dev/null || true
  curl -sf http://localhost:3000/api/health >/dev/null || true
  curl -sf http://localhost:3000/stt/health >/dev/null || true
fi

echo "✅ Stack ensure complete"

