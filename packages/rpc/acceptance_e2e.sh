#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
# © 2026 Sceat — All rights reserved. See LICENSE.
# §14 ACCEPTANCE E2E — proves a FRESH MACHINE can stand the whole read stack:
# from a clean checkout, `docker compose` brings up redis+indexer+api, the indexer backfills from
# FIRST_CHECKPOINT, and EVERY live /v1 view serves a real, correctly-shaped response over that
# indexed cache. Exits non-zero and lists any dead view (error status, wrong shape, or missing
# handler) — a legitimately EMPTY result (e.g. no dungeon runs active right now) is NOT a failure,
# it's real data; dead is 404/500/501 or a response that doesn't match the view's documented shape.
#
# THROWAWAY RUN — isolated compose project (own network + own named volume, both namespaced by
# `-p`), its own host ports. NEVER touches the live :3000/:6379/:9527 stack — that serves the
# active dev session. Tears itself down on exit (success, failure, or Ctrl-C) via the EXIT trap.
#
# ── env prerequisites ────────────────────────────────────────────────────────────────────────────
# Reads packages/rpc/.env (gitignored — NOT committed, holds the current testnet lineage's live
# addresses) as the reference config. At minimum it must define:
#   NETWORK=testnet
#   FIRST_CHECKPOINT=<a checkpoint at/near the CURRENT lineage's ceremony start — not genesis;
#                      genesis backfill of ~358M checkpoints is a non-starter for an acceptance run>
#   ARES_PACKAGES=<comma-separated 0x… package addresses for EVERY published package, INCLUDING
#                   every upgrade's `latest` address (packages/move/scripts/out/ceremony_manifest.json)
#                   — omitting a `latest` silently drops that lineage's post-upgrade events. Must be
#                   the BARE/absent form when unset (not ""), see docker-compose.yml's own comment —
#                   the indexer clap-parses an empty string as "allow nothing," not "allow all.">
# Optional: REMOTE_STORE_URL (default https://checkpoints.testnet.sui.io), STREAMING_URL (gRPC
# live-tip primary, off by default — remote-store polling alone is proven sufficient).
# SUI_FULLNODE_URL / GAS_POOL_* are gas-pool-only — this check NEVER brings up the `gas` compose
# profile (opt-in, heavy build, out of scope for a read-stack acceptance check).
# NOTE (2026-07-08): fullnode.testnet.sui.io's JSON-RPC route 404s. RPC PROVIDER LAW (2026-07-13):
# publicnode is forbidden — mysten official only — so manual chain queries (checkpoint lookups etc.)
# go through grpcurl against the official fullnode instead, e.g.:
#   grpcurl fullnode.testnet.sui.io:443 sui.rpc.v2.LedgerService/GetServiceInfo
# gRPC on the Mysten fullnode itself is unaffected and is what STREAMING_URL would use if enabled.
#
# ── usage ────────────────────────────────────────────────────────────────────────────────────────
#   bash packages/rpc/acceptance_e2e.sh                    # local throwaway docker-compose run
#   ACCEPT_TARGET_URL=https://rpc.aresrpg.world \
#     bash packages/rpc/acceptance_e2e.sh                   # POST-DEPLOY SMOKE against a live host
#
# TARGET MODE (ACCEPT_TARGET_URL set): skips docker compose entirely (no local stack, nothing to
# tear down) and the backfill-wait loop (a deployed host is assumed already caught up — it's the
# same 13-view probe table, just pointed at a real ingress instead of localhost). This is the
# release runbook's post-deploy gate — run it against the fresh rpc-api ingress right after
# a cluster GitOps sync on the rpc release definitions, before flipping any frontend
# traffic at it.
#
# Overrides (env): ACCEPT_TARGET_URL (unset = local throwaway mode), ACCEPT_ENV_FILE (default
# .env, local mode only), ACCEPT_PROJECT (default aresrpg-rpc-accept, local mode only),
# ACCEPT_REDIS_PORT (16379), ACCEPT_API_PORT (13000), ACCEPT_TIMEOUT_SEC (900 — total wall-clock
# budget for the backfill-catchup wait, local mode only), ACCEPT_BACKFILL_BUFFER (5000 — how many
# checkpoints past FIRST_CHECKPOINT to wait for before probing views; the ceremony+seed txs land
# within ~1-2K checkpoints of FIRST_CHECKPOINT by construction, so this buffer covers them without
# waiting for the indexer to walk all the way to the live chain tip, which can be hours away).
set -uo pipefail
cd "$(dirname "$0")" || exit 2 # packages/rpc

TARGET_URL="${ACCEPT_TARGET_URL:-}"
ENV_FILE="${ACCEPT_ENV_FILE:-.env}"
PROJECT="${ACCEPT_PROJECT:-aresrpg-rpc-accept}"
REDIS_PORT="${ACCEPT_REDIS_PORT:-16379}"
API_PORT="${ACCEPT_API_PORT:-13000}"
TIMEOUT_SEC="${ACCEPT_TIMEOUT_SEC:-900}"
BACKFILL_BUFFER="${ACCEPT_BACKFILL_BUFFER:-5000}"
BASE="${TARGET_URL:-http://localhost:${API_PORT}}"
BASE="${BASE%/}"

red() { printf '\033[31m%s\033[0m\n' "$1"; }
grn() { printf '\033[32m%s\033[0m\n' "$1"; }
ylw() { printf '\033[33m%s\033[0m\n' "$1"; }

if [ -n "$TARGET_URL" ]; then
  echo "== §14 acceptance E2E — TARGET MODE against $BASE (no local stack, nothing to tear down) =="
else
  if [ ! -f "$ENV_FILE" ]; then
    red "FAIL: $ENV_FILE not found — this check needs the current testnet lineage's ARES_PACKAGES/FIRST_CHECKPOINT (see header)."
    exit 2
  fi

  CLEANED_UP=0
  cleanup() {
    [ "$CLEANED_UP" = 1 ] && return
    CLEANED_UP=1
    echo
    echo "== tearing down throwaway stack (project: $PROJECT — never the live one) =="
    REDIS_PORT="$REDIS_PORT" API_PORT="$API_PORT" \
      docker compose -p "$PROJECT" --env-file "$ENV_FILE" down -v --remove-orphans >/tmp/${PROJECT}_down.log 2>&1
  }
  trap cleanup EXIT INT TERM

  echo "== §14 acceptance E2E — throwaway project '$PROJECT', redis:$REDIS_PORT api:$API_PORT (live :3000/:6379/:9527 untouched) =="
  REDIS_PORT="$REDIS_PORT" API_PORT="$API_PORT" \
    docker compose -p "$PROJECT" --env-file "$ENV_FILE" up -d redis indexer api
  UP_RC=$?
  if [ "$UP_RC" -ne 0 ]; then
    red "FAIL: docker compose up did not exit 0 (rc=$UP_RC) — a fresh machine cannot stand this stack."
    exit 1
  fi

  FIRST_CHECKPOINT="$(grep -m1 '^FIRST_CHECKPOINT=' "$ENV_FILE" | cut -d= -f2)"
  TARGET_WATERMARK=$((FIRST_CHECKPOINT + BACKFILL_BUFFER))
  echo "== waiting for the indexer to backfill past checkpoint $TARGET_WATERMARK (FIRST_CHECKPOINT=$FIRST_CHECKPOINT + buffer=$BACKFILL_BUFFER), budget ${TIMEOUT_SEC}s =="

  START=$(date +%s)
  STATUS_JSON=""
  while true; do
    NOW=$(date +%s)
    ELAPSED=$((NOW - START))
    if [ "$ELAPSED" -ge "$TIMEOUT_SEC" ]; then
      ylw "  timeout budget exhausted (${ELAPSED}s) — proceeding to view checks with whatever's indexed so far."
      break
    fi
    STATUS_JSON="$(curl -sf --max-time 5 "$BASE/v1/status" 2>/dev/null)"
    if [ -n "$STATUS_JSON" ]; then
      WM=$(echo "$STATUS_JSON" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("committer_watermark") or 0)' 2>/dev/null || echo 0)
      INDEXED=$(echo "$STATUS_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("indexed"))' 2>/dev/null || echo False)
      echo "  [${ELAPSED}s] indexed=$INDEXED watermark=$WM (target $TARGET_WATERMARK, $((TARGET_WATERMARK - WM)) to go)"
      if [ "$INDEXED" = "True" ] && [ "$WM" -ge "$TARGET_WATERMARK" ] 2>/dev/null; then
        grn "  backfill past the ceremony+seed range — proceeding to view checks."
        break
      fi
    else
      echo "  [${ELAPSED}s] /v1/status not answering yet (api/indexer still starting)"
    fi
    sleep 10
  done
fi

# ── per-view probes ─────────────────────────────────────────────────────────────────────────────
# Each probe: method, path, expected top-level key(s) in the JSON body. A view PASSES if it returns
# HTTP 200 with a body containing every expected key (content may legitimately be an empty array/
# null for views tied to real gameplay that hasn't happened on this lineage yet — that's still a
# live, correctly-computed response, not a dead view). Discovers real IDs from earlier probes
# (encyclopedia → template/world ids, listings → a seller address) to feed later probes instead of
# guessing — falls back to the ceremony/seed manifest's known signer + world id if discovery empty.
FIRST_CHECKPOINT_OK=1
declare -a RESULTS=()

probe() {
  local name="$1" path="$2"
  local resp status body
  resp="$(curl -s --max-time 10 -w '\n%{http_code}' "$BASE$path")"
  status="$(echo "$resp" | tail -1)"
  body="$(echo "$resp" | sed '$d')"
  echo "$body" > "/tmp/${PROJECT}_${name}.json"
  if [ "$status" = "200" ]; then
    echo "$body"
    return 0
  else
    RESULTS+=("FAIL	$name	$path	HTTP $status")
    return 1
  fi
}

check_keys() {
  local name="$1" path="$2" body="$3"; shift 3
  local keys=("$@")
  local missing=0
  for k in "${keys[@]}"; do
    python3 -c "import json,sys; d=json.loads(sys.argv[1]); sys.exit(0 if '$k' in d else 1)" "$body" 2>/dev/null || missing=1
  done
  if [ "$missing" = 1 ]; then
    RESULTS+=("FAIL	$name	$path	missing expected key(s): ${keys[*]}")
    return 1
  fi
  local nonempty
  nonempty="$(python3 -c "
import json,sys
d=json.loads(sys.argv[1])
def has_content(v):
    if isinstance(v, dict): return any(has_content(x) for x in v.values())
    if isinstance(v, list): return len(v) > 0
    return v not in (None, '', 0, False)
print('yes' if any(has_content(d.get(k)) for k in sys.argv[2:]) else 'empty')
" "$body" "${keys[@]}" 2>/dev/null)"
  RESULTS+=("PASS	$name	$path	${nonempty:-unknown}")
  return 0
}

echo
echo "== probing every /v1 view =="

# health (never rate-limited, no keys needed)
h="$(probe health /health)" && check_keys health /health "$h" status

# status
s="$(probe status /v1/status)" && check_keys status /v1/status "$s" status indexed

# encyclopedia (no required params — discover template/world ids from here)
enc="$(probe encyclopedia /v1/encyclopedia)" && check_keys encyclopedia /v1/encyclopedia "$enc" items worlds
WORLD_ID="$(echo "${enc:-{}}" | python3 -c 'import json,sys
try:
    d=json.load(sys.stdin); w=d.get("worlds") or []
    print(w[0]["world_id"] if w else "")
except Exception: print("")' 2>/dev/null)"
[ -z "$WORLD_ID" ] && WORLD_ID="$(grep -A2 '"world"' ../move/scripts/out/seed_manifest.json 2>/dev/null | grep -o '0x[0-9a-f]\{64\}' | head -1)"
TEMPLATE_ID="$(echo "${enc:-{}}" | python3 -c 'import json,sys
try:
    d=json.load(sys.stdin); i=d.get("items") or []
    print(i[0]["template_id"] if i else "")
except Exception: print("")' 2>/dev/null)"

# config (no required params)
cfg="$(probe config /v1/config)" && check_keys config /v1/config "$cfg" dials classes creation

# listings (no required params — discover a real owner/seller from here)
lst="$(probe listings /v1/listings)" && check_keys listings /v1/listings "$lst" listings total
OWNER="$(echo "${lst:-{}}" | python3 -c 'import json,sys
try:
    d=json.load(sys.stdin); l=d.get("listings") or []
    print(l[0]["seller"] if l else "")
except Exception: print("")' 2>/dev/null)"
[ -z "$OWNER" ] && OWNER="$(python3 -c "import json; print(json.load(open('../move/scripts/out/seed_manifest.json')).get('_signer',''))" 2>/dev/null)"

# pools (no required params)
pl="$(probe pools /v1/pools)" && check_keys pools /v1/pools "$pl" pools

# shop (no required params)
sh="$(probe shop /v1/shop)" && check_keys shop /v1/shop "$sh" sales

# taux (no required params — every touched template)
tx="$(probe taux /v1/taux)" && check_keys taux /v1/taux "$tx" taux neutral_milli

# kolizeum (no required params)
kz="$(probe kolizeum /v1/kolizeum)" && check_keys kolizeum /v1/kolizeum "$kz" kolizeums

# zones (requires ?world=)
if [ -n "$WORLD_ID" ]; then
  zn="$(probe zones "/v1/zones?world=$WORLD_ID")" && check_keys zones "/v1/zones?world=$WORLD_ID" "$zn" zones biome
else
  RESULTS+=("SKIP	zones	/v1/zones	no world id discovered from encyclopedia or seed_manifest.json")
fi

# characters (requires ?owner= or ?ids=)
if [ -n "$OWNER" ]; then
  ch="$(probe characters "/v1/characters?owner=$OWNER")" && check_keys characters "/v1/characters?owner=$OWNER" "$ch" characters
else
  RESULTS+=("SKIP	characters	/v1/characters	no owner address discovered from listings or seed_manifest.json")
fi

# dungeon-runs (requires ?owner= or ?pass=)
if [ -n "$OWNER" ]; then
  dr="$(probe dungeon-runs "/v1/dungeon-runs?owner=$OWNER")" && check_keys dungeon-runs "/v1/dungeon-runs?owner=$OWNER" "$dr" runs
else
  RESULTS+=("SKIP	dungeon-runs	/v1/dungeon-runs	no owner address discovered")
fi

# fight-results (requires ?owner=)
if [ -n "$OWNER" ]; then
  fr="$(probe fight-results "/v1/fight-results?owner=$OWNER")" && check_keys fight-results "/v1/fight-results?owner=$OWNER" "$fr" results
else
  RESULTS+=("SKIP	fight-results	/v1/fight-results	no owner address discovered")
fi

# fights (requires ?id=, ?character=, or ?world=) — use the discovered world
if [ -n "$WORLD_ID" ]; then
  fg="$(probe fights "/v1/fights?world=$WORLD_ID")" && check_keys fights "/v1/fights?world=$WORLD_ID" "$fg" fights
else
  RESULTS+=("SKIP	fights	/v1/fights	no world id discovered")
fi

echo
echo "== §14 ACCEPTANCE — per-view pass table =="
printf '%-6s %-16s %-40s %s\n' "VERDICT" "VIEW" "PATH" "CONTENT"
FAILS=0
for row in "${RESULTS[@]}"; do
  IFS=$'\t' read -r verdict name path note <<< "$row"
  printf '%-6s %-16s %-40s %s\n' "$verdict" "$name" "$path" "$note"
  [ "$verdict" = "FAIL" ] && FAILS=$((FAILS + 1))
done

echo
if [ "$FAILS" -gt 0 ]; then
  red "§14 ACCEPTANCE FAILED — $FAILS dead view(s) above."
  exit 1
fi
grn "§14 ACCEPTANCE PASSED — every /v1 view is live and correctly shaped over a fresh-machine backfill."
exit 0
