#!/usr/bin/env bash
# scripts/codeql/db-create.sh — build (or rebuild) the CodeQL databases for the repo.
#
#   js    — javascript-typescript over the whole repo (~50s cold / ~21s warm, ~350 MB)
#   rust  — packages/rpc/indexer crate (~1m50s, ~320 MB; needs cargo — skipped loudly without it)
#   all   — both (default)
#
# Move has NO CodeQL extractor — the Move contracts are covered by the repo's D321 grep gates,
# not by this tier. DBs are build artifacts and live OUTSIDE the repo tree (default
# ~/.cache/aresrpg-codeql; override with CODEQL_DB_DIR).
#
# Usage: bash scripts/codeql/db-create.sh [--force] [js|rust|all]
#        (without --force an existing DB is kept)
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cache_dir="${CODEQL_DB_DIR:-$HOME/.cache/aresrpg-codeql}"

force=0
target="all"
for arg in "$@"; do
  case "$arg" in
    --force) force=1 ;;
    js | rust | all) target="$arg" ;;
    *)
      echo "unknown argument: $arg (usage: db-create.sh [--force] [js|rust|all])" >&2
      exit 2
      ;;
  esac
done

if ! command -v codeql >/dev/null 2>&1; then
  echo "SKIP: codeql CLI not installed (brew install codeql) — no database built." >&2
  exit 0
fi

mkdir -p "$cache_dir"

build_js() {
  local db="$cache_dir/db"
  if [ -d "$db" ] && [ "$force" != "1" ]; then
    echo "JS database already exists at $db — pass --force to rebuild." >&2
    return 0
  fi
  # Path filters for the JS/TS extractor (one directive per line). docs/ = corpora + research JSON;
  # seed JSON = generated content blobs; public/ = vendored/built browser assets (the draco codecs
  # alone contributed ~1,500 junk census findings); scripts/codeql + scripts/arch fixtures =
  # deliberately-violating test code for the gates themselves. Everything else stays in.
  LGTM_INDEX_FILTERS=$'exclude:docs\nexclude:seed/**/*.json\nexclude:.claude\nexclude:.vercel\nexclude:**/public\nexclude:**/dist\nexclude:**/out\nexclude:scripts/codeql\nexclude:scripts/arch/fixtures' \
    codeql database create "$db" \
    --language=javascript-typescript \
    --source-root "$repo_root" \
    --threads=0 \
    --overwrite
}

build_rust() {
  local db="$cache_dir/db-rust"
  if ! command -v cargo >/dev/null 2>&1; then
    echo "SKIP: cargo not installed — rust database (packages/rpc/indexer) not built." >&2
    return 0
  fi
  if [ -d "$db" ] && [ "$force" != "1" ]; then
    echo "Rust database already exists at $db — pass --force to rebuild." >&2
    return 0
  fi
  codeql database create "$db" \
    --language=rust \
    --source-root "$repo_root/packages/rpc/indexer" \
    --threads=0 \
    --overwrite
}

case "$target" in
  js) build_js ;;
  rust) build_rust ;;
  all)
    build_js
    build_rust
    ;;
esac

du -sh "$cache_dir"/db* 2>/dev/null || true
