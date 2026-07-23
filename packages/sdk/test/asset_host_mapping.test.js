// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE MAPPING LAW, pinned (#650 — full pivot off Walrus for asset serving, MinIO behind
// assets.aresrpg.world). walrus_asset_url dispatches by the filename's own extension into one of
// three shapes; this is the one file proving all three, replacing the coverage walrus_multi_quilt.test.js
// used to carry for the (now-deleted) quilt-sharding branch:
//   flat art  → {host}/{family}/{key}[_hd].{ext}
//   geometry  → {host}/models/{family}/{key}.glb
//   data blob → {host}/data/{class}.json
// RED-FIRST: every assertion here is red against the quilt-era `by-quilt-id/<quilt>/...` output (the
// resolver never produced a `/data/` or `/models/` path before #650) and green against the rewrite.

import { afterEach, describe, expect, test } from 'bun:test'

import { configure_walrus_assets, spell_icon_url, walrus_asset_url } from '../src/jobs.js'

const HOST = 'https://assets.aresrpg.world'

afterEach(() => {
  // Explicit unpublish after every test — bun shares this module's state across the whole
  // `packages/sdk packages/frontend` run (reset_walrus_assets_for_test.doc); never rely on a later
  // file's ambient state.
  configure_walrus_assets({
    aggregator: HOST,
    classes: {
      spell: {},
      mob: {},
      character: {},
      cosmetic: {},
      spell_corpus: {},
      world_corpus: {},
      mob_catalog: {},
      pet_catalog: {},
      icon_slug_map: {},
    },
  })
})

describe('the mapping law — flat art', () => {
  test('spell_icon_url resolves {host}/spells/{icon}[_hd].png once published', () => {
    configure_walrus_assets({ aggregator: HOST, classes: { spell: { published: true } } })
    expect(spell_icon_url('ikari_haki')).toBe(`${HOST}/spells/ikari_haki.png`)
    expect(spell_icon_url('ikari_haki', { hd: true })).toBe(`${HOST}/spells/ikari_haki_hd.png`)
  })

  test('an unpublished flat-art class returns null (caller falls back)', () => {
    expect(walrus_asset_url('spell', 'ikari_haki.png')).toBeNull()
  })
})

describe('the mapping law — geometry (.glb)', () => {
  test('mob/character/cosmetic all resolve {host}/models/{family}/{key}.glb once published', () => {
    configure_walrus_assets({
      aggregator: HOST,
      classes: { mob: { published: true }, character: { published: true }, cosmetic: { published: true } },
    })
    expect(walrus_asset_url('mob', 'crab.glb')).toBe(`${HOST}/models/mobs/crab.glb`)
    expect(walrus_asset_url('character', 'senshi_male.glb')).toBe(`${HOST}/models/characters/senshi_male.glb`)
    expect(walrus_asset_url('cosmetic', 'vaporeon.glb')).toBe(`${HOST}/models/cosmetics/vaporeon.glb`)
  })

  test('an unpublished geometry class returns null (caller falls back to the bundled copy)', () => {
    expect(walrus_asset_url('mob', 'crab.glb')).toBeNull()
  })
})

describe('the mapping law — data blob (/data/{class}.json)', () => {
  test('every runtime content blob resolves {host}/data/{class}.json once published — keyed by CLASS, not the passed filename', () => {
    configure_walrus_assets({
      aggregator: HOST,
      classes: {
        spell_corpus: { published: true },
        world_corpus: { published: true },
        mob_catalog: { published: true },
        pet_catalog: { published: true },
        icon_slug_map: { published: true },
      },
    })
    expect(walrus_asset_url('spell_corpus', 'spell_corpus.json')).toBe(`${HOST}/data/spell_corpus.json`)
    expect(walrus_asset_url('world_corpus', 'world_corpus.json')).toBe(`${HOST}/data/world_corpus.json`)
    expect(walrus_asset_url('mob_catalog', 'mob_catalog.json')).toBe(`${HOST}/data/mob_catalog.json`)
    expect(walrus_asset_url('pet_catalog', 'pet_catalog.json')).toBe(`${HOST}/data/pet_catalog.json`)
    expect(walrus_asset_url('icon_slug_map', 'icon_slug_map.json')).toBe(`${HOST}/data/icon_slug_map.json`)
  })

  test('an unpublished data-blob class returns null (loader degrades loudly, never a frozen absence)', () => {
    expect(walrus_asset_url('spell_corpus', 'spell_corpus.json')).toBeNull()
  })
})
