// Regression gate for MULTI-QUILT asset resolution (src/jobs.js walrus_asset_url). A Walrus quilt caps
// at 666 blobs, so an over-cap class (item icons: 2137 files → 4 quilts) ships as a SHARDED set: N
// quilts, each owning a sorted [first,last] identifier range, resolved by binary search. This pins:
//   1. sharded resolution picks the correct quilt per identifier (incl. shard boundaries + hd),
//   2. an out-of-range identifier returns null → the /assets fallback (progressive migration),
//   3. SINGLE-quilt classes (spell/music/mob/character/cosmetic) are BYTE-IDENTICAL to pre-shard —
//      the exact `by-quilt-id/<quilt>/<id>` URL, proving the shard branch never regresses them.
// The resolver's `<=` byte comparison mirrors the upload sharder's code-unit sort (lib.mjs).

import { afterEach, describe, expect, test } from 'bun:test'

import {
  configure_walrus_assets,
  configure_item_icons,
  walrus_asset_url,
  item_icon_url,
  spell_icon_url,
  ASSET_BASE,
} from '../src/jobs.js'

const AGG = 'https://cdn.aresrpg.world/walrus'

// Four contiguous, sorted shards — the exact shape census.mjs projects for an over-cap class.
const ITEM_QUILTS = [
  { id: 'QUILT_A', first: 'aaa.png', last: 'fff.png' },
  { id: 'QUILT_B', first: 'ggg.png', last: 'mmm.png' },
  { id: 'QUILT_C', first: 'nnn.png', last: 'sss.png' },
  { id: 'QUILT_D', first: 'ttt.png', last: 'zzz.png' },
]

const url = (quilt, file) => `${AGG}/v1/blobs/by-quilt-id/${quilt}/${file}`

// Reset the module-global resolver after every test: clear `item` + restore the default aggregator.
afterEach(() => configure_item_icons({ aggregator: AGG, item_quilt: null }))

describe('walrus_asset_url — sharded (multi-quilt) class', () => {
  const cfg = () =>
    configure_walrus_assets({
      aggregator: AGG,
      classes: { item: { quilts: ITEM_QUILTS } },
    })

  test('each identifier resolves to the quilt whose range owns it', () => {
    cfg()
    expect(walrus_asset_url('item', 'axe.png')).toBe(url('QUILT_A', 'axe.png'))
    expect(walrus_asset_url('item', 'jade.png')).toBe(
      url('QUILT_B', 'jade.png'),
    )
    expect(walrus_asset_url('item', 'ring.png')).toBe(
      url('QUILT_C', 'ring.png'),
    )
    expect(walrus_asset_url('item', 'wand.png')).toBe(
      url('QUILT_D', 'wand.png'),
    )
  })

  test('shard boundaries (exact first / last of a shard) resolve to that shard', () => {
    cfg()
    expect(walrus_asset_url('item', 'aaa.png')).toBe(url('QUILT_A', 'aaa.png')) // global first
    expect(walrus_asset_url('item', 'fff.png')).toBe(url('QUILT_A', 'fff.png')) // shard-A last
    expect(walrus_asset_url('item', 'ggg.png')).toBe(url('QUILT_B', 'ggg.png')) // shard-B first
    expect(walrus_asset_url('item', 'zzz.png')).toBe(url('QUILT_D', 'zzz.png')) // global last
  })

  test('hd twin resolves within its shard (same range test)', () => {
    cfg()
    // 'axe_hd.png' sorts after 'axe.png' but still inside shard A (< 'fff.png').
    expect(walrus_asset_url('item', 'axe_hd.png')).toBe(
      url('QUILT_A', 'axe_hd.png'),
    )
  })

  test('an identifier outside every range → null (not-yet-uploaded → caller falls back)', () => {
    cfg()
    expect(walrus_asset_url('item', 'AAA.png')).toBeNull() // before the first shard (uppercase < 'aaa')
    expect(walrus_asset_url('item', 'zzzzz.png')).toBeNull() // past the last shard's last
  })

  test('item_icon_url drives the sharded resolver, hd appends _hd', () => {
    cfg()
    expect(item_icon_url('longsword')).toBe(url('QUILT_B', 'longsword.png')) // 'l' ∈ [ggg,mmm]
    expect(item_icon_url('ring', { hd: true })).toBe(
      url('QUILT_C', 'ring_hd.png'),
    )
  })

  test('item_icon_url falls back to the host-free /assets path for an out-of-range key', () => {
    cfg()
    // A live item whose icon has not been uploaded to any shard degrades to the relative path
    // (then the category glyph on 404) — the progressive-migration contract, unchanged by sharding.
    expect(item_icon_url('AAA')).toBe(`${ASSET_BASE}/items/AAA.png`)
  })
})

describe('walrus_asset_url — single-quilt classes stay BYTE-IDENTICAL (no shard-branch regression)', () => {
  test('spell / music / mob / character / cosmetic resolve to the exact by-quilt-id URL', () => {
    configure_walrus_assets({
      aggregator: AGG,
      classes: {
        spell: { quilt: 'SPELL_Q' },
        music: { quilt: 'MUSIC_Q' },
        mob: { quilt: 'MOB_Q' },
        character: { quilt: 'CHAR_Q' },
        cosmetic: { quilt: 'COSM_Q' },
      },
    })
    expect(spell_icon_url('ikari_haki')).toBe(url('SPELL_Q', 'ikari_haki.png'))
    expect(spell_icon_url('ikari_haki', { hd: true })).toBe(
      url('SPELL_Q', 'ikari_haki_hd.png'),
    )
    expect(walrus_asset_url('music', 'arctic.mp3')).toBe(
      url('MUSIC_Q', 'arctic.mp3'),
    )
    expect(walrus_asset_url('mob', 'crab.glb')).toBe(url('MOB_Q', 'crab.glb'))
    expect(walrus_asset_url('character', 'senshi_male.glb')).toBe(
      url('CHAR_Q', 'senshi_male.glb'),
    )
    expect(walrus_asset_url('cosmetic', 'vaporeon.glb')).toBe(
      url('COSM_Q', 'vaporeon.glb'),
    )
  })

  test('a single-quilt item class (legacy configure_item_icons path) is unchanged', () => {
    configure_item_icons({ aggregator: AGG, item_quilt: 'ITEM_ONE' })
    expect(item_icon_url('longsword')).toBe(url('ITEM_ONE', 'longsword.png'))
    expect(item_icon_url('mace', { hd: true })).toBe(
      url('ITEM_ONE', 'mace_hd.png'),
    )
  })
})

describe('walrus_asset_url — a mixed manifest (single + sharded classes coexist)', () => {
  test('the same manifest resolves single-quilt spells AND sharded items correctly', () => {
    configure_walrus_assets({
      aggregator: AGG,
      classes: { spell: { quilt: 'SPELL_Q' }, item: { quilts: ITEM_QUILTS } },
    })
    expect(spell_icon_url('ember_strike')).toBe(
      url('SPELL_Q', 'ember_strike.png'),
    )
    expect(item_icon_url('jade')).toBe(url('QUILT_B', 'jade.png'))
  })
})
