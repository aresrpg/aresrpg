// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Regression + unit coverage for the seed-batching primitives added to ceremony_lib.mjs (critical-path
// seeder optimization: PTBs cap at 1024 operations per tx — batch the
// ~1,850-row item/mob/spell one-per-tx phases in seed_full_corpus.mjs). Pure — no chain, no client, no
// seeder import (ceremony_lib.mjs itself has zero import-time side effects, unlike client.js/seed_full_corpus.mjs,
// so it imports cleanly here).
import { describe, test, expect } from 'bun:test'
import { bcs } from '@mysten/sui/bcs'

import {
  resolveBatch,
  claimCreated,
  multiGetObjectsChunked,
  planFixedKeyAdds,
  existingTableKeys,
  normalizeReceipt,
  netGas,
  classify,
  probeBatchSize,
  parsePublishedToml,
  bumpPublishedToml,
  resolveUpgradeTarget,
  runPreflightedBatches,
} from './ceremony_lib.mjs'

describe('runPreflightedBatches — refuse every batch before the phase mints anything', () => {
  test('all exact, input-fitted batches preflight before the first execute', async () => {
    const order = []
    await runPreflightedBatches(
      ['a', 'b', 'c', 'd', 'e'],
      3,
      (candidate) => Math.min(candidate.length, 2),
      async (batch, offset) => order.push(`probe:${offset}:${batch.join('')}`),
      async (batch, offset) => order.push(`mint:${offset}:${batch.join('')}`)
    )
    expect(order).toEqual([
      'probe:0:ab',
      'probe:2:cd',
      'probe:4:e',
      'mint:0:ab',
      'mint:2:cd',
      'mint:4:e',
    ])
  })

  test('a later-batch refusal executes zero mints for the phase', async () => {
    const minted = []
    await expect(
      runPreflightedBatches(
        ['a', 'b', 'c', 'd'],
        2,
        (candidate) => candidate.length,
        async (_batch, offset) => {
          if (offset === 2) throw new Error('refusing batch at offset 2')
        },
        async (batch) => minted.push(...batch)
      )
    ).rejects.toThrow(/refusing batch at offset 2/)
    expect(minted).toEqual([])
  })
})

describe('probeBatchSize — simulation failures retain their original Move abort', () => {
  test('a failed floor surfaces module/code/message and preserves the raw abort as its cause', async () => {
    const abort = {
      $kind: 'MoveAbort',
      message: "MoveAbort in '0xabc::spell_book::seed' (instruction 7)",
      MoveAbort: { abortCode: '205', location: { module: 'spell_book' } },
    }
    const client = {
      simulateTransaction: async () => ({
        $kind: 'FailedTransaction',
        FailedTransaction: {
          effects: { status: { success: false, error: abort } },
        },
      }),
    }
    const tx = { setSenderIfNotSet: () => {} }

    try {
      await probeBatchSize(client, '0xsender', [{}], () => tx)
      throw new Error('expected probeBatchSize to reject')
    } catch (error) {
      expect(error).toMatchObject({
        name: 'ProbeSimulationError',
        module: 'spell_book',
        code: 205,
        message: abort.message,
        cause: abort,
      })
    }
  })
})

describe('resolveBatch — order-INDEPENDENT batch resolution (never an objectChanges/event order assumption)', () => {
  test('order-scrambled created ids resolve correctly by composite key (mirrors the item/mob content-key path)', () => {
    const rows = [
      { slug: 'sword_a', name: 'Iron Sword', level: 5 },
      { slug: 'sword_b', name: 'Steel Sword', level: 10 },
      { slug: 'sword_c', name: 'Gold Sword', level: 15 },
    ]
    const keyOfRow = (r) => `${r.name}:${r.level}`
    // created ids arrive in a DELIBERATELY SCRAMBLED order (never assume objectChanges mirrors command order)
    const created = [
      { id: '0xC3', key: 'Gold Sword:15' },
      { id: '0xA1', key: 'Iron Sword:5' },
      { id: '0xB2', key: 'Steel Sword:10' },
    ]
    const resolved = resolveBatch(rows, keyOfRow, created)
    expect(resolved.find((x) => x.row.slug === 'sword_a').id).toBe('0xA1')
    expect(resolved.find((x) => x.row.slug === 'sword_b').id).toBe('0xB2')
    expect(resolved.find((x) => x.row.slug === 'sword_c').id).toBe('0xC3')
  })

  test('duplicate keys (byte-identical rows) are treated as interchangeable — first-available consumption, no double-assign', () => {
    const rows = [
      { slug: 'x1', k: 'dup' },
      { slug: 'x2', k: 'dup' },
    ]
    const created = [
      { id: '0xAA', key: 'dup' },
      { id: '0xBB', key: 'dup' },
    ]
    const resolved = resolveBatch(rows, (r) => r.k, created)
    const ids = resolved.map((r) => r.id).sort()
    expect(ids).toEqual(['0xAA', '0xBB']) // both consumed, none reused
  })

  test('a row with zero matching candidates HALTS (throws) — never guesses a mapping', () => {
    const rows = [{ slug: 'ghost', k: 'nowhere' }]
    const created = [{ id: '0x1', key: 'somewhere-else' }]
    expect(() => resolveBatch(rows, (r) => r.k, created)).toThrow(
      /no created id matches row key/
    )
  })

  test('a leftover unclaimed created id (count mismatch) HALTS — never silently drops an on-chain object', () => {
    const rows = [{ slug: 'only-one', k: 'a' }]
    const created = [
      { id: '0x1', key: 'a' },
      { id: '0x2', key: 'a' },
    ] // 2 created, 1 row
    expect(() => resolveBatch(rows, (r) => r.k, created)).toThrow(
      /unclaimed after matching/
    )
  })

  test('event-based resolution shape (spells): (class, unlock_level, name) triple needs no content read', () => {
    const rows = [
      {
        classType: 'senshi',
        unlock: 1,
        id: 'senshi_ember_strike',
        name: 'Ember Strike',
      },
      {
        classType: 'senshi',
        unlock: 1,
        id: 'senshi_earthen_cleave',
        name: 'Earthen Cleave',
      },
    ]
    const keyOfRow = (sp) => `${sp.classType}:${sp.unlock}:${sp.id}`
    // mirrors parsedJson off a real SpellMinted event — order scrambled vs the rows above
    const created = [
      { id: '0xSPELL2', key: 'senshi:1:senshi_earthen_cleave' },
      { id: '0xSPELL1', key: 'senshi:1:senshi_ember_strike' },
    ]
    const resolved = resolveBatch(rows, keyOfRow, created)
    expect(resolved.find((x) => x.row.id === 'senshi_ember_strike').id).toBe(
      '0xSPELL1'
    )
    expect(resolved.find((x) => x.row.id === 'senshi_earthen_cleave').id).toBe(
      '0xSPELL2'
    )
  })
})

// Idempotent fixed-key adds (07-12 live-train fix): crush_go_live had already seeded `rune` into the fresh
// lineage's Catalog, and PHASE 1's blind re-add of ALL categories aborted `0x2::dynamic_field::add` code 0
// (EFieldAlreadyExists — Table<String,bool>.add). Pre-flight read → add ONLY the missing; all-exist → no tx.
describe('planFixedKeyAdds — add only the missing keys; all-exist skips the tx entirely', () => {
  test('mocked existing-DF set (the live incident shape): only the missing categories are added', () => {
    const wanted = ['rune', 'helmet', 'longsword', 'consumable']
    const existing = new Set(['rune']) // crush_go_live's registry run seeded this one
    const plan = planFixedKeyAdds(wanted, existing)
    expect(plan.missing).toEqual(['helmet', 'longsword', 'consumable'])
    expect(plan.existingCount).toBe(1)
    expect(plan.skip).toBe(false)
  })

  test('ALL keys already on-chain → skip=true (no tx is built at all)', () => {
    const wanted = ['senshi', 'yajin']
    const plan = planFixedKeyAdds(
      wanted,
      new Set(['senshi', 'yajin', 'tomoda'])
    )
    expect(plan.missing).toEqual([])
    expect(plan.skip).toBe(true)
  })
})

describe('existingTableKeys — Table<String,bool> DF walk (mocked gRPC client: json → table id → paginated keys)', () => {
  const table_id = '0x' + 'ab'.repeat(32)
  // gRPC Core DF name = { type, bcs } (bcs = the BCS-encoded key); a Table<String,bool> key is a bare String.
  const dfName = (s) => ({
    name: {
      type: '0x1::string::String',
      bcs: bcs.string().serialize(s).toBytes(),
    },
  })
  const client_with = (pages) => {
    let call = 0
    return {
      // gRPC Core getObject → { object: { json } }; json flattens the Table field's UID to a bare id string.
      getObject: async () => ({
        object: { json: { categories: { id: table_id, size: '3' } } },
      }),
      listDynamicFields: async ({ parentId }) => {
        expect(parentId).toBe(table_id) // MUST walk the TABLE's UID, not the shared object's
        return pages[call++]
      },
    }
  }

  test('walks every page and returns the full key set (BCS-decoded string DF names)', async () => {
    const pages = [
      { dynamicFields: [dfName('rune')], hasNextPage: true, cursor: '0x1' },
      { dynamicFields: [dfName('helmet')], hasNextPage: false, cursor: null },
    ]
    const keys = await existingTableKeys(
      client_with(pages),
      '0xCATALOG',
      'categories'
    )
    expect([...keys].sort()).toEqual(['helmet', 'rune'])
  })

  test('an unresolvable table THROWS (never returns an empty set that would green-light the blind re-add)', async () => {
    const bad = { getObject: async () => ({ object: { json: {} } }) }
    await expect(
      existingTableKeys(bad, '0xCATALOG', 'categories')
    ).rejects.toThrow(/refusing a blind add/)
  })
})

// Page every id-array read at ≤50/page (belt-and-braces against per-request node caps); gRPC Core getObjects →
// { objects:[obj|Error] }, re-projected to the jsonRpc-ish { data:{ objectId, content:{ fields } } } consumers read.
describe('multiGetObjectsChunked — ≤50-id pages, order preserved (gRPC getObjects → data.content.fields)', () => {
  test('120 ids → 3 calls (50/50/20), results concatenated in order', async () => {
    const ids = Array.from({ length: 120 }, (_, i) => `0xID${i}`)
    const calls = []
    const client = {
      getObjects: async ({ objectIds: page }) => {
        calls.push(page.length)
        return {
          objects: page.map((id) => ({
            objectId: id,
            json: { item_type: 'x' },
          })),
        }
      },
    }
    const out = await multiGetObjectsChunked(client, ids, { showContent: true })
    expect(calls).toEqual([50, 50, 20])
    expect(out.length).toBe(120)
    expect(out.map((o) => o.data.objectId)).toEqual(ids) // order preserved across pages
    expect(out[0].data.content.fields.item_type).toBe('x') // json → content.fields projection
  })
})

describe('claimCreated — backfill resolution (created ids from a re-fetched digest → manifest rows)', () => {
  // Fixture mirrors the real incident: an executed items:0 digest holds created templates; the unresolved
  // row set is the WHOLE corpus (superset of the batch) — every created id must land, leftover rows stay.
  const rows = [
    { slug: 'sword_a', k: 'Iron Sword' },
    { slug: 'sword_b', k: 'Steel Sword' },
    { slug: 'sword_c', k: 'Gold Sword' }, // not in the executed batch — must stay pending, unclaimed
  ]
  const keyOf = (r) => r.k

  test('fixture digest effects → rows land for every created id; rows beyond the batch stay pending', () => {
    const created = [
      { id: '0xB', key: 'Steel Sword' },
      { id: '0xA', key: 'Iron Sword' },
    ]
    const landed = claimCreated(rows, keyOf, created)
    expect(landed.find((x) => x.id === '0xA').row.slug).toBe('sword_a')
    expect(landed.find((x) => x.id === '0xB').row.slug).toBe('sword_b')
    expect(landed.length).toBe(2) // sword_c untouched — still pending for the live mint path
  })

  test('an unmatched created id THROWS — an on-chain object is never silently dropped', () => {
    expect(() =>
      claimCreated(rows, keyOf, [{ id: '0xZ', key: 'Phantom Blade' }])
    ).toThrow(/matches no unclaimed row/)
  })
})

// #23 gRPC cutover: normalizeReceipt re-projects the Core { $kind, Transaction|FailedTransaction } result into
// the jsonRpc-ish receipt every seeder/ceremony consumer parses. This is the money-rail seam — createdId,
// resolveBatch, account (gasUsed), classify (published + shared owner) all read its output.
describe('normalizeReceipt — Core result → jsonRpc-ish { digest, effects, objectChanges, events }', () => {
  const grpcOk = {
    $kind: 'Transaction',
    Transaction: {
      digest: '0xDIGEST',
      objectTypes: {
        '0xITEM': '0xpkg::item::ItemTemplate',
        '0xCFG': '0xpkg::config::GameConfig',
        '0xMUT': '0xpkg::x::Y',
      },
      effects: {
        status: { success: true, error: null },
        gasUsed: {
          computationCost: 1000,
          storageCost: 2000,
          storageRebate: 500,
          nonRefundableStorageFee: 10,
        },
        changedObjects: [
          {
            objectId: '0xPKG',
            outputState: 'PackageWrite',
            idOperation: 'None',
          },
          {
            objectId: '0xITEM',
            idOperation: 'Created',
            outputState: 'ObjectWrite',
            outputVersion: '3',
            outputOwner: { $kind: 'AddressOwner', AddressOwner: '0xME' },
          },
          {
            objectId: '0xCFG',
            idOperation: 'Created',
            outputState: 'ObjectWrite',
            outputVersion: '3',
            outputOwner: {
              $kind: 'Shared',
              Shared: { initialSharedVersion: '7' },
            },
          },
          {
            objectId: '0xMUT',
            idOperation: 'None',
            outputState: 'ObjectWrite',
            outputVersion: '5',
            outputOwner: { $kind: 'AddressOwner', AddressOwner: '0xME' },
          },
        ],
      },
      events: [
        {
          eventType: '0xpkg::spell_template::SpellMinted',
          json: {
            spell: '0xS',
            class: 'senshi',
            unlock_level: 1,
            name: 'Ember',
          },
        },
      ],
    },
  }

  test('success: digest, status, string gasUsed (netGas math holds), created/published/mutated objectChanges, events', () => {
    const r = normalizeReceipt(grpcOk)
    expect(r.digest).toBe('0xDIGEST')
    expect(r.effects.status.status).toBe('success')
    // gasUsed carries the three fields netGas reads, coerced to strings (jsonRpc parity).
    expect(r.effects.gasUsed).toEqual({
      computationCost: '1000',
      storageCost: '2000',
      storageRebate: '500',
    })
    expect(netGas(r.effects.gasUsed)).toBe(2500) // 1000 + 2000 − 500

    // createdId-style filter (seed_full_corpus): first created object whose type ends with a suffix.
    const item = r.objectChanges.find(
      (c) =>
        c.type === 'created' && c.objectType.endsWith('::item::ItemTemplate')
    )
    expect(item.objectId).toBe('0xITEM')
    expect(item.version).toBe('3')

    // classify-style (ceremony): the PackageWrite → published, and a shared created object → mapped snake owner.
    expect(r.objectChanges.find((c) => c.type === 'published').packageId).toBe(
      '0xPKG'
    )
    const cfg = r.objectChanges.find((c) => c.objectId === '0xCFG')
    expect('Shared' in cfg.owner).toBe(true) // isShared() sees it
    expect(cfg.owner.Shared.initial_shared_version).toBe('7') // camel→snake mapped for classify

    // mutated is carried (type !== 'created', skipped by createdId/classify but present for version reads).
    expect(r.objectChanges.find((c) => c.objectId === '0xMUT').type).toBe(
      'mutated'
    )

    // events re-keyed to { type, parsedJson } (spellCreatedOf reads e.type / e.parsedJson).
    expect(r.events).toEqual([
      {
        type: '0xpkg::spell_template::SpellMinted',
        parsedJson: {
          spell: '0xS',
          class: 'senshi',
          unlock_level: 1,
          name: 'Ember',
        },
      },
    ])
  })

  test('failure: FailedTransaction → status "failure" + the error surfaced (the tx-retry-burn gate reads this)', () => {
    const r = normalizeReceipt({
      $kind: 'FailedTransaction',
      FailedTransaction: {
        digest: '0xBAD',
        effects: {
          status: { success: false, error: { kind: 'MoveAbort' } },
          gasUsed: {},
          changedObjects: [],
        },
        events: [],
      },
    })
    expect(r.effects.status.status).toBe('failure')
    expect(r.effects.status.error).toEqual({ kind: 'MoveAbort' })
    expect(r.digest).toBe('0xBAD')
  })
})

// LATENT-BUG regression (wave-2a receipt replay): gRPC objectTypes arrive ADDRESS-PADDED
// (`0x0000…0002::package::UpgradeCap`) — classify()'s SHORT-form literals (UpgradeCap `===`, Publisher/Display
// startsWith) and ceremony.mjs capturePolicy's `includes('0x2::transfer_policy::TransferPolicy<')` all MISSED,
// so the ceremony stamped `upgrade-capability = "null"` into Published.toml and every downstream `sui move
// build` died AccountAddressParseError. normalizeReceipt now canonicalizes every address to the short form.
describe('normalizeReceipt — PADDED gRPC type strings → classify/capturePolicy/seeder matchers resolve', () => {
  const PAD = '0x' + '0'.repeat(63) // + last hex char → a padded framework address
  const USER =
    '0x0a544113d593fc233921ecd7d0ec4fb8d4abedc7100c33188041a4aed1038cb5' // leading-zero user pkg
  const paddedReceipt = {
    $kind: 'Transaction',
    Transaction: {
      digest: '0xPADDED',
      objectTypes: {
        '0xCAP': `${PAD}2::package::UpgradeCap`,
        '0xPUB': `${PAD}2::package::Publisher`,
        '0xDISP': `${PAD}2::display::Display<${USER}::item::Item>`,
        '0xPOL': `${PAD}2::transfer_policy::TransferPolicy<${USER}::character::Character>`,
        '0xTPL': `${USER}::item::ItemTemplate`,
        '0xVER': `${USER}::version::Version`,
        '0xADM': `${USER}::admin::AdminCap`,
      },
      effects: {
        status: { success: true, error: null },
        gasUsed: { computationCost: 1, storageCost: 1, storageRebate: 0 },
        changedObjects: [
          {
            objectId: '0xPKG',
            outputState: 'PackageWrite',
            idOperation: 'None',
          },
          ...['0xCAP', '0xPUB', '0xDISP', '0xTPL', '0xVER', '0xADM'].map(
            (objectId) => ({
              objectId,
              idOperation: 'Created',
              outputState: 'ObjectWrite',
              outputVersion: '2',
              outputOwner: { $kind: 'AddressOwner', AddressOwner: '0xME' },
            })
          ),
          {
            objectId: '0xPOL',
            idOperation: 'Created',
            outputState: 'ObjectWrite',
            outputVersion: '2',
            outputOwner: {
              $kind: 'Shared',
              Shared: { initialSharedVersion: '9' },
            },
          },
        ],
      },
      events: [
        {
          eventType: `${PAD}4ed7::spell_template::SpellMinted`,
          json: { spell: '0xS' },
        },
      ],
    },
  }

  test('classify() resolves upgradeCap / Publisher / Display / version / admin off a padded receipt (the Published.toml "null" bug)', () => {
    const r = normalizeReceipt(paddedReceipt)
    const M = {}
    const e = classify('aresrpg', r, M)
    expect(e.pkg).toBe('0xPKG')
    expect(e.upgradeCap).toBe('0xCAP') // was null on padded types — the exact `=== '0x2::package::UpgradeCap'` match
    expect(e._pubIds).toEqual(['0xPUB']) // startsWith('0x2::package::Publisher')
    expect(e.displays.Item).toBe('0xDISP') // startsWith('0x2::display::Display<')
    expect(e.version).toBe('0xVER')
    expect(e.admin).toBe('0xADM')
  })

  test('ceremony capturePolicy matcher + seeder endsWith resolution both hit on the normalized types', () => {
    const r = normalizeReceipt(paddedReceipt)
    // capturePolicy's exact expression (ceremony.mjs createdChange): SHORT-form includes.
    const policy = r.objectChanges.find(
      (c) =>
        c.type === 'created' &&
        (c.objectType || '').includes('0x2::transfer_policy::TransferPolicy<')
    )
    expect(policy.objectId).toBe('0xPOL')
    expect(policy.owner.Shared.initial_shared_version).toBe('9')
    // struct type args are canonicalized too (leading-zero USER pkg keeps its jsonRpc full form? NO — short form;
    // consumers are endsWith/includes on `::mod::Struct`, address-form-agnostic).
    expect(policy.objectType).toBe(
      `0x2::transfer_policy::TransferPolicy<${USER.replace('0x0', '0x')}::character::Character>`
    )
    // the reseed's created-object resolution (seed_full_corpus itemCreatedOf / createdId): endsWith — hits.
    const tpl = r.objectChanges.find(
      (c) =>
        c.type === 'created' &&
        (c.objectType || '').endsWith('::item::ItemTemplate')
    )
    expect(tpl.objectId).toBe('0xTPL')
    // spellCreatedOf's event matcher (seed_spells_phase): endsWith on the normalized event type — hits.
    expect(r.events[0].type.endsWith('::spell_template::SpellMinted')).toBe(
      true
    )
  })
})

// ── Upgrade-target derivation (2026-07-13 wave-2a incident: a type-origin PACKAGE_ID passed to tx.upgrade
//    would have aborted ON-CHAIN with PackageIDDoesNotMatch after one prior upgrade advanced cap.package).
//    These lock the pre-flight guard + the Published.toml lineage bookkeeping ceremony_upgrade.mjs now does. ──

const ORIGIN =
  '0x627b503041cb74ae1315c8c784a2f040db9e7739026ad2622e25c22672374999'
const LATEST =
  '0xd5157a9bd0bd1c00483f27d945851b28c7d6bc10aba4cb75e22016c02894d7d1'
const NEWEST =
  '0xaaaa000000000000000000000000000000000000000000000000000000001111'
const TOML = `# Generated by Move
[published.testnet]
chain-id = "4c78adac"
published-at = "${LATEST}"
original-id = "${ORIGIN}"
version = 2
toolchain-version = "1.74.1"
build-config = { flavor = "sui", edition = "2024" }
upgrade-capability = "0xecbce15177c226cb8fd73dbd6b5ebc2383b6dcc8f97c20008eafc469f78900bb"
`

describe('resolveUpgradeTarget — the tx.upgrade target is the CURRENT package id, never the type origin', () => {
  test('cap.package wins when present (chain is truth)', () => {
    const r = resolveUpgradeTarget({ capPackage: LATEST, publishedAt: LATEST })
    expect(r.target).toBe(LATEST)
    expect(r.source).toBe('upgrade-cap')
    expect(r.stalePublishedToml).toBe(false)
  })

  test('falls back to Published.toml published-at when the cap read is unavailable', () => {
    const r = resolveUpgradeTarget({ publishedAt: LATEST })
    expect(r.target).toBe(LATEST)
    expect(r.source).toBe('published-toml')
  })

  test('THE WAVE-2A BUG: an origin/type-origin PACKAGE_ID env THROWS pre-flight (never reaches the chain)', () => {
    expect(() =>
      resolveUpgradeTarget({
        capPackage: LATEST,
        publishedAt: LATEST,
        envPackageId: ORIGIN,
      })
    ).toThrow(/disagrees with the CURRENT package id/)
  })

  test('a matching explicit PACKAGE_ID passes (case/prefix-normalized)', () => {
    const r = resolveUpgradeTarget({
      capPackage: LATEST,
      envPackageId: LATEST.slice(2).toUpperCase(),
    })
    expect(r.target).toBe(LATEST)
  })

  test('stale Published.toml (disagrees with cap.package) is FLAGGED, cap still wins', () => {
    const r = resolveUpgradeTarget({ capPackage: NEWEST, publishedAt: LATEST })
    expect(r.target).toBe(NEWEST)
    expect(r.stalePublishedToml).toBe(true)
  })

  test('no source at all HALTS — never guesses an upgrade target', () => {
    expect(() => resolveUpgradeTarget({})).toThrow(/refusing to guess/)
  })
})

describe('parsePublishedToml / bumpPublishedToml — the lineage record the NEXT build + upgrade read', () => {
  test('parse extracts published-at / original-id / version / upgrade-capability for the network', () => {
    const p = parsePublishedToml(TOML, 'testnet')
    expect(p.publishedAt).toBe(LATEST)
    expect(p.originalId).toBe(ORIGIN)
    expect(p.version).toBe(2)
    expect(p.upgradeCap).toBe(
      '0xecbce15177c226cb8fd73dbd6b5ebc2383b6dcc8f97c20008eafc469f78900bb'
    )
  })

  test('parse returns null for an absent network section (fresh package)', () => {
    expect(parsePublishedToml(TOML, 'mainnet')).toBe(null)
  })

  test('bump swaps published-at, increments version, touches NOTHING else — parse(bump()) round-trips', () => {
    const bumped = bumpPublishedToml(TOML, 'testnet', NEWEST)
    const p = parsePublishedToml(bumped, 'testnet')
    expect(p.publishedAt).toBe(NEWEST)
    expect(p.version).toBe(3)
    expect(p.originalId).toBe(ORIGIN) // origin NEVER moves
    expect(bumped).toContain('chain-id = "4c78adac"')
    expect(bumped).toContain(`upgrade-capability = "0xecbce15177c226cb8fd73dbd`)
  })

  test('bump on a missing section HALTS (writes nothing)', () => {
    expect(() => bumpPublishedToml(TOML, 'mainnet', NEWEST)).toThrow(
      /no \[published\.mainnet\] section/
    )
  })
})
