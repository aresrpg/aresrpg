// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// COOP GOLD ROW — two real players (plus one deserter and one latecomer), ONE public overworld fight, everyone
// paid (the required bar: "fights 100% working" — every driven green to date was SOLO; this is the
// first multiplayer fight proof). One fight covers the whole claim surface:
//   A (ctx 1) claims a PUBLIC fight through the real [R]-pill engage (openness default = PUBLIC);
//   B (ctx 2) DISCOVERS it through the FightsModal's exact read (/v1 → to_fight_marker → is_join_legal) and
//     joins through the product join door (fight::join PTB) during the placement window;
//   D (ctx 3) joins the same way, then DESERTS mid-fight (context close) — the liquidation crank must carry
//     the fight past the dead seat (never a wedge);
//   C (ctx 4) attempts the SAME join AFTER placement closed and gets the honest humanized refusal (engine
//     ENotPlacement → "That fight already started…"), no crash;
//   settlement pays ALL THREE seats: the ResultMinted events must equal this spec's EXACT xp_share_kernel twin
//   per seat (chain truth, not adjectives), the surviving dialogs must render those same numbers, and the
//   deserter's outcome must sit owned, match, and OPEN cleanly (a disconnect never forfeits pay).
// LOOT NOTE: the multi_turn fixture authors an EMPTY loot table (fight_fixtures.mjs mints no MobLootEntry), so
// the per-seat loot leg is proven VACUOUSLY (group checklist length 0 asserted on-chain + on the deserter's
// outcome object). A loot-carrying coop fixture is a named rider in the lane report.
import { expect, test, type BrowserContext, type Page } from '@playwright/test'

import { get_fields, make_client, owned_by_type, submit } from '../../localnet/bots/framework/sui.js'
import { signerOf } from '../lib_gold.mjs'
import { open_result_ptb } from '../../../packages/sdk/src/fight.js'
import {
  boot_fixture_world,
  clean_return,
  engage_by_mouse,
  gold_manifest,
  snapshot,
  type FightFixture,
} from '../specs_anchor/fight_mouse_helpers'

import {
  assert_victory_and_continue,
  boot_roster_lite,
  boot_world_lite,
  discover_fights,
  fighters_snapshot,
  join_fight_by_door,
  join_refusal_message,
  living_mob,
  place_and_ready,
  play_turn,
  probe_beats,
  type GoldWallet,
} from './coop_helpers'
import {
  actor_for_turn,
  split_verdict,
  stall_budget_ms,
  visibility_complete,
  visibility_fold,
  xp_share_kernel,
} from './coop_kernel.mjs'

// ── manifest plumbing (tolerant unwrap of the chain JSON view — the marketplace idiom) ──────────────────────

const unwrap = (value: any): any => (value && typeof value === 'object' && 'fields' in value ? value.fields : value)
/** Depth-first search for the FIRST occurrence of a named field in a chain-JSON tree. */
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

function character_row(wallet_index: number, slot: number) {
  return (gold_manifest?.characters ?? []).find((row: any) => row.wallet_index === wallet_index && row.slot === slot)
}

test.describe('gold localnet — coop public fight (two joiners, one deserter, one latecomer)', () => {
  test.skip(!gold_manifest, 'no .gold-deployment.json — run `node test/gold/up_gold.mjs` first')
  test.skip(!gold_manifest?.fight_fixtures?.multi_turn, 'gold bootstrap did not publish fight_fixtures.multi_turn')

  test('@headed @coop CREATE public → DISCOVER+JOIN ×2 → late-join refusal → alternating turns both ways → desertion crank → per-seat settlement', async ({
    browser,
  }) => {
    test.setTimeout(600_000)
    const fixture = gold_manifest.fight_fixtures.multi_turn as FightFixture
    const wallets = gold_manifest.wallets as GoldWallet[]
    // Seat plan (collision-free with the market fixture's reserved slot-0 rows on wallets 0/1/2):
    //   A creator w0/slot1 · B joiner w1/slot1 · D deserter w3/slot0 · C latecomer w2/slot0 (refusal is
    //   pre-flight/abort-only — the market buyer's kiosk state is never mutated by a refused join).
    const seat_a = character_row(0, 1)
    const seat_b = character_row(1, 1)
    const seat_d = character_row(3, 0)
    const seat_c = character_row(2, 0)
    expect(seat_a && seat_b && seat_d && seat_c, 'gold bootstrap is missing a coop character row').toBeTruthy()
    const client = make_client(gold_manifest.rpc, 'localnet')
    const ids = gold_manifest.ids.aresrpg

    const contexts: BrowserContext[] = []
    const page_of = async () => {
      const context = await browser.newContext()
      contexts.push(context)
      return context.newPage()
    }
    try {
      // ── 1 · A claims a PUBLIC fight through the real engage (openness default = PUBLIC) ────────────────────
      const page_a = await page_of()
      await boot_fixture_world(page_a, wallets[0], fixture, seat_a.character_id)
      const spawn_id = await engage_by_mouse(page_a, fixture)
      await expect.poll(() => snapshot(page_a).then((state) => state.placement), { timeout: 45_000 }).toBe(true)
      const fight_id = (await snapshot(page_a)).fight_id!
      expect(fight_id, 'engage minted no fight id').toBeTruthy()

      // ── 2 · B discovers through the FightsModal read, then joins through the product door ─────────────────
      const page_b = await page_of()
      await boot_world_lite(page_b, wallets[1], fixture.world_id, seat_b.character_id)
      await expect
        .poll(
          async () => {
            const rows = await discover_fights(page_b, fixture.world_id)
            const row = rows.find((entry: any) => entry.id === fight_id)
            return row ? { public: row.public, status: row.status, join_legal: row.join_legal } : null
          },
          { timeout: 30_000, message: 'the public fight never became discoverable on /v1 during placement' }
        )
        .toEqual({ public: true, status: 'placement', join_legal: true })
      await join_fight_by_door(page_b, fight_id, seat_b.character_id)
      await expect
        .poll(() => fighters_snapshot(page_a).then((rows) => rows.filter((row) => row.is_player).length), {
          timeout: 30_000,
          message: "B's seat never appeared on A's board (join cross-visibility)",
        })
        .toBe(2)

      // ── 3 · D joins the same way — three seats before anyone readies ─────────────────────────────────────
      const page_d = await page_of()
      await boot_world_lite(page_d, wallets[3], fixture.world_id, seat_d.character_id)
      await join_fight_by_door(page_d, fight_id, seat_d.character_id)
      await expect
        .poll(() => fighters_snapshot(page_a).then((rows) => rows.filter((row) => row.is_player).length), {
          timeout: 30_000,
          message: "D's seat never appeared on A's board",
        })
        .toBe(3)

      // Seat → entity map (the kernel router's ground truth, captured from each page's OWN binding).
      const entity_of = async (page: Page) => (await snapshot(page)).me!.id
      const seats = [
        { actor: 'A', page: page_a, character: seat_a.character_id, entity: await entity_of(page_a) },
        { actor: 'B', page: page_b, character: seat_b.character_id, entity: await entity_of(page_b) },
        { actor: 'D', page: page_d, character: seat_d.character_id, entity: await entity_of(page_d) },
      ]
      const entity_by_actor = Object.fromEntries(seats.map((seat) => [seat.actor, seat.entity]))

      // ── 4 · all three place with the hardened gesture (sequential READY — last ready auto-starts) ────────
      await place_and_ready(page_a)
      await place_and_ready(page_b)
      await place_and_ready(page_d)
      for (const seat of seats)
        await expect
          .poll(() => snapshot(seat.page).then((state) => state.placement), {
            timeout: 45_000,
            message: `placement never closed on ${seat.actor}'s board after the last READY`,
          })
          .toBe(false)

      // ── 5 · fight facts off the LIVE object (destroyed at settlement — read now): the split's inputs ─────
      const facts = await (async () => {
        const fields = await get_fields(client, fight_id)
        expect(fields, 'the live Fight object was unreadable during ACTIVE').toBeTruthy()
        const group = unwrap(fields.group)
        const participants = (fields.participants ?? []).map((row: any) => ({
          character: String(dig(row, 'character')),
          wisdom: Number(dig(row, 'wisdom') ?? 0),
        }))
        return {
          status: Number(fields.status),
          turn_ms: Number(fields.turn_ms),
          xp_mult: Number(fields.xp_mult),
          aged_bp: Number(fields.aged_bp),
          group_xp: Number(group?.xp ?? 0),
          group_loot_len: (group?.loot ?? []).length,
          mob_count: (fields.mobs ?? []).length,
          participants,
        }
      })()
      expect(facts.status, 'the fight must be ACTIVE after the last READY').toBe(1)
      expect(facts.participants).toHaveLength(3)
      expect(facts.mob_count).toBeGreaterThan(0)
      expect(facts.group_loot_len, 'fixture law: the multi_turn mob authors an EMPTY loot table').toBe(0)
      const wisdom_by_character = Object.fromEntries(facts.participants.map((row) => [row.character, row.wisdom]))
      const total_xp = facts.group_xp * facts.mob_count

      // ── 6 · acceptance (a): the latecomer's join after placement closed = the honest refusal, no crash ───
      const page_c = await page_of()
      await boot_roster_lite(page_c, wallets[2])
      const refusal = await join_refusal_message(page_c, fight_id, seat_c.character_id)
      expect(refusal, 'the late join was wrongly accepted (no refusal surfaced)').toBeTruthy()
      expect(refusal!, 'the refusal must be the humanized placement-closed copy, never a raw abort').toMatch(
        /already started/i
      )
      expect(await page_c.evaluate(() => 1 + 1), 'the refused page crashed').toBe(2)
      expect((await fighters_snapshot(page_a)).filter((row) => row.is_player)).toHaveLength(3)

      // ── 7 · round 1: every seat plays one real turn; every OTHER board renders it (both ways) ────────────
      const played: Record<string, number> = { A: 0, B: 0, D: 0 }
      const live = () => seats.filter((seat) => !seat.page.isClosed())
      const step = async (max_casts: number) => {
        for (const seat of live()) {
          const state = await snapshot(seat.page)
          const turn = actor_for_turn({ active: state.active, presenting: state.presenting }, seats)
          if (turn === seat.actor && state.me && state.active === state.me.id) {
            const result = await play_turn(seat.page, { max_casts })
            played[seat.actor] += 1
            return { seat, result }
          }
        }
        await page_a.waitForTimeout(500)
        return null
      }
      const mob_hp_initial = (await living_mob(page_a))!.hp
      const round_1_deadline = Date.now() + 240_000
      while ((played.A < 1 || played.B < 1 || played.D < 1) && Date.now() < round_1_deadline) await step(1)
      expect(played, 'round 1 never completed a turn for every seat').toEqual({ A: 1, B: 1, D: 1 })
      // Cross-visibility BOTH WAYS: every observer's rendered beat layer carries the OTHERS' casts…
      const required_pairs: Array<[string, string]> = [
        ['A', 'B'],
        ['A', 'D'],
        ['B', 'A'],
        ['D', 'A'],
      ]
      await expect
        .poll(
          async () => {
            let ledger: Record<string, string[]> = {}
            for (const seat of live())
              ledger = visibility_fold(ledger, seat.actor, await probe_beats(seat.page), entity_by_actor)
            return visibility_complete(ledger, required_pairs)
          },
          { timeout: 60_000, message: 'cross-visibility beats incomplete after round 1' }
        )
        .toEqual({ ok: true, missing: [] })
      // …and every board agrees on the mob's HP (consensus = everyone folded everyone's damage).
      await expect
        .poll(
          async () => {
            const hps = await Promise.all(live().map(async (seat) => (await living_mob(seat.page))?.hp ?? null))
            return { agreed: new Set(hps).size === 1, dropped: hps.every((hp) => hp != null && hp < mob_hp_initial) }
          },
          { timeout: 60_000, message: 'the boards never converged on the mob HP after round 1' }
        )
        .toEqual({ agreed: true, dropped: true })

      // ── 8 · acceptance (b): D deserts mid-fight — the crank must carry the fight past the dead seat ──────
      const [, , context_d] = contexts
      await context_d.close()
      const round_2_deadline = Date.now() + 240_000
      while ((played.A < 2 || played.B < 2) && Date.now() < round_2_deadline) await step(1)
      expect({ A: played.A, B: played.B }, 'round 2 (post-desertion) never completed for A and B').toEqual({
        A: 2,
        B: 2,
      })
      expect(await living_mob(page_a), 'the mob died before the desertion stall — retune round casts').toBeTruthy()
      // The queue now reaches D's deserted seat: within the stall budget (deadline + crank + wave) a FRESH
      // playable turn must land on a surviving seat — the fight never wedges.
      await expect
        .poll(
          async () => {
            for (const seat of live()) {
              const state = await snapshot(seat.page)
              if (state.me && state.active === state.me.id && !state.presenting) return true
            }
            return false
          },
          {
            timeout: stall_budget_ms(facts.turn_ms),
            message: `no surviving seat became playable within ${stall_budget_ms(facts.turn_ms)}ms of the deserted turn — the fight WEDGED`,
          }
        )
        .toBe(true)

      // ── 9 · finish: stacked casts to victory on the surviving seats ──────────────────────────────────────
      const victory = page_a.locator('[role="dialog"][aria-label^="Victory:"]')
      const kill_deadline = Date.now() + 300_000
      while (!(await victory.isVisible()) && Date.now() < kill_deadline) await step(6)
      await expect(victory).toBeVisible({ timeout: 150_000 })

      // ── 10 · acceptance (c): settlement pays all three seats the EXACT kernel share ──────────────────────
      const minted = await expect
        .poll(
          async () => {
            const events = await (client as any).queryEvents({
              query: { MoveEventType: `${ids.ENGINE_PACKAGE_ID}::fight_events::ResultMinted` },
              limit: 50,
              order: 'descending',
            })
            const rows = (events?.data ?? [])
              .map((event: any) => event.parsedJson)
              .filter((row: any) => row?.fight === fight_id)
            return rows.length
          },
          { timeout: 60_000, message: 'settlement never minted the three seat results' }
        )
        .toBe(3)
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
      const verdict = split_verdict(
        minted.map((row: any) => ({
          character: String(row.character),
          outcome: Number(row.outcome),
          xp_share: String(row.xp_share),
          loot_len: 0, // authored-empty checklist, asserted at facts.group_loot_len + on D's outcome below
        })),
        { total_xp, aged_bp: facts.aged_bp, xp_mult: facts.xp_mult, wisdom_by_character }
      )
      expect(verdict.ok, `per-seat split verdict failed: ${verdict.reason}`).toBe(true)

      // ── 11 · the surviving dialogs render their OWN chain share, Continue opens, clean world return ──────
      const share_of = (character: string) =>
        xp_share_kernel({
          total_xp,
          party_size: minted.length,
          wisdom: wisdom_by_character[character] ?? 0,
          aged_bp: facts.aged_bp,
          xp_mult: facts.xp_mult,
        })
      expect(await assert_victory_and_continue(page_a), "A's rendered +XP diverged from its chain share").toBe(
        share_of(seat_a.character_id)
      )
      await clean_return(page_a, spawn_id)
      expect(await assert_victory_and_continue(page_b), "B's rendered +XP diverged from its chain share").toBe(
        share_of(seat_b.character_id)
      )

      // ── 12 · the deserter's pay survives: outcome owned by D, exact share, empty checklist, and it OPENS ─
      const outcome_type = `${ids.ENGINE_PACKAGE_ID}::settlement::FightOutcome`
      const outcome = await expect
        .poll(
          async () => {
            const owned = await owned_by_type(client, wallets[3].address, outcome_type)
            return owned.find((row: any) => dig(row?.data?.content, 'fight') === fight_id)?.data?.objectId ?? null
          },
          { timeout: 45_000, message: "the deserter's FightOutcome never reached its owner" }
        )
        .not.toBeNull()
        .then(async () => {
          const owned = await owned_by_type(client, wallets[3].address, outcome_type)
          return owned.find((row: any) => dig(row?.data?.content, 'fight') === fight_id)!
        })
      const outcome_fields = unwrap(outcome.data!.content) as any
      expect(Number(outcome_fields.outcome)).toBe(2)
      expect(BigInt(outcome_fields.xp_share)).toBe(share_of(seat_d.character_id))
      expect((outcome_fields.loot ?? []).length, 'the deserter checklist must match the authored-empty table').toBe(0)
      const open = await submit({
        client,
        signer: await signerOf(wallets[3].privkey),
        tx: open_result_ptb({ network: 'localnet', ids: { aresrpg: ids } })({
          outcome_id: outcome.data!.objectId,
          kiosk_id: seat_d.kiosk_id,
          personal_kiosk_cap_id: seat_d.personal_kiosk_cap_id,
        }),
        sender: wallets[3].address,
      })
      expect(open.ok, `the deserter's outcome refused to open: ${open.abort ?? open.error ?? 'unknown'}`).toBe(true)
      expect(open.digest, 'the deserter open produced no digest').toBeTruthy()
    } finally {
      for (const context of contexts) await context.close().catch(() => {})
    }
  })
})
