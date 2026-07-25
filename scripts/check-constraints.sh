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

if [ "${1:-}" = "--hardcoded-ids" ]; then
  shift
  node scripts/check-chain-ids.mjs "$@"
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
      "packages/frontend/scripts/", // asset-pipeline .test.mjs helpers outside src/ (frontend test script = "bun test src")
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

if [ "${1:-}" = "--test-reachability" ]; then
  test_reachability_gate
  exit $?
fi
if [ "$#" -ne 0 ]; then
  echo "usage: bash scripts/check-constraints.sh [--move-public-surfaces | --app-clean-names | --test-reachability | --hardcoded-ids [--strict] [--inventory] | --manifest-lineage]" >&2
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
if ! test_reachability_gate; then
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
# (A former #3, scripts/walrus/out/display_swap_report.json, is gone with its only producer —
# publish-boundary sweep 2026-07-23: walrus_display_step.mjs moved to the seed repo.)
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
# Dataflow (semgrep: laundered store writes / fight effect-freedom / functor purity — SKIPs green
# when the semgrep binary is absent) + import graph (dependency-cruiser: fight hermetic, engine
# quarantine, no NEW cycles). Both ratcheted: census-day debt is baselined, anything new is red.
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

echo
if [ "$FAIL" -eq 0 ]; then
  grn "ALL CONSTRAINT GATES PASSED."
else
  red "CONSTRAINT GATES FAILED."
fi
exit "$FAIL"
