// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// #1754 — Class-E source-to-surface convergence. Every row crosses the same four named
// stations: source truth → indexer-shaped projection → client ingestion → rendered semantics.
// A transition gets at most MAX_FOLDS passes; retrying forever would only hide a stale surface.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

import { describe, expect, test } from 'bun:test'
import {
  create_spawns_store,
  spawn_markers,
  spawn_rows,
  subscribe_world_rows_request,
} from '@aresrpg/world/spawns_zones'
import { apply_action, empty_state } from '@aresrpg/fight/inputs'
import {
  empty_core_state,
  empty_inbox,
  enrich_actions,
  fold_canonical,
  ingest,
  decode_fight_batch,
} from '@aresrpg/fight/core'
import { produce_receipt_render_turns } from '@aresrpg/fight/fight_render_events'

import { normalize_journal_page } from '../../../fight/src/journal_normalize.js'
import { evaluate_parity } from '../../../rpc/scripts/standby_parity.mjs'

const MAX_FOLDS = 3
const FIGHT = '0xf1754'
const WORLD = `0x${'a'.repeat(64)}`
const TEMPLATE = `0x${'b'.repeat(64)}`
const here = dirname(fileURLToPath(import.meta.url))
const repo_root = join(here, '../../../..')

const raw_event = (kind, data) => ({
  type: `0xclass_e::fight_events::${kind}`,
  parsedJson: { fight: FIGHT, ...data },
})

const mob = (spawn_id, x, z, template_id = TEMPLATE) => ({
  spawn_id,
  kind: 'mob',
  x,
  z,
  template_id,
  size: 1,
})

/**
 * Run one transition through the four stations until the semantic surface equals source truth.
 * Projection and ingestion are deliberately re-driven: idempotence/reconciliation is part of convergence.
 */
const converge = async ({ issue, source, project, ingest_projection, render, truth, max_folds = MAX_FOLDS }) => {
  let projection = null
  let client = null
  let semantic = null
  let folds = 0
  for (folds = 1; folds <= max_folds; folds += 1) {
    projection = await project(source, projection)
    client = await ingest_projection(projection, client)
    semantic = await render(client)
    if (isDeepStrictEqual(semantic, truth)) break
  }
  expect(semantic, `#${issue} did not converge within ${max_folds} folds`).toEqual(truth)
  expect(folds, `#${issue} exceeded its fold budget`).toBeLessThanOrEqual(max_folds)
}

const fold_raw_fight = (events) => {
  const actions = decode_fight_batch(
    { events },
    { version: 1, source: 'journal', fight_id: FIGHT, resolve_seat: null, base_of: null }
  )
  return enrich_actions(empty_inbox(), actions).reduce(apply_action, empty_state(FIGHT))
}

const fold_journal = (page) => {
  let core = ingest(empty_core_state(), {
    payload: { kind: 'session_opened', fight_id: FIGHT, my_key: null, ctx: {} },
    observed_at_ms: 0,
  })
  core = ingest(core, {
    payload: {
      kind: 'journal_rows_received',
      source: 'journal',
      fight_id: FIGHT,
      version: Number(page.events.at(-1)?.version ?? 0),
      rows: page,
    },
    observed_at_ms: 1,
  })
  return fold_canonical(core.inbox)
}

describe('Class-E source-to-surface convergence (#1754)', () => {
  test('#1738 re-entry — settling a world wakes the entry read and renders its rows', async () => {
    const store = create_spawns_store()
    const unsubscribe = subscribe_world_rows_request(store, () => {
      store.getState().input({ type: 'world_doc', doc: { zone_size: 100, bounds_x: 1000, bounds_z: 1000 } }, 1)
      store.getState().input(
        {
          type: 'zones_rows_snapshot',
          version: 1,
          zones: [{ zx: 5, zy: 5, discovered_at_ms: 1 }],
          cells: [{ zx: 5, zy: 5, rows: [mob('entry', 520, 540)] }],
        },
        1
      )
    })
    try {
      await converge({
        issue: 1738,
        source: { type: 'world_bound', world_id: WORLD },
        project: async (source) => source,
        ingest_projection: async (projection) => {
          store.getState().input(projection, 1)
          return store.getState()
        },
        render: async (state) => spawn_markers(state).map(({ spawn_id }) => spawn_id),
        truth: ['entry'],
      })
    } finally {
      unsubscribe()
    }
  })

  test('#1732 update — an authentic effects-before-Cast receipt reveals its caster', async () => {
    const events = [
      raw_event('StanceChanged', { fighter_is_mob: true, fighter_idx: 0, stance: 27, active: true }),
      raw_event('ActionStarted', {
        caster_is_mob: true,
        caster_idx: 0,
        turn_ordinal: '1',
        action_ordinal: '0',
        target_cell: 105,
      }),
      raw_event('Hit', { victim_is_mob: false, victim_idx: 0, amount: 3, remaining_hp: 17 }),
      raw_event('Cast', { caster_is_mob: true, caster_idx: 0, target_cell: 105 }),
      raw_event('ActionResolved', {
        caster_is_mob: true,
        caster_idx: 0,
        turn_ordinal: '1',
        action_ordinal: '0',
      }),
    ]
    await converge({
      issue: 1732,
      source: events,
      project: async (source) => source,
      ingest_projection: async (projection) => fold_raw_fight(projection),
      render: async (state) => ({ invisible: state.fighters.m0?.invisible ?? false }),
      truth: { invisible: false },
    })
  })

  test('#1623 create — a newly minted, previously unknown boss reaches a named marker', async () => {
    const snapshot_source = readFileSync(join(repo_root, 'packages/rpc/indexer/src/handlers/ares/snapshot.rs'), 'utf8')
    const unknown_names_are_admitted =
      snapshot_source.includes('!self.ids.contains(id) && self.names.contains(name)') &&
      snapshot_source.includes('mob_template_doc(id, &p)')
    const store = create_spawns_store()
    store.getState().input({ type: 'world_bound', world_id: WORLD }, 1)
    await converge({
      issue: 1623,
      source: { id: `0x${'c'.repeat(64)}`, name: 'New Boss', spawn_id: 'boss-new' },
      project: async (source) => ({ ...source, admitted: unknown_names_are_admitted }),
      ingest_projection: async (projection) => {
        if (projection.admitted) {
          store.getState().input(
            {
              type: 'zone_rows',
              zx: 5,
              zy: 5,
              proven: true,
              rows: [mob(projection.spawn_id, 520, 540, projection.id)],
            },
            1
          )
          store.getState().input(
            {
              type: 'template_resolved',
              template_id: projection.id,
              name: projection.name,
              min_level: 20,
              max_level: 20,
            },
            1
          )
        }
        return store.getState()
      },
      render: async (state) =>
        spawn_markers(state).map(({ spawn_id, name }) => ({
          spawn_id,
          name,
        })),
      truth: [{ spawn_id: 'boss-new', name: 'New Boss' }],
    })
  })

  test('#1489 create — the search receipt and its chain-direct rows render without waiting for a poll', async () => {
    const store = create_spawns_store()
    store.getState().input({ type: 'world_bound', world_id: WORLD }, 1)
    store.getState().input({ type: 'world_doc', doc: { zone_size: 100, bounds_x: 1000, bounds_z: 1000 } }, 1)
    await converge({
      issue: 1489,
      source: { zx: 5, zy: 5, x: 20, z: 40, rows: [mob('fast', 520, 540)] },
      project: async (source) => [
        { type: 'zone_searched', ...source, rows: undefined },
        { type: 'zone_rows', zx: source.zx, zy: source.zy, proven: true, rows: source.rows },
      ],
      ingest_projection: async (projection) => {
        for (const input of projection) store.getState().input(input, 2)
        return store.getState()
      },
      render: async (state) => spawn_markers(state).map(({ spawn_id }) => spawn_id),
      truth: ['fast'],
    })
  })

  test('#1486 update — replacing zone B preserves zone A on every rendered surface', async () => {
    const store = create_spawns_store()
    store.getState().input({ type: 'world_bound', world_id: WORLD }, 1)
    store.getState().input(
      {
        type: 'zones_rows_snapshot',
        version: 1,
        zones: [
          { zx: 5, zy: 5, discovered_at_ms: 1 },
          { zx: 6, zy: 5, discovered_at_ms: 1 },
        ],
        cells: [
          { zx: 5, zy: 5, rows: [mob('a', 520, 540)] },
          { zx: 6, zy: 5, rows: [mob('b-old', 620, 540)] },
        ],
      },
      1
    )
    await converge({
      issue: 1486,
      source: { type: 'zone_rows', zx: 6, zy: 5, proven: true, rows: [mob('b', 620, 540)] },
      project: async (source) => source,
      ingest_projection: async (projection) => {
        store.getState().input(projection, 2)
        return store.getState()
      },
      render: async (state) =>
        spawn_rows(state)
          .map(({ row }) => row.spawn_id)
          .sort(),
      truth: ['a', 'b'],
    })
  })

  test('#1143 update — a status envelope reaches the fighter badge semantics', async () => {
    const events = [
      raw_event('Displaced', { target_is_mob: false, target_idx: 0, from_cell: 104, to_cell: 105 }),
      raw_event('ActionStarted', {
        caster_is_mob: false,
        caster_idx: 0,
        turn_ordinal: '1',
        action_ordinal: '0',
        target_cell: 105,
      }),
      raw_event('ActionEffect', {
        caster_is_mob: false,
        caster_idx: 0,
        turn_ordinal: '1',
        action_ordinal: '0',
        effect_ordinal: 0,
        effect: {
          kind: 9,
          element: 255,
          value: 32788,
          area_shape: 0,
          area_size: 0,
          target_filter: 4,
          chance: 100,
          turns: 3,
          stat: 0,
          flags: 0,
        },
      }),
      raw_event('Cast', { caster_is_mob: false, caster_idx: 0, target_cell: 105 }),
    ]
    await converge({
      issue: 1143,
      source: events,
      project: async (source) => source,
      ingest_projection: async (projection) => fold_raw_fight(projection),
      render: async (state) =>
        (state.fighters.p0?.statuses ?? []).map(({ kind, value, remaining_turns }) => ({
          kind,
          value,
          remaining_turns,
        })),
      truth: [{ kind: 9, value: 20, remaining_turns: 3 }],
    })
  })

  test('#1137 re-entry — a receipt-proven join checkpoint survives a lagging indexed read', async () => {
    const store = create_spawns_store()
    store.getState().input({ type: 'world_bound', world_id: WORLD }, 1)
    store.getState().input({ type: 'world_doc', doc: { zone_size: 100, bounds_x: 1000, bounds_z: 1000 } }, 1)
    await converge({
      issue: 1137,
      source: { character_id: 'p0', world_id: WORLD, x: 520, z: 540 },
      project: async (source) => [
        { type: 'checkpoint_resolved', ...source, source: 'receipt' },
        { type: 'checkpoint_resolved', ...source, source: 'indexed', x: 500, z: 500 },
      ],
      ingest_projection: async (projection) => {
        for (const input of projection) store.getState().input(input, 2)
        return store.getState()
      },
      render: async (state) => state.checkpoint,
      // the anchor bag (#2231): a receipt-shaped input carries no clock or budget, so the boot arbiter reads
      // this checkpoint as unjudgeable and keeps the local pose rather than yanking it
      truth: { x: 20, z: 40, time_ms: null, speed_budget: null, pet_equipped: false },
    })
  })

  test('#1109 update — the serving pointer becomes eligible only after era and watermark convergence', async () => {
    const packages = ['0xa', '0xb'].join(',')
    await converge({
      issue: 1109,
      source: {
        serving_packages: packages,
        standby_packages: packages,
        watermarks: { checkpoints: 100, ares: 100, ares_snapshot: 100 },
        chain_tip: 100,
        tolerance: 0,
      },
      project: async (source) => evaluate_parity(source),
      ingest_projection: async (projection) => projection,
      render: async (parity) => ({
        eligible: parity.eligible,
        checks: parity.checks.map(({ name, ok }) => [name, ok]),
      }),
      truth: {
        eligible: true,
        checks: [
          ['package-set', true],
          ['watermark-tip', true],
        ],
      },
    })
  })

  test('#1009 update — a force-start TurnStarted reaches the active-seat surface with an acknowledgement', async () => {
    const liquidation_source = readFileSync(
      join(repo_root, 'packages/frontend/src/world-shell/fight-liquidation.js'),
      'utf8'
    )
    const page = {
      fight: FIGHT,
      journal_head: '1',
      events: [
        {
          seq: '0',
          kind: 'TurnStarted',
          version: '2',
          digest: 'force-start',
          data: { fight: FIGHT, is_mob: false, idx: '0', deadline_ms: '1000' },
        },
      ],
    }
    await converge({
      issue: 1009,
      source: page,
      project: async (source) => normalize_journal_page(source),
      ingest_projection: async (projection) => fold_journal(projection),
      render: async (state) => ({
        active: state.active,
        acknowledged: liquidation_source.includes("i18n.t('dungeons.auto_force_start_fired')"),
      }),
      truth: { active: 'p0', acknowledged: true },
    })
  })

  test('#760 update — a health-increasing Hit renders as heal semantics', async () => {
    const events = [
      raw_event('Hit', { victim_is_mob: false, victim_idx: 0, amount: 8, remaining_hp: 28 }),
      raw_event('Cast', { caster_is_mob: false, caster_idx: 0, target_cell: 105 }),
    ]
    await converge({
      issue: 760,
      source: { events, health_before: 20 },
      project: async (source) => source.events,
      ingest_projection: async (projection) =>
        produce_receipt_render_turns(projection, {
          fight_id: FIGHT,
          fighter_health: new Map([['p0', 20]]),
          resolve_fighter_id: ({ is_mob, idx }) => `${is_mob ? 'm' : 'p'}${idx}`,
        }),
      render: async (receipt) => {
        const beat = receipt.events.find(({ kind }) => kind === 'damage' || kind === 'heal')
        return {
          kind: beat?.kind,
          amount: beat?.payload?.heal ?? beat?.payload?.damage,
          health: Number(beat?.payload?.new_health),
        }
      },
      truth: { kind: 'heal', amount: 8, health: 28 },
    })
  })

  test('#216 update — an observer journal row reaches the rendered committed position', async () => {
    const page = {
      fight: FIGHT,
      journal_head: '1',
      events: [
        {
          seq: '0',
          kind: 'MobMoved',
          version: '2',
          digest: 'peer-turn',
          data: { fight: FIGHT, idx: '0', to_cell: '49' },
        },
      ],
    }
    await converge({
      issue: 216,
      source: page,
      project: async (source) => normalize_journal_page(source),
      ingest_projection: async (projection) => fold_journal(projection),
      render: async (state) => ({ mob_cell: state.fighters.m0?.cell ?? null }),
      truth: { mob_cell: 49 },
    })
  })

  test('#1676 delete/re-entry — lifecycle mirrors remove the old result and admit the replacement', async () => {
    const parity_source = readFileSync(join(repo_root, 'packages/rpc/indexer/tests/move_mirror_parity.rs'), 'utf8')
    const lifecycle_is_mirrored = ['ResultMinted', 'ResultBurned', 'ResultOpened'].every((name) =>
      parity_source.includes(`("${name}", "${name}")`)
    )
    await converge({
      issue: 1676,
      source: [
        { kind: 'ResultMinted', id: 'old' },
        { kind: 'ResultBurned', id: 'old' },
        { kind: 'ResultOpened', id: 'replacement' },
      ],
      project: async (source) => (lifecycle_is_mirrored ? source : []),
      ingest_projection: async (projection) =>
        projection.reduce(
          (results, event) =>
            event.kind === 'ResultBurned'
              ? results.filter((id) => id !== event.id)
              : [...results.filter((id) => id !== event.id), event.id],
          []
        ),
      render: async (results) => results,
      truth: ['replacement'],
    })
  })
})
