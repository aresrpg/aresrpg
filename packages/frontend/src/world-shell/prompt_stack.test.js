import { beforeEach, describe, expect, it } from 'bun:test'

import { use_prompt_stack, visible_prompts } from './prompt_stack.js'

// Reset the zustand store between cases (module singleton).
beforeEach(() => use_prompt_stack.setState({ prompts: {}, pending: {} }))

const state = () => use_prompt_stack.getState()
const register = (over = {}) =>
  state().register_prompt({ id: 'search', key: 'F', label: 'SEARCH', priority: 80, on_trigger: () => {}, ...over })

/** A manually-settleable promise — drives the pending lifecycle deterministically. */
function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => ((resolve = res), (reject = rej)))
  return { promise, resolve, reject }
}
const tick = () => new Promise((r) => setTimeout(r, 0))

describe('prompt_stack — registry basics', () => {
  it('registers, updates in place, and clears by id', () => {
    register()
    expect(visible_prompts(state()).map((p) => p.id)).toEqual(['search'])
    register({ label: 'SEARCH AGAIN' }) // idempotent per id — update, never duplicate
    expect(visible_prompts(state())).toHaveLength(1)
    expect(state().prompts.search.label).toBe('SEARCH AGAIN')
    state().clear_prompt('search')
    expect(visible_prompts(state())).toEqual([])
  })
})

describe('prompt_stack — the optimistic-pending press law', () => {
  it('a SYNC press (toast/modal) fires and never pends', () => {
    let fired = 0
    register({ on_trigger: () => (fired += 1) })
    state().trigger_prompt('search')
    state().trigger_prompt('search')
    expect(fired).toBe(2) // no single-flight for sync presses — nothing is in flight
    expect(state().pending).toEqual({})
  })

  it('a TX press hides the prompt instantly and is single-flight until the promise settles', async () => {
    const d = deferred()
    let fired = 0
    register({
      on_trigger: () => {
        fired += 1
        return d.promise
      },
    })
    state().trigger_prompt('search')
    expect(fired).toBe(1)
    expect(state().pending.search).toBe(true) // pending immediately on press
    expect(visible_prompts(state())).toEqual([]) // hidden instantly — pressing twice is impossible
    state().trigger_prompt('search') // double-press during flight
    expect(fired).toBe(1) // single-flight: ignored

    d.resolve()
    await tick()
    expect(state().pending).toEqual({}) // settle releases pending
    // the prompt is still REGISTERED (the source decides off chain truth) → honest re-arm
    expect(visible_prompts(state()).map((p) => p.id)).toEqual(['search'])
  })

  it('a FAILED press settles identically (honest re-arm; the source owns the toast) without throwing', async () => {
    const d = deferred()
    register({ on_trigger: () => d.promise })
    state().trigger_prompt('search')
    expect(state().pending.search).toBe(true)
    d.reject(new Error('tx failed'))
    await tick()
    expect(state().pending).toEqual({})
    expect(visible_prompts(state()).map((p) => p.id)).toEqual(['search']) // re-armed for the retry
  })

  it('a mid-flight clear/re-register cycle never resurfaces the button before settle', async () => {
    const d = deferred()
    register({ on_trigger: () => d.promise })
    state().trigger_prompt('search')
    // sources re-register on every dep change (React effects) — the pending hold must survive the churn
    state().clear_prompt('search')
    register()
    expect(state().pending.search).toBe(true)
    expect(visible_prompts(state())).toEqual([]) // still hidden — pending outlives registration churn
    d.resolve()
    await tick()
    expect(visible_prompts(state()).map((p) => p.id)).toEqual(['search'])
  })

  it('triggering an unregistered id is a no-op', () => {
    expect(() => state().trigger_prompt('ghost')).not.toThrow()
    expect(state().pending).toEqual({})
  })

  it('pending is per-id — one prompt in flight never blocks the others', () => {
    const d = deferred()
    register({ on_trigger: () => d.promise })
    register({ id: 'gather', key: 'G', label: 'GATHER', priority: 60, on_trigger: () => {} })
    state().trigger_prompt('search')
    expect(visible_prompts(state()).map((p) => p.id)).toEqual(['gather']) // only the in-flight one hides
    d.resolve()
  })
})

// The zone-HUD vanish bug: the [F] press used to latch pending by PROMPT ID, so one
// in-flight search suppressed the button over EVERY zone until it settled — and forever, on a press whose
// promise never resolved. Pending now latches `pending_key ?? id` (the press's SUBJECT): [F] scopes it to
// `search:<world>:<zx>:<zy>`, so zone A's in-flight press never hides [F] over zone B. Sources without a
// pending_key (gather/dungeon) keep the id-latch behavior — covered verbatim by the suite above.
describe('prompt_stack — per-zone pending (pending_key)', () => {
  const zone_register = (zone, over = {}) => register({ pending_key: `search:w1:${zone}`, ...over })

  it('a pending press hides the prompt for ITS zone only, and the crossing transition re-arms it', async () => {
    const d = deferred()
    zone_register('0:0', { on_trigger: () => d.promise })
    state().trigger_prompt('search')
    expect(state().pending).toEqual({ 'search:w1:0:0': true })
    expect(visible_prompts(state())).toEqual([]) // hidden over the pressed zone

    // ZONE CROSSING: the source re-registers the SAME id for the next zone (its dep-change behavior) —
    // the button must be back instantly, zone 0:0's in-flight press notwithstanding.
    state().clear_prompt('search')
    zone_register('1:0')
    expect(visible_prompts(state()).map((p) => p.id)).toEqual(['search'])

    // …and crossing BACK into the still-pending zone re-hides it (the latch is the subject, not the visit).
    zone_register('0:0', { on_trigger: () => d.promise })
    expect(visible_prompts(state())).toEqual([])

    d.resolve()
    await tick()
    expect(state().pending).toEqual({}) // settle releases the zone's latch
    expect(visible_prompts(state()).map((p) => p.id)).toEqual(['search'])
  })

  it('single-flight is per subject: the pending zone swallows a re-press, another zone fires', () => {
    const d = deferred()
    let fired = 0
    zone_register('0:0', { on_trigger: () => d.promise })
    state().trigger_prompt('search')
    state().trigger_prompt('search') // same subject in flight → swallowed
    zone_register('1:0', { on_trigger: () => (fired += 1) })
    state().trigger_prompt('search') // different subject → fires
    expect(fired).toBe(1)
    expect(state().pending).toEqual({ 'search:w1:0:0': true })
    d.resolve()
  })

  it('the latch is captured at PRESS time — a mid-flight re-register to another zone cannot move it', async () => {
    const d = deferred()
    zone_register('0:0', { on_trigger: () => d.promise })
    state().trigger_prompt('search')
    zone_register('1:0') // the player crossed while the press flies
    d.resolve()
    await tick()
    expect(state().pending).toEqual({}) // settle released 0:0's latch, not 1:0's
    expect(visible_prompts(state()).map((p) => p.id)).toEqual(['search'])
  })
})
