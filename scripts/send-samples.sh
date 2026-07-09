#!/usr/bin/env bash
# Feed the ArcVault sample messages to the running n8n intake webhook.
#
# Usage:
#   bash scripts/send-samples.sh                 # -> production webhook (default)
#   WEBHOOK_URL=... bash scripts/send-samples.sh # -> custom URL
#   RUN=2 bash scripts/send-samples.sh           # tag a run number (consistency test, task 3.2)
#   INCLUDE_DEMO=0 bash scripts/send-samples.sh  # skip msg-006 synthetic demo-extra
#   OUT_DIR=output/raw bash scripts/send-samples.sh  # also save each response to OUT_DIR/<id>.json
#
# n8n webhook URLs (path 'intake'):
#   production : http://localhost:5678/webhook/intake      (workflow must be Active)
#   test       : http://localhost:5678/webhook-test/intake ("Listen for test event" armed)
set -euo pipefail

WEBHOOK_URL="${WEBHOOK_URL:-http://localhost:5678/webhook/intake}"
RUN="${RUN:-1}"
INCLUDE_DEMO="${INCLUDE_DEMO:-1}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SAMPLES="$SCRIPT_DIR/../data/samples.json"

command -v jq >/dev/null || { echo "ERROR: jq required (pacman -S jq)"; exit 1; }

echo "== ArcVault sample feeder =="
echo "target : $WEBHOOK_URL"
echo "run    : $RUN   include-demo: $INCLUDE_DEMO  "
echo

count=$(jq 'length' "$SAMPLES")
for i in $(seq 0 $((count - 1))); do
  msg=$(jq -c ".[$i]" "$SAMPLES")
  id=$(echo "$msg" | jq -r '.id')
  demo=$(echo "$msg" | jq -r '.demoExtra // false')

  if [ "$demo" = "true" ] && [ "$INCLUDE_DEMO" != "1" ]; then
    echo "-- skip $id (demo-extra)"; continue
  fi

  # inject run tag so repeat runs are distinguishable in the sheet/consistency log
  payload=$(echo "$msg" | jq -c --arg run "$RUN" '. + {run: ($run|tonumber)}')

  echo "-- POST $id (run $RUN)"
  http_code=$(curl -sS -o /tmp/arcvault_resp.json -w "%{http_code}" \
    -X POST "$WEBHOOK_URL" \
    -H 'Content-Type: application/json' \
    -d "$payload" || echo "000")
  echo "   HTTP $http_code"
  if [ -n "${OUT_DIR:-}" ]; then
    mkdir -p "$OUT_DIR"
    cp /tmp/arcvault_resp.json "$OUT_DIR/$id.json"
  fi
  jq . /tmp/arcvault_resp.json 2>/dev/null || cat /tmp/arcvault_resp.json
  echo
done

echo "== done: $count messages processed =="
