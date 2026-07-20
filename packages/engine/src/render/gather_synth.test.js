// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// GATHER-NODE SPRITE SYNTHESIS — proof the frontend resource-node prop gets a REAL procedural sprite per id
// (the fix: "procedurally generate real wheat like grass textures, same for herbs + ores"), NOT an item
// icon. Pure + headless (no three): synth_gather_buffer returns raw RGBA bytes. Asserts every one of the 33 node
// identities synthesizes a non-blank, deterministic sprite; siblings differ (the per-id ramp hue really lands);
// and the magical self-glow stays under the no-white-halo luma ceiling.

import { describe, expect, it } from 'bun:test'

import {
  GATHER_NIGHT_FLOOR,
  GATHER_TEX_SIZE,
  gather_night_tint,
  node_glow,
  ore_visual,
  synth_gather_buffer,
} from './gather_synth.js'
import {
  GATHER_BASE_IDS,
  GATHER_EMISSION_LUMA_CEILING,
  HERB_RAMP,
  ORE_RAMP,
  WHEAT_RAMP,
  luma01,
} from './texture_recipes_gather.js'

/** @param {{ data: Uint8Array, size: number }} buf */
const opaque_count = (buf) => {
  let n = 0
  for (let i = 3; i < buf.data.length; i += 4) if (buf.data[i] === 255) n += 1
  return n
}
/** @param {{ data: Uint8Array }} a @param {{ data: Uint8Array }} b */
const buffers_equal = (a, b) => a.data.length === b.data.length && a.data.every((v, i) => v === b.data[i])
/** synth a KNOWN id (asserts non-null so the type narrows for the comparisons). @param {string} id */
const synth = (id) => {
  const b = synth_gather_buffer(id)
  if (!b) throw new Error(`no sprite for ${id}`)
  return b
}

describe('synth_gather_buffer — a procedural sprite per resource id (the grass idiom, not an item icon)', () => {
  it('every one of the 33 base node ids synthesizes a non-blank RGBA sprite of the atlas size', () => {
    expect(GATHER_BASE_IDS).toHaveLength(33)
    for (const id of GATHER_BASE_IDS) {
      const buf = synth_gather_buffer(id)
      expect(buf, `${id} synthesizes`).toBeTruthy()
      if (!buf) continue
      expect(buf.size).toBe(GATHER_TEX_SIZE)
      expect(buf.data.length).toBe(GATHER_TEX_SIZE * GATHER_TEX_SIZE * 4)
      // a real silhouette paints hundreds of opaque texels — never a blank/transparent card (the sticker bug).
      expect(opaque_count(buf), `${id} has painted body`).toBeGreaterThan(100)
    }
  })

  it('the 33 base ids are exactly the three family ramps (wheat ∪ ore ∪ herb), all distinct', () => {
    const ramp_ids = [...WHEAT_RAMP, ...ORE_RAMP, ...HERB_RAMP].map((e) => e.id)
    expect(new Set(GATHER_BASE_IDS)).toEqual(new Set(ramp_ids))
    expect(ramp_ids).toHaveLength(33)
  })

  it('is deterministic — the same id synthesizes byte-identical art every call (stable per-node art)', () => {
    for (const id of ['wheat', 'blood_wheat', 'jade', 'arcaneshroom']) {
      expect(buffers_equal(synth(id), synth(id)), `${id} deterministic`).toBe(true)
    }
  })

  it('siblings in a family DIFFER — the per-id ramp hue actually changes the art (not one recoloured stamp)', () => {
    // same op + geometry, different ramp colour ⇒ the byte buffers must diverge (proves the hue lands on pixels).
    expect(buffers_equal(synth('wheat'), synth('blood_wheat'))).toBe(false)
    expect(buffers_equal(synth('diamond'), synth('jade'))).toBe(false)
    expect(buffers_equal(synth('green_mushroom'), synth('nightcap'))).toBe(false)
  })

  it('returns null for an unknown id (a drifted chain row renders untextured, never crashes)', () => {
    expect(synth_gather_buffer('not_a_real_resource')).toBeNull()
  })
})

describe('node_glow / ore_visual — magical self-glow under the no-white-halo luma ceiling', () => {
  const MAGICAL = [
    'nightcap',
    'phantom_spore',
    'arcaneshroom',
    'dragonlily',
    'cursed_fungus',
    'amber',
    'arcanite',
    'draconite',
    'cursed_gem',
  ]
  const MUNDANE = ['wheat', 'green_mushroom', 'diamond', 'jade', 'red_orchid']

  it('magical ids carry a capped hued glow; mundane ids carry none', () => {
    for (const id of MAGICAL) {
      const g = node_glow(id)
      expect(g, `${id} glows`).toBeTruthy()
      if (!g) continue
      expect(luma01(g), `${id} glow ≤ ceiling`).toBeLessThanOrEqual(GATHER_EMISSION_LUMA_CEILING + 1e-9)
    }
    for (const id of MUNDANE) expect(node_glow(id), `${id} mundane`).toBeNull()
  })

  it('ore_visual gives each ore its identity vein colour; magical ores also an (capped) emissive', () => {
    const jade = ore_visual('jade')
    expect(jade.rgb).toEqual([72, 166, 120]) // ORE_RAMP identity — the single home
    expect(jade.emissive).toBeNull() // mundane ore, no pulse
    const arcanite = ore_visual('arcanite')
    expect(arcanite.emissive).toBeTruthy()
    if (arcanite.emissive) expect(luma01(arcanite.emissive)).toBeLessThanOrEqual(GATHER_EMISSION_LUMA_CEILING + 1e-9)
  })
})

describe('gather_night_tint — the gather prop day/night dim (2026-07-19: glowing gatherables at night)', () => {
  it('is identity in full daylight (day_factor 1) so the tuned DAY look is byte-identical', () => {
    expect(gather_night_tint(1)).toBe(1)
  })
  it('falls to GATHER_NIGHT_FLOOR below the horizon (day_factor 0) — dimmed, never black', () => {
    expect(gather_night_tint(0)).toBeCloseTo(GATHER_NIGHT_FLOOR, 9)
    expect(GATHER_NIGHT_FLOOR).toBeGreaterThan(0) // plants stay findable at night (gameplay)
    expect(GATHER_NIGHT_FLOOR).toBeLessThan(1) // …but clearly darker than day
  })
  it('is monotonic across dusk and clamps out-of-range inputs', () => {
    expect(gather_night_tint(0.5)).toBeGreaterThan(gather_night_tint(0))
    expect(gather_night_tint(1)).toBeGreaterThan(gather_night_tint(0.5))
    expect(gather_night_tint(-3)).toBe(GATHER_NIGHT_FLOOR) // clamp low → floor
    expect(gather_night_tint(9)).toBe(1) // clamp high → identity
  })
})
