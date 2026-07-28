#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
# © 2026 Sceat — All rights reserved. See LICENSE.
# check-constraints.sh — the AresRPG constraint gate.
#
# Mechanical checks that keep the tree honest, wired into `bun run lint`:
#   chain-id declarations · Move public-surface law · app identifier naming ·
#   test reachability · the secret-leak gate.
#
# Exit: 0 = clean; 1 = at least one violation.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 2

red() { printf '\033[31m%s\033[0m\n' "$1"; }
grn() { printf '\033[32m%s\033[0m\n' "$1"; }
ylw() { printf '\033[33m%s\033[0m\n' "$1"; }

# ── file collection: portable, and fail-closed by construction ──────────────────────────────────
# Every scan gate below starts by collecting a file set from git. Two properties it depends on:
#
#   · PORTABLE — macOS ships /bin/bash 3.2, which has no `mapfile`; the NUL-safe `read -r -d ''`
#     loop is the equivalent that runs everywhere. (3.2 also aborts on an empty-array expansion
#     under `set -u`, so the array is always declared before it is read — issue #824's shape.)
#   · FAIL-CLOSED — an empty result returns NON-ZERO. A scan gate's ✓ means "I read these files and
#     found nothing"; a collection step that silently yields nothing would turn it into "I read
#     nothing", which is the same checkmark and a lie. Callers must branch on the return value.
#
# The result lands in COLLECTED_FILES — bash 3.2 has no namerefs, so one shared array is the single
# home for a collected set: read it before the next collect_files call. `git ls-files` keeps listing
# a tracked file DELETED in the working tree, so entries are filtered to what actually exists and a
# scanner never dies on a mid-cleanup tree.
COLLECTED_FILES=()
collect_files() {
  local include_untracked=1
  if [ "${1:-}" = "--tracked-only" ]; then
    include_untracked=0
    shift
  fi
  COLLECTED_FILES=()
  local file
  while IFS= read -r -d '' file; do
    [ -f "$file" ] && COLLECTED_FILES+=("$file")
  done < <(
    git ls-files -z -- "$@"
    [ "$include_untracked" -eq 1 ] && git ls-files -z --others --exclude-standard -- "$@"
  )
  [ "${#COLLECTED_FILES[@]}" -gt 0 ]
}

# One extended grep over COLLECTED_FILES; hits go to stdout, tool errors stay on stderr (never
# swallowed — a silent scan failure is the thing this whole block exists to prevent).
# Returns non-zero only when the scan did NOT run, so "no hits" and "grep never happened" can never
# look alike. Status contract, portable: 0 = every invocation matched; 1 or 123 = at least one
# matched nothing (GNU xargs reports 123, BSD/macOS reports 1, and grep's own "no match" is 1 —
# indistinguishable, and all mean the scan ran); 126/127 = could not exec; 128+N = killed.
grep_collected() {
  local pattern="$1"
  shift
  local status=0
  printf '%s\0' "${COLLECTED_FILES[@]}" | xargs -0 grep "$@" -e "$pattern" || status=$?
  case "$status" in
    0 | 1 | 123) return 0 ;;
    *) return 1 ;;
  esac
}

# D756 — on-chain names are generationless. Signature changes republish the package under the one clean name;
# they never add V2/V3, _old, legacy, or deprecated markers to a module, callable, struct, enum, or event type.
MOVE_SOURCE_PATHSPEC=':(glob)packages/move/*/sources/*.move'
move_public_surface_hits() {
  printf '%s\0' "${COLLECTED_FILES[@]}" | xargs -0 awk '
    function has_marker(name) { return tolower(name) ~ /(v2|v3|_old|legacy|deprecated)/ }
    function without_comments(text,    ch, pair, result, cursor) {
      result = ""
      cursor = 1
      while (cursor <= length(text)) {
        ch = substr(text, cursor, 1)
        pair = substr(text, cursor, 2)
        if (comment_depth > 0) {
          if (pair == "/*") {
            comment_depth++
            cursor += 2
          } else if (pair == "*/") {
            comment_depth--
            cursor += 2
          } else {
            cursor++
          }
        } else if (in_string) {
          if (escaped) {
            escaped = 0
          } else if (ch == "\\") {
            escaped = 1
          } else if (ch == "\"") {
            in_string = 0
          }
          result = result " "
          cursor++
        } else if (pair == "//") {
          break
        } else if (pair == "/*") {
          comment_depth++
          cursor += 2
        } else if (ch == "\"") {
          in_string = 1
          result = result " "
          cursor++
        } else {
          result = result ch
          cursor++
        }
      }
      return result
    }
    FNR == 1 { comment_depth = 0; in_string = 0; escaped = 0 }
    {
      raw = $0
      line = without_comments($0)
      name = ""
      if (line ~ /^[ \t]*module[ \t]+/) {
        name = line
        sub(/^[ \t]*module[ \t]+/, "", name)
        sub(/[ \t{;].*$/, "", name)
        sub(/^.*::/, "", name)
      } else if (line ~ /^[ \t]*(public([ \t]*\([^)]*\))?[ \t]+((entry|macro|native)[ \t]+)*fun|entry[ \t]+((macro|native)[ \t]+)*fun)[ \t]+/) {
        name = line
        sub(/^[ \t]*(public([ \t]*\([^)]*\))?[ \t]+((entry|macro|native)[ \t]+)*fun|entry[ \t]+((macro|native)[ \t]+)*fun)[ \t]+/, "", name)
        sub(/[^A-Za-z0-9_].*$/, "", name)
      } else if (line ~ /^[ \t]*(public([ \t]*\([^)]*\))?[ \t]+)?(struct|enum|event)[ \t]+/) {
        name = line
        sub(/^[ \t]*(public([ \t]*\([^)]*\))?[ \t]+)?(struct|enum|event)[ \t]+/, "", name)
        sub(/[^A-Za-z0-9_].*$/, "", name)
      }
      if (name != "" && has_marker(name)) print FILENAME ":" FNR ":" raw
    }
  '
}

move_public_surface_gate() {
  echo "== AresRPG Move clean-name gate (D756: no public version markers) =="
  local hits
  local scan_status
  if ! collect_files "$MOVE_SOURCE_PATHSPEC"; then
    red "  ✗ FAIL: no Move sources collected — this gate cannot pass on an empty scan set."
    return 1
  fi
  local scanned="${#COLLECTED_FILES[@]}"
  hits="$(move_public_surface_hits)"
  scan_status=$?
  if [ "$scan_status" -ne 0 ]; then
    red "  ✗ FAIL: Move public-surface scan could not complete (exit=$scan_status)"
    return 1
  fi
  if [ -n "$hits" ]; then
    red "  ✗ FAIL: version-marker identifier(s) on a Move public surface:"
    echo "$hits" | sed 's/^/      /'
    red "MOVE CLEAN-NAME GATE FAILED. Fresh-republish the package with one clean, unversioned surface."
    return 1
  fi
  grn "  ✓ no V2/V3/_old/legacy/deprecated identifiers on Move public surfaces ($scanned files scanned)"
}

# The same generationless law, extended to app SOURCE identifiers — the
# off-chain residue class (ITEMS_V2_DEPLOYMENT / items_v2_ready survived the 07-15 republish invisible
# to the Move-only scan above). Scans packages/*/src JS/TS at IDENTIFIER positions only: comments AND
# string literals are stripped first, so versioned DATA strings (the 'ares_tutorial_seen_v2' storage
# key, the 'Ares_Aura_V2' asset id, a dead moveCall target tracked by its own ticket — see
# write_worlds.js's S-57 header) never trip it. `_v2` ONLY, deliberately: `_v3` is the three.js
# Vector3 scratch idiom (engine tactical/index.js `_occ_v3`), so vN>=3 stays the Move gate's problem.
# Limitation, accepted: identifiers used only inside a template-literal ${} are blanked with the
# string — the declaration/import site still catches them.
# :(glob) magic is LOAD-BEARING: default pathspec fnmatch gives `**/` no zero-directory match, so
# files sitting DIRECTLY in src/ (env.ts, boot_shim.ts, …) would silently escape the scan.
APP_SOURCE_PATHSPEC=(
  ':(glob)packages/*/src/**/*.js' ':(glob)packages/*/src/**/*.jsx'
  ':(glob)packages/*/src/**/*.ts' ':(glob)packages/*/src/**/*.tsx' ':(glob)packages/*/src/**/*.mjs'
  ':(exclude)**/*.d.ts'
)
app_identifier_hits() {
  printf '%s\0' "${COLLECTED_FILES[@]}" | xargs -0 awk '
    function without_comments_or_strings(text,    ch, pair, result, cursor) {
      result = ""
      cursor = 1
      while (cursor <= length(text)) {
        ch = substr(text, cursor, 1)
        pair = substr(text, cursor, 2)
        if (comment_depth > 0) {
          if (pair == "/*") {
            comment_depth++
            cursor += 2
          } else if (pair == "*/") {
            comment_depth--
            cursor += 2
          } else {
            cursor++
          }
        } else if (string_char != "") {
          if (escaped) {
            escaped = 0
          } else if (ch == "\\") {
            escaped = 1
          } else if (ch == string_char) {
            string_char = ""
          }
          result = result " "
          cursor++
        } else if (pair == "//") {
          break
        } else if (pair == "/*") {
          comment_depth++
          cursor += 2
        } else if (ch == "\"" || ch == "\047" || ch == "`") {
          string_char = ch
          result = result " "
          cursor++
        } else {
          result = result ch
          cursor++
        }
      }
      return result
    }
    FNR == 1 { comment_depth = 0; string_char = ""; escaped = 0 }
    {
      line = without_comments_or_strings($0)
      if (line ~ /_[vV]2/) print FILENAME ":" FNR ":" $0
    }
  '
}

app_identifier_gate() {
  echo "== AresRPG app-side clean-name gate (D756 extension: no _v2 identifiers in packages/*/src) =="
  local hits
  local scan_status
  if ! collect_files "${APP_SOURCE_PATHSPEC[@]}"; then
    red "  ✗ FAIL: no app sources collected — this gate cannot pass on an empty scan set."
    return 1
  fi
  local scanned="${#COLLECTED_FILES[@]}"
  hits="$(app_identifier_hits)"
  scan_status=$?
  if [ "$scan_status" -ne 0 ]; then
    red "  ✗ FAIL: app-side identifier scan could not complete (exit=$scan_status)"
    return 1
  fi
  if [ -n "$hits" ]; then
    red "  ✗ FAIL: versioned _v2 identifier(s) in app source:"
    echo "$hits" | cut -c1-160 | sed 's/^/      /' | head -40
    red "APP CLEAN-NAME GATE FAILED. Rename to the one clean name (D756) — versioned identifiers never land app-side."
    return 1
  fi
  grn "  ✓ no _v2-versioned identifiers in packages/*/src ($scanned files scanned)"
}

asset_codename_gate() {
  echo "== AresRPG retired asset-codename gate =="
  local content_hits
  local path_hits
  local hits
  local scan_status
  if ! collect_files; then
    red "  ✗ FAIL: no repository files collected — this gate cannot pass on an empty scan set."
    return 1
  fi
  local scanned="${#COLLECTED_FILES[@]}"
  content_hits="$(grep_collected 'w[a]lrus' -IilE)"
  scan_status=$?
  if [ "$scan_status" -ne 0 ]; then
    red "  ✗ FAIL: retired asset-codename scan could not complete (exit=$scan_status)"
    return 1
  fi
  path_hits="$(printf '%s\n' "${COLLECTED_FILES[@]}" | awk 'tolower($0) ~ /w[a]lrus/')"
  hits="$(printf '%s\n%s\n' "$content_hits" "$path_hits" | awk 'NF && !seen[$0]++')"
  if [ -n "$hits" ]; then
    local hit_count
    hit_count="$(printf '%s\n' "$hits" | awk 'NF { count++ } END { print count + 0 }')"
    red "  ✗ FAIL: retired asset codename remains in $hit_count file(s):"
    echo "$hits" | sed 's/^/      /'
    red "ASSET-CODENAME GATE FAILED. Remove every occurrence; this gate has no allowlist."
    return 1
  fi
  grn "  ✓ retired asset codename absent from contents and paths ($scanned files scanned; zero allowlist)"
}

# ── SPATIAL-VOCABULARY GATE (#1536 — the fight path's SSOT knot) ────────────────────────────────
# The board's spatial vocabulary has exactly ONE home: packages/sim/src/{combat_grid,cell,pathfind,
# visibility}.js — grid dims, encode/decode, in_grid, the manhattan metric, the 4-dir BFS, the LOS
# predicate. `sim` and `fight` each grew a COMPLETE independent copy of it, and the copies had already
# drifted in production: `in_grid` disagreed on negative cells, and an unproven float-slope LOS gated
# every world-mode cast while the Move-proven integer twin sat unused beside it (a client that offers a
# cast the chain aborts burns the player's gas). Comments asked for one home for a year; this enforces it.
#
# Three checks over packages/{sim,fight,frontend}/src — the production fight path (the test-side literal
# copies are #1536 row 6 and burn down separately):
#   1. DECLARATION — GRID_W/GRID_H/GRID_CELLS may be BOUND only in the home. Everyone else imports.
#   2. DERIVATION  — no re-derived decode (`% GRID_W` / `/ GRID_W`) and no re-inlined manhattan
#      (`Math.abs(a.x - b.x) + Math.abs(a.y - b.y)`) outside their homes. Those two shapes are exactly
#      how the five manhattan copies and the second encode/decode were born.
#   3. ENGINE MIRROR — packages/engine ships NO @aresrpg/sim dependency by design (three + noise only),
#      so board_anchor.js vendors the stride. That copy may exist; it may not DRIFT — its values are
#      compared against the home's, and a mismatch is fatal.
#
# Every check carries a POSITIVE CONTROL: the home's own line must match the pattern. A clean scan whose
# pattern silently stopped matching anything reads exactly like a clean tree, and is a lie.
SPATIAL_HOME='packages/sim/src/combat_grid.js'
SPATIAL_METRIC_HOME='packages/sim/src/cell.js'
SPATIAL_ENGINE_MIRROR='packages/engine/src/binding/board_anchor.js'
SPATIAL_SOURCE_PATHSPEC=(
  ':(glob)packages/sim/src/**/*.js' ':(glob)packages/fight/src/**/*.js'
  ':(glob)packages/frontend/src/**/*.js' ':(glob)packages/frontend/src/**/*.jsx'
)

# scan <pattern> <home-file> <what> <remedy> — hits outside <home-file> fail; zero hits INSIDE it fail too
# (the pattern went blind). Echoes nothing on success but the one green line.
spatial_scan() {
  local pattern="$1" home="$2" what="$3" remedy="$4"
  local all outside inside
  if ! all="$(grep_collected "$pattern" -InE)"; then
    red "  ✗ FAIL: the $what scan did not run to completion — an unproven pattern is not an absent one."
    return 1
  fi
  inside="$(printf '%s\n' "$all" | grep -c "^$home:")"
  if [ "$inside" -eq 0 ]; then
    red "  ✗ FAIL: the $what pattern no longer matches its own home ($home) — the check has gone blind."
    return 1
  fi
  outside="$(printf '%s\n' "$all" | grep -v "^$home:" | awk 'NF')"
  if [ -n "$outside" ]; then
    red "  ✗ FAIL: $what outside $home:"
    echo "$outside" | cut -c1-160 | sed 's/^/      /' | head -40
    red "$remedy"
    return 1
  fi
  grn "  ✓ $what: $home only ($inside line(s) there, zero elsewhere)"
}

spatial_vocabulary_gate() {
  echo "== AresRPG spatial-vocabulary gate (#1536: ONE home for the grid dims, decode, and the manhattan metric) =="
  if ! collect_files "${SPATIAL_SOURCE_PATHSPEC[@]}"; then
    red "  ✗ FAIL: no fight-path sources collected — this gate cannot pass on an empty scan set."
    return 1
  fi
  # in-src test files are #1536 row 6 (their own literal copies, burning down separately) — drop them here
  # rather than by pathspec: git's :(exclude) magic silently stops applying once several :(glob) positives are
  # in the same pathspec list, and a filter that quietly matches nothing is the failure mode this gate is about.
  local kept=()
  local file
  for file in "${COLLECTED_FILES[@]}"; do
    case "$file" in *.test.js | *.test.jsx) continue ;; esac
    kept+=("$file")
  done
  if [ "${#kept[@]}" -eq 0 ]; then
    red "  ✗ FAIL: every collected fight-path source was a test file — this gate cannot pass on an empty scan set."
    return 1
  fi
  COLLECTED_FILES=("${kept[@]}")
  local scanned="${#COLLECTED_FILES[@]}"
  local failed=0

  spatial_scan '(const|let|var)[[:space:]]+(GRID_W|GRID_H|GRID_CELLS)[[:space:]]*=' "$SPATIAL_HOME" \
    'grid-dimension declaration' \
    "GRID GATE FAILED. Import GRID_W/GRID_H/GRID_CELLS from $SPATIAL_HOME (re-exported by @aresrpg/fight/los) — never re-declare the board." || failed=1

  spatial_scan '%[[:space:]]*GRID_W|/[[:space:]]*GRID_W[[:space:]]*\)' "$SPATIAL_HOME" \
    'hand-rolled cell decode' \
    "DECODE GATE FAILED. Use decode()/cell_x()/cell_y() from $SPATIAL_HOME — a second decode is a second board." || failed=1

  spatial_scan 'Math\.abs\([^()]*\.x[^()]*\)[[:space:]]*\+[[:space:]]*Math\.abs\([^()]*\.y[^()]*\)' \
    "$SPATIAL_METRIC_HOME" 'inlined manhattan distance' \
    "MANHATTAN GATE FAILED. Use manhattan_distance() from $SPATIAL_METRIC_HOME (or manhattan() from $SPATIAL_HOME for encoded cells) — this is the spell-range metric, it gets ONE definition." || failed=1

  # 3 — the engine's deliberate vendored copy may not drift from the home
  local home_dims mirror_dims
  home_dims="$(sed -n -E 's/^export const (GRID_W|GRID_H) = ([0-9]+).*/\1=\2/p' "$SPATIAL_HOME" | sort | tr '\n' ' ')"
  mirror_dims="$(sed -n -E 's/^const (GRID_W|GRID_H) = ([0-9]+).*/\1=\2/p' "$SPATIAL_ENGINE_MIRROR" | sort | tr '\n' ' ')"
  if [ -z "$home_dims" ] || [ -z "$mirror_dims" ]; then
    red "  ✗ FAIL: could not read the grid dims from $SPATIAL_HOME and/or $SPATIAL_ENGINE_MIRROR — the mirror check has gone blind."
    failed=1
  elif [ "$home_dims" != "$mirror_dims" ]; then
    red "  ✗ FAIL: the engine's vendored board dims drifted from the home:"
    echo "      $SPATIAL_HOME:           $home_dims" >&2
    echo "      $SPATIAL_ENGINE_MIRROR:  $mirror_dims" >&2
    red "ENGINE MIRROR GATE FAILED. packages/engine ships no @aresrpg/sim dependency by design, so its copy must track the home byte for byte."
    failed=1
  else
    grn "  ✓ engine's vendored board dims match the home ($home_dims)"
  fi

  if [ "$failed" -ne 0 ]; then
    return 1
  fi
  grn "  ✓ spatial vocabulary has one home ($scanned fight-path sources scanned)"
}

# ── MOVE DISPLAY GATE (#592 — a Display is rendered STANDALONE, outside the game client) ────────
# Object Display values are read by SuiVision, Suiscan and every wallet, which fetch the object and
# render `image_url` with NO AresRPG origin to resolve a relative path against. A host-free template
# like `/assets/items/{item_type}.png` therefore renders a BROKEN image everywhere except our own
# client. That is #592, and it shipped TWICE: the first fix was applied as a runtime `display::edit`
# on the live object and never mirrored into source, so the next republish re-ran init() from the
# stale source and resurrected it. Source is the only home a republish can read — so source is gated.
#
# Two teeth over packages/move/*/sources:
#   1. ABSOLUTE — every media template literal (.png/.webp/.jpg/.glb, or any `/assets` path) starts
#      with https://. That is the bug's exact shape.
#   2. image_url KEY — a module registering a Display must set the `image_url` key. Explorers key on
#      that precise name; a Display carrying only `url` shows no image with a perfectly absolute
#      template, which fails as silently as the relative form.
# Both carry a POSITIVE CONTROL: the scan must still match something. A clean scan whose pattern
# quietly stopped matching reads exactly like a clean tree, and is a lie (the spatial gate's law).
MOVE_DISPLAY_PATHSPEC=':(glob)packages/move/*/sources/*.move'

move_display_gate() {
  echo "== AresRPG Move Display gate (#592: rendered standalone — absolute media, image_url key) =="
  if ! collect_files "$MOVE_DISPLAY_PATHSPEC"; then
    red "  ✗ FAIL: no Move sources collected — this gate cannot pass on an empty scan set."
    return 1
  fi
  local scanned="${#COLLECTED_FILES[@]}"
  local failed=0

  # 1 — media templates must be absolute
  local media relative
  if ! media="$(grep_collected 'b"[^"]*(\.png|\.webp|\.jpe?g|\.glb|/assets/)' -InE)"; then
    red "  ✗ FAIL: the Display media scan did not run to completion — an unproven pattern is not an absent one."
    return 1
  fi
  media="$(printf '%s\n' "$media" | awk 'NF')"
  if [ -z "$media" ]; then
    red "  ✗ FAIL: no Display media template matched in packages/move/*/sources — the check has gone blind."
    return 1
  fi
  relative="$(printf '%s\n' "$media" | grep -vE 'b"https://' | awk 'NF')"
  if [ -n "$relative" ]; then
    red "  ✗ FAIL: host-relative Display media template(s) — a wallet or explorer has no origin to resolve these:"
    echo "$relative" | cut -c1-160 | sed 's/^/      /' | head -40
    red "DISPLAY GATE FAILED (#592). Display media is ABSOLUTE (https://assets.aresrpg.world/...); the in-client /assets fallback is jobs.js ASSET_BASE's job, never the Display's."
    failed=1
  else
    grn "  ✓ every Display media template is absolute ($(printf '%s\n' "$media" | wc -l | tr -d ' ') literal(s))"
  fi

  # 2 — a module that registers a Display must set the image_url key
  local registrars file
  registrars="$(printf '%s\0' "${COLLECTED_FILES[@]}" | xargs -0 grep -lE 'display::new(_with_fields)?<' 2>/dev/null || true)"
  registrars="$(printf '%s\n' "$registrars" | awk 'NF')"
  if [ -z "$registrars" ]; then
    red "  ✗ FAIL: no display::new call site found in packages/move/*/sources — the image_url check has gone blind."
    return 1
  fi
  while IFS= read -r file; do
    [ -n "$file" ] || continue
    if ! grep -qE 'b"image_url"' "$file"; then
      red "  ✗ FAIL: $file registers a Display but never sets the \`image_url\` key — explorers key on that exact name."
      failed=1
    fi
  done <<EOF
$registrars
EOF
  if [ "$failed" -eq 0 ]; then
    grn "  ✓ every Display registrar sets image_url ($(printf '%s\n' "$registrars" | wc -l | tr -d ' ') module(s))"
    grn "  ✓ Move Display gate clean ($scanned Move source(s) scanned)"
  fi
  [ "$failed" -eq 0 ]
}

if [ "${1:-}" = "--hardcoded-ids" ]; then
  shift
  node scripts/check-chain-ids.mjs "$@"
  exit $?
fi
if [ "${1:-}" = "--move-display" ]; then
  move_display_gate
  exit $?
fi
if [ "${1:-}" = "--manifest-lineage" ]; then
  shift
  node scripts/check-manifest-lineage.mjs "$@"
  exit $?
fi
if [ "${1:-}" = "--move-public-surfaces" ]; then
  move_public_surface_gate
  exit $?
fi
if [ "${1:-}" = "--app-clean-names" ]; then
  app_identifier_gate
  exit $?
fi
if [ "${1:-}" = "--asset-codename" ]; then
  asset_codename_gate
  exit $?
fi
if [ "${1:-}" = "--spatial-vocabulary" ]; then
  spatial_vocabulary_gate
  exit $?
fi

# ── TEST-REACHABILITY TOOTH ─────────────────────────────────────────────────────────────────────
# Every `*.test.*` / `*.spec.*` file in the repo must be reachable by SOME `ares test <selector>` (or
# the bare `ares test` default pipeline) — a test file nothing ever runs is a false sense of coverage.
# The reachable set is DERIVED, never copied:
#   · workspace "test" scripts are read live off packages/*/package.json + apps/*/package.json — bun's
#     OWN 12-member workspace list (verified via `bun pm ls`, NOT a git pathspec: a git pathspec `*`
#     crosses `/` and would over-match e.g. packages/rpc/api — bun's workspace glob does not), and each
#     `bun test <args>` scope is parsed the same way bun itself would use it (bare `bun test` = the whole
#     package tree; a trailing arg with a file extension = one exact file; otherwise a sub-directory).
#   · ares.mjs's own explicit `unit_test_files` / `orchestrator_unit_tests` arrays are IMPORTED live —
#     single source of truth, this gate can never silently drift from a future ares.mjs edit.
#   · the four gold-suite playwright testDirs are the one hardcoded piece (playwright.*.config.ts are
#     stable infra outside this script's fence): test/gold/specs(_anchor|_multiplayer|_prod_smoke)/.
test_reachability_hits() {
  node --input-type=module -e '
    import fs from "node:fs"
    import path from "node:path"
    import { execFileSync } from "node:child_process"
    import { pathToFileURL } from "node:url"

    const repo_root = process.cwd()
    const nul_list = (args) =>
      execFileSync("git", ["ls-files", "-z", ...args], { cwd: repo_root })
        .toString("utf8")
        .split("\0")
        .filter(Boolean)
    const candidate_files = new Set([
      ...nul_list(["--", "*.test.*", "*.spec.*"]),
      ...nul_list(["--others", "--exclude-standard", "--", "*.test.*", "*.spec.*"]),
    ])
    for (const file of [...candidate_files]) {
      if (
        file.startsWith("node_modules/") ||
        file.includes("/node_modules/") ||
        file.startsWith("test/gold/out/") ||
        file.startsWith(".build/") ||
        file.includes("/.build/")
      )
        candidate_files.delete(file)
    }

    const reachable_prefixes = new Set()
    const reachable_files = new Set()
    const add_scope = (base, token) => {
      const rel = [base, token].filter(Boolean).join("/")
      if (path.extname(token)) reachable_files.add(rel)
      else reachable_prefixes.add(`${rel}/`)
    }

    // 1 — bun workspaces: direct children of packages/ and apps/ that carry a package.json declaring a
    // "test" script starting with `bun test` (a differently-shaped script contributes nothing — fail
    // closed, surface the gap loudly instead of silently mis-parsing an unknown runner).
    for (const group of ["packages", "apps"]) {
      const dir = path.join(repo_root, group)
      if (!fs.existsSync(dir)) continue
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const pkg_json = path.join(dir, entry.name, "package.json")
        if (!fs.existsSync(pkg_json)) continue
        const base = `${group}/${entry.name}`
        const test_script = JSON.parse(fs.readFileSync(pkg_json, "utf8"))?.scripts?.test ?? ""
        if (test_script !== "bun test" && !test_script.startsWith("bun test ")) continue
        const args = test_script.split(/\s+/).slice(2)
        if (args.length === 0) reachable_prefixes.add(`${base}/`)
        else for (const token of args) add_scope(base, token)
      }
    }

    // 2 — the explicit test-file arrays ares.mjs already owns (imported live — never copied).
    const ares_url = pathToFileURL(path.join(repo_root, "scripts/ares.mjs")).href
    const { unit_test_files, orchestrator_unit_tests } = await import(ares_url)
    for (const entry of [...unit_test_files, ...orchestrator_unit_tests]) add_scope("", entry)

    // 3 — the 4 gold-suite playwright testDirs (playwright.*.config.ts testDir, outside this fence).
    for (const dir of [
      "test/gold/specs",
      "test/gold/specs_anchor",
      "test/gold/specs_multiplayer",
      "test/gold/specs_prod_smoke",
    ])
      reachable_prefixes.add(`${dir}/`)

    const is_reachable = (file) => reachable_files.has(file) || [...reachable_prefixes].some((p) => file.startsWith(p))
    const raw_orphans = [...candidate_files].filter((file) => !is_reachable(file)).sort()

    // KNOWN baseline (ratchet — same idiom as the semgrep/depcruise/codeql baselines above): the
    // burn-down worklist found 2026-07-20, never grows silently — any NEW orphan still fails the gate.
    const baseline_prefixes = [
      "packages/engine/bench/", // visual-regression .spec.js benches — `bun run bench` (playwright), a manual tool, never ares test
      "packages/frontend/e2e/", // legacy e2e suite driven by scripts/golden_path.sh, predates test/gold, not an ares test leg
      "packages/move/scripts/", // Move ceremony-script tests — packages/move has NO "test" script at all
      "packages/rpc/", // rpc-api + gas-pool — NOT a bun workspace member (bun pm ls: packages/rpc has no package.json)
      "packages/simlab/", // no "test" script (dev/build only)
      "api/", // sponsor.mjs unit tests — api/ is not a workspace, no test script
      "scripts/oss/", // OSS copyright-header tests — no runner wires scripts/oss/** in
    ]
    const baseline_files = [
      "scripts/ceremony-signer-gate.test.mjs",
      "scripts/ares.test.mjs", // the ares CLI'\''s OWN suite — ironic, flagged here for a follow-up wiring ticket
      "test/gold/fixtures/fight_fixtures.test.mjs",
      "test/gold/investigations/b5/b5_drive.spec.ts", // live-prod investigation kit, manual driver — see its README.md
      "test/gold/investigations/b5/b5_fresh.spec.ts", // live-prod investigation kit, manual driver — see its README.md
    ]
    const is_baselined = (file) => baseline_files.includes(file) || baseline_prefixes.some((p) => file.startsWith(p))
    const new_orphans = raw_orphans.filter((file) => !is_baselined(file))

    if (new_orphans.length > 0) {
      console.error("ORPHANED test file(s) — no `ares test <selector>` reaches them:")
      for (const file of new_orphans) console.error(`  ${file}`)
      process.exit(1)
    }
    console.error(`ok: 0 new orphans (${raw_orphans.length} pre-existing baselined, ${candidate_files.size} test files scanned)`)
  ' 2>&1
  return $?
}

test_reachability_gate() {
  echo "== AresRPG test-reachability gate (every *.test.*/*.spec.* file must be reachable by some ares test <selector>) =="
  local output
  local status
  output="$(test_reachability_hits)"
  status=$?
  echo "$output" | sed 's/^/  /'
  if [ "$status" -ne 0 ]; then
    red "TEST-REACHABILITY GATE FAILED. Wire the orphan(s) into an ares.mjs selector, or — if genuinely unreached by design — add it to the baseline lists in check-constraints.sh with a one-line reason."
    return 1
  fi
  grn "  ✓ no new orphaned test files"
}

# ── fixture-adjudication gate (#1101) ────────────────────────────────────────────────────────────
# Fixtures are evidence, not ordinary source: changing an existing one can make the implementation
# and its oracle agree on the same lie. The repository's tracked corpus has two conventions:
#   · packages/*/test/fixtures/**        (fight + sim today; JSON and executable fixtures)
#   · every *.json under package/root test trees (fixtures, vectors, oracles, and test/gold)
# A file newly added by a commit has no earlier evidence to overwrite and is exempt. Every other
# per-commit change under those pathspecs needs an Adjudicated-by trailer whose email differs from
# the author (both canonicalized through .mailmap). The range is the PR's exact base..head in CI and
# merge-base(origin/edge, HEAD)..HEAD in a contributor checkout.
FIXTURE_PATHSPEC=(
  ':(glob)packages/*/test/fixtures/**'
  ':(glob)packages/*/test/**/*.json'
  ':(glob)test/**/*.json'
)
FIXTURE_RANGE_BASE=
FIXTURE_RANGE_HEAD=
FIXTURE_RANGE_CONTEXT=
FIXTURE_RANGE_SKIP=0
resolve_fixture_pr_range() {
  FIXTURE_RANGE_BASE=
  FIXTURE_RANGE_HEAD=
  FIXTURE_RANGE_CONTEXT=
  FIXTURE_RANGE_SKIP=0

  if [ -n "${FIXTURE_ADJUDICATION_BASE_SHA:-}" ] || [ -n "${FIXTURE_ADJUDICATION_HEAD_SHA:-}" ]; then
    if [ -z "${FIXTURE_ADJUDICATION_BASE_SHA:-}" ] || [ -z "${FIXTURE_ADJUDICATION_HEAD_SHA:-}" ]; then
      red "  ✗ RED: FIXTURE_ADJUDICATION_BASE_SHA and FIXTURE_ADJUDICATION_HEAD_SHA must be supplied together."
      return 1
    fi
    FIXTURE_RANGE_BASE="$FIXTURE_ADJUDICATION_BASE_SHA"
    FIXTURE_RANGE_HEAD="$FIXTURE_ADJUDICATION_HEAD_SHA"
    FIXTURE_RANGE_CONTEXT=explicit
  elif [ "${GITHUB_EVENT_NAME:-}" = pull_request ] || [ "${GITHUB_EVENT_NAME:-}" = pull_request_target ]; then
    if [ -z "${GITHUB_EVENT_PATH:-}" ] || [ ! -r "$GITHUB_EVENT_PATH" ]; then
      red "  ✗ RED: pull-request event payload is unavailable — the fixture commit range cannot be stated."
      return 1
    fi
    local event_range
    event_range="$(
      node -e '
        const fs = require("node:fs")
        const event = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
        const base = event.pull_request?.base?.sha
        const head = event.pull_request?.head?.sha
        if (!base || !head) process.exit(2)
        process.stdout.write(`${base}\n${head}\n`)
      ' "$GITHUB_EVENT_PATH"
    )" || {
      red "  ✗ RED: pull-request base/head SHAs could not be read from $GITHUB_EVENT_PATH."
      return 1
    }
    FIXTURE_RANGE_BASE="$(printf '%s\n' "$event_range" | sed -n '1p')"
    FIXTURE_RANGE_HEAD="$(printf '%s\n' "$event_range" | sed -n '2p')"
    FIXTURE_RANGE_CONTEXT=pull-request
  elif [ -n "${CI:-}" ] || [ -n "${GITHUB_ACTIONS:-}" ]; then
    FIXTURE_RANGE_SKIP=1
    FIXTURE_RANGE_CONTEXT="${GITHUB_EVENT_NAME:-non-PR CI} has no PR commit range"
    return 0
  else
    FIXTURE_RANGE_HEAD=HEAD
    FIXTURE_RANGE_BASE="$(git merge-base HEAD origin/edge 2>/dev/null)" || {
      red "  ✗ RED: no merge-base with origin/edge — the local fixture commit range is unknown."
      return 1
    }
    FIXTURE_RANGE_CONTEXT=local
  fi

  if ! git cat-file -e "${FIXTURE_RANGE_BASE}^{commit}" 2>/dev/null; then
    red "  ✗ RED: fixture range base $FIXTURE_RANGE_BASE is not present as a commit."
    return 1
  fi
  if ! git cat-file -e "${FIXTURE_RANGE_HEAD}^{commit}" 2>/dev/null; then
    red "  ✗ RED: fixture range head $FIXTURE_RANGE_HEAD is not present as a commit."
    return 1
  fi
  FIXTURE_RANGE_BASE="$(git rev-parse "$FIXTURE_RANGE_BASE")" || return 1
  FIXTURE_RANGE_HEAD="$(git rev-parse "$FIXTURE_RANGE_HEAD")" || return 1
}

COMMIT_DIFF_FILES=()
collect_commit_diff_files() {
  local parent="$1"
  local commit="$2"
  local filter="$3"
  local output_file
  COMMIT_DIFF_FILES=()
  output_file="$(mktemp "${TMPDIR:-/tmp}/ares-fixture-diff.XXXXXX")" || return 1
  if ! git diff-tree --no-commit-id --name-only --no-renames --diff-filter="$filter" -r -z \
    "$parent" "$commit" -- "${FIXTURE_PATHSPEC[@]}" >"$output_file"; then
    rm -f "$output_file"
    return 1
  fi
  local file
  while IFS= read -r -d '' file; do
    COMMIT_DIFF_FILES+=("$file")
  done <"$output_file"
  rm -f "$output_file"
}

fixture_adjudicators() {
  local commit="$1"
  local trailers
  trailers="$(git show -s --format=%B "$commit" | git interpret-trailers --parse)" || return 1
  local line
  while IFS= read -r line; do
    local key="${line%%:*}"
    key="$(printf '%s' "$key" | tr '[:upper:]' '[:lower:]')"
    if [ "$key" = adjudicated-by ]; then
      printf '%s\n' "${line#*: }"
    fi
  done <<<"$trailers"
}

fixture_adjudication_gate() {
  echo "== AresRPG fixture-adjudication gate (#1101: existing fixture mutations need a non-author trailer) =="
  if ! resolve_fixture_pr_range; then
    red "FIXTURE-ADJUDICATION GATE FAILED (nothing was judged). Fetch the complete PR history and rerun."
    return 1
  fi
  if [ "$FIXTURE_RANGE_SKIP" -eq 1 ]; then
    grn "  ✓ PASS: $FIXTURE_RANGE_CONTEXT; this row judges pull-request ranges."
    return 0
  fi

  local commit_output
  commit_output="$(git rev-list --reverse "$FIXTURE_RANGE_BASE..$FIXTURE_RANGE_HEAD")" || {
    red "  ✗ RED: git could not enumerate $FIXTURE_RANGE_BASE..$FIXTURE_RANGE_HEAD."
    red "FIXTURE-ADJUDICATION GATE FAILED (nothing was judged). Fetch the complete PR history and rerun."
    return 1
  }
  local commits=()
  local commit
  while IFS= read -r commit; do
    [ -n "$commit" ] && commits+=("$commit")
  done <<<"$commit_output"

  local red_rows=0
  local mutating_commits=0
  local mutated_files=0
  local exempt_additions=0
  for commit in "${commits[@]}"; do
    local parent
    parent="$(git rev-parse "${commit}^1" 2>/dev/null)" || {
      red "  ✗ RED: $commit has no readable first parent; its fixture delta cannot be judged."
      red_rows=$((red_rows + 1))
      continue
    }

    if ! collect_commit_diff_files "$parent" "$commit" MDTUXB; then
      red "  ✗ RED: $commit fixture mutations could not be read."
      red_rows=$((red_rows + 1))
      continue
    fi
    local mutations=("${COMMIT_DIFF_FILES[@]}")
    if ! collect_commit_diff_files "$parent" "$commit" A; then
      red "  ✗ RED: $commit new-fixture additions could not be read."
      red_rows=$((red_rows + 1))
      continue
    fi
    local additions=("${COMMIT_DIFF_FILES[@]}")
    exempt_additions=$((exempt_additions + ${#additions[@]}))

    local short
    local subject
    short="$(git rev-parse --short=12 "$commit")"
    subject="$(git show -s --format=%s "$commit")"
    if [ "${#mutations[@]}" -eq 0 ]; then
      if [ "${#additions[@]}" -gt 0 ]; then
        grn "  ✓ PASS $short $subject — ${#additions[@]} new fixture addition(s) exempt"
      else
        grn "  ✓ PASS $short $subject — no existing fixture mutation"
      fi
      continue
    fi

    mutating_commits=$((mutating_commits + 1))
    mutated_files=$((mutated_files + ${#mutations[@]}))
    local author_name
    local author_email
    author_name="$(git show -s --format=%aN "$commit")"
    author_email="$(git show -s --format=%aE "$commit")"
    local author_email_lower
    author_email_lower="$(printf '%s' "$author_email" | tr '[:upper:]' '[:lower:]')"

    local adjudicator_output
    if ! adjudicator_output="$(fixture_adjudicators "$commit")"; then
      red "  ✗ RED $short $subject — commit trailers could not be parsed"
      printf '      %s\n' "${mutations[@]}"
      red_rows=$((red_rows + 1))
      continue
    fi
    local adjudicators=()
    local identity
    while IFS= read -r identity; do
      [ -n "$identity" ] && adjudicators+=("$identity")
    done <<<"$adjudicator_output"

    local accepted_identity=
    local self_identity=
    for identity in "${adjudicators[@]}"; do
      local canonical
      canonical="$(git check-mailmap "$identity" 2>/dev/null)" || continue
      local adjudicator_email=
      case "$canonical" in
        *'<'*'>'*)
          adjudicator_email="${canonical##*<}"
          adjudicator_email="${adjudicator_email%%>*}"
          ;;
      esac
      [ -n "$adjudicator_email" ] || continue
      local adjudicator_email_lower
      adjudicator_email_lower="$(printf '%s' "$adjudicator_email" | tr '[:upper:]' '[:lower:]')"
      if [ "$adjudicator_email_lower" = "$author_email_lower" ]; then
        self_identity="$identity"
      elif [ -z "$accepted_identity" ]; then
        accepted_identity="$identity"
      fi
    done

    if [ -n "$accepted_identity" ]; then
      grn "  ✓ PASS $short $subject — ${#mutations[@]} existing fixture(s), Adjudicated-by: $accepted_identity"
      printf '      %s\n' "${mutations[@]}"
    elif [ -n "$self_identity" ]; then
      red "  ✗ RED $short $subject — self-adjudication: $self_identity matches author $author_name <$author_email>"
      printf '      %s\n' "${mutations[@]}"
      red_rows=$((red_rows + 1))
    else
      red "  ✗ RED $short $subject — missing a parseable non-author Adjudicated-by: Name <email> trailer"
      printf '      %s\n' "${mutations[@]}"
      red_rows=$((red_rows + 1))
    fi
  done

  echo "  range=$FIXTURE_RANGE_BASE..$FIXTURE_RANGE_HEAD context=$FIXTURE_RANGE_CONTEXT commits=${#commits[@]} mutating_commits=$mutating_commits mutated_files=$mutated_files new_fixture_additions_exempt=$exempt_additions red=$red_rows"
  if [ "$red_rows" -gt 0 ]; then
    red "FIXTURE-ADJUDICATION GATE FAILED. A fixture mutation can let a wrong fix hide its own evidence — the lying-green class at its root. Carry an Adjudicated-by: Name <email> trailer from someone other than the commit author."
    return 1
  fi
  grn "FIXTURE-ADJUDICATION GATE PASSED."
}

if [ "${1:-}" = "--test-reachability" ]; then
  test_reachability_gate
  exit $?
fi
if [ "${1:-}" = "--fixture-adjudication" ]; then
  if [ "$#" -ne 1 ]; then
    echo "usage: bash scripts/check-constraints.sh --fixture-adjudication" >&2
    exit 2
  fi
  fixture_adjudication_gate
  exit $?
fi
if [ "$#" -ne 0 ]; then
  echo "usage: bash scripts/check-constraints.sh [--move-public-surfaces | --app-clean-names | --asset-codename | --spatial-vocabulary | --test-reachability | --fixture-adjudication | --hardcoded-ids [--strict] [--inventory] | --manifest-lineage]" >&2
  exit 2
fi

FAIL=0

echo
if ! node scripts/check-chain-ids.mjs; then
  FAIL=1
fi

echo
if ! node scripts/check-manifest-lineage.mjs; then
  FAIL=1
fi

echo
if ! move_public_surface_gate; then
  FAIL=1
fi

echo
if ! app_identifier_gate; then
  FAIL=1
fi

echo
if ! asset_codename_gate; then
  FAIL=1
fi

echo
if ! spatial_vocabulary_gate; then
  FAIL=1
fi

echo
if ! test_reachability_gate; then
  FAIL=1
fi

echo
if ! fixture_adjudication_gate; then
  FAIL=1
fi

# ── SPDX header gate: every source file carries the license identity ─────────────────────────
# The per-file marking travels with snippets (survives separation from LICENSE); the stamper
# (scripts/stamp_copyright.mjs) writes it, THIS leg keeps every NEW file honest.
spdx_gate() {
  echo "== SPDX license-header gate =="
  local missing
  # Tracked files only: the stamper runs before a file is committed, so an in-flight untracked
  # scratch file is not this gate's business.
  if ! collect_files --tracked-only '*.js' '*.mjs' '*.cjs' '*.ts' '*.tsx' '*.jsx' '*.move' '*.rs' '*.css' '*.sh' '*.yml' '*.yaml'; then
    red "  ✗ FAIL: no source files collected — this gate cannot pass on an empty scan set."
    return 1
  fi
  local scanned="${#COLLECTED_FILES[@]}"
  local f
  missing="$(
    for f in "${COLLECTED_FILES[@]}"; do
      head -3 "$f" | grep -q 'SPDX-License-Identifier' || echo "$f"
    done
  )"
  if [ -n "$missing" ]; then
    red "  ✗ FAIL: source file(s) missing the SPDX header (run: node scripts/stamp_copyright.mjs):"
    echo "$missing" | sed 's/^/      /' | head -20
    return 1
  fi
  grn "  ✓ every source file carries the SPDX header ($scanned files scanned)"
}

echo
if ! spdx_gate; then
  FAIL=1
fi

# ── secret-leak gate (S-22, 2026-07-09): no hardcoded Sui private keys, ever ────────────────────────
# A `suiprivkey1` bech32 literal long enough to be a real secret (>=20 chars past the prefix — a doc
# example like `suiprivkey1...` never matches) must NEVER land in any tracked or untracked-but-added
# file. Scans the WHOLE tree, not just the shippable-source set above — a leak in a .md/.yaml/.json is
# just as real as one in .ts (this is exactly how the 12-file S-22 leak happened: e2e/*.spec.ts and two
# root debug .mjs files, none of which are "source" in the brand-gate sense). The 5 addresses below are
# the ones already leaked once and rotated off (S-22 audit) — their reappearance in a NEW file is a
# strong signal of key reuse and fails the gate too, belt-and-braces.
#
# Two exclusions, both deliberate (not a growing escape hatch — see the brand-law gate's own EXCLUDE
# precedent above for the same pattern):
#   1. This script itself — it necessarily contains the address literals to check against them.
#   2. packages/move/scripts/out/** — GENERATED ceremony/seed manifest output. It legitimately
#      records the publishing signer's ADDRESS (not a secret) and is regenerated fresh every ceremony
#      run; a real code leak never lands here. If it ever contains a `suiprivkey1` literal, the first
#      OR-branch below still catches it — only the address-reappearance check is scoped out.
echo
echo "== AresRPG secret-leak gate (no hardcoded suiprivkey1 literals) =="
LEAKED_ADDR_RE='0xe2a45ca2df4efba794060847c157964cef4029084728ecfca004510a82d9c803|0xf3e422622a6713a7b7ec76309ff2734483f1d62845f27f2b6aaa4461ddc6872f|0xac3e6e4373708e69f29073ccb778afc8c2e16aa336c5e6d5513a2dedb8cb5db2|0xcbc75cafc71f3404f5a0ddde4fbe0990ec31feb9b5c5ee023392252bf9ed065c|0x75c0c5bfe253f86f664f0e41125c057020e505aa13b18261693a0362b917730e'
SECRET_EXCLUDES=(
  ':(exclude)**/node_modules/**' ':(exclude)**/dist/**' ':(exclude)**/build/**' ':(exclude)**/target/**'
  ':(exclude)scripts/check-constraints.sh' ':(exclude)packages/move/scripts/out/**'
)
SECRET_RE="suiprivkey1[a-z0-9]{20,}|$LEAKED_ADDR_RE"
# Positive control, run every pass: the same pattern through the same grep, over this script — which
# necessarily carries the S-22 address literals (exclusion 1 above exists for exactly that reason).
# Zero hits HERE means the scan machinery is broken, and a clean verdict from a broken scan is a lie.
if ! grep -IinE -e "$SECRET_RE" scripts/check-constraints.sh >/dev/null; then
  red "  ✗ FAIL: self-test found no known literal in scripts/check-constraints.sh — the scan machinery is broken."
  FAIL=1
elif ! collect_files "${SECRET_EXCLUDES[@]}"; then
  red "  ✗ FAIL: no files collected — this gate cannot pass on an empty scan set."
  FAIL=1
else
  SECRET_SCANNED="${#COLLECTED_FILES[@]}"
  SECRET_SCAN_OK=0
  SECRET_HITS="$(grep_collected "$SECRET_RE" -IinE)" || SECRET_SCAN_OK=$?
  if [ "$SECRET_SCAN_OK" -ne 0 ]; then
    red "  ✗ FAIL: the scan did not run to completion — see the error above; a gate that did not run never passes."
    FAIL=1
  elif [ -n "$SECRET_HITS" ]; then
    red "  ✗ FAIL: hardcoded Sui private key (or a previously-leaked S-22 address) in a tracked/working-tree file:"
    echo "$SECRET_HITS" | cut -c1-160 | sed 's/^/      /' | head -40
    echo
    red "SECRET-LEAK GATE FAILED. Keys live ONLY in an untracked .env / gitignored source, read via"
    red "process.env — a literal bech32 secret (or a burned S-22 address) must never touch a tracked file."
    FAIL=1
  else
    grn "  ✓ no hardcoded suiprivkey1 secrets, no reappearance of the S-22 leaked addresses ($SECRET_SCANNED files scanned)"
  fi
fi

# ── Move security-pattern gate (D321, lens-C pre-publish audit 2026-07-13) ──────────────────────────
# Four grep-gate additions from tonight's Move/Sui-protocol exploit-class audit, scoped to
# packages/move/**/*.move only (tracked + untracked, same git-ls-files idiom as the two gates above —
# gitignored build/ output is excluded for free). Checks 1-2 are HARD FAILS: the current tree has ZERO
# hits, so any future introduction trips the gate immediately. Checks 3-4 are WARN-only: the pattern
# already has legitimate/known hits today (printed, non-fatal, tracked for a follow-up review) — never
# weaken these patterns to silence a hit; add a reasoned exclusion instead if one is ever warranted.
#
# All four checks share ONE collected file set. `severity` is fail|warn: a warn prints and moves on,
# a fail is fatal. A scan that could NOT run is fatal at either severity — an unproven pattern is not
# an absent one, and the checkmark reads the same either way.
move_pattern_check() {
  local severity="$1" pattern="$2" hit_msg="$3" remedy="$4" clean_msg="$5"
  local hits
  local scan_ok=0
  hits="$(grep_collected "$pattern" -InE)" || scan_ok=$?
  if [ "$scan_ok" -ne 0 ]; then
    red "  ✗ FAIL: the scan did not run to completion — see the error above; an unproven pattern is not an absent one."
    return 1
  fi
  if [ -z "$hits" ]; then
    grn "  ✓ $clean_msg"
    return 0
  fi
  if [ "$severity" = warn ]; then
    ylw "  ⚠ WARN: $hit_msg"
    echo "$hits" | cut -c1-160 | sed 's/^/      /' | head -40
    return 0
  fi
  red "  ✗ FAIL: $hit_msg"
  echo "$hits" | cut -c1-160 | sed 's/^/      /' | head -40
  red "$remedy"
  return 1
}

echo
echo "== AresRPG Move security-pattern gate (mul_mod / u256-narrow / type_name::get / div-before-mul) =="
if ! collect_files ':(glob)packages/move/**/*.move'; then
  red "  ✗ FAIL: no Move sources collected — none of the four checks below can pass on an empty scan set."
  FAIL=1
else
  # 1) HARD FAIL — hand-rolled modular/wide math (the OZ Contracts-for-Sui `mul_mod` bug family: a
  #    512-bit mul_mod/div_rem early-exits on quotient overflow and silently zeros the remainder). Our
  #    codebase only ever uses the framework's u128-upcast `mul_div`/`mul_div_ceil` — a hand-rolled
  #    mul_mod/div_rem, or a locally-defined `mul_div`, must never appear.
  move_pattern_check fail 'mul_mod|mulmod|div_rem|fun mul_div' \
    'hand-rolled modular/wide math (mul_mod/div_rem/custom mul_div) in packages/move:' \
    'MUL_MOD GATE FAILED. Use the framework u128-upcast mul_div/mul_div_ceil — never hand-roll modular math.' \
    'no hand-rolled mul_mod/div_rem/custom mul_div (framework mul_div/mul_div_ceil only)' || FAIL=1

  # 2) HARD FAIL — u256 narrowing/overflow-prone casts (same OZ bug family: wide math cast back down
  #    loses the overflow signal). Scoped to an in-statement u256↔narrower-cast pairing so the
  #    legitimate zkLogin `address_seed: u256` field and the framework `address::from_u256(x as u256)`
  #    WIDENING call (creation.move, loot_box_tests.move) don't trip it — only a u256 value narrowed
  #    back down to u8/16/32/64/128 in the same statement does.
  move_pattern_check fail 'u256[^;]*as u(8|16|32|64|128)\b|as u(8|16|32|64|128)\b[^;]*u256' \
    'u256 narrowing/overflow-prone cast in packages/move:' \
    'U256-NARROW GATE FAILED. A u256 value cast down to a narrower int is the Cetus/OZ hazard shape — re-derive without the wide type, or prove the narrowing is bounds-checked.' \
    'no u256 value narrowed by an in-statement cast to a smaller int' || FAIL=1

  # 3) WARN — type_name::get (deprecated) vs with_defining_ids (upgrade-stable: defining-id vs
  #    original-id can differ for a type introduced in a package upgrade). Fires TODAY —
  #    config.move:258,266 pin the forge witness with the deprecated call while fight.move/kolizeum.move
  #    already use with_defining_ids (lens-C finding F2). Non-fatal: a mismatch fails CLOSED (forge DoS),
  #    not open, but tracked for a migration to with_defining_ids for consistency + future-proofing.
  move_pattern_check warn 'type_name::get\b' \
    'deprecated type_name::get — migrate to with_defining_ids (non-fatal, see F2):' '' \
    'no deprecated type_name::get call sites' || FAIL=1

  # 4) WARN — rounding-direction hazard: division before multiplication in the same expression
  #    (`a / b * c` truncates early and compounds; the safe form multiplies first — `a * c / b`, the
  #    framework mul_div idiom). Fires TODAY in real value math: settlement.move's XP-share kernel and
  #    foundation/world_math.move's pet speed-budget both divide-then-multiply; none of the three are
  #    proven exploitable (percentage-style scaling, not an AMM price/settlement transfer) but are
  #    tracked for a rounding-safety pass. Non-fatal.
  move_pattern_check warn '[A-Za-z0-9_]+ */ *[A-Za-z0-9_]+ *\*' \
    'division-before-multiplication (rounding-direction hazard) in value math (non-fatal):' '' \
    'no division-before-multiplication pattern in value math' || FAIL=1
fi

# The LimitsVerifier struct-field cap, sourced from the 04:09 gold-rig publish failure. The offline
# source counter refuses absent/stale build output so this pre-publish guard can never lie green.
echo
if ! node scripts/check-move-field-limits.mjs; then
  FAIL=1
fi

# ── i18n coverage gate (ticket #18) ──────────────────────────────────────────────────────────────
# Every static t()/i18nKey used in frontend/src must resolve in ALL 6 locales, and each locale's
# plural-normalized key set must exactly match en.json (the locale-stomp class). Deterministic; runs on `node`.
echo
echo "== AresRPG i18n coverage gate (used-key coverage + normalized key parity across 6 locales) =="
# Gate-framework reduction: the bespoke Python
# ratchet gates are DELETED — a law is one line in SPEC, enforced by absence of the pattern in the
# code. Survivors: the greps above, the Move field-cap gate, and the i18n gate below. The PTB
# keep-set check (packages/move/scripts/check_keepset.mjs) relocates into `ares publish` pre-flight.
if node scripts/i18n_coverage.mjs; then
  grn "I18N GATE PASSED."
else
  red "I18N GATE FAILED (see keys above)."
  FAIL=1
fi

# ── arch gates (docs/CODE_LAW.md "Arch gates", 2026-07-17) ──────────────────────────────────────
# Dataflow (semgrep: laundered store writes / fight effect-freedom / functor purity) + import graph
# (dependency-cruiser: fight hermetic, engine quarantine, no NEW cycles). Missing tools always fail:
# an unavailable analyzer has no verdict. Both ratcheted: census-day debt is baselined, anything new
# is red.
echo
if ! bash scripts/semgrep-gate.sh; then
  red "ARCH GATE (semgrep) FAILED."
  FAIL=1
fi
echo
if ! bash scripts/depcruise-gate.sh; then
  red "ARCH GATE (dependency-cruiser) FAILED."
  FAIL=1
fi
# ZERO-DRIFT (issue #914): the two fight compositions — the world's and the simulator's — resolved
# from their roots and diffed module by module. The depcruise rules above fence which DIRECTORIES
# the simulator may import from; this one asserts it runs THE SAME MODULES the world does, with the
# receipt source as the single sanctioned divergence. Same ratchet idiom: the difference is an
# enumerated manifest inside the gate, so drift reds the commit it appears in. Runs under bun (it
# uses dependency-cruiser's own resolver) and SKIPs green when the tool is absent.
echo
if ! command -v bun >/dev/null 2>&1; then
  echo "== AresRPG zero-drift gate · world fight ≡ simulator fight (issue #914) =="
  echo "  SKIP: bun not available (this bun-first repo runs dependency-cruiser under bun)"
elif ! bun scripts/zero-drift-gate.mjs; then
  red "ARCH GATE (zero-drift: world fight ≡ simulator fight) FAILED."
  FAIL=1
fi
# Deep tier (codeql: interprocedural laundered store writes / fight-fold purity / boundary
# mutation — fresh DB each run, ~40s; SKIPs green when the codeql binary is absent). Same
# ratchet: baseline/aresrpg-fp.baseline.txt is the worklist, any NEW fingerprint is red.
#
# CODEQL-JAVA holds hooks/bounded-run.sh's machine-wide peak token first (07-19 harness-
# teardown leg 3: concurrent lanes each starting their own codeql container piled up docker
# while a live deploy's own codeql leg starved). Smaller than routing this call THROUGH
# bounded-run.sh itself, which would also apply its avail-preflight refusal and RSS babysitter
# to this substep — the wrong semantics for a gate that already has its own SKIP path: source
# the extracted mutex primitives directly, wait briefly, then SKIP LOUDLY — never lie green,
# never block a commit on a contended token. A missing helper (hooks absent, e.g. a fresh
# clone without the personal agent-fleet dotfiles) falls back to today's ungated call.
echo
PEAK_LOCK_HELPER="$HOME/.claude/hooks/peak-lock.sh"
# The docker-containerised deep tier is the LOCAL pre-ship gate. In CI it is REPLACED by the native
# github/codeql-action (.github/workflows/checks.yml → fp-codeql job = the JS/TS FP-pack ratchet), so
# skip it under CI or when the codeql image is not built on this host (a bounded inspect never hangs a
# wedged daemon). Coverage is not lost — it moves to native code scanning; gate.sh's mechanics are intact.
CODEQL_TIMEOUT="$(command -v timeout || command -v gtimeout || true)"
codeql_image_present() {
  command -v docker >/dev/null 2>&1 || return 1
  ${CODEQL_TIMEOUT:+$CODEQL_TIMEOUT 20} docker image inspect aresrpg-codeql:2.26.1 >/dev/null 2>&1
}
if [ "${CI:-}" = "true" ] || [ -n "${GITHUB_ACTIONS:-}" ] || ! codeql_image_present; then
  ylw "  SKIP (codeql deep tier): not run here — CI uses the native github/codeql-action fp-codeql job; locally it runs when the aresrpg-codeql image is built."
elif [ -r "$PEAK_LOCK_HELPER" ]; then
  # shellcheck disable=SC1090
  . "$PEAK_LOCK_HELPER"
  if acquire_peak_or_skip CODEQL-JAVA "${CODEQL_PEAK_WAIT_S:-20}"; then
    if ! bash scripts/codeql/gate.sh; then
      red "ARCH GATE (codeql deep tier) FAILED."
      FAIL=1
    fi
    release_peak
  else
    echo "SKIP (codeql gate): deep tier NOT run this pass — peak token contended, see wait line above." >&2
  fi
else
  if ! bash scripts/codeql/gate.sh; then
    red "ARCH GATE (codeql deep tier) FAILED."
    FAIL=1
  fi
fi

# ── Move framework-rev gate (#1284) ─────────────────────────────────────────────────────────────
# The rule packages/move/Move.toml carried as PROSE since the FeatureNotYetSupported incident: ONE
# sui-framework + ONE move-stdlib rev per environment, and no floating git revs. It was broken anyway,
# for a year, because nothing read the lock — the graduation trigger. Pure repo bytes: no chain, no
# CLI, no network, so it costs nothing and cannot flake.
echo
if ! move_display_gate; then
  red "MOVE DISPLAY GATE FAILED."
  FAIL=1
fi

echo
echo "== AresRPG Move framework-rev gate (one framework lineage per environment) =="
if node packages/move/scripts/check_move_lock_revs.mjs; then
  :
else
  red "MOVE LOCK REV GATE FAILED."
  FAIL=1
fi

echo
if [ "$FAIL" -eq 0 ]; then
  grn "ALL CONSTRAINT GATES PASSED."
else
  red "CONSTRAINT GATES FAILED."
fi
exit "$FAIL"
