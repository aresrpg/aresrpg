// PER-REGION ZONE MUSIC — unit coverage of the pure decision core (region_music.js): the zone-key format
// (`${world}:${region}` when a region names itself, base biome otherwise — the coordinator's 2026-07-13
// ruling superseding D-2710's plain biome hash on region worlds) and the hysteresis follower (a region
// switch arms only after `confirm` consecutive stable samples; border flapping never switches; the armed
// zone always wins ties). No DOM/audio here — the arm callback is injected; the audio side is
// ambient_music's engine_retune, driven live.
import { describe, expect, it } from 'bun:test'

import { create_region_follower, region_zone_key } from './region_music.js'

describe('region_zone_key — the `${world}:${region}` zone identity', () => {
  it('region present → the world-qualified key (per-world spread, fixes same-biome collapse)', () => {
    expect(region_zone_key('02_verdant_hollow', 'cloud_forest', 'canyon')).toBe('02_verdant_hollow:cloud_forest')
    // two WORLDS sharing a region name still get DISTINCT keys (per-world music identity)
    expect(region_zone_key('w1', 'glade', 'x')).not.toBe(region_zone_key('w2', 'glade', 'x'))
  })

  it('no region (non-region world / layer off) → the base biome key verbatim (behavior unchanged)', () => {
    expect(region_zone_key('01_first_shore', null, 'archipelago')).toBe('archipelago')
  })
})

describe('create_region_follower — hysteresis (no flapping at borders)', () => {
  it('arms only after `confirm` consecutive samples of the SAME new key', () => {
    const armed = []
    const f = create_region_follower({ arm: (k) => armed.push(k), confirm: 3 })
    expect(f.feed('w:a')).toBeNull()
    expect(f.feed('w:a')).toBeNull()
    expect(f.feed('w:a')).toBe('w:a') // 3rd stable sample → the switch fires exactly once
    expect(armed).toEqual(['w:a'])
    expect(f.armed()).toBe('w:a')
  })

  it('border flapping (A/B alternation) NEVER switches — each flip resets the streak', () => {
    const armed = []
    const f = create_region_follower({ arm: (k) => armed.push(k), confirm: 3 })
    f.feed('w:a')
    f.feed('w:a')
    f.feed('w:a') // armed w:a
    for (let i = 0; i < 20; i++) f.feed(i % 2 === 0 ? 'w:b' : 'w:a') // straddle the border
    expect(armed).toEqual(['w:a']) // the flap armed nothing new
    expect(f.armed()).toBe('w:a')
  })

  it('a sample matching the ARMED key dissolves any half-built candidate streak', () => {
    const armed = []
    const f = create_region_follower({ arm: (k) => armed.push(k), confirm: 3 })
    f.feed('w:a')
    f.feed('w:a')
    f.feed('w:a') // armed w:a
    f.feed('w:b')
    f.feed('w:b') // 2-streak toward b…
    f.feed('w:a') // …back on the armed zone → streak dissolves
    f.feed('w:b')
    f.feed('w:b')
    expect(armed).toEqual(['w:a']) // b never reached 3 consecutive
    expect(f.feed('w:b')).toBe('w:b') // now it does
    expect(armed).toEqual(['w:a', 'w:b'])
  })

  it('falsy keys are ignored (no arm, no streak)', () => {
    const armed = []
    const f = create_region_follower({ arm: (k) => armed.push(k), confirm: 2 })
    f.feed(null)
    f.feed(undefined)
    f.feed('')
    expect(armed).toEqual([])
    expect(f.armed()).toBeNull()
  })

  it('tick is time-gated: the key getter runs ONLY on accepted samples (~interval_ms apart)', () => {
    let probes = 0
    const armed = []
    const f = create_region_follower({ arm: (k) => armed.push(k), confirm: 2, interval_ms: 2000 })
    const get_key = () => {
      probes += 1
      return 'w:a'
    }
    expect(f.tick(0, get_key)).toBeNull() // t=0: first accepted sample (streak 1)
    expect(f.tick(500, get_key)).toBeNull() // inside the gate — probe NOT invoked
    expect(f.tick(1999, get_key)).toBeNull() // still gated
    expect(probes).toBe(1)
    expect(f.tick(2000, get_key)).toBe('w:a') // 2nd accepted sample → confirm=2 fires
    expect(probes).toBe(2)
    expect(armed).toEqual(['w:a'])
  })
})
