// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// COOP FULL-KIT GOLD ROW — four wallets, one L100 core class each, one public fight, and a fifth-wallet
// spectator. A spell earns coverage only from DungeonBoard's committed clock; committed-board deltas and rendered
// trigger beats are derived from the runtime catalog, and all five clients converge before the settlement oracle.
import fs from 'node:fs'

import { expect, test, type BrowserContext, type Page } from '@playwright/test'

import classes_json from '../../../packages/sdk/src/classes.json'
import { get_fields, make_client } from '../../localnet/bots/framework/sui.js'
import {
  boot_fixture_world,
  clean_return,
  engage_by_mouse,
  gold_manifest,
  snapshot,
  type FightFixture,
} from '../specs_anchor/fight_mouse_helpers'

import {
  changed_target_ids,
  find_trap_formation,
  full_kit,
  hazard_formation_holds,
  move_toward_formation,
  pass_coverage_turn,
  play_ap_grant_turn,
  play_coverage_turn,
  play_mp_grant_turn,
  type coverage_result,
  type exported_fighter,
  type runtime_spell,
  type trap_formation,
} from './coop_full_kit_helpers'
import {
  assert_victory_and_continue,
  boot_roster_lite,
  boot_world_lite,
  chain_truth_export,
  committed_drain_export,
  committed_dot_tick_export,
  committed_resource_turn_export,
  committed_visibility_export,
  discover_fights,
  fighters_snapshot,
  join_fight_by_door,
  join_refusal_message,
  living_mob,
  place_and_ready,
  play_turn,
  probe_beats,
  watch_fight_by_door,
  type committed_drain,
  type committed_dot_tick,
  type committed_resource_turn,
  type committed_visibility,
  type GoldWallet,
} from './coop_helpers'
import {
  actor_for_turn,
  effect_catalog_verdict,
  effect_evidence_fold,
  effect_evidence_verdict,
  effect_requirements_by_class,
  split_verdict,
  xp_share_kernel,
} from './coop_kernel.mjs'

const core_classes = ['senshi', 'yajin', 'tomoda', 'shugo'] as const
const actor_names = ['a', 'b', 'c', 'd'] as const

type core_class = (typeof core_classes)[number]
type actor_name = (typeof actor_names)[number]
type character_row = {
  wallet_index: number
  slot: number
  character_id: string
  kiosk_id: string
  personal_kiosk_cap_id: string
  class: string
  level: number
}
type seat_row = {
  actor: actor_name
  class_id: core_class
  page: Page
  character: character_row
  entity: string
  spell_ids: string[]
}
const unwrap = (value: any): any => (value && typeof value === 'object' && 'fields' in value ? value.fields : value)

function dig(value: any, key: string): any {
  if (value == null || typeof value !== 'object') return undefined
  const plain = unwrap(value)
  if (plain && typeof plain === 'object' && !Array.isArray(plain) && key in plain) return plain[key]
  for (const child of Object.values(plain ?? {})) {
    const found = dig(child, key)
    if (found !== undefined) return found
  }
  return undefined
}

const spell_kinds = (spell: runtime_spell) => [
  ...new Set((spell.levels[0]?.effects ?? []).map((effect) => effect.kind)),
]
const resource_for_stat = (stat: unknown): 'ap' | 'mp' | null =>
  Number(stat) === 0 ? 'ap' : Number(stat) === 1 ? 'mp' : null

test.describe('gold localnet — four-class coop full-kit fight plus spectator', () => {
  test.skip(!gold_manifest, 'no .gold-deployment.json — run `node test/gold/up_gold.mjs` first')
  test.skip(
    !gold_manifest?.fight_fixtures?.coop_full_kit,
    'gold bootstrap did not publish fight_fixtures.coop_full_kit'
  )
  test.skip(!gold_manifest?.coop_full_kit_roster, 'gold bootstrap did not publish coop_full_kit_roster')

  test('@headed @coop CREATE → JOIN ×3 → late refusal + WATCH → four complete L100 kits → five-way export → settlement', async ({
    browser,
  }) => {
    test.setTimeout(1_800_000)
    const fixture = gold_manifest.fight_fixtures.coop_full_kit as FightFixture & {
      mob_spell_damage: number
      mob_spell_area_shape: string
    }
    const roster = gold_manifest.coop_full_kit_roster as {
      fighters: character_row[]
      spectator: character_row
    }
    const wallets = gold_manifest.wallets as GoldWallet[]
    const runtime_spells = gold_manifest.runtime_catalog.catalog.spells as runtime_spell[]
    const runtime_by_id = new Map(runtime_spells.map((spell) => [spell.name_key, spell]))
    const sdk_class_ids = new Set(Object.values(classes_json).map((row) => row.id))
    const fighters_by_class = new Map(roster.fighters.map((row) => [row.class, row]))
    const planned_characters = core_classes.map((class_id) => fighters_by_class.get(class_id))

    expect(
      core_classes.every((class_id) => sdk_class_ids.has(class_id)),
      'classes.json lacks a core identity'
    ).toBe(true)
    expect(roster.fighters, 'the full-kit roster must contain exactly four fighters').toHaveLength(4)
    expect(new Set(roster.fighters.map((row) => row.wallet_index)).size, 'fighters need distinct wallets').toBe(4)
    expect(new Set(roster.fighters.map((row) => row.class)), 'one seat per core class is required').toEqual(
      new Set(core_classes)
    )
    expect(planned_characters.every(Boolean), 'the manifest is missing a core-class fighter').toBe(true)
    expect(
      planned_characters.every((row) => Number(row!.level) >= 100),
      'every fighter must be L100'
    ).toBe(true)
    expect(roster.fighters.every((row) => row.wallet_index !== roster.spectator.wallet_index)).toBe(true)
    expect(wallets[roster.spectator.wallet_index], 'the fifth wallet is missing').toBeTruthy()
    expect(fixture.mob_spell_damage, 'the heal/life-steal oracles need a positive injury source').toBeGreaterThan(0)
    expect(fixture.mob_spell_area_shape, 'the injury source must reach every seat').toBe('allmap')

    const kits = Object.fromEntries(
      core_classes.map((class_id) => [class_id, full_kit(class_id, runtime_spells)])
    ) as Record<core_class, string[]>
    const level_1 = Object.fromEntries(
      core_classes.map((class_id) => [
        class_id,
        runtime_spells
          .filter((spell) => spell.class === class_id && Number(spell.unlock_level) === 1)
          .map((spell) => spell.name_key)
          .sort(),
      ])
    ) as Record<core_class, string[]>
    const effect_requirements = effect_requirements_by_class(runtime_spells, [...core_classes], 100)
    const catalog_verdict = effect_catalog_verdict(effect_requirements)
    expect(
      catalog_verdict.ok,
      `runtime effect kinds lack an oracle classification: ${catalog_verdict.uncovered.join(', ')}`
    ).toBe(true)
    expect(
      new Set([...catalog_verdict.asserted_kinds, ...catalog_verdict.unassertable_kinds]),
      'asserted + explicitly unassertable kinds must exactly partition the runtime inventory'
    ).toEqual(new Set(catalog_verdict.kinds))
    expect(
      catalog_verdict.asserted_kinds.filter((kind: string) => catalog_verdict.unassertable_kinds.includes(kind)),
      'asserted and explicitly unassertable runtime kinds must be disjoint'
    ).toEqual([])
    for (const mandatory of ['ALTER_STAT', 'INVISIBILITY', 'GIVE_POINTS'])
      if (catalog_verdict.kinds.includes(mandatory))
        expect(catalog_verdict.asserted_kinds, `${mandatory} must never fall through an honesty waiver`).toContain(
          mandatory
        )
    for (const class_id of core_classes) {
      expect(kits[class_id].length, `${class_id} has no runtime L100 kit`).toBeGreaterThan(0)
      expect(new Set(kits[class_id]).size, `${class_id} runtime ids are duplicated`).toBe(kits[class_id].length)
      expect(level_1[class_id].length, `${class_id} has no explicit level-1 coverage row`).toBeGreaterThan(0)
      expect(
        level_1[class_id].every((spell_id) => kits[class_id].includes(spell_id)),
        `${class_id}'s level-1 ids must be included in its coverage set`
      ).toBe(true)
      expect(
        effect_requirements[class_id].length,
        `${class_id} has no runtime-derived effect-kind requirement`
      ).toBeGreaterThan(0)
    }

    const client = make_client(gold_manifest.rpc, 'localnet')
    const ids = gold_manifest.ids.aresrpg
    const contexts: BrowserContext[] = []
    const page_of = async () => {
      const context = await browser.newContext()
      contexts.push(context)
      return context.newPage()
    }

    try {
      const pages = await Promise.all(actor_names.map(page_of))
      const [creator] = planned_characters as character_row[]
      await boot_fixture_world(pages[0], wallets[creator.wallet_index], fixture, creator.character_id)
      const spawn_id = await engage_by_mouse(pages[0], fixture)
      await expect.poll(() => snapshot(pages[0]).then((state) => state.placement), { timeout: 45_000 }).toBe(true)
      const fight_id = (await snapshot(pages[0])).fight_id!
      expect(fight_id, 'engage minted no full-kit fight id').toBeTruthy()

      for (let index = 1; index < planned_characters.length; index += 1) {
        const character = planned_characters[index]!
        const page = pages[index]
        await boot_world_lite(page, wallets[character.wallet_index], fixture.world_id, character.character_id)
        await expect
          .poll(
            async () => {
              const row = (await discover_fights(page, fixture.world_id)).find((entry: any) => entry.id === fight_id)
              return row ? { public: row.public, status: row.status, join_legal: row.join_legal } : null
            },
            { timeout: 30_000, message: `${character.class} never discovered the public placement fight` }
          )
          .toEqual({ public: true, status: 'placement', join_legal: true })
        await join_fight_by_door(page, fight_id, character.character_id)
        await expect
          .poll(() => fighters_snapshot(pages[0]).then((rows) => rows.filter((row) => row.is_player).length), {
            timeout: 30_000,
            message: `${character.class} never appeared as a player seat`,
          })
          .toBe(index + 1)
      }

      const seats: seat_row[] = []
      for (let index = 0; index < actor_names.length; index += 1) {
        const class_id = core_classes[index]
        const character = planned_characters[index]!
        const state = await snapshot(pages[index])
        expect(state.me?.id, `${class_id} never received its own seat binding`).toBeTruthy()
        seats.push({
          actor: actor_names[index],
          class_id,
          page: pages[index],
          character,
          entity: state.me!.id,
          spell_ids: kits[class_id],
        })
      }

      for (const seat of seats) await place_and_ready(seat.page)
      for (const seat of seats)
        await expect
          .poll(() => snapshot(seat.page).then((state) => state.placement), {
            timeout: 45_000,
            message: `placement never closed on ${seat.actor}/${seat.class_id}`,
          })
          .toBe(false)

      const fields = await get_fields(client, fight_id)
      expect(fields, 'the live full-kit Fight object was unreadable').toBeTruthy()
      const group = unwrap(fields.group)
      const participants: Array<{ character: string; wisdom: number }> = (fields.participants ?? []).map(
        (row: any) => ({
          character: String(dig(row, 'character')),
          wisdom: Number(dig(row, 'wisdom') ?? 0),
        })
      )
      const facts = {
        xp_mult: Number(fields.xp_mult),
        aged_bp: Number(fields.aged_bp),
        total_xp: Number(group?.xp ?? 0) * (fields.mobs ?? []).length,
        participants,
      }
      expect(Number(fields.status), 'the fight must be ACTIVE after four READY commits').toBe(1)
      expect(participants).toHaveLength(4)
      expect((fields.mobs ?? []).length).toBeGreaterThan(0)
      expect((group?.loot ?? []).length, 'the settlement fixture must keep an empty loot checklist').toBe(0)

      const page_spectator = await page_of()
      await boot_roster_lite(page_spectator, wallets[roster.spectator.wallet_index])
      const refusal = await join_refusal_message(page_spectator, fight_id, roster.spectator.character_id)
      expect(refusal, 'the fifth wallet was wrongly accepted as a late fifth seat').toBeTruthy()
      expect(refusal!, 'late join must surface the humanized placement-closed copy').toMatch(/already started/i)
      expect(await page_spectator.evaluate(() => 1 + 1), 'the refused fifth client crashed').toBe(2)
      expect((await fighters_snapshot(pages[0])).filter((row) => row.is_player)).toHaveLength(4)
      await watch_fight_by_door(page_spectator, fight_id, fixture.world_id)

      const observer_pages = [...seats.map((seat) => seat.page), page_spectator]
      const converged_exports = async (accept: (exports: exported_fighter[][]) => boolean = () => true) => {
        let accepted_exports: exported_fighter[][] | null = null
        await expect
          .poll(
            async () => {
              const candidates = await Promise.all(observer_pages.map(chain_truth_export))
              const ready = candidates.every((board) => board !== null)
              const exports = candidates as exported_fighter[][]
              const serialized = exports.map((board) => JSON.stringify(board))
              const diverged = serialized.slice(1).filter((board) => board !== serialized[0]).length
              const accepted = ready && diverged === 0 && accept(exports)
              if (accepted) accepted_exports = exports
              return {
                seats: 4,
                spectators: 1,
                ready,
                diverged,
                accepted,
              }
            },
            { timeout: 90_000, message: 'four seats and the spectator never converged on one committed board' }
          )
          .toEqual({ seats: 4, spectators: 1, ready: true, diverged: 0, accepted: true })
        expect(
          accepted_exports,
          'the convergence poll returned without retaining its exact accepted sample'
        ).toBeTruthy()
        return accepted_exports!
      }
      const observed_exports = async (accept: (exports: exported_fighter[][]) => boolean) => {
        let accepted_exports: exported_fighter[][] | null = null
        await expect
          .poll(
            async () => {
              const candidates = await Promise.all(observer_pages.map(chain_truth_export))
              const ready = candidates.every((board) => board !== null)
              const exports = candidates as exported_fighter[][]
              const accepted = ready && accept(exports)
              if (accepted) accepted_exports = exports
              return { ready, accepted }
            },
            { timeout: 90_000, message: 'the five observers never exposed the required committed fighter field' }
          )
          .toEqual({ ready: true, accepted: true })
        expect(accepted_exports, 'the field-observation poll retained no accepted five-way sample').toBeTruthy()
        return accepted_exports!
      }
      const converged_visibility = async (target: string, invisible: boolean) => {
        let accepted: committed_visibility[] | null = null
        await expect
          .poll(
            async () => {
              const candidates = await Promise.all(
                observer_pages.map((page) => committed_visibility_export(page, { fight_id, target }))
              )
              const ready = candidates.every(Boolean)
              const proofs = candidates as committed_visibility[]
              const serialized = proofs.map((proof) => JSON.stringify(proof))
              const diverged = ready ? serialized.slice(1).filter((proof) => proof !== serialized[0]).length : 5
              const matched = ready && proofs.every((proof) => proof.invisible === invisible)
              if (ready && diverged === 0 && matched) accepted = proofs
              return { ready, diverged, matched }
            },
            {
              timeout: 90_000,
              message: `the five authoritative Fight exports never agreed that ${target} invisible=${invisible}`,
            }
          )
          .toEqual({ ready: true, diverged: 0, matched: true })
        expect(accepted, 'the visibility poll returned without retaining its accepted five-way sample').toBeTruthy()
        return accepted!
      }
      const converged_resource_turn = async (args: {
        entity: string
        resource: 'ap' | 'mp'
        expected_actions: number
        minimum_grant: number
        action_costs: number[]
        grant_target: { x: number; y: number }
        before: exported_fighter[]
      }) => {
        let accepted: committed_resource_turn[] | null = null
        await expect
          .poll(
            async () => {
              const candidates = await Promise.all(
                observer_pages.map((page) => committed_resource_turn_export(page, args))
              )
              const ready = candidates.every(Boolean)
              const proofs = candidates as committed_resource_turn[]
              const serialized = proofs.map((proof) => JSON.stringify(proof))
              const diverged = ready ? serialized.slice(1).filter((proof) => proof !== serialized[0]).length : 5
              if (ready && diverged === 0) accepted = proofs
              return { ready, diverged }
            },
            { timeout: 90_000, message: 'the five observers never agreed on the committed excess-budget turn' }
          )
          .toEqual({ ready: true, diverged: 0 })
        expect(accepted, 'the grant proof poll returned without retaining its accepted sample').toBeTruthy()
        return accepted!
      }
      const converged_dot_tick = async (args: {
        caster: string
        target: string
        target_cell: { x: number; y: number }
      }) => {
        let accepted: committed_dot_tick[] | null = null
        await expect
          .poll(
            async () => {
              const candidates = await Promise.all(observer_pages.map((page) => committed_dot_tick_export(page, args)))
              const ready = candidates.every(Boolean)
              const proofs = candidates as committed_dot_tick[]
              const serialized = proofs.map((proof) => JSON.stringify(proof))
              const diverged = ready ? serialized.slice(1).filter((proof) => proof !== serialized[0]).length : 5
              if (ready && diverged === 0) accepted = proofs
              return { ready, diverged }
            },
            { timeout: 90_000, message: 'the five observers never agreed on the isolated committed DoT tick' }
          )
          .toEqual({ ready: true, diverged: 0 })
        expect(accepted, 'the DoT proof poll returned without retaining its accepted sample').toBeTruthy()
        return accepted!
      }
      const converged_drain = async (args: {
        caster: string
        target: string
        resource: 'ap' | 'mp'
        cast_target: { x: number; y: number }
      }) => {
        let accepted: committed_drain[] | null = null
        await expect
          .poll(
            async () => {
              const candidates = await Promise.all(observer_pages.map((page) => committed_drain_export(page, args)))
              const ready = candidates.every(Boolean)
              const proofs = candidates as committed_drain[]
              const serialized = proofs.map((proof) => JSON.stringify(proof))
              const diverged = ready ? serialized.slice(1).filter((proof) => proof !== serialized[0]).length : 5
              if (ready && diverged === 0) accepted = proofs
              return { ready, diverged }
            },
            { timeout: 90_000, message: 'the five observers never agreed on the committed point-removal row' }
          )
          .toEqual({ ready: true, diverged: 0 })
        expect(accepted, 'the point-removal poll returned without retaining its accepted sample').toBeTruthy()
        return accepted!
      }

      // A committed spell id proves coverage; the raw-kind ledger separately requires applied-effect evidence.
      const cast_ledger = Object.fromEntries(seats.map((seat) => [seat.actor, new Set<string>()])) as Record<
        actor_name,
        Set<string>
      >
      const completed_turns = Object.fromEntries(seats.map((seat) => [seat.actor, 0])) as Record<actor_name, number>
      let effect_ledger: Record<string, Record<string, string[]>> = {}
      let formation: trap_formation | null = null
      let armed_hazard: {
        spell_id: string
        formation: trap_formation
      } | null = null
      const retry_cursor: Record<string, number> = {}
      const isolated_resource_turns = new Set<string>()

      const trap_row = effect_requirements.yajin.find((row: any) => row.kind === 'PLACE_TRAP')
      const trap_oracle_spell_id = trap_row?.spell_ids.find((spell_id: string) => {
        const spell = runtime_by_id.get(spell_id)
        return spell && Number(spell.levels[0]?.range?.[1] ?? 0) >= 2 && !spell_kinds(spell).includes('APPLY_DOT')
      })
      const push_spell_id = kits.yajin.find((spell_id) => {
        const spell = runtime_by_id.get(spell_id)
        return spell && !spell.levels[0]?.free_cell && spell_kinds(spell).includes('PUSH')
      })
      const [ap_spend_spell] = kits.tomoda
        .flatMap((spell_id) => {
          const spell = runtime_by_id.get(spell_id)
          return spell &&
            !spell.levels[0]?.free_cell &&
            Number(spell.levels[0]?.casts_per_turn ?? 0) > 1 &&
            Number(spell.levels[0]?.casts_per_target ?? 0) > 1 &&
            spell_kinds(spell).includes('DAMAGE') &&
            !spell_kinds(spell).includes('GIVE_POINTS')
            ? [spell]
            : []
        })
        .sort((left, right) => Number(right.levels[0]?.ap) - Number(left.levels[0]?.ap))
      expect(trap_row?.spell_ids.length, 'runtime Yajin catalog has no trap-kind spell').toBeGreaterThan(0)
      expect(trap_oracle_spell_id, 'no range-2 Yajin trap can be crossed by an occupied-target push').toBeTruthy()
      expect(push_spell_id, 'runtime Yajin catalog has no occupied-target displacement spell').toBeTruthy()
      expect(ap_spend_spell, 'runtime Tomoda catalog has no AP-spend follow-up spell').toBeTruthy()

      const coverage_complete = () => seats.every((seat) => cast_ledger[seat.actor].size === seat.spell_ids.length)
      const requirement_met = (row: any) =>
        core_classes.some((class_id) =>
          effect_requirements[class_id]
            .filter((candidate: any) => candidate.key === row.key && !candidate.unassertable_reason)
            .some((candidate: any) =>
              candidate.spell_ids.some((spell_id: string) =>
                (effect_ledger[class_id]?.[candidate.key] ?? []).includes(spell_id)
              )
            )
        )
      const exempted = (row: any) => !!row.unassertable_reason
      const effects_complete = () => effect_evidence_verdict(effect_requirements, effect_ledger).ok
      const retry_spell_for = (seat: seat_row) => {
        const missing = effect_requirements[seat.class_id].find(
          (row: any) => !exempted(row) && !['GIVE_POINTS', 'INVISIBILITY'].includes(row.kind) && !requirement_met(row)
        )
        if (!missing) return undefined
        if (missing.kind === 'PLACE_TRAP') return trap_oracle_spell_id
        const candidates = missing.spell_ids.filter((spell_id: string) => seat.spell_ids.includes(spell_id))
        const key = `${seat.class_id}:${missing.key}`
        const index = retry_cursor[key] ?? 0
        retry_cursor[key] = index + 1
        return candidates[index % candidates.length]
      }
      const credit_cast = async (seat: seat_row, spell_id: string, result: coverage_result) => {
        const spell = runtime_by_id.get(spell_id)
        if (!spell) return
        const rows = effect_requirements[seat.class_id].filter((row: any) => row.spell_ids.includes(spell_id))
        for (const row of rows) {
          if (exempted(row) || requirement_met(row)) continue
          if (['GIVE_POINTS', 'INVISIBILITY', 'PLACE_TRAP'].includes(row.kind)) continue
          const runtime_effect = spell.levels[0]?.effects.find((effect) => effect.kind === row.kind)
          const stat = runtime_effect?.stat ?? row.stat
          const kind_id = runtime_effect?.kind_id ?? row.kind_id
          const resource = resource_for_stat(stat)
          if (row.kind === 'APPLY_DOT') {
            const target = result.before.find(
              (fighter) =>
                fighter.team === 1 && fighter.cell?.x === result.target?.x && fighter.cell?.y === result.target?.y
            )
            if (!target || kind_id == null) continue
            const target_after = result.after.find((fighter) => fighter.id === target.id)
            // Patient Venom is Yajin seat 1; the 4v1 Euclidean queue is p0,p1,m0,p2,p3, so its victim-mob
            // start tick is in the same committed PTB immediately after p1 ends. Enemy status rows are absent
            // from the spectator's flat journal, so the fresh HP edge gates the stronger ordered Hit proof below.
            if (!target_after || target_after.hp >= target.hp) continue
            const dot_exports = await converged_dot_tick({
              caster: seat.entity,
              target: target.id,
              target_cell: result.target!,
            })
            const tick_hp = dot_exports[0].remaining_hp
            const observer_exports = await observed_exports((exports) =>
              exports.every((board) => Number(board.find((fighter) => fighter.id === target.id)?.hp) === tick_hp)
            )
            effect_ledger = effect_evidence_fold(effect_ledger, {
              class_id: seat.class_id,
              requirement_key: row.key,
              kind: row.kind,
              kind_id,
              spell_id,
              target_id: target.id,
              caster_id: seat.entity,
              before: result.before,
              after: observer_exports[0],
              observer_exports,
              dot_exports,
            })
            continue
          }
          const targets = changed_target_ids(result.before, result.after, row.kind, seat.entity, resource, stat)
          for (const target_id of targets) {
            const drain_exports =
              row.kind === 'REMOVE_POINTS' && resource && result.target
                ? await converged_drain({
                    caster: seat.entity,
                    target: target_id,
                    resource,
                    cast_target: result.target,
                  })
                : undefined
            effect_ledger = effect_evidence_fold(effect_ledger, {
              class_id: seat.class_id,
              requirement_key: row.key,
              kind: row.kind,
              kind_id,
              spell_id,
              target_id,
              caster_id: seat.entity,
              stat,
              resource,
              before: result.before,
              after: result.after,
              cast_target: result.target,
              drain_exports,
            })
          }
        }
      }
      const resource_probe_for = (seat: seat_row) => {
        const rows = effect_requirements[seat.class_id]
        const resource = rows.find((row: any) => row.kind === 'GIVE_POINTS' && !requirement_met(row))
        if (resource) return resource
        return rows.find((row: any) => row.kind === 'INVISIBILITY' && !requirement_met(row))
      }
      const credit_resource_probe = async (seat: seat_row, row: any) => {
        const resource_row =
          row.kind === 'GIVE_POINTS'
            ? row
            : effect_requirements[seat.class_id].find(
                (candidate: any) => candidate.kind === 'GIVE_POINTS' && candidate.stat === 1
              )
        const spell_id = row.kind === 'INVISIBILITY' ? row.spell_ids[0] : resource_row?.spell_ids[0]
        const spell = runtime_by_id.get(spell_id)
        const invisibility_row = effect_requirements[seat.class_id].find(
          (candidate: any) => candidate.kind === 'INVISIBILITY' && candidate.spell_ids.includes(spell_id)
        )
        const invisibility = invisibility_row && !requirement_met(invisibility_row) ? invisibility_row : undefined
        expect(resource_row, `${seat.class_id}/${row.key} has no matching resource requirement`).toBeTruthy()
        expect(spell, `${seat.class_id}/${row.key} has no runtime grant spell`).toBeTruthy()
        expect(
          resource_row!.spell_ids,
          `${seat.class_id}/${row.key} must be proved by the same spell that carries its catalog grant`
        ).toContain(spell_id)
        if (resource_row?.stat === 0) {
          expect(seat.class_id, 'the AP spender must belong to the AP-granting seat').toBe(ap_spend_spell!.class)
        }
        if (
          invisibility_row &&
          (await committed_visibility_export(seat.page, { fight_id, target: seat.entity }))?.invisible
        ) {
          // Full-kit casting may have armed Vanish before this isolated proof turn. Let that real status expire;
          // accepting an already-hidden baseline would erase the required false→true visibility edge.
          await pass_coverage_turn(seat.page)
          completed_turns[seat.actor] += 1
          return
        }
        const baseline_exports = await converged_exports()
        const visibility_before_exports = invisibility ? await converged_visibility(seat.entity, false) : undefined
        const [baseline] = baseline_exports
        const baseline_fighter = baseline.find((fighter) => fighter.id === seat.entity)
        const live = (await snapshot(seat.page)).me
        const baseline_pool = resource_row?.stat === 0 ? baseline_fighter?.ap : baseline_fighter?.mp
        const live_pool = resource_row?.stat === 0 ? live?.ap : live?.mp
        expect(live_pool, 'the isolated resource turn did not start at the committed five-way baseline').toBe(
          baseline_pool
        )
        const result =
          resource_row?.stat === 0
            ? await play_ap_grant_turn(seat.page, seat.entity, spell!, ap_spend_spell!)
            : await play_mp_grant_turn(seat.page, seat.entity, spell!)
        completed_turns[seat.actor] += 1
        if (!result.spell_committed || (!result.committed && !invisibility)) return
        if (result.committed) {
          const observer_exports = await observed_exports((exports) => {
            const fighters = exports.map((board) => board.find((candidate) => candidate.id === seat.entity))
            const cells = fighters.map((fighter) => JSON.stringify(fighter?.cell ?? null))
            return fighters.every(Boolean) && cells.slice(1).every((cell) => cell === cells[0])
          })
          const [after] = observer_exports
          const minimum_grant = spell!.levels[0]?.effects
            .filter((effect) => effect.kind === 'GIVE_POINTS' && Number(effect.stat) === Number(resource_row!.stat))
            .reduce((sum, effect) => sum + Number(effect.base ?? 0), 0)
          expect(minimum_grant, `${spell_id} has no positive learned-rank grant floor`).toBeGreaterThan(0)
          // A critical grant can exceed the catalog floor. Retry it instead of asking five flat-journal exports
          // to pretend they can recover the hidden critical delta; the ordinary row is proved exactly.
          if (result.grant === minimum_grant) {
            expect(result.remaining, `${spell_id} did not retain a real post-spend budget`).not.toBeNull()
            expect(result.grant_target, `${spell_id} did not retain its committed grant target`).toBeTruthy()
            const action_costs =
              result.resource === 'ap'
                ? [
                    Number(spell!.levels[0]?.ap ?? 0),
                    ...Array.from({ length: Math.max(0, result.committed_casts - 1) }, () =>
                      Number(ap_spend_spell!.levels[0]?.ap ?? 0)
                    ),
                  ]
                : []
            const turn_exports = await converged_resource_turn({
              entity: seat.entity,
              resource: result.resource,
              expected_actions: result.committed_casts,
              minimum_grant,
              action_costs,
              grant_target: result.grant_target!,
              before: result.before,
            })
            effect_ledger = effect_evidence_fold(effect_ledger, {
              class_id: seat.class_id,
              requirement_key: resource_row!.key,
              kind: 'GIVE_POINTS',
              spell_id,
              target_id: seat.entity,
              stat: resource_row!.stat,
              before: result.before,
              after,
              resource: result.resource,
              grant: result.grant,
              minimum_grant,
              spent: result.spent,
              remaining: result.remaining,
              committed_casts: result.committed_casts,
              grant_target: result.grant_target,
              observer_exports,
              before_exports: baseline_exports,
              turn_exports,
            })
          }
        }
        if (invisibility && visibility_before_exports) {
          const visibility_after_exports = await converged_visibility(seat.entity, true)
          effect_ledger = effect_evidence_fold(effect_ledger, {
            class_id: seat.class_id,
            requirement_key: invisibility.key,
            kind: 'INVISIBILITY',
            kind_id: invisibility.kind_id,
            spell_id,
            target_id: seat.entity,
            before: result.before,
            after: result.after,
            before_exports: visibility_before_exports,
            observer_exports: visibility_after_exports,
          })
        }
      }

      const coverage_deadline = Date.now() + 1_200_000
      while ((!coverage_complete() || !effects_complete()) && Date.now() < coverage_deadline) {
        let acted = false
        for (const seat of seats) {
          const state = await snapshot(seat.page)
          const actor = actor_for_turn({ active: state.active, presenting: state.presenting }, seats)
          if (actor !== seat.actor || state.active !== seat.entity) continue
          if (
            armed_hazard &&
            !hazard_formation_holds((await chain_truth_export(seat.page)) as exported_fighter[], armed_hazard.formation)
          )
            armed_hazard = null
          const hazard_push_due: boolean = armed_hazard != null && seat.class_id === 'yajin'
          if (armed_hazard && !hazard_push_due) {
            await pass_coverage_turn(seat.page)
            completed_turns[seat.actor] += 1
            acted = true
            break
          }
          if (hazard_push_due && (await move_toward_formation(seat.page, armed_hazard!.formation))) {
            completed_turns[seat.actor] += 1
            acted = true
            break
          }
          const resource_probe = !hazard_push_due && coverage_complete() ? resource_probe_for(seat) : null
          if (resource_probe) {
            const isolation_key = `${seat.class_id}/${resource_probe.key}`
            if (!isolated_resource_turns.has(isolation_key)) {
              await pass_coverage_turn(seat.page)
              isolated_resource_turns.add(isolation_key)
              completed_turns[seat.actor] += 1
              acted = true
              break
            }
            isolated_resource_turns.delete(isolation_key)
            await credit_resource_probe(seat, resource_probe)
            acted = true
            break
          }
          const dot_pending = effect_requirements.yajin.find(
            (row: any) => row.kind === 'APPLY_DOT' && !requirement_met(row)
          )
          const uncast = seat.spell_ids.find(
            (spell_id) =>
              !cast_ledger[seat.actor].has(spell_id) &&
              !(
                dot_pending &&
                seat.class_id === 'shugo' &&
                spell_kinds(runtime_by_id.get(spell_id)!).includes('PLACE_GLYPH')
              )
          )
          const spell_id: string | undefined = hazard_push_due
            ? push_spell_id!
            : (uncast ??
              (coverage_complete() || (dot_pending && seat.class_id === 'yajin') ? retry_spell_for(seat) : undefined))
          if (!spell_id) {
            await pass_coverage_turn(seat.page)
            completed_turns[seat.actor] += 1
            acted = true
            break
          }
          const places_trap: boolean = seat.class_id === 'yajin' && spell_id === trap_oracle_spell_id
          if (places_trap) {
            formation = await find_trap_formation(seat.page)
            expect(formation, 'no reachable player→mob→trap formation exists').toBeTruthy()
            if (await move_toward_formation(seat.page, formation!)) {
              completed_turns[seat.actor] += 1
              acted = true
              break
            }
          }
          const preferred_target = places_trap ? formation!.trap : null
          const trap_trigger_after_t =
            armed_hazard && spell_id === push_spell_id
              ? Math.max(0, ...(await probe_beats(seat.page)).map((beat) => beat.t))
              : null
          const result = await play_coverage_turn(seat.page, seat.entity, spell_id, preferred_target)
          completed_turns[seat.actor] += 1
          acted = true
          if (!result.committed) break

          cast_ledger[seat.actor].add(spell_id)
          await credit_cast(seat, spell_id, result)
          if (places_trap) {
            const trap_armed = await expect
              .poll(
                () =>
                  seat.page.evaluate(async (cell) => {
                    const [{ fight_view }, { encode }] = await Promise.all([
                      import('/@id/@aresrpg/fight/project'),
                      import('/@id/@aresrpg/fight/los'),
                    ])
                    return fight_view()?.my_traps?.includes(encode(cell.x, cell.y)) === true
                  }, formation!.trap),
                { timeout: 4_000 }
              )
              .toBe(true)
              .then(() => true)
              .catch(() => false)
            if (trap_armed)
              armed_hazard = {
                spell_id,
                formation: formation!,
              }
          }
          if (spell_id === push_spell_id && armed_hazard) {
            const hazard = armed_hazard
            const before_mob = result.before.find((fighter) => fighter.id === hazard.formation.mob_id)
            const after_mob = result.after.find((fighter) => fighter.id === hazard.formation.mob_id)
            if (
              !before_mob?.cell ||
              !after_mob?.cell ||
              (before_mob.cell.x === after_mob.cell.x && before_mob.cell.y === after_mob.cell.y)
            )
              break
            let trigger_beat: Awaited<ReturnType<typeof probe_beats>>[number] | null = null
            expect(trap_trigger_after_t, 'trap push did not retain its acting-client beat cursor').not.toBeNull()
            await expect
              .poll(
                async () => {
                  trigger_beat =
                    (await probe_beats(seat.page)).find(
                      (beat) =>
                        beat.t > trap_trigger_after_t! &&
                        beat.kind === 'trap_trigger' &&
                        beat.id === hazard.formation.mob_id
                    ) ?? null
                  return trigger_beat
                },
                {
                  timeout: 60_000,
                  message: 'the acting mounted participant never rendered the pushed mob’s trap-trigger beat',
                }
              )
              .toMatchObject({ kind: 'trap_trigger', id: hazard.formation.mob_id })
            const placed = effect_requirements.yajin.find(
              (row: any) => row.kind === 'PLACE_TRAP' && row.spell_ids.includes(hazard.spell_id)
            )
            if (placed)
              effect_ledger = effect_evidence_fold(effect_ledger, {
                class_id: 'yajin',
                requirement_key: placed.key,
                kind: 'PLACE_TRAP',
                spell_id: hazard.spell_id,
                target_id: hazard.formation.mob_id,
                before: result.before,
                after: result.after,
                trap_cell: hazard.formation.trap,
                trigger_after_t: trap_trigger_after_t,
                trigger_beat,
              })
            armed_hazard = null
          }
          break
        }
        if (!acted) await pages[0].waitForTimeout(400)
        expect(
          await living_mob(pages[0]),
          'the fixture died before coverage and effect evidence completed'
        ).toBeTruthy()
      }
      for (const seat of seats) {
        expect(completed_turns[seat.actor], `${seat.actor}/${seat.class_id} never completed a turn`).toBeGreaterThan(0)
        expect([...cast_ledger[seat.actor]].sort(), `${seat.class_id} did not cast its complete runtime kit`).toEqual(
          [...seat.spell_ids].sort()
        )
        expect(
          level_1[seat.class_id].every((spell_id) => cast_ledger[seat.actor].has(spell_id)),
          `${seat.class_id} did not explicitly cover every level-1 runtime spell`
        ).toBe(true)
      }
      const effect_verdict = effect_evidence_verdict(effect_requirements, effect_ledger)
      expect(effect_verdict.ok, `export-visible effect evidence missing: ${effect_verdict.missing.join(', ')}`).toBe(
        true
      )

      // Receipt-only timed rows (notably Vanish) legitimately make the caster richer than journal-only observers.
      // Advance real turns until those rows expire; the final byte-equality oracle must never erase that difference.
      let exports: exported_fighter[][] | null = null
      const convergence_deadline = Date.now() + 240_000
      while (!exports && Date.now() < convergence_deadline) {
        const candidates = await Promise.all(observer_pages.map(chain_truth_export))
        if (
          candidates.every((board) => board !== null) &&
          candidates.slice(1).every((board) => JSON.stringify(board) === JSON.stringify(candidates[0]))
        ) {
          exports = candidates as exported_fighter[][]
          break
        }
        let advanced = false
        for (const seat of seats) {
          const state = await snapshot(seat.page)
          const actor = actor_for_turn({ active: state.active, presenting: state.presenting }, seats)
          if (actor !== seat.actor || state.active !== seat.entity) continue
          await pass_coverage_turn(seat.page)
          completed_turns[seat.actor] += 1
          advanced = true
          break
        }
        if (!advanced) await pages[0].waitForTimeout(400)
        expect(await living_mob(pages[0]), 'the fixture died while timed rows settled for export').toBeTruthy()
      }
      expect(exports, 'four seats and the spectator never converged after timed rows expired').toBeTruthy()

      // Pre-victory oracle: four seats plus the watch-door spectator converge on one committed byte stream.
      const export_names = ['a', 'b', 'c', 'd', 'spectator'] as const
      const export_bytes = exports!.map((board) => `${JSON.stringify(board, null, 2)}\n`)
      for (const bytes of export_bytes.slice(1))
        expect(bytes, 'committed board exports were not byte-identical').toBe(export_bytes[0])
      const out_dir = new URL('../out/', import.meta.url)
      fs.mkdirSync(out_dir, { recursive: true })
      for (let index = 0; index < export_names.length; index += 1)
        fs.writeFileSync(new URL(`coop_full_kit_export_${export_names[index]}.json`, out_dir), export_bytes[index])
      for (const board of exports!.slice(1)) expect(board, 'a five-way export diverged').toEqual(exports![0])

      const victory = pages[0].locator('[role="dialog"][aria-label^="Victory:"]')
      const kill_deadline = Date.now() + 360_000
      while (!(await victory.isVisible()) && Date.now() < kill_deadline) {
        let acted = false
        for (const seat of seats) {
          const state = await snapshot(seat.page)
          const actor = actor_for_turn({ active: state.active, presenting: state.presenting }, seats)
          if (actor !== seat.actor || state.active !== seat.entity) continue
          await play_turn(seat.page, { max_casts: 6 })
          acted = true
          break
        }
        if (!acted) await pages[0].waitForTimeout(400)
      }
      await expect(victory).toBeVisible({ timeout: 150_000 })

      const minted = await expect
        .poll(
          async () => {
            const events = await (client as any).queryEvents({
              query: { MoveEventType: `${ids.ENGINE_PACKAGE_ID}::fight_events::ResultMinted` },
              limit: 50,
              order: 'descending',
            })
            return (events?.data ?? [])
              .map((event: any) => event.parsedJson)
              .filter((row: any) => row?.fight === fight_id).length
          },
          { timeout: 90_000, message: 'settlement never minted all four seat results' }
        )
        .toBe(4)
        .then(async () => {
          const events = await (client as any).queryEvents({
            query: { MoveEventType: `${ids.ENGINE_PACKAGE_ID}::fight_events::ResultMinted` },
            limit: 50,
            order: 'descending',
          })
          return (events?.data ?? [])
            .map((event: any) => event.parsedJson)
            .filter((row: any) => row?.fight === fight_id)
        })
      const wisdom_by_character = Object.fromEntries(participants.map((row) => [row.character, row.wisdom]))
      const verdict = split_verdict(
        minted.map((row: any) => ({
          character: String(row.character),
          outcome: Number(row.outcome),
          xp_share: String(row.xp_share),
          loot_len: 0,
        })),
        {
          total_xp: facts.total_xp,
          aged_bp: facts.aged_bp,
          xp_mult: facts.xp_mult,
          wisdom_by_character,
        }
      )
      expect(verdict.ok, `four-seat split verdict failed: ${verdict.reason}`).toBe(true)
      const share_of = (character: string) =>
        xp_share_kernel({
          total_xp: facts.total_xp,
          party_size: minted.length,
          wisdom: wisdom_by_character[character] ?? 0,
          aged_bp: facts.aged_bp,
          xp_mult: facts.xp_mult,
        })
      for (const seat of seats)
        expect(
          await assert_victory_and_continue(seat.page),
          `${seat.actor}/${seat.class_id} rendered XP diverged from its chain share`
        ).toBe(share_of(seat.character.character_id))
      await clean_return(pages[0], spawn_id)
    } finally {
      for (const context of contexts) await context.close().catch(() => {})
    }
  })
})
