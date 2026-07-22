// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test, type Page } from '@playwright/test'

import { click_cell } from './fight_mouse_helpers'

const gold = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest_path = path.join(gold, '.gold-deployment.json')
const manifest = fs.existsSync(manifest_path) ? JSON.parse(fs.readFileSync(manifest_path, 'utf8')) : null
const api: string = manifest?.api

type GoldWallet = { address: string; privkey: string }
type Cell = { x: number; y: number }
type Fighter = { id: string; cell: Cell; dead: boolean; health: number; ap: number; mp: number }
type FightSnapshot = {
  active: string | null
  armed: string | null
  presenting: boolean
  me: Fighter | null
  mobs: Fighter[]
  arena: { width: number; height: number; cells: number[] } | null
}
type Formation = { mob: Fighter; stage: Cell; trap: Cell; direction: Cell; path: Cell[] }
type BeatRow = {
  kind: 'cell_change' | 'trap_log' | 'queue_idle'
  at_ms: number
  presenting: boolean
  from?: Cell
  to?: Cell
  message?: string
}

async function boot(page: Page, wallet: GoldWallet) {
  await page.addInitScript(
    (payload: { key: string; ids: any }) => {
      ;(window as any).__ARES_DEV_KEY = payload.key
      ;(window as any).__ARES_LOCALNET_IDS = payload.ids
    },
    { key: wallet.privkey, ids: manifest.ids.aresrpg }
  )
  await page.goto('/characters?dev')
  await expect
    .poll(() => page.evaluate(() => !!(window as any).__ARES_ENGINE?.get_state().sui?.loaded), {
      timeout: 45_000,
      message: 'gold roster did not resolve for the in-turn fixture wallet',
    })
    .toBe(true)
}

async function prepare_searchable_character(page: Page, character_id: string, world_id: string) {
  const prepared = await page.evaluate(
    async ({ id, world_id }) => {
      const [roster, world_join, checkpoint, sdk_module, game_api, coords, rpc] = await Promise.all([
        import('/src/roster/load_roster.js'),
        import('/src/world-shell/world_join.js'),
        import('/src/chain/read_checkpoint.js'),
        import('/src/chain/sdk'),
        // bare specifiers can't resolve in a browser-native import (page.evaluate) — Vite's /@id/ escape can.
        import('/@id/@aresrpg/sdk/game'),
        import('/@id/@aresrpg/sdk/coords'),
        import('/src/rpc/client'),
      ])
      await roster.load_roster()
      const engine = (window as any).__ARES_ENGINE
      engine.dispatch('action/select_character', id)
      await world_join.join_world_action({ character_id: id, world_id })
      const current = await checkpoint.read_checkpoint(id, world_id)
      if (!current) return null
      const sdk = await sdk_module.get_sdk()
      const world = await game_api.get_world({ grpc_client: sdk.grpc_client })(world_id)
      const offsets = coords.world_offsets(world)
      const zone_size = Number(world.zone_size ?? 512)
      const known = new Set(
        (await rpc.get_zones(world_id, undefined, true)).zones.map((zone: any) => `${zone.zx}:${zone.zy}`)
      )
      const cx = Math.floor(current.x / zone_size)
      const cy = Math.floor(current.z / zone_size)
      const choices: Array<{ x: number; z: number; zx: number; zy: number; distance: number }> = []
      for (let radius = 0; radius <= 8 && choices.length === 0; radius += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          for (let dy = -radius; dy <= radius; dy += 1) {
            const zx = cx + dx
            const zy = cy + dy
            if (zx < 0 || zy < 0 || known.has(`${zx}:${zy}`)) continue
            const x = Math.min(Number(world.bounds_x) - 1, zx * zone_size + Math.floor(zone_size / 2))
            const z = Math.min(Number(world.bounds_z) - 1, zy * zone_size + Math.floor(zone_size / 2))
            if (x < 0 || z < 0) continue
            choices.push({ x, z, zx, zy, distance: Math.hypot(x - current.x, z - current.z) })
          }
        }
      }
      choices.sort((a, b) => a.distance - b.distance)
      const [target] = choices
      if (!target) return null
      return {
        target: {
          x: coords.chain_to_world(target.x, offsets.x),
          z: coords.chain_to_world(target.z, offsets.z),
          zx: target.zx,
          zy: target.zy,
        },
        wait_ms: Math.max(100, Math.ceil((target.distance / 900) * 1_000)),
      }
    },
    { id: character_id, world_id }
  )
  expect(prepared, 'no undiscovered zone exists near the in-turn fixture checkpoint').toBeTruthy()
  await page.waitForTimeout(prepared!.wait_ms)
  const searched = await page.evaluate(
    async ({ id, world_id, target }) => {
      const [auth, sdk_module, kiosk, discovery, toast] = await Promise.all([
        import('/src/auth'),
        import('/src/chain/sdk'),
        import('/src/world-shell/kiosk_resolve.js'),
        import('/src/world-shell/discovery_actions.js'),
        import('/src/game/core/toast.js'),
      ])
      const sdk = await sdk_module.get_sdk()
      const { address } = auth.use_auth.getState()
      const handle = await kiosk.kiosk_for_character(sdk, address, id)
      if (!handle) return { ok: false, error: 'character kiosk did not resolve' }
      try {
        const outcome = await discovery.search_zone({
          world_id,
          x: target.x,
          z: target.z,
          character_id: id,
          kiosk_id: handle.kiosk_id,
          personal_kiosk_cap_id: handle.personal_kiosk_cap_id,
          toast_id: toast.push_progress_toast({ title: 'gold in-turn fixture' }),
        })
        return { ok: true, digest: outcome?.timing?.digest }
      } catch (error: any) {
        return { ok: false, error: String(error?.message ?? error) }
      }
    },
    { id: character_id, world_id, target: prepared!.target }
  )
  expect(searched.ok, `could not discover in-turn fight zone: ${searched.error}`).toBe(true)
  expect(searched.digest, 'in-turn zone search returned no digest').toBeTruthy()
  await expect
    .poll(
      async () => {
        const response = await fetch(`${api}/v1/zones?world=${world_id}`)
        const zones = (await response.json()).zones ?? []
        return zones.some((zone: any) => zone.zx === prepared!.target.zx && zone.zy === prepared!.target.zy)
      },
      { timeout: 30_000, message: '/v1 did not project the in-turn fight zone' }
    )
    .toBe(true)
  await page.evaluate(async (id) => {
    const { set_last_character } = await import('/src/game/core/draft.js')
    await set_last_character(id)
  }, character_id)
}

async function snapshot(page: Page): Promise<FightSnapshot> {
  return page.evaluate(async () => {
    // mirror kill 07-17: `state.fight` is deleted — read the fight core's synchronous view door instead
    // (fight/project.js engine_view: the FightSlice shape preserved verbatim, so every field maps 1:1).
    const { fight_view } = await import('/@id/@aresrpg/fight')
    const fight = fight_view()
    const fighters = fight ? [...fight.fighters.values()] : []
    const plain = (fighter: any): Fighter => ({
      id: fighter.id,
      cell: fighter.cell,
      dead: !!fighter.dead,
      health: Number(fighter.health ?? 0),
      ap: Number(fighter.ap ?? 0),
      mp: Number(fighter.mp ?? 0),
    })
    return {
      active: fight?.active_entity_id ?? null,
      armed: fight?.armed_spell_id ?? null,
      presenting: !!fight?.presenting,
      me: fight?.my_entity_id ? plain(fight.fighters.get(fight.my_entity_id)) : null,
      mobs: fighters.filter((fighter: any) => !fighter.is_player).map(plain),
      arena: fight ? { width: fight.arena.width, height: fight.arena.height, cells: [...fight.arena.cells] } : null,
    }
  })
}

const key = (cell: Cell) => `${cell.x}:${cell.y}`

function path_to(state: FightSnapshot, target: Cell): Cell[] | null {
  const { me, arena } = state
  if (!me || !arena) return null
  const occupied = new Set(
    [me, ...state.mobs].filter((fighter) => !fighter.dead && fighter.id !== me.id).map((fighter) => key(fighter.cell))
  )
  const queue: Array<{ cell: Cell; path: Cell[] }> = [{ cell: me.cell, path: [] }]
  const seen = new Set([key(me.cell)])
  while (queue.length) {
    const current = queue.shift()!
    if (key(current.cell) === key(target)) return current.path
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const cell = { x: current.cell.x + dx, y: current.cell.y + dy }
      const cell_key = key(cell)
      const index = cell.y * arena.width + cell.x
      if (
        cell.x < 0 ||
        cell.y < 0 ||
        cell.x >= arena.width ||
        cell.y >= arena.height ||
        arena.cells[index] !== 0 ||
        occupied.has(cell_key) ||
        seen.has(cell_key)
      )
        continue
      seen.add(cell_key)
      queue.push({ cell, path: [...current.path, cell] })
    }
  }
  return null
}

function find_formation(state: FightSnapshot): Formation | null {
  const { me, arena } = state
  if (!me || !arena) return null
  const occupied = new Set([me, ...state.mobs].filter((fighter) => !fighter.dead).map((fighter) => key(fighter.cell)))
  const candidates: Formation[] = []
  for (const mob of state.mobs.filter((fighter) => !fighter.dead)) {
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const stage = { x: mob.cell.x - dx, y: mob.cell.y - dy }
      const trap = { x: mob.cell.x + dx, y: mob.cell.y + dy }
      const valid = (cell: Cell) => {
        const index = cell.y * arena.width + cell.x
        return cell.x >= 0 && cell.y >= 0 && cell.x < arena.width && cell.y < arena.height && arena.cells[index] === 0
      }
      if (!valid(stage) || !valid(trap) || (occupied.has(key(stage)) && key(stage) !== key(me.cell))) continue
      if (occupied.has(key(trap))) continue
      const path = path_to(state, stage)
      if (path) candidates.push({ mob, stage, trap, direction: { x: dx, y: dy }, path })
    }
  }
  candidates.sort((a, b) => a.path.length - b.path.length)
  return candidates[0] ?? null
}

async function wait_player_turn(page: Page) {
  await expect
    .poll(
      async () => {
        const state = await snapshot(page)
        return !!state.me && state.active === state.me.id && !state.presenting
      },
      { timeout: 60_000, message: 'player turn never became playable for in-turn setup' }
    )
    .toBe(true)
  const end_turn = page.locator('.hud-fightctl__end')
  await expect(end_turn).toBeVisible()
  await expect(end_turn).toBeEnabled({ timeout: 10_000 })
}

async function align_for_push(page: Page): Promise<Formation> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await wait_player_turn(page)
    const state = await snapshot(page)
    const formation = find_formation(state)
    expect(formation, 'fight board has no free player→mob→trap formation').toBeTruthy()
    if (key(state.me!.cell) === key(formation!.stage)) return formation!
    const step_count = Math.max(1, Math.min(state.me!.mp, formation!.path.length))
    const destination = formation!.path[step_count - 1]
    const moved = await page.evaluate((cell) => (window as any).__ARES_DEV_MOVE(cell), destination)
    expect(moved.ok, `formation move failed: ${moved.error}`).toBe(true)
  }
  throw new Error('could not align player, mob, and trap cell within 20 turns')
}

// (the local unhardened click_cell copy is DEAD — cast aims route through fight_mouse_helpers' click_cell,
// the click_verify-governed gesture that only ever presses a pixel DECODING to the intended cell)

async function install_beat_recorder(page: Page, target_id: string) {
  await page.evaluate(async (id) => {
    const target = window as any
    const engine = target.__ARES_ENGINE
    // MIRROR KILL (07-17): fight truth (cell/presenting) no longer rides the engine's STATE_UPDATED pump —
    // the `state.fight` copy is deleted. Fight rows subscribe to the fight CORE (fight_store, projected through
    // the memoized engine_view — the one synchronous surface); the engine listener keeps ONLY the trap-log
    // rows (message_history is engine state), stamping `presenting` from the live view at message time.
    const { fight_store, engine_view_of } = await import('/@id/@aresrpg/fight')
    target.__GOLD_IN_TURN_OFF?.()
    target.__GOLD_IN_TURN_ROWS = []
    target.__ARES_FIGHT_TRACE = []
    const view = () => engine_view_of(fight_store.getState())
    let previous_cell = view()?.fighters?.get(id)?.cell ?? null
    let previous_presenting = !!view()?.presenting
    let message_count = engine.get_state().message_history?.length ?? 0
    const on_fight = () => {
      const at_ms = Date.now()
      const v = view()
      const presenting = !!v?.presenting
      const cell = v?.fighters?.get(id)?.cell ?? null
      if (cell && previous_cell && (cell.x !== previous_cell.x || cell.y !== previous_cell.y))
        target.__GOLD_IN_TURN_ROWS.push({
          kind: 'cell_change',
          at_ms,
          presenting,
          from: previous_cell,
          to: cell,
        })
      previous_cell = cell ?? previous_cell
      if (previous_presenting && !presenting) target.__GOLD_IN_TURN_ROWS.push({ kind: 'queue_idle', at_ms, presenting })
      previous_presenting = presenting
    }
    const unsubscribe = fight_store.subscribe(on_fight)
    const listener = (state: any) => {
      const at_ms = Date.now()
      const presenting = !!view()?.presenting
      const messages = state.message_history ?? []
      for (const message of messages.slice(message_count))
        if (message.channel === 'CLIENT_COMBAT' && /triggered a trap for \d+/.test(message.message ?? ''))
          target.__GOLD_IN_TURN_ROWS.push({ kind: 'trap_log', at_ms, presenting, message: message.message })
      message_count = messages.length
    }
    engine.events.on('STATE_UPDATED', listener)
    target.__GOLD_IN_TURN_OFF = () => {
      engine.events.off('STATE_UPDATED', listener)
      unsubscribe()
    }
  }, target_id)
}

async function highlight_count(page: Page) {
  return page.evaluate(() => {
    const scene = (window as any).__voxel_engine?.get_scene?.()
    return scene?.getObjectByName?.('highlight_trap')?.children?.length ?? 0
  })
}

async function trace_rows(page: Page) {
  return page.evaluate(() => ((window as any).__ARES_FIGHT_TRACE ?? []) as Array<Record<string, any>>)
}

async function beat_rows(page: Page) {
  return page.evaluate(() => ((window as any).__GOLD_IN_TURN_ROWS ?? []) as BeatRow[])
}

test.describe('07-15 fixed-class regression — real in-turn render queue', () => {
  test.skip(!manifest, 'no .gold-deployment.json — run `node test/gold/up_gold.mjs` first')

  test('@headed IN-TURN BEATS · trap, push, impact, and idle render in causal order', async ({ page }) => {
    test.slow()
    const [, wallet] = manifest.wallets as GoldWallet[]
    const character_id = manifest.characters.find((row: any) => row.wallet === 1)?.character_id
    const fixture = manifest.fight_fixtures?.beats
    expect(character_id, 'gold boot must provide the isolated Yajin character for wallet 1').toBeTruthy()
    expect(fixture, 'gold boot must provide the durable beat fixture world').toBeTruthy()
    await boot(page, wallet)
    await prepare_searchable_character(page, character_id!, fixture.world_id)
    await page.goto('/?dev&fighttrace=1')
    await expect
      .poll(
        () =>
          page.evaluate(
            (id) =>
              (window as any).__ARES_ENGINE?.get_state().selected_character_id === id &&
              !!(window as any).__dev_start_world_fight &&
              !!(window as any).__ARES_DEV_PLACE_READY &&
              !!(window as any).__ARES_DEV_CELL_SCREEN,
            character_id
          ),
        { timeout: 90_000, message: 'headed resident fight hooks did not boot for in-turn proof' }
      )
      .toBe(true)

    const fight_id = await page.evaluate(() => (window as any).__dev_start_world_fight())
    expect(fight_id, 'production world-fight create + mount returned no fight id').toBeTruthy()
    await expect.poll(() => snapshot(page).then((state) => !!state.me), { timeout: 60_000 }).toBe(true)
    const ready = page.locator('.hud-fightctl__ready')
    await expect(ready).toBeVisible()
    const placed = await page.evaluate(() => (window as any).__ARES_DEV_PLACE_READY())
    expect(placed.ok, `placement failed: ${placed.reason}`).toBe(true)

    const formation = await align_for_push(page)
    const before = await snapshot(page)
    await install_beat_recorder(page, formation.mob.id)

    const snare = page.getByRole('button', { name: 'Fanged Snare', exact: true })
    await expect(snare, 'full-corpus Yajin must carry Fanged Snare at level 1').toBeEnabled()
    await snare.click()
    await expect.poll(() => snapshot(page).then((state) => state.armed)).toBe('fanged_snare')
    expect(
      await click_cell(page, formation.trap),
      `Fanged Snare aim never aligned a verified press pixel on cell ${key(formation.trap)}`
    ).toBe('pressed')
    await expect.poll(() => snapshot(page).then((state) => state.me?.ap)).toBe(before.me!.ap - 2)
    await expect.poll(() => snapshot(page).then((state) => !state.presenting)).toBe(true)
    await expect.poll(() => highlight_count(page), { message: 'placed Fanged Snare marker never rendered' }).toBe(1)

    const gutterknife = page.getByRole('button', { name: 'Gutterknife', exact: true })
    await expect(gutterknife, 'full-corpus Yajin must carry Gutterknife at level 1').toBeEnabled()
    await gutterknife.click()
    await expect.poll(() => snapshot(page).then((state) => state.armed)).toBe('gutterknife')
    expect(
      await click_cell(page, formation.mob.cell),
      `Gutterknife aim never aligned a verified press pixel on cell ${key(formation.mob.cell)}`
    ).toBe('pressed')

    const end_turn = page.locator('.hud-fightctl__end')
    await expect
      .poll(async () => {
        const trace = await trace_rows(page)
        return trace.some((row) => row.event === 'flush_started') || (await end_turn.isEnabled().catch(() => false))
      })
      .toBe(true)
    if (!(await trace_rows(page)).some((row) => row.event === 'flush_started')) {
      await expect(end_turn).toBeEnabled()
      await end_turn.click()
    }

    await expect
      .poll(async () => (await trace_rows(page)).find((row) => row.event === 'flush_finished')?.ok, {
        timeout: 90_000,
        message: 'two-cast turn never committed successfully',
      })
      .toBe(true)
    const trace = await trace_rows(page)
    expect(trace.find((row) => row.event === 'flush_started')?.cast_count).toBe(2)
    expect(
      trace.some((row) => row.event === 'displacement_play_started' && row.target_id === formation.mob.id),
      'Gutterknife receipt never entered the displacement render beat'
    ).toBe(true)
    expect(
      trace.some((row) => row.event === 'displacement_play_finished' && row.target_id === formation.mob.id),
      'Gutterknife displacement render beat never drained'
    ).toBe(true)

    await expect
      .poll(async () => (await beat_rows(page)).some((row) => row.kind === 'trap_log'), {
        timeout: 60_000,
        message: 'pushed mob never emitted the trap impact log beat',
      })
      .toBe(true)
    const beats = await beat_rows(page)
    const moved = beats.find((row) => row.kind === 'cell_change')
    const trap_log = beats.find((row) => row.kind === 'trap_log')
    const idle = beats.find((row) => row.kind === 'queue_idle' && row.at_ms >= trap_log!.at_ms)
    expect(moved, 'pushed mob produced no live cell transition').toBeTruthy()
    expect(
      (moved!.to!.x - moved!.from!.x) * formation.direction.x + (moved!.to!.y - moved!.from!.y) * formation.direction.y,
      'mob must move away from the caster through the trap cell'
    ).toBeGreaterThan(0)
    expect(trap_log!.message).toMatch(/triggered a trap for ([1-9]\d*)/)
    expect(trap_log!.presenting, 'trap log must land while its impact beat is presenting').toBe(true)
    expect(trap_log!.at_ms).toBeGreaterThanOrEqual(moved!.at_ms)
    expect(idle, 'render queue never returned idle after the trap impact').toBeTruthy()
    await expect.poll(() => highlight_count(page), { message: 'triggered trap marker stayed on the board' }).toBe(0)
    await page.evaluate(() => (window as any).__GOLD_IN_TURN_OFF?.())
  })
})
