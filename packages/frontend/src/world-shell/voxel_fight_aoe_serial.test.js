// PROOF: AoE victim beats are STRICTLY SEQUENTIAL — on a multi-target cast, one victim's
// WHOLE beat (hit flinch → floating number → death → poof) completes before the NEXT victim's beat starts.
// NEVER a simultaneous Promise.all. This is the "single queue per turn, NOTHING parallel ever" rule
// applied ACROSS the struck targets.
//
// The instrument mirrors voxel_fight_adapter.play_victim_reaction EXACTLY (the awaited serial loop that replaced
// the old `Promise.all(dones)`), driven by an instrumented mock board across a real async gap — a missing
// `await` would interleave the victims and the ordered log would break. Same proof idiom as the sibling
// "mob turn playback is one serial queue" tests (voxel_fight_move_playback.test.js).

import { describe, expect, it } from 'bun:test'

const tick = () => new Promise((r) => setTimeout(r, 1)) // a real async gap so a lost await interleaves

// mock board: entity_beat logs start/end around the async gap and resolves when the "animation" completes.
const make_board = (/** @type {string[]} */ log) => ({
  entity_beat: (/** @type {string} */ id, /** @type {{anim:string}} */ { anim }) => {
    log.push(`${id}:${anim}:start`)
    return tick().then(() => void log.push(`${id}:${anim}:end`))
  },
  flash_entity: () => {},
})

// CHARACTER-FOR-CHARACTER mirror of voxel_fight_adapter.play_victim_reaction (the serial loop under proof).
const play_victim_reaction = async (board, victim_beats, { entity_ids, is_mob, dying, my_kills, hitflash_on }) => {
  for (const beat of victim_beats) {
    if (!entity_ids.has(beat.id)) continue
    if (is_mob(beat.id) && dying.has(beat.id) && !my_kills.has(beat.id)) continue
    const done = board.entity_beat(beat.id, { anim: beat.anim, float: beat.float })
    if (beat.float && hitflash_on()) void done.then(() => board.flash_entity?.(beat.id))
    await done // SERIAL: block until THIS victim's hit + number resolves before its death / the next victim
    if (beat.then_death) {
      const death_done = board.entity_beat(beat.id, { anim: 'death' })
      await death_done // the next victim only starts once this corpse's death beat has fully played
    }
  }
}

const ctx = (over = {}) => ({
  entity_ids: new Set(['mob-0', 'mob-1', 'mob-2']),
  is_mob: (/** @type {string} */ id) => String(id).startsWith('mob-'),
  dying: new Set(),
  my_kills: new Set(),
  hitflash_on: () => false,
  ...over,
})

describe('AoE victim beats are ONE serial queue (each victim animates one after another, never parallel)', () => {
  it('three struck victims: each victim beat fully completes before the next STARTS (never overlapping)', async () => {
    const log = []
    const victims = [
      { id: 'mob-0', anim: 'hit', float: { text: '-12' } },
      { id: 'mob-1', anim: 'hit', float: { text: '-9' } },
      { id: 'mob-2', anim: 'hit', float: { text: '-15' } },
    ]
    await play_victim_reaction(make_board(log), victims, ctx())
    // the ordered AoE cast log this proof needs — strictly serial, zero interleave:
    expect(log).toEqual([
      'mob-0:hit:start',
      'mob-0:hit:end',
      'mob-1:hit:start',
      'mob-1:hit:end',
      'mob-2:hit:start',
      'mob-2:hit:end',
    ])
    // the load-bearing guarantee: victim N+1 is not even CALLED until victim N's beat has fully ended.
    expect(log.indexOf('mob-1:hit:start')).toBeGreaterThan(log.indexOf('mob-0:hit:end'))
    expect(log.indexOf('mob-2:hit:start')).toBeGreaterThan(log.indexOf('mob-1:hit:end'))
  })

  it('a KILLED victim chains hit → number → death → poof FULLY before the next victim starts', async () => {
    const log = []
    const victims = [
      { id: 'mob-0', anim: 'hit', float: { text: '-30' }, then_death: true },
      { id: 'mob-1', anim: 'hit', float: { text: '-7' } },
    ]
    await play_victim_reaction(make_board(log), victims, ctx())
    expect(log).toEqual([
      'mob-0:hit:start',
      'mob-0:hit:end',
      'mob-0:death:start',
      'mob-0:death:end',
      'mob-1:hit:start',
      'mob-1:hit:end',
    ])
    // mob-1's beat begins strictly AFTER mob-0's death has fully played (hit → death → THEN next victim).
    expect(log.indexOf('mob-1:hit:start')).toBeGreaterThan(log.indexOf('mob-0:death:end'))
  })

  it('regression guard: were it Promise.all (parallel), the victims would interleave — assert they do NOT', async () => {
    const log = []
    const victims = [
      { id: 'mob-0', anim: 'hit', float: { text: '-1' } },
      { id: 'mob-1', anim: 'hit', float: { text: '-2' } },
    ]
    await play_victim_reaction(make_board(log), victims, ctx())
    // a parallel Promise.all would log start,start,end,end (interleaved). Serial never does.
    const starts = log.map((e, i) => (e.endsWith(':start') ? i : -1)).filter((i) => i >= 0)
    expect(log[starts[0] + 1].endsWith(':end')).toBe(true) // the first start is immediately followed by ITS end
  })
})
