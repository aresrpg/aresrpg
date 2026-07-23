// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// COOP FULL-KIT GOLD ROW — four wallets, one L100 core class each, one public fight, and a fifth-wallet
// spectator. A spell earns coverage only from DungeonBoard's committed clock; export-visible effect evidence is
// derived from the runtime catalog, and all five clients must converge before the four-seat settlement oracle.
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
  move_toward_formation,
  pass_coverage_turn,
  play_coverage_turn,
  trap_formation_holds,
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
  discover_fights,
  fighters_snapshot,
  join_fight_by_door,
  join_refusal_message,
  living_mob,
  place_and_ready,
  play_turn,
  watch_fight_by_door,
  type GoldWallet,
} from './coop_helpers'
import {
  actor_for_turn,
  effect_evidence_fold,
  effect_evidence_verdict,
  effect_requirements_by_class,
  observable_effect_family,
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
type shield_pending = {
  class_id: core_class
  spell_id: string
  target_id: string
  before: exported_fighter[]
  after: exported_fighter[]
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

function spell_families(spell: runtime_spell) {
  return [
    ...new Set(
      (spell.levels[0]?.effects ?? []).flatMap((effect) => {
        const family = observable_effect_family(effect.kind)
        return family ? [family] : []
      })
    ),
  ]
}

function unshielded_control_loss(before: exported_fighter[], after: exported_fighter[], target_id: string) {
  const later = new Map(after.map((row) => [row.id, row]))
  return Math.max(
    0,
    ...before
      .filter(
        (row) =>
          row.team === 0 &&
          row.id !== target_id &&
          !row.effects.some((effect) => effect.kind === 24 && Number(effect.value ?? 0) > 0)
      )
      .map((row) => row.hp - (later.get(row.id)?.hp ?? row.hp))
  )
}

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
    expect(fixture.mob_spell_damage, 'the shield oracle needs a positive control hit').toBeGreaterThan(0)
    expect(fixture.mob_spell_area_shape, 'the control hit must reach every seat').toBe('allmap')

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
        `${class_id} has no export-observable effect family`
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
      const participants = (fields.participants ?? []).map((row: any) => ({
        character: String(dig(row, 'character')),
        wisdom: Number(dig(row, 'wisdom') ?? 0),
      }))
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

      // A committed spell id proves coverage; a separate ledger requires an export-visible applied effect.
      const cast_ledger = Object.fromEntries(seats.map((seat) => [seat.actor, new Set<string>()])) as Record<
        actor_name,
        Set<string>
      >
      const completed_turns = Object.fromEntries(seats.map((seat) => [seat.actor, 0])) as Record<actor_name, number>
      let effect_ledger: Record<string, Record<string, string[]>> = {}
      let shield_pendings: shield_pending[] = []
      let formation: trap_formation | null = null
      let armed_trap: { spell_id: string; formation: trap_formation } | null = null
      const retry_cursor: Record<string, number> = {}

      const trap_row = effect_requirements.yajin.find((row: any) => row.family === 'trap')
      const [trap_spell_id] = trap_row?.spell_ids ?? []
      const push_spell_id = kits.yajin.find((spell_id) => {
        const spell = runtime_by_id.get(spell_id)
        return spell && !spell.levels[0]?.free_cell && spell_families(spell).includes('displacement')
      })
      expect(trap_spell_id, 'runtime Yajin catalog has no trap-family spell').toBeTruthy()
      expect(push_spell_id, 'runtime Yajin catalog has no occupied-target displacement spell').toBeTruthy()

      const coverage_complete = () => seats.every((seat) => cast_ledger[seat.actor].size === seat.spell_ids.length)
      const requirement_met = (class_id: core_class, row: any) =>
        row.spell_ids.some((spell_id: string) => (effect_ledger[class_id]?.[row.family] ?? []).includes(spell_id))
      const effects_complete = () => effect_evidence_verdict(effect_requirements, effect_ledger).ok
      const retry_spell_for = (seat: seat_row) => {
        const missing = effect_requirements[seat.class_id].find((row: any) => !requirement_met(seat.class_id, row))
        if (!missing) return undefined
        const candidates = missing.spell_ids.filter((spell_id: string) => seat.spell_ids.includes(spell_id))
        const key = `${seat.class_id}:${missing.family}`
        const index = retry_cursor[key] ?? 0
        retry_cursor[key] = index + 1
        return candidates[index % candidates.length]
      }
      const credit_cast = (seat: seat_row, spell_id: string, result: coverage_result) => {
        const spell = runtime_by_id.get(spell_id)
        if (!spell) return
        for (const family of spell_families(spell)) {
          if (family === 'trap') continue
          const targets = changed_target_ids(result.before, result.after, family)
          if (family === 'shield') {
            shield_pendings.push(
              ...targets.map((target_id) => ({
                class_id: seat.class_id,
                spell_id,
                target_id,
                before: result.before,
                after: result.after,
              }))
            )
            continue
          }
          for (const target_id of targets)
            effect_ledger = effect_evidence_fold(effect_ledger, {
              class_id: seat.class_id,
              family,
              spell_id,
              target_id,
              before: result.before,
              after: result.after,
            })
        }
      }
      const fold_shield_followups = async () => {
        const followup = (await chain_truth_export(pages[0])) as exported_fighter[]
        shield_pendings = shield_pendings.filter((pending) => {
          const incoming_damage = unshielded_control_loss(pending.after, followup, pending.target_id)
          const shielded_before = pending.after.find((row) => row.id === pending.target_id)?.hp
          const shielded_after = followup.find((row) => row.id === pending.target_id)?.hp
          if (!incoming_damage || shielded_before !== shielded_after) return true
          const next = effect_evidence_fold(effect_ledger, {
            ...pending,
            family: 'shield',
            followup,
            incoming_damage,
          })
          const credited = next !== effect_ledger
          effect_ledger = next
          return !credited
        })
      }

      const coverage_deadline = Date.now() + 1_200_000
      while ((!coverage_complete() || !effects_complete()) && Date.now() < coverage_deadline) {
        await fold_shield_followups()
        let acted = false
        for (const seat of seats) {
          const state = await snapshot(seat.page)
          const actor = actor_for_turn({ active: state.active, presenting: state.presenting }, seats)
          if (actor !== seat.actor || state.active !== seat.entity) continue
          if (
            armed_trap &&
            !trap_formation_holds(
              (await chain_truth_export(seat.page)) as exported_fighter[],
              seats[1].entity,
              armed_trap.formation
            )
          )
            armed_trap = null
          const trap_push_due =
            armed_trap &&
            seat.class_id === 'yajin' &&
            (!cast_ledger[seat.actor].has(push_spell_id!) || coverage_complete())
          if (armed_trap && !trap_push_due && seat.class_id !== 'yajin') {
            await pass_coverage_turn(seat.page)
            completed_turns[seat.actor] += 1
            acted = true
            break
          }
          const uncast = seat.spell_ids.find((spell_id) => !cast_ledger[seat.actor].has(spell_id))
          const spell_id = trap_push_due
            ? push_spell_id!
            : (uncast ?? (coverage_complete() ? retry_spell_for(seat) : undefined))
          if (!spell_id) {
            await pass_coverage_turn(seat.page)
            completed_turns[seat.actor] += 1
            acted = true
            break
          }

          if (seat.class_id === 'yajin' && spell_id === trap_spell_id) {
            formation = await find_trap_formation(seat.page)
            expect(formation, 'no reachable player→mob→trap formation exists').toBeTruthy()
            if (await move_toward_formation(seat.page, formation!)) {
              completed_turns[seat.actor] += 1
              acted = true
              break
            }
          }
          const preferred_target = spell_id === trap_spell_id ? formation!.trap : null
          const result = await play_coverage_turn(seat.page, seat.entity, spell_id, preferred_target)
          completed_turns[seat.actor] += 1
          acted = true
          if (!result.committed) break

          cast_ledger[seat.actor].add(spell_id)
          credit_cast(seat, spell_id, result)
          if (spell_id === trap_spell_id) armed_trap = { spell_id, formation: formation! }
          if (spell_id === push_spell_id && armed_trap) {
            const before_mob = result.before.find((row) => row.id === armed_trap!.formation.mob_id)
            const after_mob = result.after.find((row) => row.id === armed_trap!.formation.mob_id)
            if (
              before_mob &&
              after_mob?.cell?.x === armed_trap.formation.trap.x &&
              after_mob.cell.y === armed_trap.formation.trap.y &&
              after_mob.hp < before_mob.hp
            )
              effect_ledger = effect_evidence_fold(effect_ledger, {
                class_id: 'yajin',
                family: 'trap',
                spell_id: armed_trap.spell_id,
                target_id: armed_trap.formation.mob_id,
                before: result.before,
                after: result.after,
                trap_cell: armed_trap.formation.trap,
                trigger_cell: after_mob.cell,
              })
            armed_trap = null
          }
          break
        }
        if (!acted) await pages[0].waitForTimeout(400)
        expect(
          await living_mob(pages[0]),
          'the fixture died before coverage and effect evidence completed'
        ).toBeTruthy()
      }
      await fold_shield_followups()

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
      for (const class_id of core_classes)
        for (const requirement of effect_requirements[class_id])
          expect(
            requirement.spell_ids.some((spell_id: string) =>
              (effect_ledger[class_id]?.[requirement.family] ?? []).includes(spell_id)
            ),
            `${class_id}/${requirement.family} has no applied runtime-catalog effect`
          ).toBe(true)

      // Pre-victory oracle: four seats plus the watch-door spectator converge on one committed byte stream.
      const observer_pages = [...seats.map((seat) => seat.page), page_spectator]
      await expect
        .poll(
          async () => {
            const exports = await Promise.all(observer_pages.map(chain_truth_export))
            const serialized = exports.map((board) => JSON.stringify(board))
            return {
              seats: 4,
              spectators: 1,
              ready: exports.every((board) => board !== null),
              diverged: serialized.slice(1).filter((board) => board !== serialized[0]).length,
            }
          },
          { timeout: 90_000, message: 'four seats and the spectator never converged on one committed board' }
        )
        .toEqual({ seats: 4, spectators: 1, ready: true, diverged: 0 })

      const exports = await Promise.all(observer_pages.map(chain_truth_export))
      const export_names = ['a', 'b', 'c', 'd', 'spectator'] as const
      const export_bytes = exports.map((board) => `${JSON.stringify(board, null, 2)}\n`)
      for (const bytes of export_bytes.slice(1))
        expect(bytes, 'committed board exports were not byte-identical').toBe(export_bytes[0])
      const out_dir = new URL('../out/', import.meta.url)
      fs.mkdirSync(out_dir, { recursive: true })
      for (let index = 0; index < export_names.length; index += 1)
        fs.writeFileSync(new URL(`coop_full_kit_export_${export_names[index]}.json`, out_dir), export_bytes[index])
      for (const board of exports.slice(1)) expect(board, 'a five-way export diverged').toEqual(exports[0])

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
