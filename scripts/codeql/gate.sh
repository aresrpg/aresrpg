#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
# © 2026 Sceat — All rights reserved. See LICENSE.
# scripts/codeql/gate.sh — the CodeQL ratchet gate (deep tier of the FP constitution, docs/CODE_LAW.md).
#
# Two legs, one baseline:
#   JS/TS — the aresrpg-fp query pack (laundered-store-write L-P4 · effect-escapes-the-edge
#           L-P4/P1 · boundary-mutation L-I2) against a FRESH database of the working tree.
#   Rust  — the standard codeql/rust-queries suite over packages/rpc/indexer (default threat
#           model; the crate is ops-run, env/CLI inputs are trusted). The DB is rebuilt only
#           when crate sources are newer than it (build costs ~1m50s; analyze results are
#           evaluator-cached when nothing changed). Move has NO CodeQL extractor — Move is
#           covered by the D321 grep gates, not this tier.
#
# Findings from both legs reduce to `ruleId|file|lineHash` fingerprint rows (line-shift-stable)
# and diff against scripts/codeql/baseline/aresrpg-fp.baseline.txt:
#   exit 0  — no NEW findings (baselined mass is the burn-down worklist, not a failure)
#   exit 1  — new findings: the tree adds a violation the constitution's deep tier can see
#   exit 0 + SKIP — docker missing on the host, or codeql/jq missing in the image (loud note).
#                   cargo missing skips ONLY the rust leg, loudly; the JS leg still gates.
#
# The host half owns the cgroup and mounts; the same script's container half owns the ratchet.
# Keep bounded-run.sh outside this script so it remains the single process-tree choke point.
#
# Usage: bash scripts/codeql/gate.sh                 # the honest default (~55s; +~2min when rust changed)
#        CODEQL_GATE_REUSE_DB=1 bash scripts/codeql/gate.sh   # reuse cached JS DB (iteration only —
#                                                    # a stale DB cannot see new code; never in CI)
#        bash scripts/codeql/gate.sh --rebaseline    # accept the current tree's findings as the
#                                                    # new baseline (explicit ratchet reset — the
#                                                    # baseline may only shrink or justify itself)
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
pack_dir="$repo_root/scripts/codeql"
baseline="$pack_dir/baseline/aresrpg-fp.baseline.txt"

repo_cache_key() {
  if command -v shasum >/dev/null 2>&1; then
    printf '%s\n' "$repo_root" | shasum | cut -c1-12
  elif command -v sha1sum >/dev/null 2>&1; then
    printf '%s\n' "$repo_root" | sha1sum | cut -c1-12
  else
    printf '%s\n' "$repo_root" | cksum | awk '{print $1}' | cut -c1-12
  fi
}

if [ "${CODEQL_GATE_IN_CONTAINER:-0}" != "1" ]; then
  if ! command -v docker >/dev/null 2>&1; then
    echo "SKIP (codeql gate): 'docker' not installed — containerized deep-tier queries NOT run." >&2
    exit 0
  fi

  codeql_image="aresrpg-codeql:2.26.1"
  cache_key="$(repo_cache_key)"
  # Name carries the wrapping-process PGID, not just our own transient PID (07-19 harness-teardown leg 2):
  # a SIGKILLed docker-run client does NOT stop its container — orphans up to 3h piled up
  # docker before this. Under hooks/bounded-run.sh this script runs un-setsid'd, so our own
  # process group IS the wrapping lane's $CHILD (job-control group leader) — bounded-run.sh's
  # teardown can therefore compute the exact same name and `docker rm -f` it with zero
  # process-tree walk and zero guessing. Un-wrapped runs still get a valid, unique name.
  owner_pgid="$(ps -o pgid= -p $$ 2>/dev/null | tr -d ' ')"
  [ -n "$owner_pgid" ] || owner_pgid="$$"
  container_name="agent-codeql-${owner_pgid}-$$"
  docker_args=(
    run --rm
    --pull never
    --name "$container_name"
    --platform linux/amd64
    --memory 3g
    --memory-swap 3g
    --cpus 4
    --pids-limit 512
    --mount "type=bind,source=$repo_root,target=/workspace,readonly"
    --mount "type=volume,source=codeql-cache,target=/codeql-cache"
    --workdir /workspace
    --env CODEQL_GATE_IN_CONTAINER=1
    --env "CODEQL_DB_DIR=/codeql-cache/$cache_key"
    --env "CODEQL_GATE_REUSE_DB=${CODEQL_GATE_REUSE_DB:-0}"
  )

  host_output_dir=""
  cleanup_host_output() {
    [ -z "$host_output_dir" ] || rm -rf -- "$host_output_dir"
  }
  trap cleanup_host_output EXIT

  if [ "${1:-}" = "--rebaseline" ]; then
    host_output_dir="$(mktemp -d "${TMPDIR:-/tmp}/aresrpg-codeql-rebaseline.XXXXXX")"
    docker_args+=(
      --mount "type=bind,source=$host_output_dir,target=/gate-output"
      --env CODEQL_GATE_REBASELINE_OUTPUT=/gate-output/baseline.txt
    )
  fi

  if docker "${docker_args[@]}" "$codeql_image" \
    bash /workspace/scripts/codeql/gate.sh "$@"; then
    if [ -n "$host_output_dir" ]; then
      [ -f "$host_output_dir/baseline.txt" ] || {
        echo "RED (codeql gate): container produced no rebaseline output." >&2
        exit 1
      }
      cp "$host_output_dir/baseline.txt" "$baseline"
      echo "Rebaselined: $(wc -l <"$baseline" | tr -d ' ') findings accepted into $baseline"
    fi
  else
    exit $?
  fi
  exit 0
fi

[ -f /.dockerenv ] || {
  echo "RED (codeql gate): container marker set outside Docker — refusing uncapped analysis." >&2
  exit 1
}

cache_dir="${CODEQL_DB_DIR:-$HOME/.cache/aresrpg-codeql/$(repo_cache_key)}"
mkdir -p "$cache_dir"
export CODEQL_DB_DIR="$cache_dir"
js_db="$cache_dir/db"
rust_db="$cache_dir/db-rust"
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/aresrpg-codeql.XXXXXX")"
trap 'rm -rf -- "$tmp_dir"' EXIT
js_sarif="$tmp_dir/js.sarif"
rust_sarif="$tmp_dir/rust.sarif"
actual="$tmp_dir/actual.txt"
baseline_sorted="$tmp_dir/baseline.sorted.txt"

for tool in codeql jq; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "SKIP (codeql gate): '$tool' not installed — deep-tier queries NOT run. brew install codeql" >&2
    exit 0
  fi
done

fingerprints() {
  jq -r '.runs[0].results[]
    | .ruleId + "|" + .locations[0].physicalLocation.artifactLocation.uri + "|"
      + (.partialFingerprints.primaryLocationLineHash // "NOHASH")' "$1"
}

# ── JS/TS leg: fresh DB + the custom law pack ───────────────────────────────────────────────────
if [ "${CODEQL_GATE_REUSE_DB:-0}" != "1" ] || [ ! -d "$js_db" ]; then
  build_log="$tmp_dir/js-db-build.log"
  bash "$pack_dir/db-create.sh" --force js >"$build_log" 2>&1 || {
    echo "RED (codeql gate): JS database build failed —" >&2
    tail -20 "$build_log" >&2
    exit 1
  }
else
  echo "(reusing cached JS DB at $js_db — iteration mode, not a shippable verdict)" >&2
fi

codeql database analyze "$js_db" "$pack_dir/aresrpg-fp" \
  --format=sarif-latest --output="$js_sarif" --threads=0 --max-disk-cache=2048 --rerun \
  >/dev/null 2>&1
fingerprints "$js_sarif" >>"$actual"

# ── Rust leg: packages/rpc/indexer + the standard rust suite ────────────────────────────────────
if ! command -v cargo >/dev/null 2>&1; then
  echo "SKIP (codeql gate, rust leg): cargo not installed — packages/rpc/indexer NOT analyzed." >&2
else
  crate="$repo_root/packages/rpc/indexer"
  stale=0
  [ -d "$rust_db" ] || stale=1
  if [ "$stale" = "0" ]; then
    newer="$(find "$crate/src" "$crate/Cargo.toml" "$crate/Cargo.lock" -newer "$rust_db/codeql-database.yml" -type f 2>/dev/null | head -1)"
    [ -n "$newer" ] && stale=1
  fi
  if [ "$stale" = "1" ]; then
    build_log="$tmp_dir/rust-db-build.log"
    bash "$pack_dir/db-create.sh" --force rust >"$build_log" 2>&1 || {
      echo "RED (codeql gate): rust database build failed —" >&2
      tail -20 "$build_log" >&2
      exit 1
    }
  fi
  # No --rerun: on an unchanged DB the evaluator cache answers fast; a rebuilt DB is a fresh
  # evaluation anyway.
  codeql database analyze "$rust_db" codeql/rust-queries \
    --format=sarif-latest --output="$rust_sarif" --threads=0 --max-disk-cache=2048 \
    >/dev/null 2>&1
  fingerprints "$rust_sarif" >>"$actual"
fi

LC_ALL=C sort -u "$actual" -o "$actual"

if [ "${1:-}" = "--rebaseline" ]; then
  rebaseline_output="${CODEQL_GATE_REBASELINE_OUTPUT:-$baseline}"
  cp "$actual" "$rebaseline_output"
  if [ -z "${CODEQL_GATE_REBASELINE_OUTPUT:-}" ]; then
    echo "Rebaselined: $(wc -l <"$baseline" | tr -d ' ') findings accepted into $baseline"
  fi
  exit 0
fi

[ -f "$baseline" ] || {
  echo "RED (codeql gate): baseline missing at $baseline — run gate.sh --rebaseline once." >&2
  exit 1
}

LC_ALL=C sort -u "$baseline" >"$baseline_sorted"
new_findings="$(LC_ALL=C comm -13 "$baseline_sorted" "$actual")"
if [ -n "$new_findings" ]; then
  echo "RED (codeql gate): NEW deep-tier findings vs baseline:" >&2
  echo "$new_findings" >&2
  echo "Each row is ruleId|file|lineHash — run the packs for locations:" >&2
  echo "  codeql database analyze $js_db $pack_dir/aresrpg-fp --format=sarif-latest --output=/tmp/fp.sarif" >&2
  echo "  codeql database analyze $rust_db codeql/rust-queries --format=sarif-latest --output=/tmp/rust.sarif" >&2
  exit 1
fi

echo "codeql gate: 0 new findings ($(wc -l <"$actual" | tr -d ' ') baselined across JS+Rust, worklist — see docs/CODE_LAW.md)"
