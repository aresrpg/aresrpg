// Unit coverage for the fight-VFX choreography map's pure helpers + data integrity. Phase 2: the map names 3D
// GPU-particle PRESETS (preset_3d) exclusively — NO sprite sheets on any fight surface — so
// the integrity sweep proves EVERY attack layer AND the reserved shelves resolve to a real preset in
// @aresrpg/engine3/vfx (the "zero sprites can render" guarantee that closes the mob-attack sprite gap).
import { describe, expect, it } from 'bun:test'
import { PRESETS } from '@aresrpg/engine3/vfx'

import {
  BURST_VFX,
  CAST_VFX,
  TRAP_GLYPH_VFX,
  IMPACT_BIG_AT,
  IMPACT_FEEL,
  MAG_HP_FRACTION,
  MAG_MAX,
  MAG_MIN,
  STATUS_VFX,
  SUMMON_VFX,
  TITLE_AURA,
  asset_element,
  is_burst_element,
  magnitude_scale,
  resolve_impact,
  element_from_code,
  resolve_cast_element,
  prewarm_specs,
} from './vfx_map.js'

describe('magnitude_scale — a nuke reads bigger than a jab (soft log ramp, clamped)', () => {
  it('rises monotonically with damage and clamps to [MAG_MIN, MAG_MAX]', () => {
    expect(magnitude_scale(0)).toBeCloseTo(0.85, 2)
    expect(magnitude_scale(400)).toBeGreaterThan(magnitude_scale(40))
    expect(magnitude_scale(1e9)).toBeLessThanOrEqual(MAG_MAX)
    expect(magnitude_scale(-50)).toBeGreaterThanOrEqual(MAG_MIN)
    expect(Number.isFinite(magnitude_scale(undefined))).toBe(true)
  })
  it('TARGET-RELATIVE reference: a LV1 12-dmg crit on a 31-HP mob crosses IMPACT_BIG_AT via MAG_HP_FRACTION', () => {
    expect(magnitude_scale(12, 40)).toBeCloseTo(magnitude_scale(12), 10) // back-compat with the 1-arg call
    expect(magnitude_scale(12, 31 * MAG_HP_FRACTION)).toBeGreaterThanOrEqual(IMPACT_BIG_AT)
    expect(magnitude_scale(6, 31 * MAG_HP_FRACTION)).toBeLessThan(IMPACT_BIG_AT) // a routine hit stays below
  })
})

describe('the map is internally consistent (data integrity — the renderer trusts these)', () => {
  it('asset_element normalises unknown/non-art elements to neutral; known cast elements pass through', () => {
    expect(asset_element('fire')).toBe('fire')
    expect(asset_element('water')).toBe('water')
    expect(asset_element('air')).toBe('air')
    expect(asset_element('heal')).toBe('heal')
    expect(asset_element('earth')).toBe('neutral') // earth is a burst, not a cast element
    expect(asset_element('totally-unknown')).toBe('neutral')
  })

  it('every element that can resolve on the board has an IMPACT_FEEL row (shake + flash colour)', () => {
    for (const el of [...Object.keys(CAST_VFX), ...Object.keys(BURST_VFX)]) {
      const feel = IMPACT_FEEL[el]
      expect(feel, `IMPACT_FEEL.${el}`).toBeTruthy()
      expect(feel.shake).toBeGreaterThanOrEqual(0)
      expect(feel.flash).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })
})

// ── THE ZERO-SPRITE GUARANTEE — every attack now plays a 3D effect, never a 2D sprite.
// Every attack layer — cast AND burst, for EVERY element a spell/mob can resolve — carries a preset_3d that names a
// real 3D preset. There is no element/layer combination left that could fall back to a sprite sheet. This is the
// mob-attack gap fix: a mob's physical swing (neutral) / elemental cast / KO all route through these same rows.
describe('every ATTACK layer is 3D — no sprite sheet can render (the mob-attack gap fix)', () => {
  it('every CAST element carries caster_cell+windup+orb+impact(+optional impact_big)+remnant, each a REAL 3D preset', () => {
    for (const [el, prof] of Object.entries(CAST_VFX)) {
      for (const layer of ['caster_cell', 'windup', 'orb', 'impact', 'remnant']) {
        const row = prof[layer]
        expect(row, `${el}.${layer} exists`).toBeTruthy()
        expect(row.preset_3d?.preset, `${el}.${layer} has a preset_3d`).toBeTruthy()
        expect(
          PRESETS[row.preset_3d.preset],
          `${el}.${layer} → ${row.preset_3d?.preset} resolves in PRESETS`
        ).toBeTruthy()
        expect(row.m, `${el}.${layer} footprint`).toBeGreaterThan(0)
        expect(row.sheet, `${el}.${layer} carries NO sprite sheet`).toBeUndefined() // the deletion is real
      }
      if (prof.impact_big) {
        expect(PRESETS[prof.impact_big.preset_3d.preset], `${el}.impact_big preset`).toBeTruthy()
        expect(prof.impact_big.m, `${el}.impact_big bigger than impact`).toBeGreaterThan(prof.impact.m)
      }
    }
  })

  it('every BURST element carries a preset_3d resolving to a real 3D preset (earth/death/weapon)', () => {
    for (const [el, prof] of Object.entries(BURST_VFX)) {
      expect(is_burst_element(el)).toBe(true)
      expect(prof.preset_3d?.preset, `${el}.preset_3d`).toBeTruthy()
      expect(PRESETS[prof.preset_3d.preset], `${el} → ${prof.preset_3d?.preset} resolves`).toBeTruthy()
      expect(prof.contact_s).toBeGreaterThanOrEqual(0)
    }
  })

  it('the impact tint recolours the SHARED library presets; the charge/bolt/remnant presets are pre-coloured (no tint)', () => {
    // impact/impact_big name a shared Hit/Explosion preset ⇒ a per-element tint. charge/bolt/remnant are already
    // element-coloured ⇒ no tint (tinting a pre-coloured preset would be a redundant no-op / a smell).
    for (const prof of Object.values(CAST_VFX)) {
      expect(Array.isArray(prof.impact.preset_3d.tint)).toBe(true)
      for (const layer of ['caster_cell', 'windup', 'orb', 'remnant'])
        expect(prof[layer].preset_3d.tint).toBeUndefined()
    }
  })
})

describe('the 5-layer cast schema (caster_cell · delivery · remnant) — the choreography rows the renderer trusts', () => {
  it('every CAST element carries a well-formed remnant (a LOOP preset, ~2–3 s window)', () => {
    for (const [el, prof] of Object.entries(CAST_VFX)) {
      expect(PRESETS[prof.remnant.preset_3d.preset].loop, `${el}.remnant is a LOOP`).toBe(true)
      expect(prof.remnant.duration_s, `${el}.remnant lingers ~2–3 s`).toBeGreaterThanOrEqual(1)
      expect(prof.remnant.duration_s).toBeLessThanOrEqual(3.5)
    }
  })

  it('DELIVERY is SKYFALL for EVERY cast row (cast effects drop from the sky)', () => {
    for (const [el, prof] of Object.entries(CAST_VFX)) {
      expect(['arc', 'skyfall'], `${el}.delivery is a known trajectory`).toContain(prof.delivery ?? 'skyfall')
      // every projectile cast now DROPS from the sky (was: only air; fire/water/neutral/heal used to lob 'arc').
      expect(prof.delivery, `${el} drops from the sky`).toBe('skyfall')
    }
  })

  it('the projectile presets (bolt_*) are LOOPs so the head/trail/aura shed continuously while flying', () => {
    for (const prof of Object.values(CAST_VFX)) expect(PRESETS[prof.orb.preset_3d.preset].loop).toBe(true)
  })
})

describe('resolve_impact — a heavy hit swaps to the bigger explosion above IMPACT_BIG_AT', () => {
  it('picks impact_big only at/above the threshold; a small hit keeps the base impact', () => {
    const prof = CAST_VFX.fire
    expect(resolve_impact(prof, IMPACT_BIG_AT - 0.01)).toBe(prof.impact)
    expect(resolve_impact(prof, IMPACT_BIG_AT)).toBe(prof.impact_big)
    expect(resolve_impact(prof, MAG_MAX)).toBe(prof.impact_big)
  })
  it('an element without impact_big always falls back to impact (never undefined)', () => {
    const prof = CAST_VFX.neutral
    expect(prof.impact_big).toBeUndefined()
    expect(resolve_impact(prof, MAG_MAX)).toBe(prof.impact)
  })
})

describe('mob element resolution (the "dungeon mobs all render neutral violet" fix)', () => {
  it('element_from_code maps the on-chain discriminant (0=fire 1=water 2=earth 3=air; 255/none/undefined → neutral)', () => {
    expect(element_from_code(0)).toBe('fire')
    expect(element_from_code(1)).toBe('water')
    expect(element_from_code(2)).toBe('earth')
    expect(element_from_code(3)).toBe('air')
    expect(element_from_code(255)).toBe('neutral')
    expect(element_from_code(undefined)).toBe('neutral')
    expect(element_from_code(null)).toBe('neutral')
  })
  it('resolve_cast_element keeps a resolved spell element, else fills a mob-neutral cast from the mob element code', () => {
    expect(resolve_cast_element('fire', 2)).toBe('fire') // a real spell element always wins
    expect(resolve_cast_element('weapon', 0)).toBe('weapon') // weapon/heal are never neutral ⇒ pass through
    expect(resolve_cast_element('heal', 0)).toBe('heal')
    expect(resolve_cast_element('neutral', 0)).toBe('fire') // a fire mob's unresolved cast → fire (not violet)
    expect(resolve_cast_element('neutral', 2)).toBe('earth') // an earth mob → the earth burst
    expect(resolve_cast_element('neutral', 255)).toBe('neutral') // a none-element mob genuinely stays neutral
    expect(resolve_cast_element('neutral', undefined)).toBe('neutral') // a non-mob caster is untouched
  })
  it('every element a mob can carry resolves to a real 3D preset (fire/water cast, earth burst, air cast)', () => {
    for (const code of [0, 1, 2, 3]) {
      const el = element_from_code(code)
      const has_art = CAST_VFX[el] || BURST_VFX[el]
      expect(has_art, `${el} (code ${code}) has cast or burst art`).toBeTruthy()
    }
  })
})

describe('prewarm_specs (D3 — the pipeline-compile set a fight can mount)', () => {
  it('returns distinct, resolvable preset specs across cast layers + bursts for the fight elements', () => {
    const specs = prewarm_specs(['fire', 'earth', 'neutral', 'weapon', 'heal', 'death'])
    expect(specs.length).toBeGreaterThan(0)
    for (const s of specs) expect(PRESETS[s.preset], `${s.preset} resolves in PRESETS`).toBeTruthy()
    const keys = specs.map((s) => s.preset + (s.tint ? s.tint.join(',') : ''))
    expect(new Set(keys).size, 'deduped by preset+tint').toBe(keys.length)
    expect(specs.some((s) => s.preset === 'eruption_earth')).toBe(true) // earth burst
    expect(specs.some((s) => s.preset === 'soul_death')).toBe(true) // death burst
    expect(specs.some((s) => s.preset.startsWith('charge_'))).toBe(true) // a cast windup
    expect(specs.some((s) => Array.isArray(s.tint))).toBe(true) // the tinted impact library presets
  })

  it('front-loads first-cast-critical presets before the secondary tail (fixes the first-cast freeze)', () => {
    // The emit order IS the compile priority (prewarm_fight_vfx mounts only a few per frame). Every element's
    // CORE cast beat (windup charge_ / orb bolt_ / impact) + the impact-only bursts must precede the lingering
    // remnant + heavy-hit impact_big, or a fast player cast beats its own element to the compile.
    const specs = prewarm_specs(['fire', 'earth', 'death', 'weapon', 'neutral', 'heal'])
    const idx = (/** @type {string} */ p) => specs.findIndex((s) => s.preset === p)
    expect(idx('charge_fire')).toBeGreaterThanOrEqual(0) // fire windup present
    expect(idx('bolt_fire')).toBeGreaterThanOrEqual(0) // fire orb present
    expect(idx('remnant_fire')).toBeGreaterThan(idx('charge_fire')) // remnant (tail) after the windup (core)
    expect(idx('remnant_fire')).toBeGreaterThan(idx('bolt_fire')) // remnant (tail) after the orb (core)
    expect(idx('eruption_earth')).toBeLessThan(idx('remnant_fire')) // the earth burst is core, before any tail
  })
})

describe('the reserved LOOP-preset shelves (title auras/glyphs/status/summons — all 3D, no sheets)', () => {
  it('every reserved shelf entry names a real LOOP preset', () => {
    const shelves = [
      TITLE_AURA.auras,
      TITLE_AURA.trails,
      Object.values(TRAP_GLYPH_VFX.trap), // the trap ground-decal LOOPs
      Object.values(TRAP_GLYPH_VFX.glyph), // the glyph ground-decal LOOPs
      STATUS_VFX.buff,
      STATUS_VFX.debuff,
      SUMMON_VFX,
    ]
    let count = 0
    for (const arr of shelves)
      for (const name of arr) {
        count += 1
        expect(PRESETS[name], `reserved preset ${name} resolves`).toBeTruthy()
        expect(PRESETS[name].loop, `${name} is a LOOP (persistent aura)`).toBe(true)
      }
    expect(count).toBeGreaterThan(8) // the reserved families materially widened coverage
  })
})
