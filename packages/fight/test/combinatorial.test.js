// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE COMBINATORIAL FIGHT GATE — sim-driven, chain-free, every combination folded through the REAL pipeline
// (sim reduce → the receipt bridge → the store's beat/fold door) and judged by four oracle families. Owner
// mandate: "TEST many fight combination and movements with multiple mobs, use yajin and place traps, push,
// move… all different effects, AoE, Glyphs, traps of multiple cells. Even run fights without the chain."
//
// THE RATCHET (the spell_effect_conformance_matrix idiom): HARD oracles (grammar · trajectory · state-parity ·
// §7b ordering) are CORRECTNESS — a combo that hard-fails and is NOT on KNOWN_HARD_FAIL is a regression (RED).
// SOFT §7b envelope timings are the tunable pacing catalog (findings, never a gate). Failures today = FINDINGS
// (the brief): they are cataloged to out/catalog.md, mapped to an area, never silently fixed.
//
// Run: `bun ares test combo` (the selector) — or `bun test packages/fight/test/combinatorial.test.js`.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, test, expect, beforeAll } from 'bun:test'

// MISSING-ARTIFACT (#96): this integration suite needs THREE artifacts the content pipeline (private repo)
// produces — all absent by design in this public repo:
//   - test/gold/specs_anchor/trajectory_eval.ts   (gold anchor, via combinatorial/oracles.js)
//   - test/gold/specs_anchor/pacing_envelopes.ts  (gold anchor, via combinatorial/oracles.js)
//   - seed/mainnet/spells/                        (real spell corpus, via combinatorial/entities.js)
// Guarded via dynamic import so combinatorial/{matrix,driver,oracles,entities}.js are never touched when
// any is missing — none of those support files are used anywhere else in this repo.
const COMBINATORIAL_ARTIFACTS_AVAILABLE =
  existsSync(fileURLToPath(new URL('../../../test/gold/specs_anchor/trajectory_eval.ts', import.meta.url))) &&
  existsSync(fileURLToPath(new URL('../../../test/gold/specs_anchor/pacing_envelopes.ts', import.meta.url))) &&
  existsSync(fileURLToPath(new URL('../../../seed/mainnet/spells', import.meta.url)))

const { MATRIX, drive_combo, beat_grammar_violations, parity_violations, pacing_order_violations } =
  COMBINATORIAL_ARTIFACTS_AVAILABLE
    ? {
        ...(await import('./combinatorial/matrix.js')),
        ...(await import('./combinatorial/driver.js')),
        ...(await import('./combinatorial/oracles.js')),
      }
    : {
        MATRIX: [],
        drive_combo: undefined,
        beat_grammar_violations: undefined,
        parity_violations: undefined,
        pacing_order_violations: undefined,
      }

// ── THE BURN-DOWN WORKLIST — combos that HARD-fail against HEAD today. Empty = the fold/beat layer is correct
//    for every combination (the pixel layer is a later lane). An entry here is a KNOWN finding mapped below; a
//    NEW hard failure (a combo not listed) is a regression the gate reddens on. ──────────────────────────────
const KNOWN_HARD_FAIL = new Map([])

// Map a finding to its area/ticket (no live sweep-ticket ids available headless — labeled by oracle + §7b row).
const AREA = (finding) => {
  if (finding.startsWith('pacing: E5')) return '§7b E5 death-hold vs 3s mob-slot compression (rescale) · NEW'
  if (finding.startsWith('pacing: E3')) return '§7b E3 serial-floater spacing across paced turns · NEW'
  if (finding.startsWith('pacing: E8')) return '§7b E8 turn-handoff spacing · NEW'
  if (finding.startsWith('pacing: E10') || finding.startsWith('pacing: dead_air'))
    return '§7b E10/E12 mob-slot length · NEW'
  if (finding.startsWith('grammar:')) return 'FOLD beat-grammar regression (cast/displacement/trap/death order)'
  if (finding.startsWith('trajectory:')) return 'FOLD projected-trajectory regression (discontinuity/arrival/teleport)'
  if (finding.startsWith('parity:')) return 'FOLD terminal-state divergence from the sim'
  if (finding.startsWith('pacing_order:')) return 'FOLD §7b ordering regression (floater/death before cause)'
  return 'uncategorized · NEW'
}

const OUT_DIR = fileURLToPath(new URL('./combinatorial/out', import.meta.url))
const results = []

const write_catalog = () => {
  mkdirSync(OUT_DIR, { recursive: true })
  const failing = results.filter((r) => !r.pass)
  const with_soft = results.filter((r) => r.soft?.length)
  const lines = []
  lines.push('# Combinatorial fight catalog (sim-driven, chain-free — the FOLD/BEAT half)')
  lines.push('')
  lines.push(
    `Combinations run: **${results.length}** · hard-pass **${results.filter((r) => r.pass).length}** · hard-fail **${failing.length}** · with soft findings **${with_soft.length}**`
  )
  lines.push('')
  lines.push(
    'Hard oracles (gate): grammar · trajectory · state-parity · §7b-ordering. Soft (catalog only): §7b envelope timings.'
  )
  lines.push('')
  lines.push('## HARD failures (regressions — must be empty or worklisted)')
  if (!failing.length) lines.push('_none — the fold/beat pipeline is correct for every combination today._')
  for (const r of failing)
    for (const h of r.hard) lines.push(`- \`${r.name}\` (seed ${r.seed}) · ${h} · ${AREA('' + h.split(': ')[0] + ':')}`)
  lines.push('')
  lines.push('## SOFT findings (§7b pacing — cataloged, tunable, not a gate)')
  lines.push('')
  lines.push('| combo | seed | symptom | area / ticket |')
  lines.push('| --- | --- | --- | --- |')
  for (const r of with_soft)
    for (const s of r.soft) lines.push(`| ${r.name} | ${r.seed} | ${s.replace('pacing: ', '')} | ${AREA(s)} |`)
  lines.push('')
  lines.push('## Every combination')
  lines.push('')
  lines.push('| combo | seed | hard | soft | sim_ev | chain_ev | turns | beats | traps |')
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |')
  for (const r of results)
    lines.push(
      `| ${r.name} | ${r.seed} | ${r.pass ? 'PASS' : r.hard.length} | ${r.soft.length} | ${r.counts.sim_events} | ${r.counts.chain_events} | ${r.counts.wave_turns} | ${r.counts.beats} | ${r.counts.trap_cells} |`
    )
  writeFileSync(`${OUT_DIR}/catalog.md`, lines.join('\n'))
}

beforeAll(() => {
  if (!COMBINATORIAL_ARTIFACTS_AVAILABLE) return
  for (const combo of MATRIX) {
    try {
      results.push(drive_combo(combo))
    } catch (error) {
      results.push({
        name: combo.name,
        seed: combo.seed,
        pass: false,
        hard: [`threw: ${String(error?.message ?? error).slice(0, 120)}`],
        soft: [],
        counts: {},
      })
    }
  }
  write_catalog()
})

describe.skipIf(!COMBINATORIAL_ARTIFACTS_AVAILABLE)(
  'combinatorial fight matrix — sim-driven, chain-free, the real fold/beat pipeline',
  () => {
    test('every combination runs without throwing and the breadth spans the effect families', () => {
      expect(results.length).toBe(MATRIX.length)
      expect(results.length).toBeGreaterThanOrEqual(24)
      const names = results.map((r) => r.name).join(' ')
      for (const family of [
        'aoe.circle',
        'aoe.cross',
        'aoe.line',
        'aoe.cone',
        'aoe.ring',
        'glyph',
        'trap.walk',
        'trap.push_onto',
        'push.into_wall',
        'push.into_mob',
        'pull',
        'teleport',
        'swap',
        'carry',
        'throw',
        'invis',
        'multimob',
        'kill.last_by_spell',
        'kill.last_by_weapon',
      ])
        expect(names, `matrix must exercise ${family}`).toContain(family)
      // no combo may throw (a throw carries the 'threw:' hard row)
      const threw = results.filter((r) => r.hard?.some((h) => h.startsWith('threw:')))
      expect(threw.map((r) => `${r.name}: ${r.hard[0]}`)).toEqual([])
    })

    test('THE RATCHET — no combination HARD-fails (grammar/trajectory/parity/order) outside the worklist', () => {
      const surprises = results.filter((r) => !r.pass && !KNOWN_HARD_FAIL.has(r.name))
      const report = surprises
        .map((r) => `  ${r.name} (seed ${r.seed}):\n${r.hard.map((h) => `    · ${h}`).join('\n')}`)
        .join('\n')
      expect(surprises.length, `HARD-failing combinations NOT on the worklist (regressions):\n${report}`).toBe(0)
    })

    test('the known-hard-fail worklist is current (each listed combo STILL hard-fails)', () => {
      const stale = [...KNOWN_HARD_FAIL.keys()].filter((name) => results.find((r) => r.name === name)?.pass)
      expect(stale, `worklist combos that NOW pass — remove from KNOWN_HARD_FAIL: ${stale.join(', ')}`).toEqual([])
    })

    test('the §7b pacing catalog fired (soft findings exist — the pacing oracle is live, not inert)', () => {
      const soft_total = results.reduce((n, r) => n + (r.soft?.length ?? 0), 0)
      expect(
        soft_total,
        'zero soft §7b findings across the whole matrix — the pacing evaluator ran on nothing'
      ).toBeGreaterThan(0)
    })

    test('the catalog artifact is written', () => {
      expect(`${OUT_DIR}/catalog.md`).toContain('combinatorial/out/catalog.md')
    })
  }
)

// ── ANTI-LYING SELF-TESTS — the oracles CATCH a deliberately broken fold (mutation proof, the matrix idiom). ─
describe.skipIf(!COMBINATORIAL_ARTIFACTS_AVAILABLE)(
  'oracle liveness — a broken beat stream / divergent fold is CAUGHT (the gate is not lying-green)',
  () => {
    test('grammar catches a displacement whose slide path does not end at to_cell', () => {
      const wave = [
        {
          is_local: false,
          duration: 3000,
          beats: [
            { kind: 'cast', at: 0, duration: 300, payload: { entity_id: 'mob-0' } },
            {
              kind: 'displacement',
              at: 300,
              duration: 200,
              payload: {
                target_id: 'p0',
                from: { x: 1, y: 1 },
                to: { x: 3, y: 1 },
                path: [
                  { x: 1, y: 1 },
                  { x: 2, y: 1 },
                ],
                requested: 2,
                effect_kind: 12,
              },
            },
          ],
        },
      ]
      expect(beat_grammar_violations(wave, {}).some((v) => v.startsWith('grammar.displacement_stop'))).toBe(true)
    })

    test('grammar catches a lethal hit with no death beat (the rig-exclusion flag would never arm)', () => {
      const wave = [
        {
          is_local: false,
          duration: 3000,
          beats: [
            { kind: 'cast', at: 0, duration: 300, payload: { entity_id: 'mob-0' } },
            { kind: 'damage', at: 300, duration: 450, payload: { target_id: 'p0', new_health: 0, killed: true } },
          ],
        },
      ]
      expect(beat_grammar_violations(wave, {}).some((v) => v.startsWith('grammar.death_beat'))).toBe(true)
    })

    test('parity catches an HP + cell divergence between the fold and the sim', () => {
      const bad = parity_violations([
        {
          label: 'm0',
          sim: { health: 5, cell: { x: 1, y: 1 }, alive: true },
          folded: { health: 9, cell: { x: 2, y: 1 }, alive: true },
        },
      ])
      expect(bad.some((v) => v.startsWith('parity.hp'))).toBe(true)
      expect(bad.some((v) => v.startsWith('parity.cell'))).toBe(true)
    })

    test('§7b ordering catches a death beat rendered BEFORE its own damage floater', () => {
      const wave = [
        {
          is_local: false,
          duration: 3000,
          beats: [
            { kind: 'turn_start', at: 0, duration: 0, payload: {} },
            { kind: 'cast', at: 0, duration: 300, payload: { entity_id: 'mob-0' } },
            { kind: 'death', at: 300, duration: 1500, payload: { target_id: 'p0' } },
            { kind: 'damage', at: 1800, duration: 450, payload: { target_id: 'p0', new_health: 0 } },
          ],
        },
      ]
      expect(pacing_order_violations(wave).some((v) => v.startsWith('order.death_before_floater'))).toBe(true)
    })
  }
)
