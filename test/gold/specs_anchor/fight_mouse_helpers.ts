// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, type Locator, type Page } from '@playwright/test'

import { CLICK_POLICY, click_decision, type Cell, type ClickPolicy } from './click_verify'
import { run_fight_recovery, type FightRecoveryState } from './fight_recovery'
import { settle_search } from './search_retry'

const gold = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest_path = path.join(gold, '.gold-deployment.json')

export const gold_manifest = fs.existsSync(manifest_path) ? JSON.parse(fs.readFileSync(manifest_path, 'utf8')) : null

export type GoldWallet = { address: string; privkey: string }
export type FightFixture = {
  world_id: string
  mob_template_id: string
  mob_name: string
  mob_hp: number
}
export type { Cell } from './click_verify'
type Fighter = {
  id: string
  name: string
  team: number
  cell: Cell
  dead: boolean
  health: number
  committed: { alive: boolean; hp: number }
  ap: number
  mp: number
  is_player: boolean
}
type FightSnapshot = {
  fight_id: string | null
  placement: boolean
  active: string | null
  armed: string | null
  presenting: boolean
  turn: number
  me: Fighter | null
  mobs: Fighter[]
  placement_cells: Cell[]
  arena: { width: number; height: number; cells: number[] } | null
}

const api = () => String(gold_manifest?.api ?? 'http://127.0.0.1:3100')
export const cell_key = (cell: Cell) => `${cell.x}:${cell.y}`

async function press_release(page: Page) {
  await page.mouse.down()
  await page.waitForTimeout(90)
  await page.mouse.up()
  await page.waitForTimeout(220)
}

async function human_click_point(page: Page, point: { x: number; y: number }) {
  await page.mouse.move(point.x, point.y, { steps: 8 })
  await page.waitForTimeout(120)
  await press_release(page)
}

export async function human_click_locator(page: Page, locator: Locator) {
  await expect(locator).toBeVisible()
  const box = await locator.boundingBox()
  expect(box, 'visible control must expose a mouse-clickable box').toBeTruthy()
  await human_click_point(page, { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 })
}

async function boot_roster(page: Page, wallet: GoldWallet) {
  await page.addInitScript(
    (payload: { key: string; ids: any }) => {
      ;(window as any).__ARES_DEV_KEY = payload.key
      ;(window as any).__ARES_LOCALNET_IDS = payload.ids
    },
    { key: wallet.privkey, ids: gold_manifest.ids.aresrpg }
  )
  await page.goto('/characters?dev')
  await expect
    .poll(() => page.evaluate(() => !!(window as any).__ARES_ENGINE?.get_state().sui?.loaded), {
      timeout: 45_000,
      message: 'gold roster did not resolve',
    })
    .toBe(true)
}

async function join_fixture_world(page: Page, world_id: string, character_id: string | null = null) {
  const joined = await page.evaluate(
    async ({ requested_world, requested_character }) => {
      // No load_roster re-run here: boot_roster's `sui.loaded` poll already proved the roster — `loaded: true`
      // rides the SAME atomic dispatch as `characters` (boot_roster.js:96-98 / load_roster.js:188-199), so a
      // re-load was a duplicated effect.
      const join = await import('/src/world-shell/world_join.js')
      const engine = (window as any).__ARES_ENGINE
      const rows = engine.get_state().sui.characters
      // Manifest-driven pick when the caller names one (a wallet's [0] can be market-fixture-reserved —
      // its kiosk state then refuses world join); default stays the first roster row.
      const character = requested_character ? rows.find((row: any) => row.id === requested_character) : rows[0]
      if (!character) return null
      engine.dispatch('action/select_character', character.id)
      const result = await join.join_world_action({ character_id: character.id, world_id: requested_world })
      return { character_id: character.id, digest: result?.timing?.digest ?? null }
    },
    { requested_world: world_id, requested_character: character_id }
  )
  expect(joined?.character_id, 'fixture wallet has no (matching) character').toBeTruthy()
  expect(joined?.digest, 'fixture world join produced no certified digest').toBeTruthy()
  return joined!.character_id
}

async function next_zone(page: Page, world_id: string, excluded: string[]) {
  return page.evaluate(
    async ({ requested_world, excluded_keys }) => {
      const [checkpoint, sdk_module, game_api, coords, rpc] = await Promise.all([
        import('/src/chain/read_checkpoint.js'),
        import('/src/chain/sdk'),
        // bare specifiers can't resolve in a browser-native import (page.evaluate) — Vite's /@id/ escape can.
        import('/@id/@aresrpg/sdk/game'),
        import('/@id/@aresrpg/sdk/coords'),
        import('/src/rpc/client'),
      ])
      const engine = (window as any).__ARES_ENGINE
      const character_id = engine.get_state().selected_character_id
      const current = character_id ? await checkpoint.read_checkpoint(character_id, requested_world) : null
      if (!character_id || !current) return null
      const sdk = await sdk_module.get_sdk()
      const world = await game_api.get_world({ grpc_client: sdk.grpc_client })(requested_world)
      const offsets = coords.world_offsets(world)
      const zone_size = Number(world.zone_size ?? 32)
      const known = new Set(
        (await rpc.get_zones(requested_world, undefined, true)).zones.map((row: any) => `${row.zx}:${row.zy}`)
      )
      for (const key of excluded_keys) known.add(key)
      const cx = Math.floor(Number(current.x) / zone_size)
      const cy = Math.floor(Number(current.z) / zone_size)
      const choices: Array<{ zx: number; zy: number; x: number; z: number; distance: number }> = []
      for (let radius = 0; radius <= 16 && choices.length === 0; radius += 1) {
        for (let dx = -radius; dx <= radius; dx += 1)
          for (let dy = -radius; dy <= radius; dy += 1) {
            const zx = cx + dx
            const zy = cy + dy
            const key = `${zx}:${zy}`
            if (zx < 0 || zy < 0 || known.has(key)) continue
            const x = Math.min(Number(world.bounds_x) - 1, zx * zone_size + Math.floor(zone_size / 2))
            const z = Math.min(Number(world.bounds_z) - 1, zy * zone_size + Math.floor(zone_size / 2))
            if (x < 0 || z < 0 || Math.floor(x / zone_size) !== zx || Math.floor(z / zone_size) !== zy) continue
            choices.push({ zx, zy, x, z, distance: Math.hypot(x - Number(current.x), z - Number(current.z)) })
          }
      }
      choices.sort((a, b) => a.distance - b.distance)
      const [target] = choices
      if (!target) return null
      return {
        character_id,
        zx: target.zx,
        zy: target.zy,
        chain_x: target.x,
        chain_z: target.z,
        x: coords.chain_to_world(target.x, offsets.x),
        z: coords.chain_to_world(target.z, offsets.z),
        wait_ms: Math.max(150, Math.ceil((target.distance / 900) * 1_000)),
      }
    },
    { requested_world: world_id, excluded_keys: excluded }
  )
}

async function search_zone(
  page: Page,
  fixture: FightFixture,
  target: NonNullable<Awaited<ReturnType<typeof next_zone>>>
) {
  return page.evaluate(
    async ({ requested_world, template_id, destination }) => {
      const [auth, sdk_module, kiosk, discovery, toast, zone_rows] = await Promise.all([
        import('/src/auth'),
        import('/src/chain/sdk'),
        import('/src/world-shell/kiosk_resolve.js'),
        import('/src/world-shell/discovery_actions.js'),
        import('/src/game/core/toast.js'),
        import('/src/game/zone_rows.js'),
      ])
      const sdk = await sdk_module.get_sdk()
      const { address } = auth.use_auth.getState()
      const handle = await kiosk.kiosk_for_character(sdk, address, destination.character_id)
      if (!handle) return { ok: false, error: 'character kiosk did not resolve', close: false }
      try {
        const result = await discovery.search_zone({
          world_id: requested_world,
          x: destination.x,
          z: destination.z,
          character_id: destination.character_id,
          kiosk_id: handle.kiosk_id,
          personal_kiosk_cap_id: handle.personal_kiosk_cap_id,
          toast_id: toast.push_progress_toast({ title: 'gold fight fixture' }),
        })
        // The Zone DF read index (get_zone_state gRPC) lags the search's execution view a checkpoint or two — the
        // SAME owned-object read lag search_zone_settled handles for the pkcap. So zone_rows_chain issued right
        // after the search can return null/empty before the just-discovered zone is readable; poll until the
        // derived rows show mobs (bounded) so `close` sees the real zone.
        let rows: any[] = []
        for (let i = 0; i < 15; i += 1) {
          rows = (await zone_rows.zone_rows_chain(requested_world, destination.zx, destination.zy)) ?? []
          if (rows.some((r: any) => r.kind === 'mob')) break
          await new Promise((r) => setTimeout(r, 400))
        }
        // The engage gate is PROXIMITY: world_spawns.js `is_claimable` requires the mob's LIVE placed position
        // within PROXIMITY_M=6 of the player (who mounts at this searched center). But a mob AMBLES up to
        // WANDER.WAYPOINT_R≈3.5 blocks from its spawn anchor (ambient_placement.js), so an anchor merely ≤6 from
        // center can wander OUT of the 6-block engage radius. Accept a zone only when the fixture mob's ANCHOR is
        // within 6−3.5≈2.4 of center, so it stays claimable at ANY wander phase.
        const CLAIM_ANCHOR_R = 2.4
        const close = rows.some(
          (row: any) =>
            row.kind === 'mob' &&
            row.template_id === template_id &&
            Math.hypot(Number(row.x) - destination.chain_x, Number(row.z) - destination.chain_z) <= CLAIM_ANCHOR_R
        )
        return { ok: true, digest: result?.timing?.digest ?? null, close }
      } catch (error: any) {
        return { ok: false, error: String(error?.message ?? error), close: false }
      }
    },
    { requested_world: fixture.world_id, template_id: fixture.mob_template_id, destination: target }
  )
}

// Bounded retry over the owned-object read-index lag — search_retry.ts owns the two retryable failure classes (the
// pkcap stale-version rebuild AND the kiosk-unresolved re-poll at :186) and the budget; here we only wire the real
// effects: the concrete search_zone and the page's own clock.
async function search_zone_settled(
  page: Page,
  fixture: FightFixture,
  target: NonNullable<Awaited<ReturnType<typeof next_zone>>>
) {
  return settle_search(
    () => search_zone(page, fixture, target),
    (ms) => page.waitForTimeout(ms)
  )
}

/** The roam-world mount gate (extracted so the stale-fight recovery can re-await it after a forfeit
 *  re-navigation): the character is selected, the voxel world engine + canvas exist, and the world binding names
 *  THIS world. Fight-agnostic — the world engine persists under a mounted fight, so this holds during a stale one. */
async function await_roam_world_mounted(page: Page, character_id: string, world_id: string, message: string) {
  await expect
    .poll(
      () =>
        page.evaluate(
          async ({ id, world }) => {
            const { use_world_binding } = await import('/src/world-shell/session_gate.js')
            const state = (window as any).__ARES_ENGINE?.get_state()
            return (
              state?.selected_character_id === id &&
              !!(window as any).__voxel_engine?.get_scene?.() &&
              !!(window as any).__voxel_canvas &&
              use_world_binding.getState().world === world
            )
          },
          { id: character_id, world: world_id }
        ),
      { timeout: 90_000, message }
    )
    .toBe(true)
}

/** Read the fixture character's fight-recovery state off the SAME two /v1 leaves unfinished_result_pending reads:
 *  the rpc.get_fights rows (status + seat-sorted participants) and a find_pending_outcome row. The pure
 *  classification then lives in fight_recovery.ts — this is only the impure read. */
async function read_fight_recovery_state(page: Page, character_id: string): Promise<FightRecoveryState> {
  return page.evaluate(async (cid) => {
    const [auth, rpc, settlement] = await Promise.all([
      import('/src/auth'),
      import('/src/rpc/client'),
      import('/src/world-shell/dungeon_settlement.js'),
    ])
    const { address } = auth.use_auth.getState()
    if (!address || !cid) return { character_id: cid, fights: [], pending_outcome: false }
    const fights = ((await rpc.get_fights({ character: cid }).catch(() => [])) ?? []).filter(Boolean).map((f: any) => ({
      fight_id: String(f.fight_id ?? ''),
      status: f.status ?? null,
      participants: (f.participants ?? []).map((seat: any) => ({ character: seat?.character ?? null })),
    }))
    // mirror unfinished_result_pending: only reach for the outcome row when no fight doc already settles the verdict
    const has_live = fights.some((f: any) => f.status === 'placement' || f.status === 'active')
    const has_terminal = fights.some((f: any) => f.status === 'victory' || f.status === 'defeat')
    const row = has_live || has_terminal ? null : await settlement.find_pending_outcome(address, cid).catch(() => null)
    return { character_id: cid, fights, pending_outcome: !!row }
  }, character_id)
}

/** Drive the app's OWN forfeit (use_dungeon.abandon_fight — the FORFEIT button's default handler, FightControls
 *  .jsx; it forfeits AND deterministically claims/settles, dungeon_run_store.js:1104) for an owned stale ACTIVE
 *  fight, then re-mount the roam world clean. SINGLE-SHOT, NEVER retried (seat rider #2 / tx-retry-burn law):
 *  abandon_fight fires ONE actions::abandon tx and returns false on ANY failure (executed OR pre-flight) without
 *  distinguishing — a digest may exist, so a retry could double-burn. false → surface the store error and STOP the
 *  boot; an honest failure beats a double-burn. */
async function forfeit_via_app(
  page: Page,
  world_id: string,
  character_id: string,
  fight: { readonly fight_id: string }
) {
  // abandon_fight self-guards to a false no-op with no live fight_id, so wait for the fight session to mount first.
  await expect
    .poll(() => page.evaluate(async () => !!(await import('/@id/@aresrpg/fight')).fight_view()), {
      timeout: 30_000,
      message: `the stale ACTIVE fight ${fight.fight_id} never mounted a fight session to forfeit`,
    })
    .toBe(true)
  const outcome = await page.evaluate(async () => {
    const { use_dungeon } = await import('/src/world-shell/dungeon_store.js')
    const ok = await use_dungeon.getState().abandon_fight()
    return { ok, error: use_dungeon.getState().error ?? null }
  })
  expect(
    outcome.ok,
    `forfeit (abandon_fight) refused the stale ACTIVE fight ${fight.fight_id}: ${outcome.error ?? 'busy/no-fight self-guard'} — boot stopped, no retry (a burned forfeit tx is never re-fired)`
  ).toBe(true)
  // teardown → re-mount the roam world clean (drops the abandon recap overlay; the character is settled by claim())
  await expect
    .poll(() => page.evaluate(async () => !(await import('/@id/@aresrpg/fight')).fight_view()), {
      timeout: 45_000,
      message: `the forfeited fight ${fight.fight_id} never tore down`,
    })
    .toBe(true)
  await page.goto('/?dev&fighttrace=1')
  await await_roam_world_mounted(
    page,
    character_id,
    world_id,
    `the roam world did not re-mount after forfeiting ${fight.fight_id}`
  )
}

/** STALE-FIGHT RECOVERY entry: read the recovery state, LOG the decision point (fight id + participants +
 *  ownership — seat money-lens rider #1), and run the pure orchestrator, which forfeits an OWNED live fight
 *  EXACTLY ONCE. Idempotent: none / claim_result no-op here (a terminal-unclaimed marker is discharged by the
 *  engage loop's existing D767 open_pending_result, never the forfeit door). */
async function recover_stale_fight(page: Page, world_id: string, character_id: string) {
  const state = await read_fight_recovery_state(page, character_id)
  const live = state.fights.find((f) => f != null && (f.status === 'placement' || f.status === 'active'))
  if (live) {
    const chars = (live.participants ?? []).map((seat) => seat?.character ?? '?').join(', ')
    const owned = (live.participants ?? []).some((seat) => seat?.character === character_id)
    console.log(
      `[gold] stale-fight decision: fight ${live.fight_id} status=${live.status} participants=[${chars}] fixture=${character_id} owned=${owned}`
    )
  }
  const { verdict, forfeited } = await run_fight_recovery(state, {
    forfeit: (f) => forfeit_via_app(page, world_id, character_id, f),
  })
  if (verdict === 'forfeit_active') console.log(`[gold] recovered: forfeited stale ACTIVE fight ${forfeited}`)
}

/** Legitimate pre-fight setup only: join, walk-time wait, and normal search transactions. */
export async function boot_fixture_world(
  page: Page,
  wallet: GoldWallet,
  fixture: FightFixture,
  requested_character_id: string | null = null
) {
  await boot_roster(page, wallet)
  const character_id = await join_fixture_world(page, fixture.world_id, requested_character_id)
  // CHECKPOINT SETTLE (boot-from-0 gate law): the join tx just advanced the character's per-world CHECKPOINT DF
  // (read_checkpoint), but the owned-object gRPC read index lags the execution view a checkpoint or two after a
  // mutating tx — the SAME lag search_zone_settled handles for the pkcap. next_zone reads that checkpoint to seat
  // its bounded zone search; on a FRESH boot (the first-ever join) it reads null before the index catches up, so
  // next_zone returns null and boot mis-fails as "no undiscovered zone". A re-run finds it already settled — which
  // is exactly the state-dependence that made this rig look non-deterministic. Poll to readable before searching.
  const t_join = Date.now()
  let checkpoint_settled = false
  for (let i = 0; i < 90; i += 1) {
    checkpoint_settled = await page.evaluate(
      async ({ id, world }) => {
        const { read_checkpoint } = await import('/src/chain/read_checkpoint.js')
        return !!(await read_checkpoint(id, world))
      },
      { id: character_id, world: fixture.world_id }
    )
    if (checkpoint_settled) break
    await page.waitForTimeout(500)
  }
  console.log(`[gold] checkpoint settled=${checkpoint_settled} after ${Date.now() - t_join}ms post-join`)
  expect(checkpoint_settled, 'character checkpoint never settled after world join (owned-object read lag)').toBe(true)
  const attempted: string[] = []
  let searched: { zx: number; zy: number } | null = null
  // 12 zones (was 6): the fixture mob's LIVE placed position wanders (see :203), so a per-seed run can leave 6
  // zones all mob-far. The engage radius is the PRODUCT's fixed 6 blocks — so widen the SEARCH, never the radius.
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const target = await next_zone(page, fixture.world_id, attempted)
    expect(target, 'fixture world has no undiscovered zone in the bounded search area').toBeTruthy()
    attempted.push(`${target!.zx}:${target!.zy}`)
    await page.waitForTimeout(target!.wait_ms)
    const result = await search_zone_settled(page, fixture, target!)
    expect(result.ok, `fixture search failed: ${result.error}`).toBe(true)
    expect(result.digest, 'fixture search produced no certified digest').toBeTruthy()
    if (result.close) {
      searched = { zx: target!.zx, zy: target!.zy }
      break
    }
  }
  expect(searched, 'twelve dense fixture searches produced no mob within the real six-block engage radius').toBeTruthy()
  await expect
    .poll(
      async () => {
        const response = await fetch(`${api()}/v1/zones?world=${encodeURIComponent(fixture.world_id)}`)
        const rows = (await response.json()).zones ?? []
        return rows.some((row: any) => row.zx === searched!.zx && row.zy === searched!.zy)
      },
      { timeout: 30_000, message: '/v1 did not project the searched fixture zone' }
    )
    .toBe(true)
  await page.evaluate(async (id) => {
    const { set_last_character } = await import('/src/game/core/draft.js')
    await set_last_character(id)
  }, character_id)
  await page.goto('/?dev&fighttrace=1')
  await await_roam_world_mounted(
    page,
    character_id,
    fixture.world_id,
    'fixture world did not mount at its searched checkpoint'
  )
  // STALE-FIGHT RECOVERY (D767 forfeit extension + seat money-lens rider): the fixture character can carry a
  // still-LIVE fight orphaned by an interrupted run — the client mounts THAT fight, so the roam engage below would
  // find no claimable spawn and starve its 90s poll. Forfeit ONLY an owned live fight, exactly once, then re-mount.
  await recover_stale_fight(page, fixture.world_id, character_id)
  await expect(page.locator('.gw-selfplate')).toBeVisible()
  return { character_id }
}

export async function snapshot(page: Page): Promise<FightSnapshot> {
  return page.evaluate(async () => {
    // MIRROR KILL: `state.fight` no longer exists — the game-core copy lagged the core
    // ≥1 async dispatch (the AP-desync root) and was deleted. The ONE read surface is the fight core's
    // synchronous view door, `fight_view()` = memoized engine_view (@aresrpg/fight project.js), which preserves
    // the FightSlice contract verbatim — every field below maps 1:1, so the snapshot shape is unchanged.
    const { fight_view } = await import('/@id/@aresrpg/fight')
    const fight = fight_view()
    if (!fight)
      return {
        fight_id: null,
        placement: false,
        active: null,
        armed: null,
        presenting: false,
        turn: 0,
        me: null,
        mobs: [],
        placement_cells: [],
        arena: null,
      }
    const plain = (fighter: any) => ({
      id: fighter.id,
      name: String(fighter.name ?? ''),
      team: Number(fighter.team),
      cell: { x: Number(fighter.cell.x), y: Number(fighter.cell.y) },
      dead: !!fighter.dead,
      health: Number(fighter.health ?? 0),
      committed: {
        alive: !!fighter.committed_alive,
        hp: Number(fighter.committed_health ?? 0),
      },
      ap: Number(fighter.ap ?? 0),
      mp: Number(fighter.mp ?? 0),
      is_player: !!fighter.is_player,
    })
    const me = fight.my_entity_id ? plain(fight.fighters.get(fight.my_entity_id)) : null
    return {
      fight_id: fight.fight_id ?? null,
      placement: !!fight.placement,
      active: fight.active_entity_id ?? null,
      armed: fight.armed_spell_id ?? null,
      presenting: !!fight.presenting,
      turn: Number(fight.turn_number ?? 0),
      me,
      mobs: [...fight.fighters.values()].filter((row: any) => !row.is_player).map(plain),
      placement_cells: me ? (fight.placement_cells?.[me.team] ?? []).map((cell: any) => ({ ...cell })) : [],
      arena: { width: fight.arena.width, height: fight.arena.height, cells: [...fight.arena.cells] },
    }
  })
}

async function spawn_point(page: Page, fixture: FightFixture, spawn_id?: string) {
  return page.evaluate(
    async ({ template_id, requested_spawn }) => {
      // bare specifiers can't resolve in a browser-native import (page.evaluate) — Vite's /@id/ escape can
      // (same reason next_zone imports the SDK via /@id/…; a newer Vite stopped auto-resolving the bare form).
      const { Box3, Raycaster, Vector2, Vector3 } = await import('/@id/three')
      const engine = (window as any).__voxel_engine
      const canvas = (window as any).__voxel_canvas as HTMLCanvasElement | undefined
      const scene = engine?.get_scene?.()
      const camera = engine?.get_camera?.()
      const player = (window as any).__voxel_ctl?.get_transform?.().position
      if (!scene || !camera || !canvas || !player) return null
      const roots: any[] = []
      scene.traverse((node: any) => {
        const entry = node.userData?.__spawn_entry
        if (!entry || entry.kind !== 'mob' || !entry.placed || entry.engaged || !node.visible) return
        if (entry.row?.template_id !== template_id) return
        if (requested_spawn && String(entry.row?.spawn_id) !== requested_spawn) return
        const d = Math.hypot(Number(player[0]) - Number(entry.cx), Number(player[2]) - Number(entry.cz))
        if (d <= 6) roots.push(node)
      })
      roots.sort((a, b) => {
        const ea = a.userData.__spawn_entry
        const eb = b.userData.__spawn_entry
        return (
          Math.hypot(Number(player[0]) - Number(ea.cx), Number(player[2]) - Number(ea.cz)) -
          Math.hypot(Number(player[0]) - Number(eb.cx), Number(player[2]) - Number(eb.cz))
        )
      })
      const rect = canvas.getBoundingClientRect()
      const ray = new Raycaster()
      for (const root of roots) {
        root.updateWorldMatrix(true, true)
        const box = new Box3().setFromObject(root)
        if (box.isEmpty()) continue
        const center = box.getCenter(new Vector3())
        const samples = [0.3, 0.5, 0.7].map(
          (ratio) => new Vector3(center.x, box.min.y + (box.max.y - box.min.y) * ratio, center.z)
        )
        for (const sample of samples) {
          const projected = sample.clone().project(camera)
          if (projected.z < -1 || projected.z > 1) continue
          const ndc = new Vector2(projected.x, projected.y)
          ray.setFromCamera(ndc, camera)
          if (!ray.intersectObject(root, true).length) continue
          return {
            x: rect.left + ((projected.x + 1) / 2) * rect.width,
            y: rect.top + ((1 - projected.y) / 2) * rect.height,
            spawn_id: String(root.userData.__spawn_entry.row.spawn_id),
          }
        }
      }
      return null
    },
    { template_id: fixture.mob_template_id, requested_spawn: spawn_id }
  )
}

/** ZONE-SEARCH PRE-GATE (multi-turn gate red, 07-17): engage assumed the zone under the avatar was already
 *  searched — usually true (the boot's search leg seats the checkpoint in the zone it searched), but a mount
 *  can land in an UNSEARCHED zone (a spawn/checkpoint roll off the searched zone), and unsearched zones have
 *  ZERO claimable rigs (mobs exist only after `zones::search_zone`), so the spawn_point poll starved its full
 *  90s under a live "[F] SEARCH THE ZONE" prompt. Drive the REAL user verb the product arms for exactly this
 *  state: the [F] pill — registered by DiscoveryPrompts.jsx:202-284 (gate = `zone_searchable`), rendered under
 *  CompassStrip.jsx:424-430 (relocated out of the bottom prompt stack; its unique class is
 *  `gw-npc-prompt--searchable`), press → `trigger_prompt('search')` → the real kiosk-resolved search_zone tx.
 *  CLAIM-FIRST ordering: a claimable rig present = never press (a TTL-elapsed re-search would REROLL the
 *  zone's live spawns out from under the engage). Already-searched happy path: the pill never registers → fall
 *  through with zero presses (the bounded wait overlaps time the caller's own 90s poll would spend anyway).
 *  ONE re-press if the first settles re-armed (= failed); the caller's existing poll keeps the final verdict
 *  and its message. */
async function ensure_zone_searched(page: Page, fixture: FightFixture) {
  const pill = page.locator('button.gw-npc-prompt--searchable').first()
  // Registered-vs-visible tells the press outcomes apart (prompt_stack.js): in flight = registered + pending
  // (pill hidden); SUCCESS = DiscoveryPrompts CLEARS the registration once /v1 reconciles the zone searched
  // (`searchable` re-derives false); failure = settled + still registered → pill visible again (honest re-arm).
  const search_registered = () =>
    page.evaluate(async () => {
      const { use_prompt_stack } = await import('/src/world-shell/prompt_stack.js')
      return 'search' in use_prompt_stack.getState().prompts
    })
  for (let presses = 0; presses < 2; presses += 1) {
    // Bounded race, claim-first. Lap 1 (~12s) covers the fresh mount's char/zones views arming the pill; the
    // post-press lap (~45s) covers the &Random search tx + the bounded /v1 reconcile hold (DiscoveryPrompts'
    // wait_zone_reconciled, ≤12.5s) that clears the prompt.
    const deadline = Date.now() + (presses === 0 ? 12_000 : 45_000)
    let armed = false
    while (Date.now() < deadline && !armed) {
      if (await spawn_point(page, fixture)) return // a claimable rig exists — never search over live spawns
      if (presses > 0 && !(await search_registered())) return // search reconciled searched — hand back to the poll
      armed = await pill.isVisible()
      if (!armed) await page.waitForTimeout(500)
    }
    if (!armed) return // no prompt to drive (searched zone) — the caller's poll owns the verdict either way
    await human_click_locator(page, pill)
  }
}

/** THE UNFINISHED-RESULT REFUSAL STATE (D767 recovery verb) — read the SAME two /v1 leaves the product's own
 *  pending surfaces derive from (ClaimChip.jsx `derive_claim_chip` / PendingOutcomeBadge.jsx): leaf 2 = a
 *  still-indexed TERMINAL fight doc (its settle never ran), leaf 3 = an unopened /v1 FightOutcome row. Either
 *  one means the character is MARKED — `fight::mark_seated` aborts 111 (the humanized "You have an unfinished
 *  fight result" toast) on EVERY engage until `results::open` discharges the marker. A live (placement/active)
 *  doc means an engage actually landed — never a refusal — so it reads false here. */
async function unfinished_result_pending(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    const [auth, rpc, settlement] = await Promise.all([
      import('/src/auth'),
      import('/src/rpc/client'),
      import('/src/world-shell/dungeon_settlement.js'),
    ])
    const { address } = auth.use_auth.getState()
    const character_id = (window as any).__ARES_ENGINE?.get_state()?.selected_character_id
    if (!address || !character_id) return false
    const fights = ((await rpc.get_fights({ character: character_id }).catch(() => [])) ?? []).filter(Boolean)
    if (fights.some((f: any) => f.status === 'placement' || f.status === 'active')) return false
    if (fights.some((f: any) => f.status === 'victory' || f.status === 'defeat')) return true
    const row = await settlement.find_pending_outcome(address, character_id).catch(() => null)
    return !!row
  })
}

/** THE RECOVERY VERB (D767): a human whose engage is refused with the unfinished-result abort opens the pending
 *  result, then re-engages. The product already wires an AUTO open on every abort-111 refusal (dungeon_store.js
 *  `on_marker_refusal` → auto_open_pending_outcomes), but an EXECUTED open failure LATCHES (burn law — auto
 *  never re-fires) and a dungeon-bound row stays manual-only — the persistent in-world fallback is the
 *  ClaimChip (ClaimChip.jsx, world chrome; PendingOutcomeBadge is the same press on /characters), whose press
 *  drives the one-attempt `recover_pending` flow. Drive exactly that, human-shaped: give the auto attempt its
 *  window; if the pending state persists and the chip arms, press it ONCE (one attempt per press — the burn-law
 *  rail recover_pending itself enforces; a failed press stays a loud timeout here, never a blind re-press);
 *  return only when BOTH leaves read discharged. */
async function open_pending_result(page: Page) {
  // both pending surfaces carry the same humanized title (i18n `errors.fight_unclaimed_result`)
  const chip = page.locator('button[title*="unfinished fight result"]').first()
  const deadline = Date.now() + 90_000
  let pressed = false
  while (Date.now() < deadline) {
    if (!(await unfinished_result_pending(page))) return // marker discharged (the auto attempt or the press below)
    if (!pressed && (await chip.isVisible().catch(() => false)) && (await chip.isEnabled().catch(() => false))) {
      // The press may race the AUTO open clearing the chip mid-gesture — a vanished chip is not a failure;
      // the next pending read owns the verdict, so a lost gesture simply leaves `pressed` false.
      pressed = await human_click_locator(page, chip)
        .then(() => true)
        .catch(() => false)
    } else await page.waitForTimeout(1_000)
  }
  throw new Error(
    `the unfinished fight result never opened (chip pressed=${pressed}) — the recover/open flow did not discharge the fight marker in 90s`
  )
}

/** ENGAGE-RING APPROACH (attack-range split, commit 0b24aca7): the [R] ATTACK pill now ARMS on the WIDER
 *  ATTACK_VISIBLE_M=10 visibility ring (nearest group MEMBER) while claim LEGALITY stays PROXIMITY_M=6 from the
 *  group ANCHOR (spawns_reconcile.js — the exact chain position zones::claim_mob_group_in_zone travel-verifies).
 *  So the pill is VISIBLE in the 6→10 courtesy band where pressing [R] legally REFUSES ("get closer"): a mount
 *  that settles/nudges into that band makes engage()'s claim_intent refuse every press even though the pill shows.
 *  (The CHAIN claim is fine — boot's CLAIM_ANCHOR_R=2.4 gate seats the checkpoint within claim range; only the
 *  CLIENT avatar drifted out of the client-side proximity gate.) A human just walks in; the harness closes the
 *  CLIENT distance with the controller's OWN hard-place primitive (ctl.teleport — the same call boot/rescue fire
 *  in embed_voxel.js), stopping ~1.5 blocks short of the fixture anchor, then confirms the core's OWN
 *  `attack_engageable` flag (the flag engage()'s legality + the gold highlight both read) holds on a fixture-
 *  template target BEFORE the press. Idempotent — returns on the first poll once already in-ring. */
async function approach_until_engageable(page: Page, fixture: FightFixture) {
  await expect
    .poll(
      () =>
        page.evaluate(async (template_id) => {
          const { spawns_store } = await import('/src/world-shell/spawns_adapter.js')
          const ctl = (window as any).__voxel_ctl
          const pos = ctl?.get_transform?.().position
          if (!pos) return false
          const core = spawns_store.getState()
          // the row a flat key `${zk}:${rk}` points at (the reducer's own key algebra, reversed)
          const row_for = (key: string | null) => {
            if (!key) return null
            for (const [zk, zone] of core.zones as Map<string, any>)
              for (const [rk, row] of zone.rows as Map<string, any>) if (`${zk}:${rk}` === key) return row
            return null
          }
          // ALREADY IN-RING: the armed [R] target is a fixture-template group AND within the engage ring (gold).
          const armed = row_for(core.attack_target_key)
          if (armed && armed.template_id === template_id && core.attack_engageable) return true
          // WALK IN — aim for the NEAREST fixture-template mob ANCHOR (world coords: the reducer's legality basis).
          let anchor: { x: number; z: number } | null = null
          let best = Infinity
          for (const [, zone] of core.zones as Map<string, any>)
            for (const [, row] of zone.rows as Map<string, any>)
              if (row.kind === 'mob' && row.template_id === template_id) {
                const d2 = (row.x - pos[0]) ** 2 + (row.z - pos[2]) ** 2
                if (d2 < best) {
                  best = d2
                  anchor = { x: row.x, z: row.z }
                }
              }
          if (!anchor) return false // no fixture row in the core yet — let the caller's spawn poll own the wait
          // a valid ground Y from the rendered fixture rig seat (entry.cy); fall back to the current stance
          let seat_cy: number | null = null
          ;(window as any).__voxel_engine?.get_scene?.()?.traverse((node: any) => {
            const e = node.userData?.__spawn_entry
            if (e?.kind === 'mob' && e.placed && e.row?.template_id === template_id && typeof e.cy === 'number')
              seat_cy = e.cy
          })
          const ground_y = seat_cy ?? pos[1]
          const dx = anchor.x - pos[0]
          const dz = anchor.z - pos[2]
          const dist = Math.hypot(dx, dz) || 1
          const stop = Math.max(0, dist - 1.5) // ~1.5 blocks short of the anchor: solidly inside 6, never on the rig
          ctl.teleport([pos[0] + (dx / dist) * stop, ground_y + 1, pos[2] + (dz / dist) * stop])
          return false // re-poll: the frame loop feeds the new player_pos, the core recomputes engageable next tick
        }, fixture.mob_template_id),
      { timeout: 20_000, message: "could not close into the fixture group's six-block engage ring" }
    )
    .toBe(true)
}

export async function engage_by_mouse(page: Page, fixture: FightFixture) {
  await ensure_zone_searched(page, fixture) // pre-gate: an unsearched mount zone has no claimable rigs to poll for
  await approach_until_engageable(page, fixture) // walk into the 6-block engage ring so find_spawn's pixel poll isn't starved from the 6→10 band
  const find_spawn = async () => {
    let first: Awaited<ReturnType<typeof spawn_point>> = null
    await expect
      .poll(async () => (first = await spawn_point(page, fixture)), {
        timeout: 90_000,
        message: 'no claimable fixture rig projected to a real canvas pixel',
      })
      .toBeTruthy()
    return first!.spawn_id
  }
  let spawn_id = await find_spawn()
  // ENGAGE BY MOUSE via the armed [R] ATTACK pill in the PromptStack. A direct click on the mob RIG is defeated
  // by that very pill: world_spawns renders the claimable-mob [R] prompt (`.gw-prompt-stack` — NOT
  // pointer-events:none) OVER the mob, so the canvas pointerdown lands on the HUD and world_spawns' on_down/on_up
  // never fire engage (proven via elementFromPoint at the mob pixel → `gw-prompt-stack`). The pill's own onClick
  // fires the IDENTICAL claim+create (PromptStack `trigger_prompt('attack')` → the registered `on_trigger:
  // () => engage(e)`), and it is ALWAYS present while the mob is claimable — the robust, real mouse engage.
  const pill = page.locator('.gw-prompt-stack button', { has: page.locator('kbd', { hasText: 'R' }) }).first()
  let recovered = false
  // D767 resilience budgets alongside the unchanged 3-press budget: ≤2 wander re-searches (a pinned mob AMBLES
  // out of the product's fixed 6-block engage radius — a human just picks the next mob) and ≤1 unfinished-result
  // recovery. Every proof gate stays: a press only ever lands on a re-confirmed claimable spawn, and exhausting
  // any budget still fails loud.
  for (let presses = 0, researches = 0; presses < 3;) {
    await approach_until_engageable(page, fixture) // re-close each attempt (a re-search/roam can drift us back out); idempotent when already in-ring
    // re-confirm the fixture mob is still on-screen + claimable (its [R] pill armed) before the press;
    // WANDER RE-SEARCH (D767) on timeout: drop the pin and re-run the spawn search for ANY claimable spawn.
    const pinned = await expect
      .poll(() => spawn_point(page, fixture, spawn_id).then((p) => !!p), { timeout: 20_000 })
      .toBe(true)
      .then(() => true)
      .catch(() => false)
    if (!pinned) {
      expect(
        researches,
        'the pinned fixture spawn wandered unclaimable and two fresh spawn searches found no claimable replacement'
      ).toBeLessThan(2)
      researches += 1
      spawn_id = await find_spawn() // the same loud 90s search — a barren zone keeps its original failure message
      continue
    }
    await expect(pill, 'the claimable-mob [R] ATTACK pill never armed').toBeVisible({ timeout: 10_000 })
    await human_click_locator(page, pill)
    presses += 1
    const started = await expect
      .poll(() => snapshot(page).then((state) => !!state.fight_id), { timeout: 20_000 })
      .toBe(true)
      .then(() => true)
      .catch(() => false)
    if (started) return spawn_id
    // THE RECOVERY VERB (D767): the press fired but no fight mounted — if the character is MARKED (the abort-111
    // "unfinished fight result" refusal), open the pending result the way a human does, then let the remaining
    // press budget re-engage once. At most one recovery per engage: a second refusal after a discharged marker
    // is a genuine product failure and exhausts the presses loud.
    if (!recovered && (await unfinished_result_pending(page))) {
      await open_pending_result(page)
      recovered = true
    }
  }
  throw new Error(
    'the [R] ATTACK pill did not engage the claimable fixture mob in three presses (each fired from INSIDE the six-block engage ring — attack_engageable held, so a persisting refusal is a product engage bug, not the 6→10 visibility band)'
  )
}

async function project_cell(page: Page, cell: Cell): Promise<{ x: number; y: number } | null> {
  return page.evaluate((target) => {
    const point = (window as any).__ARES_DEV_CELL_SCREEN?.(target.x, target.y)
    const rect = (window as any).__voxel_canvas?.getBoundingClientRect()
    return point && rect ? { x: rect.left + point.x, y: rect.top + point.y } : null
  }, cell)
}

/** One coherent aim probe (a single evaluate = one frame): the intended cell's CURRENT projection, plus the
 *  board picker's OWN decode of the pixel the pointer sits on. `decoded` is `__voxel_board.cell_at_ray` through
 *  the exact `to_ndc` math board_picking.js runs on pointerup (CSS bounding rect, no devicePixelRatio) — so
 *  `decoded === intended` means a press released at `point` RIGHT NOW registers the intended cell, not a
 *  settle-jittered neighbor. Null decode = the pixel rays off-board / onto a void cell (a press there registers
 *  NOTHING — board_picking's on_up drops null picks). */
async function aim_probe(page: Page, cell: Cell, point: { x: number; y: number }) {
  return page.evaluate(
    ({ target, px, py }) => {
      const w = window as any
      const canvas = w.__voxel_canvas as HTMLCanvasElement | undefined
      const rect = canvas?.getBoundingClientRect()
      const raw = rect ? w.__ARES_DEV_CELL_SCREEN?.(target.x, target.y) : null
      const picked =
        rect && w.__voxel_board?.cell_at_ray
          ? w.__voxel_board.cell_at_ray({
              ndc: {
                x: ((px - rect.left) / rect.width) * 2 - 1,
                y: -(((py - rect.top) / rect.height) * 2 - 1),
              },
            })
          : null
      return {
        projected: raw && rect ? { x: rect.left + raw.x, y: rect.top + raw.y } : null,
        decoded: picked ? { x: Number(picked.x), y: Number(picked.y) } : null,
      }
    },
    { target: cell, px: point.x, py: point.y }
  )
}

/** POINTERUP RE-DECODE (B5 cure, R16_TAXONOMY): board_picking.js decodes the click on RELEASE, not on press
 *  (aim_probe's own doc comment below) — but the pre-press aim loop only proves alignment up to the moment
 *  mouse.down fires. A board re-center inside the down-hold window (the D230 world-fight anchor clamp,
 *  world_board_seat.js — a stale/far fixture chain anchor re-seats the board) decodes the SAME screen point to
 *  a DIFFERENT cell by release time: board_picking drops an off-board decode (a dead click, move_target stays
 *  null) or lands a neighbor. Re-run the IDENTICAL camera-settle idiom the pre-press loop uses — aim_probe +
 *  the pure click_decision (click_verify.ts), nothing new — WHILE STILL HELD: still aligned → release in
 *  place; drifted → chase the FRESH projection (board_picking only ever reads the release pixel, so moving a
 *  held pointer is harmless) and re-check, bounded by policy.max_corrections. An unresolved drift after the
 *  budget still releases — the caller's post-press registration oracle (click_cell_registered) owns the final
 *  dead-click/retry verdict; this never hangs waiting for a board that won't stop moving. */
async function press_release_on_cell(page: Page, cell: Cell, point: { x: number; y: number }, policy: ClickPolicy) {
  await page.mouse.down()
  await page.waitForTimeout(90)
  for (let corrections = 0; corrections < policy.max_corrections; corrections += 1) {
    const probe = await aim_probe(page, cell, point)
    const drift_px = probe.projected ? Math.hypot(probe.projected.x - point.x, probe.projected.y - point.y) : null
    const action = click_decision(cell, { kind: 'aim', decoded: probe.decoded, drift_px, corrections }, policy)
    if (action === 'press') break // still aligned at release time — nothing moved, or the chase caught up
    point = probe.projected ?? point // the board moved since aim — re-aim at the freshest projection, still held
    await page.mouse.move(point.x, point.y, { steps: 4 })
    await page.waitForTimeout(60)
  }
  await page.mouse.up()
  await page.waitForTimeout(220)
}

/** SELF-VERIFYING CELL CLICK — one human-shaped gesture that proves its own landing BEFORE the press.
 *  The projection (`__ARES_DEV_CELL_SCREEN`) needs the fight camera settled after the board mounts/re-centres,
 *  so first poll it to non-null (sub-second settle). Then the aim loop: move to the projected point (8-step
 *  human move + 120ms settle), re-read projection AND the picker's decode of the pointer pixel in one frame,
 *  and let the PURE click_decision (click_verify.ts) rule: press only when the pixel DECODES to the intended
 *  cell AND the projection is still (≤max_drift_px); otherwise re-aim at the fresh projection, bounded by
 *  policy.max_corrections. A gesture that never aligns returns 'never_aligned' WITHOUT pressing — a press at a
 *  mis-decoding pixel is how a draft REGISTERS on a wrong cell (unretriable by law, the class that killed
 *  probe_liveness_solo on 07-17), so the class dies pre-press. Camera motion inside the down-hold window is
 *  covered by press_release_on_cell's OWN re-decode-at-release chase (B5 cure — was blind before); anything
 *  still unresolved after that budget falls to the callers' post-press registration oracles
 *  (click_cell_registered). */
export async function click_cell(
  page: Page,
  cell: Cell,
  policy: ClickPolicy = CLICK_POLICY
): Promise<'pressed' | 'never_aligned'> {
  let projected: { x: number; y: number } | null = null
  await expect
    .poll(
      async () => {
        projected = await project_cell(page, cell)
        return !!projected
      },
      { timeout: 15_000, message: `board cell ${cell.x},${cell.y} did not project` }
    )
    .toBe(true)
  let point = projected!
  for (let corrections = 0; ; corrections += 1) {
    await page.mouse.move(point.x, point.y, { steps: 8 })
    await page.waitForTimeout(120)
    const probe = await aim_probe(page, cell, point)
    const drift_px = probe.projected ? Math.hypot(probe.projected.x - point.x, probe.projected.y - point.y) : null
    const action = click_decision(cell, { kind: 'aim', decoded: probe.decoded, drift_px, corrections }, policy)
    if (action === 'press') break
    if (action === 'fail_never_aligned') return 'never_aligned'
    point = probe.projected ?? point // re-aim at the freshest projection, same human pacing
  }
  await press_release_on_cell(page, cell, point, policy)
  return 'pressed'
}

function path_to_mob(state: FightSnapshot): Cell[] {
  const { me, arena } = state
  const mob = state.mobs.find((row) => !row.dead)
  if (!me || !mob || !arena) return []
  const occupied = new Set(
    [me, ...state.mobs].filter((row) => !row.dead && row.id !== me.id).map((row) => cell_key(row.cell))
  )
  const queue: Array<{ cell: Cell; path: Cell[] }> = [{ cell: me.cell, path: [] }]
  const seen = new Set([cell_key(me.cell)])
  while (queue.length) {
    const current = queue.shift()!
    if (Math.abs(current.cell.x - mob.cell.x) + Math.abs(current.cell.y - mob.cell.y) <= 1) return current.path
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const cell = { x: current.cell.x + dx, y: current.cell.y + dy }
      const index = cell.y * arena.width + cell.x
      const key = cell_key(cell)
      if (
        cell.x < 0 ||
        cell.y < 0 ||
        cell.x >= arena.width ||
        cell.y >= arena.height ||
        arena.cells[index] !== 0 ||
        occupied.has(key) ||
        seen.has(key)
      )
        continue
      seen.add(key)
      queue.push({ cell, path: [...current.path, cell] })
    }
  }
  return []
}

export async function wait_player_turn(page: Page) {
  await expect
    .poll(
      async () => {
        const state = await snapshot(page)
        return !state.mobs.some((mob) => !mob.dead) || (!!state.me && state.active === state.me.id && !state.presenting)
      },
      { timeout: 90_000, message: 'fixture fight never reached a playable player turn' }
    )
    .toBe(true)
}

/** Bounded playable-turn gate (advisor pass-21): re-verify `active===me && !presenting` immediately before an
 *  in-turn click. A poll can adopt my turn (`active`) a beat BEFORE the previous mob wave's receipt lands, so the
 *  caller's wait_player_turn passes, then `presenting` flips true and the board correctly DISARMS input (my_turn =
 *  false during a wave — the board's presentation gate). Re-gating here lands the click only when playable. ≤30s
 *  bound: if presenting ever genuinely STICKS (an unacked wave = a product bug), this times out LOUD instead of
 *  silently masking it as a dead click. */
async function wait_playable(page: Page) {
  await expect
    .poll(
      async () => {
        const s = await snapshot(page)
        return !s.mobs.some((m) => !m.dead) || (!!s.me && s.active === s.me.id && !s.presenting)
      },
      {
        timeout: 30_000,
        message: 'board never became playable (active===me && !presenting) in 30s — presenting stuck (product)?',
      }
    )
    .toBe(true)
}

export async function draft_move(
  page: Page,
  one_step: boolean,
  direction: 'toward' | 'away' = 'toward'
): Promise<Cell> {
  const before = await snapshot(page)
  const path = path_to_mob(before)
  let target = path[Math.min(path.length, one_step ? 1 : Math.max(1, before.me?.mp ?? 1)) - 1]
  if (before.me && before.arena) {
    const occupied = new Set(before.mobs.filter((row) => !row.dead).map((row) => cell_key(row.cell)))
    const free_neighbors = [
      { x: before.me.cell.x + 1, y: before.me.cell.y },
      { x: before.me.cell.x - 1, y: before.me.cell.y },
      { x: before.me.cell.x, y: before.me.cell.y + 1 },
      { x: before.me.cell.x, y: before.me.cell.y - 1 },
    ].filter((cell) => {
      const i = cell.y * before.arena!.width + cell.x
      return (
        cell.x >= 0 &&
        cell.y >= 0 &&
        cell.x < before.arena!.width &&
        cell.y < before.arena!.height &&
        before.arena!.cells[i] === 0 &&
        !occupied.has(cell_key(cell))
      )
    })
    if (direction === 'away') {
      const living_mobs = before.mobs.filter((row) => !row.dead)
      const nearest_distance = (cell: Cell) =>
        Math.min(...living_mobs.map((mob) => Math.abs(cell.x - mob.cell.x) + Math.abs(cell.y - mob.cell.y)))
      const away = free_neighbors.reduce<Cell | undefined>(
        (best, cell) => (!best || nearest_distance(cell) > nearest_distance(best) ? cell : best),
        undefined
      )
      if (away && nearest_distance(away) > nearest_distance(before.me.cell)) target = away
    }
    if (!target) {
      ;[target] = free_neighbors
    }
  }
  expect(target, 'player has no real walkable cell to click').toBeTruthy()
  // S2 SEAM (over-engineering advisor 07-16): the click DISPATCHES a Moved intent, but it folds onto an ORPHAN seat
  // (resolve_seat unwired — PRODUCT ticket in BACKLOG) so the projected me.cell doesn't predict the draft yet; the
  // draft's local truth is move_target (dungeon-turn.js:41-43). Assert the DRAFT registered — a draft that never
  // registers is a DEAD click (product P0). me.cell is asserted AFTER commit (post-READY / post-END-TURN) so the
  // receipt-render crash surface (the v1.12.28 class) still gets proven end-to-end.
  // Retry law = click_verify's PURE click_decision, via click_cell_registered: the gesture only presses pixels
  // that DECODE to the target cell, a dead click re-tries bounded, and a WRONG-cell registration stays an
  // immediate hard red — re-clicking would blind-retry a REGISTERED effect (D254-extends the move_path / burns
  // MP, the dungeon-turn.js move_path semantics).
  const seq_before = await click_seq(page)
  const { registered, pressed } = await click_cell_registered(page, target!, {
    read: () => drafted_cell(page, 'move_target'),
    before_attempt: () => wait_playable(page), // re-gate: presenting may have flipped true since the caller's wait (mob-wave race)
  })
  const diag = registered ? '' : ` [diag ${JSON.stringify(await move_click_diag(page, target!, seq_before))}]`
  const message = registered
    ? `move draft registered the WRONG cell ${cell_key(registered)} instead of ${target!.x},${target!.y} — a registered effect is never blind-retried`
    : pressed
      ? `move draft never registered move_target on cell ${target!.x},${target!.y} after ${CLICK_POLICY.max_attempts} verified mouse clicks — dead click?${diag}`
      : `move draft never aligned a verified press pixel on cell ${target!.x},${target!.y} (projection/picker skew — camera never settled?)${diag}`
  expect(registered ? cell_key(registered) : null, message).toBe(cell_key(target!))
  return target!
}

/** The local draft truth a board click registers onto, decoded to a Cell — ONE reader for the three
 *  use_dungeon_turn fields (S2: drafts live in the relay store, NEVER the projected me.cell — the resolve_seat
 *  orphan, PRODUCT ticket): 'move_target' = DERIVED last(move_path) (dungeon-turn.js:41-43), 'cast_target' =
 *  DERIVED last(cast_path).cell (:49-52), 'placement_pick' = the D66 local optimistic pick (:117). */
async function drafted_cell(page: Page, key: 'move_target' | 'cast_target' | 'placement_pick'): Promise<Cell | null> {
  return page.evaluate(async (field) => {
    const [{ use_dungeon_turn }, { decode }] = await Promise.all([
      import('/src/game/screens/dungeon-turn.js'),
      import('/@id/@aresrpg/fight'),
    ])
    const t = (use_dungeon_turn.getState() as Record<string, any>)[field]
    return t == null ? null : decode(t)
  }, key)
}

/** Hard-poll `read()` until it reports a REGISTRATION: a cell differing from `baseline` (the pre-click draft
 *  state — null for fresh move/cast drafts; possibly the previous pick for the re-pickable placement, which is
 *  exactly why plain non-null polling would false-positive a stale pick as this click's effect), or a cell equal
 *  to `intended` (a pick already sitting right is a registration, not a wait). Deadline passes → same rule over
 *  one final read, else null (a DEAD click — nothing new registered). */
async function await_registration(
  page: Page,
  read: () => Promise<Cell | null>,
  timeout_ms: number,
  baseline: Cell | null,
  intended: Cell
): Promise<Cell | null> {
  const key = (cell: Cell | null) => (cell ? cell_key(cell) : null)
  const registration = (cell: Cell | null) =>
    cell && (key(cell) !== key(baseline) || key(cell) === key(intended)) ? cell : null
  const deadline = Date.now() + timeout_ms
  while (Date.now() < deadline) {
    const cell = registration(await read())
    if (cell) return cell
    await page.waitForTimeout(150)
  }
  return registration(await read())
}

/** THE hardened effect-click primitive — every intended-cell effect click (move draft, cast aim, placement
 *  pick) routes here. Per attempt: the caller's re-gate (e.g. wait_playable) → ONE verified click_cell gesture
 *  (which only ever presses a pixel that decodes to `cell` — see click_cell) → hard-poll the caller's
 *  registration read. Every retry verdict is the PURE click_decision (click_verify.ts): a dead click or a
 *  never-aligned gesture re-tries bounded (nothing burned); a WRONG-cell registration is FINAL for effectful
 *  drafts (D254 move-path extension / AP burn — a registered effect is never blind-retried) and bounded-
 *  retriable only for the idempotent placement pick (D66 — re-picking burns nothing). Returns the final
 *  evidence; the CALLER owns its assertion + failure message. */
async function click_cell_registered(
  page: Page,
  cell: Cell,
  oracle: {
    read: () => Promise<Cell | null>
    policy?: ClickPolicy
    registration_timeout_ms?: number
    before_attempt?: () => Promise<void>
  }
): Promise<{ registered: Cell | null; pressed: boolean }> {
  const policy = oracle.policy ?? CLICK_POLICY
  for (let attempts = 1; ; attempts += 1) {
    await oracle.before_attempt?.()
    const baseline = await oracle.read()
    const pressed = (await click_cell(page, cell, policy)) === 'pressed'
    const registered = pressed
      ? await await_registration(page, oracle.read, oracle.registration_timeout_ms ?? 4_000, baseline, cell)
      : null
    const action = click_decision(cell, { kind: 'press', pressed, registered, attempts }, policy)
    if (action !== 'retry') return { registered, pressed }
    await page.waitForTimeout(400) // let the camera/board resettle before the fresh gesture
  }
}

/** The rich-board click relay counter — `use_dungeon_turn.clicked_seq` bumps on EVERY board click that reaches
 *  fight-overlay.js's `emit_click`. Sampling it before/after a click_cell tells a dead click apart: seq bumped =
 *  the click reached the board handler (a PRODUCT gate dropped it); seq flat = the click never landed (a
 *  projection/listener miss). */
async function click_seq(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const { use_dungeon_turn } = await import('/src/game/screens/dungeon-turn.js')
    return use_dungeon_turn.getState().clicked_seq
  })
}

/** DEAD-CLICK DIAGNOSTIC (lead probe): on a move draft that never registered, capture the exact dual-source state
 *  in ONE shot so the evidence names the branch — did the click reach the board (`seq_delta`), what cell it
 *  registered (`clicked_decoded`), and the ESCROW-vs-FIGHT-STORE turn/mp split (the my_mp_eff=0 → empty-reachable
 *  hypothesis: DungeonBoard's `my_turn` reads the fight store but `my_mp` reads the escrow, so the store can flip
 *  my-turn true one poll before the escrow mp-refill lands, leaving a live-looking turn with a dead move range). */
async function move_click_diag(page: Page, target: Cell, seq_before: number) {
  return page.evaluate(
    async ({ tx, ty, sb }) => {
      const [dt_mod, ds_mod, fight_mod] = await Promise.all([
        import('/src/game/screens/dungeon-turn.js'),
        import('/src/world-shell/dungeon_store.js'),
        import('/@id/@aresrpg/fight'), // los encode/decode + fight_view — one barrel since M1a
      ])
      const dt = dt_mod.use_dungeon_turn.getState()
      const { dungeon } = ds_mod.use_dungeon.getState()
      // the fight core's view (the SAME source `snapshot()` reads — mirror kill 07-17) — its me.mp is the
      // project.js projection of the chain participant; DungeonBoard's my_mp reads the escrow row below.
      const fight = fight_mod.fight_view() ?? null
      const eid = fight?.my_entity_id ?? null
      const me = eid && fight?.fighters?.get ? fight.fighters.get(eid) : null
      const row = dungeon?.escrow?.find((p: any) => (p.character ?? p.character_id) === eid) ?? null
      const proj = (window as any).__ARES_DEV_CELL_SCREEN?.(tx, ty)
      return {
        target: `${tx},${ty}`,
        encoded: fight_mod.encode(tx, ty),
        seq_delta: dt.clicked_seq - sb, // >0 = the click reached the board's emit_click; 0 = it never landed
        clicked_decoded: dt.clicked_cell == null ? null : fight_mod.decode(dt.clicked_cell),
        clicked_cast: dt.clicked_cast,
        move_target: dt.move_target,
        placement_pick: dt.placement_pick,
        active_is_me: fight ? fight.active_entity_id === eid : null,
        presenting: fight?.presenting ?? null,
        engine_me_mp: me?.mp ?? null, // the fight-store mp (empty reachable if 0 while active)
        engine_me_ap: me?.ap ?? null,
        engine_me_cell: me?.cell ?? null,
        escrow_found: !!row, // DungeonBoard's ACTUAL my_mp source
        escrow_mp: row?.mp ?? null,
        escrow_ap: row?.ap ?? null,
        armed_spell_id: fight?.armed_spell_id ?? null,
        projected: proj ? { x: Math.round(proj.x), y: Math.round(proj.y) } : null,
      }
    },
    { tx: target.x, ty: target.y, sb: seq_before }
  )
}

/** Click a board cell to AIM the currently-armed cast/weapon strike, oracled on the drafted cast_target the
 *  SAME dead/wrong-cell way draft_move oracles move_target (click_cell_registered → the pure click_decision):
 *  a dead click re-tries bounded; a DIFFERENT-cell registration is a real wrong-cell bug — a second cast would
 *  burn AP (never blind-retry a REGISTERED effect, the tx-retry-burn law's harness twin), immediate hard red.
 *  This is the single-aim site; the STACKED-cast site (cast_damage_to_ap_out) oracles the cast_path queue
 *  instead (same-cell re-casts never move cast_target) with the same verified click primitive. */
async function cast_at_cell_by_mouse(page: Page, cell: Cell) {
  const { registered, pressed } = await click_cell_registered(page, cell, {
    read: () => drafted_cell(page, 'cast_target'),
    before_attempt: () => wait_playable(page),
  })
  const message = registered
    ? `cast aim registered the WRONG cell ${cell_key(registered)} instead of ${cell.x},${cell.y} — a registered effect is never blind-retried (a second cast would burn AP)`
    : pressed
      ? `cast aim never registered cast_target on cell ${cell.x},${cell.y} after ${CLICK_POLICY.max_attempts} verified mouse clicks — dead click?`
      : `cast aim never aligned a verified press pixel on cell ${cell.x},${cell.y} (projection/picker skew — camera never settled?)`
  expect(registered ? cell_key(registered) : null, message).toBe(cell_key(cell))
}

/** After a placement CLICK, verify the local PICK registered on the intended cell. S2 FLIP (the fight rewrite):
 *  a placement click sets `use_dungeon_turn.placement_pick` — the ONE local placement truth (voxel_fight_adapter
 *  .js:293-295: "the old 'action/fight/placed' echo (dead fold) is gone"). The fighter's OWN cell only reflects the
 *  placement AFTER READY commits place_at on-chain, so `me.cell` is the wrong source to poll here — it stays at the
 *  default and the fixture never places. Verify the real mouse click projected + registered the intended pick
 *  (placement_pick === fight-los encode(x,y)); READY then commits it. This is the correct source, not a softening. */
async function place_pick_by_mouse(page: Page, place: Cell) {
  // Same hardened primitive as the move/cast drafts, ONE policy difference: a placement pick is an idempotent
  // LOCAL choice (D66 — zero tx until READY; re-picking just moves the pick), so even a WRONG-cell registration
  // may be re-clicked, bounded. Robustness, NEVER softening: it still demands the pick land on the EXACT
  // intended cell — a genuine dead click fails loud.
  const { registered } = await click_cell_registered(page, place, {
    read: () => drafted_cell(page, 'placement_pick'),
    policy: { ...CLICK_POLICY, wrong_cell_retriable: true, max_attempts: 4 },
    registration_timeout_ms: 6_000,
  })
  expect(
    registered ? cell_key(registered) : null,
    `placement pick never registered on cell ${place.x},${place.y} after 4 verified mouse clicks (projection fragility)`
  ).toBe(cell_key(place))
}

async function click_spell(page: Page) {
  expect((await snapshot(page)).armed, 'a turn must begin with no stale armed spell').toBeNull()
  const spell = page.locator('button.hud-socket:not(.weapon):not(.disabled)').first()
  await human_click_locator(page, spell)
  await expect
    .poll(() => snapshot(page).then((state) => state.armed), { message: 'the physical spell click did not arm' })
    .not.toBeNull()
}

export async function click_damage_spell(page: Page): Promise<Locator> {
  expect((await snapshot(page)).armed, 'a damage turn must begin with no stale armed spell').toBeNull()
  const damage_names = ['Warcleave', 'Ghost Talon', 'Lashline']
  let spell: Locator | null = null
  for (const name of damage_names) {
    const candidate = page.getByRole('button', { name, exact: true })
    if ((await candidate.isVisible()) && (await candidate.getAttribute('aria-disabled')) !== 'true') {
      spell = candidate
      break
    }
  }
  expect(spell, `none of the guaranteed point-damage spells rendered: ${damage_names.join(', ')}`).toBeTruthy()
  await human_click_locator(page, spell!)
  await expect
    .poll(() => snapshot(page).then((state) => state.armed), { message: 'the physical damage-spell click did not arm' })
    .not.toBeNull()
  return spell! // its `aria-disabled` is the per-turn AP-out signal the stacked-cast loop polls (cast_damage_to_ap_out)
}

/** The drafted cast/weapon QUEUE — `use_dungeon_turn.cast_path` length + its LAST cell decoded. The repeat-cast
 *  oracle (advisor pass-27): a stacked cast to the SAME cell never moves the DERIVED `cast_target`, so
 *  cast_target false-positives a re-cast; the queue growing by one is the true "another cast registered" signal,
 *  and its tail cell is where that registered cast actually sits (the wrong-cell honesty read). */
async function cast_queue(page: Page): Promise<{ length: number; last: Cell | null }> {
  return page.evaluate(async () => {
    const [{ use_dungeon_turn }, { decode }] = await Promise.all([
      import('/src/game/screens/dungeon-turn.js'),
      import('/@id/@aresrpg/fight'),
    ])
    const { cast_path } = use_dungeon_turn.getState()
    const tail = cast_path.length ? cast_path[cast_path.length - 1].cell : null
    return { length: cast_path.length, last: tail == null ? null : decode(tail) }
  })
}

/** STACKED CASTS to AP-exhaustion (advisor pass-27, §17.27 "cast as many as I want" / cpt 255). Live core
 *  classes have 12 AP and Lashline costs 4 AP, deals flat 8, and has cpt 3: 3 casts = 24 dmg/turn. Where the
 *  loadout affords only ONE cast (the tomoda's Ghost Talon, 5 AP → 6 dmg/turn), the mob is HP-budgeted to that
 *  rate instead (fight_fixtures multi_turn). Cast the armed spell until its socket greys (AP spent),
 *  bounded ≤6/turn:
 *   - poll the socket ENABLED before each cast — the affordability re-render lags a beat after a cast, so a bare
 *     read would false-red on the DungeonBoard:394 AP refusal; the disabled edge is the real per-turn exit.
 *   - oracle = `cast_path` GREW (not cast_target — the :754 same-cell false-positive trap).
 *   - SPELL only, NEVER the weapon: a weapon strike on a now-dead target aborts the whole single-PTB turn
 *     (EIllegalCast); a spell over-cast void-casts harmlessly. */
async function cast_damage_to_ap_out(page: Page, spell: Locator, cell: Cell) {
  for (let c = 0; c < 6; c += 1) {
    const affordable = await expect
      .poll(() => spell.getAttribute('aria-disabled'), { timeout: 2_000 })
      .not.toBe('true')
      .then(() => true)
      .catch(() => false)
    if (!affordable) break // socket greyed = AP spent for the turn
    if (!(await snapshot(page)).mobs.some((row) => !row.dead)) break // mob dead — nothing left to cast at
    const before = (await cast_queue(page)).length
    // The verified press: click_cell only presses a pixel that DECODES to the aimed cell — a never-aligned
    // gesture here is a rig-integrity failure (projection/picker skew), loud, never a silent skipped cast.
    expect(
      await click_cell(page, cell),
      `stacked-cast click never aligned a verified press pixel on cell ${cell.x},${cell.y}`
    ).toBe('pressed')
    let grew = false
    for (let w = 0; w < 27 && !grew; w += 1) {
      const queue = await cast_queue(page)
      if (queue.length > before) {
        grew = true
        // A grown queue is a REGISTERED cast (AP on commit) — it must sit on the aimed cell. Wrong cell =
        // immediate hard red, never a blind re-click (the same AP law the single-aim site enforces).
        expect(
          queue.last ? cell_key(queue.last) : null,
          `stacked cast queued on the WRONG cell ${queue.last ? cell_key(queue.last) : 'null'} instead of ${cell.x},${cell.y} — a registered effect is never blind-retried`
        ).toBe(cell_key(cell))
      } else await page.waitForTimeout(150)
    }
    if (!grew) break // the click landed but no cast queued (socket greyed mid-race) — stop, don't blind-retry
  }
}

async function end_turn_by_mouse(page: Page) {
  const end = page.locator('.hud-fightctl__end')
  await expect(end).toBeVisible()
  await expect(end).toBeEnabled({ timeout: 12_000 })
  await human_click_locator(page, end)
  return page.evaluate(() => Date.now())
}

/** Read the active timeline card after React catches up with the requested presentation phase. A missing card is
 *  returned as an empty array so the rendered-parity assertion—not this sampler—owns the failure. */
async function active_turn_texts(page: Page, presenting: boolean): Promise<string[]> {
  const deadline = Date.now() + 1_500
  while (Date.now() < deadline) {
    const state = await snapshot(page)
    if (state.presenting !== presenting) {
      if (presenting) return []
    } else {
      const texts = await page.locator('.hud-turn.active').allTextContents()
      if (texts.length) return texts
    }
    await page.waitForTimeout(50)
  }
  return []
}

export async function clean_return(page: Page, spawn_id: string) {
  await expect
    .poll(
      () =>
        page.evaluate(async (claimed) => {
          // mirror kill 07-17: fight-over truth = the fight core's view door (null once the session tears
          // down); `fight_mode` still lives on the engine store (the fight edge flips it on the null edge).
          const { fight_view } = await import('/@id/@aresrpg/fight')
          const state = (window as any).__ARES_ENGINE?.get_state()
          const board = (window as any).__voxel_board?._descriptor?.() ?? null
          let claimed_present = false
          ;(window as any).__voxel_engine?.get_scene?.()?.traverse((node: any) => {
            const entry = node.userData?.__spawn_entry
            if (String(entry?.row?.spawn_id ?? '') === claimed) claimed_present = true
          })
          return !fight_view() && !state?.fight_mode && !board && !claimed_present
        }, spawn_id),
      { timeout: 45_000, message: 'fight did not return cleanly to the world' }
    )
    .toBe(true)
  await expect(page.locator('.hud-fightctl')).toHaveCount(0)
  await expect(page.locator('.gw-selfplate')).toBeVisible()
}

export async function play_fixture_fight(
  page: Page,
  fixture: FightFixture,
  options: { expected: 'win' | 'loss'; on_result?: (dialog: Locator) => Promise<void> }
) {
  // Lifecycle boundary: after this call starts, evaluation below only reads state or projects a pixel.
  const spawn_id = await engage_by_mouse(page, fixture)
  await expect.poll(() => snapshot(page).then((state) => state.placement)).toBe(true)
  const placement = await snapshot(page)
  const occupied = new Set(placement.mobs.filter((row) => !row.dead).map((row) => cell_key(row.cell)))
  const mob = placement.mobs.find((row) => !row.dead)!
  const free = placement.placement_cells
    .filter((cell) => !occupied.has(cell_key(cell)))
    .sort(
      (a, b) =>
        Math.abs(a.x - mob.cell.x) +
        Math.abs(a.y - mob.cell.y) -
        (Math.abs(b.x - mob.cell.x) + Math.abs(b.y - mob.cell.y))
    )
  const place = free.find((cell) => cell_key(cell) !== cell_key(placement.me!.cell)) ?? free[0]
  expect(place, 'fixture has no free placement cell').toBeTruthy()
  await place_pick_by_mouse(page, place!)
  await human_click_locator(page, page.locator('.hud-fightctl__ready'))
  await expect.poll(() => snapshot(page).then((state) => !state.placement), { timeout: 45_000 }).toBe(true)
  // POST-READY crash-surface assert: place_at committed, so me.cell now reflects the PLACED cell (the receipt fold)
  // — the placement analog of the post-move assert. me.cell predicts nothing pre-commit; it MUST hold post-commit.
  await expect.poll(() => snapshot(page).then((s) => cell_key(s.me!.cell))).toBe(cell_key(place!))

  // A harmless, human-paced opening turn proves cell + spell + END TURN interaction before either fixture settles.
  await wait_player_turn(page)
  await draft_move(page, true)
  await click_spell(page)
  await end_turn_by_mouse(page)

  if (options.expected === 'win') {
    for (let turn = 0; turn < 12; turn += 1) {
      await wait_player_turn(page)
      const state = await snapshot(page)
      const mob = state.mobs.find((row) => !row.dead)
      if (!mob) break
      const distance = Math.abs(state.me!.cell.x - mob.cell.x) + Math.abs(state.me!.cell.y - mob.cell.y)
      if (distance > 1) await draft_move(page, false)
      await click_damage_spell(page)
      const aimed = await snapshot(page)
      const target = aimed.mobs.find((row) => !row.dead)
      // AIM from the EFFECTIVE cell (drafted destination this turn, else me.cell) — mirrors DungeonBoard.jsx:385
      // `last(move_path) ?? me`; me.cell doesn't predict the draft (resolve_seat orphan), so aim off the draft.
      const aim_from = (await drafted_cell(page, 'move_target')) ?? aimed.me!.cell
      if (target && Math.abs(aim_from.x - target.cell.x) + Math.abs(aim_from.y - target.cell.y) <= 1)
        await cast_at_cell_by_mouse(page, target.cell)
      const end = page.locator('.hud-fightctl__end')
      const can_end = await expect
        .poll(async () => (await end.isVisible()) && (await end.isEnabled()), { timeout: 12_000 })
        .toBe(true)
        .then(() => true)
        .catch(() => false)
      if (can_end) await human_click_locator(page, end)
      if (await page.locator('[role="dialog"][aria-label^="Victory:"]').isVisible()) break
    }
  }

  const selector =
    options.expected === 'win' ? '[role="dialog"][aria-label^="Victory:"]' : '[role="dialog"][aria-label^="Defeat:"]'
  const dialog = page.locator(selector)
  await expect(dialog).toBeVisible({ timeout: 150_000 })
  if (options.expected === 'win') {
    await expect(dialog.locator('.fe-state--defeated')).toBeVisible()
    await expect(dialog.locator('.fe-gain')).toContainText(/\+\d+ XP/, { timeout: 45_000 })
  } else {
    await expect(dialog.locator('.fe-row--dead.is-you .fe-state--dead')).toBeVisible()
    await expect(dialog.locator('.fe-state--alive')).toBeVisible()
    await expect(dialog.locator('.fe-nospoils')).toBeVisible()
    await expect(dialog.locator('.fe-cause')).toContainText(fixture.mob_name)
  }
  await options.on_result?.(dialog)
  await human_click_locator(page, dialog.getByRole('button', { name: 'Continue', exact: true }))
  const later = page.getByRole('button', { name: 'Later', exact: true })
  await later.waitFor({ state: 'visible', timeout: 1_500 }).catch(() => {})
  if (await later.isVisible()) await human_click_locator(page, later)
  await clean_return(page, spawn_id)
  return { spawn_id }
}

/**
 * THE MULTI-TURN ACCEPTANCE DRIVE (FIGHT_REWRITE_DESIGN, 04:49 — the definition of done): a mouse-only
 * fight against the `multi_turn` fixture proving the HANDOFF CYCLE the single-turn rows never reached:
 *   player turn (casts instant, ONE 3s floor) → mob wave REPLAYS VISIBLY (~3s/mob, VFX with actions)
 *   → the next player turn arms WHOLE and PLAYS (move draft + cast + end) → repeat ≥3 turns → win.
 * Encoded timing laws:
 *   · anti per-cast gate — once ≥3.2s has passed since MY turn armed, END TURN must enable within 1.5s no
 *     matter how many casts were drafted (a per-cast 3s disease would hold it disabled here);
 *   · visible wave — after each END TURN with a living mob, `presenting` must be OBSERVED true, and the
 *     presenting window must span ≥2s (the ~3s/mob pacing, with drain-latency slack).
 */
export async function play_multi_turn_fight(page: Page, fixture: FightFixture) {
  const spawn_id = await engage_by_mouse(page, fixture)
  // BUDGET LOG (A8 root ①): the drive arms Ghost Talon at the character's AP ceiling — a trace-proven flat
  // GHOST_TALON_PER_TURN dmg into a neutral-fire-res mob — so the win MUST land in ⌈hp/6⌉ player turns, well under
  // the 12-turn loop cap. Logging the target + arithmetic here means any future budget miss (mob HP raised, cap
  // lowered) names itself in the run output instead of failing as an opaque "no Victory dialog" timeout.
  const GHOST_TALON_PER_TURN = 6
  const expected_turns = Math.ceil(fixture.mob_hp / GHOST_TALON_PER_TURN)
  console.log(
    `[gold] multi-turn engage: ${fixture.mob_name} hp=${fixture.mob_hp} ÷ ${GHOST_TALON_PER_TURN}/turn = ${expected_turns} player turns (loop cap 12)`
  )
  await expect.poll(() => snapshot(page).then((state) => state.placement)).toBe(true)
  const placement = await snapshot(page)
  const occupied = new Set(placement.mobs.filter((row) => !row.dead).map((row) => cell_key(row.cell)))
  const first_mob = placement.mobs.find((row) => !row.dead)!
  const free = placement.placement_cells
    .filter((cell) => !occupied.has(cell_key(cell)))
    .sort(
      (a, b) =>
        Math.abs(b.x - first_mob.cell.x) +
        Math.abs(b.y - first_mob.cell.y) -
        (Math.abs(a.x - first_mob.cell.x) + Math.abs(a.y - first_mob.cell.y))
    )
  const place = free.find((cell) => cell_key(cell) !== cell_key(placement.me!.cell)) ?? free[0]
  expect(place, 'multi-turn fixture has no free placement cell').toBeTruthy()
  await place_pick_by_mouse(page, place!)
  await human_click_locator(page, page.locator('.hud-fightctl__ready'))
  await expect.poll(() => snapshot(page).then((state) => !state.placement), { timeout: 45_000 }).toBe(true)
  // POST-READY crash-surface assert: place_at committed, so me.cell now reflects the PLACED cell (the receipt fold)
  // — the placement analog of the post-move assert. me.cell predicts nothing pre-commit; it MUST hold post-commit.
  await expect.poll(() => snapshot(page).then((s) => cell_key(s.me!.cell))).toBe(cell_key(place!))

  // OPENING MOVE BEAT — move_drafts≥1 UNCONDITIONAL: a real move must render every run to prove the
  // move-beat path (the v1.12.28 crash surface), independent of spawn distance. Six start cells cannot all be
  // adjacent to one mob cell (≤4 neighbors), so the FARTHEST placement is always ≥2 away; the away-step adds +1
  // when a free away-neighbor exists. A melee r1 mob starting its first wave at distance >1 MUST move, making the
  // wave-1 mob-move beat structural. Move-only + end keeps the ≥3-turn HP budget intact and no spell armed.
  await wait_player_turn(page)
  const opening_before = await snapshot(page)
  const opening_old_cell = { ...opening_before.me!.cell }
  const me_id = opening_before.me!.id
  const me_name = opening_before.me!.name
  const opening_move = await draft_move(page, true, 'away')
  let move_drafts = 1
  const commit_clicked_at = await end_turn_by_mouse(page)
  // POST-COMMIT crash-surface assert: after END TURN commits the move on-chain, the RECEIPT render folds and me.cell
  // reflects the moved cell — proving the receipt-render path (the v1.12.28 class) e2e, not just the optimistic draft.
  // The chip mob never pushes, so the committed cell holds through its wave.
  await expect
    .poll(() => snapshot(page).then((s) => cell_key(s.me!.cell)), {
      message: 'me.cell never reflected the committed opening move — the receipt fold did not land',
    })
    .toBe(cell_key(opening_move))
  await expect
    .poll(() => snapshot(page).then((state) => state.presenting), {
      timeout: 30_000,
      message: 'the opening mob wave was never observed presenting',
    })
    .toBe(true)
  const during_active_texts = await active_turn_texts(page, true)
  await expect
    .poll(() => snapshot(page).then((state) => !state.presenting), {
      timeout: 60_000,
      message: 'the opening mob wave never finished presenting',
    })
    .toBe(true)
  const drained_active_texts = await active_turn_texts(page, false)
  const opening_wave_drained_at = await page.evaluate(() => Date.now())

  let player_turns = 0
  const waves: number[] = []
  for (let turn = 0; turn < 12; turn += 1) {
    await wait_player_turn(page)
    const armed_at = Date.now()
    const state = await snapshot(page)
    const mob = state.mobs.find((row) => row.committed.alive)
    if (!mob) break
    player_turns += 1
    // The turn arms WHOLE and PLAYS: a real move draft lands, a damage spell arms and casts.
    const distance = Math.abs(state.me!.cell.x - mob.cell.x) + Math.abs(state.me!.cell.y - mob.cell.y)
    if (distance > 1) {
      await draft_move(page, false)
      move_drafts += 1
    }
    const spell = await click_damage_spell(page)
    const aimed = await snapshot(page)
    const target = aimed.mobs.find((row) => !row.dead)
    // AIM from the EFFECTIVE cell — the drafted move destination if a move was drafted this turn, else me.cell
    // (mirrors the product's own DungeonBoard.jsx:385 `last(move_path) ?? me`). me.cell doesn't predict the draft
    // (resolve_seat orphan), so aiming off it alone would miss the mob after a move.
    const aim_from = (await drafted_cell(page, 'move_target')) ?? aimed.me!.cell
    if (target && Math.abs(aim_from.x - target.cell.x) + Math.abs(aim_from.y - target.cell.y) <= 1)
      await cast_damage_to_ap_out(page, spell, target.cell) // STACKED casts to AP-out (advisor pass-27); the tomoda's AP ceiling is ONE Ghost Talon (6 dmg) — the multi_turn mob is HP-budgeted to that rate (fight_fixtures multi_turn)
    // ANTI PER-CAST GATE: with the single per-turn floor elapsed, END TURN enables fast regardless of casts.
    const since_armed = Date.now() - armed_at
    if (since_armed < 3_200) await page.waitForTimeout(3_200 - since_armed)
    const end = page.locator('.hud-fightctl__end')
    // #4 (advisor pass-30): on a KILL turn (no living mob after the stacked casts) the D37a kill-flush auto-commits
    // the winning draft inside the assert window → END TURN goes committing→unmounted; skip the assert+click there
    // and fall through to the Victory tail. On a LIVING-mob turn the anti-per-cast + no-mid-turn-theft contract
    // holds: END TURN MUST be clickable — the #3 D36 stale-deadline fix keeps the turn mine. "element(s) not found"
    // here = the turn was STOLEN mid-turn (unmount), which #3 closes — NOT the per-cast floor (mounted+countdown).
    if ((await snapshot(page)).mobs.some((m) => !m.dead)) {
      await expect(
        end,
        'END TURN not clickable on a living-mob turn — turn STOLEN mid-turn (D36 stale-deadline) if unmounted, or the per-cast floor if mounted+disabled'
      ).toBeEnabled({ timeout: 3_000 })
      await human_click_locator(page, end)
    }
    // THE VISIBLE WAVE: a living mob acted — presentation must be observed, then measured until it drains.
    const wave_seen = await expect
      .poll(() => snapshot(page).then((s) => s.presenting || !s.mobs.some((m) => !m.dead)), { timeout: 30_000 })
      .toBe(true)
      .then(() => true)
      .catch(() => false)
    const after = await snapshot(page)
    if (wave_seen && after.mobs.some((m) => !m.dead) && after.presenting) {
      const wave_start = Date.now()
      await expect
        .poll(() => snapshot(page).then((s) => !s.presenting), {
          timeout: 60_000,
          message: 'the mob wave never finished presenting',
        })
        .toBe(true)
      waves.push(Date.now() - wave_start)
    }
    if (await page.locator('[role="dialog"][aria-label^="Victory:"]').isVisible()) break
  }

  expect(player_turns, `the fixture died before the 3rd player turn (played ${player_turns})`).toBeGreaterThanOrEqual(3)
  expect(
    move_drafts,
    `no real move ever rendered (move_drafts=${move_drafts}) — the move-beat path (the v1.12.28 crash surface) went unproven`
  ).toBeGreaterThanOrEqual(1)
  expect(waves.length, 'no mob wave presentation was ever observed').toBeGreaterThanOrEqual(2)
  for (const wave_ms of waves)
    expect(wave_ms, `a mob wave presented for ${wave_ms}ms — the ~3s/mob pacing is gone`).toBeGreaterThanOrEqual(2_000)

  const dialog = page.locator('[role="dialog"][aria-label^="Victory:"]')
  await expect(dialog).toBeVisible({ timeout: 150_000 })
  await expect(dialog.locator('.fe-gain')).toContainText(/\+\d+ XP/, { timeout: 45_000 })
  await human_click_locator(page, dialog.getByRole('button', { name: 'Continue', exact: true }))
  const later = page.getByRole('button', { name: 'Later', exact: true })
  await later.waitFor({ state: 'visible', timeout: 1_500 }).catch(() => {})
  if (await later.isVisible()) await human_click_locator(page, later)
  await clean_return(page, spawn_id)
  return {
    spawn_id,
    player_turns,
    waves,
    rendered_parity: {
      me_id,
      me_name,
      opening_old_cell,
      opening_move,
      commit_clicked_at,
      opening_wave_drained_at,
      during_active_texts,
      drained_active_texts,
    },
  }
}
