// DISPOSABLE PROBE — red→green proof for the mobEffect pre-mapper range-collapse defect.
// Census-proven: alley_bunny minted [1,1] against an authored [1,3]; all 374 mobs voided (the pre-mapper's own
// value/value_max fallback chain never read damageMin/damageMax and pre-collapsed the range before effectRange
// — the hardened family-paired law inside effectFx — ever saw the row).
//
// Extracts the pure range-resolution slice (KIND_PHASE..mobEffect: SIGNED_EFFECT_KINDS, encodeEffectValue,
// effectRange, EL_ID, MOB_OFFENSIVE, mobEffect) as SOURCE TEXT from BOTH the pre-fix HEAD revision (git show,
// no working-tree edits yet at that commit) and the current on-disk file, evals each in isolation, and diffs the
// resolved range for three REAL authored mob-kit rows (seed/mainnet/01_first_shore/mobs.json — the exact file
// loadCorpus() reads via g('mobs.json')). No chain calls, no client.js import, no network.
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(__dir, '..', '..', '..', '..')
const SCRIPT = path.join(REPO, 'packages/move/scripts/seed_full_corpus.mjs')

// Real authored rows, verbatim from seed/mainnet/01_first_shore/mobs.json (the loader loadCorpus() uses).
const ROWS = {
  kick: { kind: 0, op: 'damage', element: 'earth', base: 1, damageMin: 1, damageMax: 3 }, // alley_bunny "Kick"
  savage_fury: { kind: 9, op: 'alter_stat', stat: 8, value: 28, turns: 2 }, // alley_bunny "Savage Fury" (signed, fixed)
  bull_rush: { kind: 12, op: 'push', value: 2 }, // green_walker "Bull Rush" (non-signed, fixed)
}
const EXPECT_AFTER = {
  kick: { raw: [1, 3], encoded: [1, 3] },
  savage_fury: { raw: [28, 28], encoded: [32768 + 28, 32768 + 28] },
  bull_rush: { raw: [2, 2], encoded: [2, 2] },
}

function extract_slice(source) {
  const start = source.indexOf('const KIND_PHASE = {')
  const end = source.indexOf('\n// new_spell_level')
  if (start === -1 || end === -1)
    throw new Error('probe: anchor markers not found — file shape moved, update the probe')
  return source.slice(start, end)
}

function build_scope(source) {
  const body = `'use strict'\nconst SHIFT = 32768\n${extract_slice(source)}\nreturn { effectRange, mobEffect, encodeEffectValue }`
  // eslint-disable-next-line no-new-func -- disposable local probe, evaluates trusted in-repo source only
  return new Function(body)()
}

function resolve_all(scope) {
  const out = {}
  for (const [name, row] of Object.entries(ROWS)) {
    const mapped = scope.mobEffect(row)
    const [rawMin, rawMax] = scope.effectRange(mapped)
    const a = scope.encodeEffectValue(row.kind, rawMin)
    const b = scope.encodeEffectValue(row.kind, rawMax)
    out[name] = { raw: [rawMin, rawMax], encoded: [Math.min(a, b), Math.max(a, b)] }
  }
  return out
}

const before_src = execSync('git show HEAD:packages/move/scripts/seed_full_corpus.mjs', {
  cwd: REPO,
  encoding: 'utf8',
})
const after_src = readFileSync(SCRIPT, 'utf8')

const before = resolve_all(build_scope(before_src))
const after = resolve_all(build_scope(after_src))

console.log('--- BEFORE (HEAD, pre-fix) ---')
console.log(JSON.stringify(before))
console.log('--- AFTER (working tree, post-fix) ---')
console.log(JSON.stringify(after))

let fail = false
console.log('--- ASSERT (AFTER must match expected; kick must differ from BEFORE) ---')
for (const [name, want] of Object.entries(EXPECT_AFTER)) {
  const got = after[name]
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`${name}: got=${JSON.stringify(got)} want=${JSON.stringify(want)} ${ok ? 'PASS' : 'FAIL'}`)
  if (!ok) fail = true
}
const regressed = JSON.stringify(before.kick.raw) === JSON.stringify(after.kick.raw)
console.log(
  `kick red→green: BEFORE.raw=${JSON.stringify(before.kick.raw)} AFTER.raw=${JSON.stringify(after.kick.raw)} ${regressed ? 'FAIL (unchanged)' : 'PASS (changed)'}`
)
if (regressed) fail = true
for (const name of ['savage_fury', 'bull_rush']) {
  const same = JSON.stringify(before[name]) === JSON.stringify(after[name])
  console.log(`${name} regression guard (must be unchanged): ${same ? 'PASS' : 'FAIL'}`)
  if (!same) fail = true
}
if (fail) {
  console.error('\nPROBE FAILED')
  process.exit(1)
}
console.log('\nPROBE PASSED')
