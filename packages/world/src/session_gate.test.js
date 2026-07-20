// Spectate-until-joined — the session gate's core suite, ported from the frontend
// singleton to the D770a factory: every row drives a FRESH atom through the one `input(msg, now)` door. The
// three gates the coordinator named: unbound→spectate, bind→resident, failure→stays spectate — plus the
// no-flash bound path, the account-switch reset, the stale-poll clobber guard, the joining hold, and the W1
// fold-completion contract (pending IN the atom, the failsafe as an effect-request output, time as input).

import { describe, expect, it } from 'bun:test'

import {
  scene_target,
  resolved_mode,
  plan_scene,
  create_session_gate_store,
  subscribe_join_failsafe,
  subscribe_join_request,
  subscribe_stale_poll,
  reduce_session_gate,
  JOIN_FAILSAFE_MS,
  SCENE_SPECTATE,
  SCENE_SESSION,
} from './session_gate.js'

const WORLD = `0x${'a'.repeat(64)}`
const WORLD_B = `0x${'9'.repeat(64)}`
const CHAR = `0x${'1'.repeat(64)}`
const OTHER_CHAR = `0x${'9'.repeat(64)}`

/** Fresh atom + door shims mirroring the frontend adapter's wrapper vocabulary, so rows read as before. */
const make_gate = () => {
  const store = create_session_gate_store()
  const input = (msg, now) => store.getState().input(msg, now)
  return {
    store,
    input,
    publish: (character_id, world, source = 'manual') =>
      input({ type: 'binding_published', character_id: character_id ?? null, world: world ?? null, source }),
    begin_join: (character_id, now) => input({ type: 'join_started', character_id: character_id ?? null }, now),
    end_join: () => input({ type: 'join_ended' }),
    reset: () => input({ type: 'binding_reset' }),
  }
}

describe('scene_target — the pure decision', () => {
  it('logged-out → spectate (the landing backdrop, unchanged)', () => {
    expect(scene_target({ on_world_tab: true, authenticated: false, world: undefined })).toBe(SCENE_SPECTATE)
  })
  it('authenticated + CONFIRMED-UNBOUND → spectate (never a controller in an unjoined world)', () => {
    expect(scene_target({ on_world_tab: true, authenticated: true, world: null })).toBe(SCENE_SPECTATE)
  })
  it('authenticated + BOUND → resident session', () => {
    expect(scene_target({ on_world_tab: true, authenticated: true, world: WORLD })).toBe(SCENE_SESSION)
  })
  it('authenticated + UNKNOWN → session path (post-resolve decides — no spectate flash for bound chars)', () => {
    expect(scene_target({ on_world_tab: true, authenticated: true, world: undefined })).toBe(SCENE_SESSION)
  })
  it('off the world tab → spectate regardless', () => {
    expect(scene_target({ on_world_tab: false, authenticated: true, world: WORLD })).toBe(SCENE_SPECTATE)
  })
})

describe('resolved_mode — the post-resolve mount decision', () => {
  it('unbound (null) mounts the spectate backdrop', () => expect(resolved_mode(null)).toBe(SCENE_SPECTATE))
  it('bound mounts resident directly', () => expect(resolved_mode(WORLD)).toBe(SCENE_SESSION))
})

describe('the binding atom — unbound → spectate → bind → resident → failure semantics', () => {
  it('starts UNKNOWN (undefined) — the no-flash default', () => {
    expect(create_session_gate_store().getState().world).toBe(undefined)
  })
  it('a confirmed-unbound publish gates spectate; the JOIN publish flips the gate to resident', () => {
    const gate = make_gate()
    gate.publish(CHAR, null) // the host's resolve-time fetch on an unjoined character
    expect(scene_target({ on_world_tab: true, authenticated: true, world: gate.store.getState().world })).toBe(
      SCENE_SPECTATE
    )
    gate.publish(CHAR, WORLD) // world_join publishes the instant the join tx lands
    expect(scene_target({ on_world_tab: true, authenticated: true, world: gate.store.getState().world })).toBe(
      SCENE_SESSION
    )
  })
  it('a join FAILURE publishes nothing — the gate STAYS spectate', () => {
    const gate = make_gate()
    gate.publish(CHAR, null)
    // auto_join_world threw (dry-run refusal / executed failure): no publish happens on the failure path.
    expect(gate.store.getState().world).toBe(null)
    expect(scene_target({ on_world_tab: true, authenticated: true, world: gate.store.getState().world })).toBe(
      SCENE_SPECTATE
    )
  })
  it('an account switch resets to UNKNOWN — a stale bound never leaks a controller across accounts', () => {
    const gate = make_gate()
    gate.publish(CHAR, WORLD)
    gate.reset()
    const { character_id, world, joining } = gate.store.getState()
    expect({ character_id, world, joining }).toEqual({ character_id: null, world: undefined, joining: false })
  })
  it('an unchanged publish commits NOTHING (same state reference — the door skips the write)', () => {
    const gate = make_gate()
    gate.publish(CHAR, WORLD, 'poll')
    const committed = gate.store.getState()
    gate.publish(CHAR, WORLD, 'poll')
    expect(gate.store.getState()).toBe(committed)
  })
})

// ─── STALE-POLL CLOBBER GUARD (world-travel binding fix): the 10s doc poll must never tear a fresh
// manual/auto-join write back to the pre-travel world during the indexer catch-up window. ───

describe('binding_published — the stale-poll clobber guard', () => {
  it('a manual write then a disagreeing poll write is discarded — the atom keeps the manual target', () => {
    const gate = make_gate()
    gate.publish(CHAR, WORLD, 'manual') // the switcher/auto-join's chain-truth publish
    gate.publish(CHAR, null, 'poll') // indexer-lagged doc poll still reporting the pre-travel world
    expect(gate.store.getState().world).toBe(WORLD)
  })

  it('a poll write that AGREES with the pending manual target is accepted and clears the guard', () => {
    const gate = make_gate()
    gate.publish(CHAR, WORLD, 'manual')
    gate.publish(CHAR, WORLD, 'poll') // indexer caught up — confirms
    expect(gate.store.getState().world).toBe(WORLD)
    // guard cleared: a LATER travel's poll can now heal freely again without needing a prior manual write.
    gate.publish(CHAR, WORLD_B, 'poll')
    expect(gate.store.getState().world).toBe(WORLD_B)
  })

  it('with no pending manual write, poll writes pass through unguarded (the ghost-world healer role)', () => {
    const gate = make_gate()
    gate.publish(CHAR, WORLD, 'poll')
    expect(gate.store.getState().world).toBe(WORLD)
  })

  it('a second manual write (re-travel) re-arms the guard against a poll still reporting the FIRST target', () => {
    const gate = make_gate()
    gate.publish(CHAR, WORLD, 'manual')
    gate.publish(CHAR, WORLD, 'poll') // confirms + clears
    gate.publish(CHAR, WORLD_B, 'manual') // a second travel
    gate.publish(CHAR, WORLD, 'poll') // stale — still reports the FIRST world
    expect(gate.store.getState().world).toBe(WORLD_B)
  })

  it('binding_reset clears the guard (account switch never leaks a pending target across accounts)', () => {
    const gate = make_gate()
    gate.publish(CHAR, WORLD, 'manual')
    gate.reset()
    gate.publish(CHAR, null, 'poll') // would have been rejected pre-reset; now passes through
    expect(gate.store.getState().world).toBe(null)
  })
})

// ─── ONE-BOOT create→play — never terrain, then the spectate sky view, then reload into the game ───

describe('the JOINING hold — spectate suppressed while a create→play join is in flight', () => {
  it('joining + CONFIRMED-UNBOUND stays on the session path (the exact old spectate trigger)', () => {
    expect(scene_target({ on_world_tab: true, authenticated: true, world: null, joining: true })).toBe(SCENE_SESSION)
  })
  it('joining + UNKNOWN stays on the session path', () => {
    expect(scene_target({ on_world_tab: true, authenticated: true, world: undefined, joining: true })).toBe(
      SCENE_SESSION
    )
  })
  it('joining never overrides the auth gates (logged out / off the world tab stay spectate)', () => {
    expect(scene_target({ on_world_tab: true, authenticated: false, world: null, joining: true })).toBe(SCENE_SPECTATE)
    expect(scene_target({ on_world_tab: false, authenticated: true, world: null, joining: true })).toBe(SCENE_SPECTATE)
  })
  it('join_started arms the hold; publish (even null — roster/indexer lag) NEVER clobbers it; join_ended releases', () => {
    const gate = make_gate()
    gate.begin_join(CHAR)
    expect(gate.store.getState().joining).toBe(true)
    gate.publish(CHAR, null) // the 10s doc poll on the world-less fresh char
    expect(gate.store.getState().joining).toBe(true) // survives roster/doc lag
    expect(gate.store.getState().world).toBe(null)
    gate.end_join()
    expect(gate.store.getState().joining).toBe(false)
  })
  it('CREATE-FAILURE sad path: join_ended releases to an HONEST spectate (world still null → spectate)', () => {
    const gate = make_gate()
    gate.begin_join(CHAR)
    gate.publish(CHAR, null) // the join failed — no world publish ever happens (tx-retry law)
    gate.end_join() // synchronous terminal callers retain the same release behavior
    const { world, joining } = gate.store.getState()
    expect(joining).toBe(false)
    expect(scene_target({ on_world_tab: true, authenticated: true, world, joining })).toBe(SCENE_SPECTATE)
  })
  it('a wallet switch mid-join resets the hold (binding_reset clears joining)', () => {
    const gate = make_gate()
    gate.begin_join(CHAR)
    gate.reset()
    expect(gate.store.getState().joining).toBe(false)
  })

  it('async join failure enters through the typed input door and ignores late or duplicate delivery', () => {
    const gate = make_gate()
    gate.begin_join(CHAR)
    gate.input({ type: 'join_failed', character_id: OTHER_CHAR })
    expect(gate.store.getState().joining).toBe(true)

    gate.input({ type: 'join_failed', character_id: CHAR })
    expect(gate.store.getState().joining).toBe(false)

    const released = gate.store.getState()
    gate.input({ type: 'join_failed', character_id: CHAR })
    expect(gate.store.getState()).toBe(released)
  })
})

// ─── W1 FOLD-COMPLETION CONTRACT (D770a): the pending guard and the failsafe timer are ATOM state —
// the module-scope runtime beside the old frontend store is dead. ───

describe('W1 fold-completion — pending IN the atom, the failsafe as an effect-request OUTPUT', () => {
  it('the atom carries pending_manual_target (a Map) — not a module-scope runtime', () => {
    const gate = make_gate()
    gate.publish(CHAR, WORLD, 'manual')
    const { pending_manual_target } = gate.store.getState()
    expect(pending_manual_target instanceof Map).toBe(true)
    expect(pending_manual_target.get(CHAR)).toBe(WORLD)
  })

  it('join_started outputs a failsafe EFFECT REQUEST in the atom — {character_id, deadline}', () => {
    const gate = make_gate()
    gate.begin_join(CHAR)
    const { failsafe } = gate.store.getState()
    expect(failsafe?.character_id).toBe(CHAR)
    expect(typeof failsafe?.deadline).toBe('number')
  })

  it('time is an input: input(msg, now) stamps deadline = now + JOIN_FAILSAFE_MS', () => {
    const NOW = 1_000_000
    const gate = make_gate()
    gate.begin_join(CHAR, NOW)
    expect(gate.store.getState().failsafe?.deadline).toBe(NOW + JOIN_FAILSAFE_MS)
  })

  it('a discarded stale poll lands as a DATA row in the atom, seq-stamped per discard', () => {
    const gate = make_gate()
    gate.publish(CHAR, WORLD, 'manual')
    gate.publish(CHAR, null, 'poll')
    expect(gate.store.getState().stale_poll).toEqual({ seq: 1, character_id: CHAR, target: WORLD })
    gate.publish(CHAR, WORLD_B, 'poll')
    expect(gate.store.getState().stale_poll).toEqual({ seq: 2, character_id: CHAR, target: WORLD })
  })

  it('a repeat join_started RE-ARMS (fresh request identity + deadline — the old timer semantics)', () => {
    const gate = make_gate()
    gate.begin_join(CHAR, 1_000)
    const first = gate.store.getState().failsafe
    gate.begin_join(CHAR, 2_000)
    const second = gate.store.getState().failsafe
    expect(second).not.toBe(first)
    expect(second?.deadline).toBe(2_000 + JOIN_FAILSAFE_MS)
  })

  it('the failsafe clears on join_ended, on a MATCHING terminal, and on reset — never on a foreign terminal', () => {
    const gate = make_gate()
    gate.begin_join(CHAR)
    gate.input({ type: 'join_failed', character_id: OTHER_CHAR }) // foreign terminal — armed join survives
    expect(gate.store.getState().failsafe).not.toBe(null)
    gate.input({ type: 'join_failed', character_id: CHAR })
    expect(gate.store.getState().failsafe).toBe(null)

    gate.begin_join(CHAR)
    gate.end_join()
    expect(gate.store.getState().failsafe).toBe(null)

    gate.begin_join(CHAR)
    gate.reset()
    expect(gate.store.getState().failsafe).toBe(null)
  })

  it('the fold never mutates its arguments (pending map cloned on write)', () => {
    const state = create_session_gate_store().getState()
    const before = state.pending_manual_target
    const next = reduce_session_gate(
      state,
      { type: 'binding_published', character_id: CHAR, world: WORLD, source: 'manual' },
      0
    )
    expect(before.size).toBe(0)
    expect(next.pending_manual_target).not.toBe(before)
  })
})

describe('the effect edges — exported subscriptions, the package performs nothing', () => {
  it('subscribe_join_failsafe: clear precedes EVERY arm (idempotent edge), release ends on a bare clear', () => {
    const gate = make_gate()
    const trace = []
    subscribe_join_failsafe(gate.store, {
      arm: ({ character_id, deadline }) => trace.push(`arm:${character_id}:${deadline}`),
      clear: () => trace.push('clear'),
    })
    gate.begin_join(CHAR, 1_000)
    gate.begin_join(CHAR, 2_000) // re-arm
    gate.end_join()
    expect(trace).toEqual([
      'clear', // no-op at the edge (nothing armed yet) — the contract stays uniform
      `arm:${CHAR}:${1_000 + JOIN_FAILSAFE_MS}`,
      'clear',
      `arm:${CHAR}:${2_000 + JOIN_FAILSAFE_MS}`,
      'clear',
    ])
  })

  it('the adapter loop closes: a join_timeout dispatched back through the door releases the hold', () => {
    const gate = make_gate()
    let request = null
    subscribe_join_failsafe(gate.store, { arm: (r) => (request = r), clear: () => {} })
    gate.begin_join(CHAR)
    expect(request?.character_id).toBe(CHAR)
    gate.input({ type: 'join_timeout', character_id: request.character_id }) // the timer edge fires
    expect(gate.store.getState()).toMatchObject({ joining: false, failsafe: null })
  })

  it('subscribe_stale_poll fires once per discarded row, never on other commits', () => {
    const gate = make_gate()
    const rows = []
    subscribe_stale_poll(gate.store, (row) => rows.push(row))
    gate.publish(CHAR, WORLD, 'manual')
    gate.publish(CHAR, null, 'poll') // discard 1
    gate.publish(CHAR, null, 'poll') // discard 2 (fresh seq)
    gate.publish(CHAR, WORLD, 'poll') // confirm — no row
    gate.begin_join(CHAR) // unrelated commit — no row
    expect(rows.map((r) => r.seq)).toEqual([1, 2])
    expect(rows[0]).toMatchObject({ character_id: CHAR, target: WORLD })
  })
})

describe('character_selected — the roster re-key as ONE composed input', () => {
  it('releases a joining hold AND publishes the card binding as a trusted manual write', () => {
    const gate = make_gate()
    gate.begin_join(OTHER_CHAR)
    gate.input({ type: 'character_selected', character_id: CHAR, world_id: WORLD })
    expect(gate.store.getState()).toMatchObject({ character_id: CHAR, world: WORLD, joining: false, failsafe: null })
    // trusted write armed the guard: a stale poll for the previous world is discarded
    gate.publish(CHAR, null, 'poll')
    expect(gate.store.getState().world).toBe(WORLD)
  })
  it('selecting an unbound (null) card confirms UNBOUND — spectate, not a stale resident', () => {
    const gate = make_gate()
    gate.publish(CHAR, WORLD, 'manual')
    gate.input({ type: 'character_selected', character_id: OTHER_CHAR, world_id: null })
    expect(gate.store.getState()).toMatchObject({ character_id: OTHER_CHAR, world: null })
    expect(scene_target({ on_world_tab: true, authenticated: true, world: gate.store.getState().world })).toBe(
      SCENE_SPECTATE
    )
  })
})

describe('plan_scene — the full mount plan (action + character-keyed identity)', () => {
  const base = { show_world: true, authenticated: true, on_world_tab: true }
  // ─── v30 P1 REGRESSION — the login page must never lose its live 3D world backdrop ───
  // The pre-auth landing IS a legal input path to the live world (public read data): a confirmed
  // logged-out visitor (auth resolved, no address) gets the SPECTATE backdrop mounted UNCONDITIONALLY —
  // the d6d32bc "LOGIN CPU GATE" that held it behind an explicit watch-live-world opt-in is repealed.
  // The opt-in gesture survives as the INTERACTION gate only — a display-only canvas,
  // never as a mount gate.
  it('confirmed logged-out landing → the live world backdrop mounts (spectate, no opt-in precondition)', () => {
    expect(plan_scene({ ...base, authenticated: false, auth_loading: false, world: undefined })).toEqual({
      action: 'spectate',
      key: 'spectate',
    })
  })
  it('hidden off-screen', () => {
    expect(plan_scene({ ...base, show_world: false, world: undefined }).action).toBe('hidden')
  })
  it('joining + unresolved world → HOLD (one loading veil, no mount, no spectate)', () => {
    expect(plan_scene({ ...base, joining: true, world: undefined, character_id: CHAR })).toEqual({
      action: 'hold',
      key: 'joining',
    })
    expect(plan_scene({ ...base, joining: true, world: null, character_id: CHAR })).toEqual({
      action: 'hold',
      key: 'joining',
    })
  })
  it('bound world → RESIDENT keyed by character AND world (the join publish flips hold→resident in ONE step)', () => {
    expect(plan_scene({ ...base, joining: true, world: WORLD, character_id: CHAR })).toEqual({
      action: 'resident',
      key: `lobby:${CHAR}:${WORLD}`, // world-keyed so a travel A→B re-boots the scene into world B
    })
  })
  it('travel A→B changes the resident mount key (same character, different world → re-boot)', () => {
    const a = plan_scene({ ...base, world: WORLD, character_id: CHAR }).key
    const b = plan_scene({ ...base, world: WORLD_B, character_id: CHAR }).key
    expect(a).not.toBe(b)
    expect(b).toBe(`lobby:${CHAR}:${WORLD_B}`)
  })
  it('UNKNOWN world (normal boot) → session path, character-keyed; follow variant keys follow:', () => {
    expect(plan_scene({ ...base, world: undefined, character_id: CHAR })).toEqual({
      action: 'session',
      key: `lobby:${CHAR}`,
    })
    expect(plan_scene({ ...base, world: WORLD, character_id: CHAR, following: true })).toEqual({
      action: 'resident',
      key: `follow:${CHAR}`,
    })
  })
  it('confirmed-unbound, NOT joining (legacy pre-load) → spectate (S-57 unchanged)', () => {
    expect(plan_scene({ ...base, world: null, character_id: CHAR })).toEqual({ action: 'spectate', key: 'spectate' })
  })

  // ─── BOOT ONCE — never loads, freezes, loads something else, then freezes again ───
  it('auth still loading + NOT authenticated → await-auth HOLD (no throwaway spectate boot)', () => {
    expect(plan_scene({ ...base, authenticated: false, auth_loading: true, world: undefined })).toEqual({
      action: 'await-auth',
      key: null,
    })
  })
  it('auth_loading NEVER overrides an authenticated session (a reconnect races the login handshake)', () => {
    // A returning player whose address already resolved boots resident directly even if is_loading lingers true.
    expect(plan_scene({ ...base, authenticated: true, auth_loading: true, world: WORLD, character_id: CHAR })).toEqual({
      action: 'resident',
      key: `lobby:${CHAR}:${WORLD}`,
    })
    expect(
      plan_scene({ ...base, authenticated: true, auth_loading: true, world: undefined, character_id: CHAR })
    ).toEqual({ action: 'session', key: `lobby:${CHAR}` })
  })
  it('off the world tab still hides regardless of auth_loading', () => {
    expect(
      plan_scene({ ...base, show_world: false, authenticated: false, auth_loading: true, world: undefined })
    ).toEqual({ action: 'hidden', key: null })
  })
})

describe('BOOT-COUNT reproduction — the create→play transition storm, before vs after', () => {
  // The post-create state sequence the live QA trace produced (each step = a store publish the host reacts to):
  //   1. create tx lands   → character selected, world UNKNOWN
  //   2. /v1 doc poll      → publishes world=null (fresh char)   (old: scene_target→spectate = SKY VIEW reboot)
  //   3. auto-join lands   → publishes world=WORLD               (old: spectate→lobby = a THIRD engine boot)
  // Replaying that sequence through the mount planner counts engine boots (mount-key changes) + spectate entries.
  const drive = (plan_of, pre_create_key) => {
    const steps = [
      { world: undefined, joining: true }, // create landed → join_started
      { world: null, joining: true }, // doc poll: world-less doc published
      { world: WORLD, joining: true }, // auto-join publish (join_ended follows the resident mount)
    ]
    let mounted = pre_create_key // the decorative lobby already up behind the create form
    let boots = 0
    let spectate_entries = 0
    for (const s of steps) {
      const plan = plan_of(s)
      if (plan.action === 'hold' || plan.action === 'hidden') continue // veil — no engine mount
      if (plan.key !== mounted) {
        mounted = plan.key
        boots += 1
        if (plan.action === 'spectate') spectate_entries += 1
      }
    }
    return { boots, spectate_entries }
  }

  it('BEFORE (joining-blind gate, character-blind key): 2 engine reboots INCLUDING the spectate sky view', () => {
    // The old planner, verbatim semantics: scene_target without `joining`, key = spectate|lobby (no char).
    const old_plan = ({ world }) => {
      const target = scene_target({ on_world_tab: true, authenticated: true, world, joining: false })
      return target === SCENE_SPECTATE ? { action: 'spectate', key: 'spectate' } : { action: 'session', key: 'lobby' }
    }
    expect(drive(old_plan, 'lobby')).toEqual({ boots: 2, spectate_entries: 1 }) // lobby→spectate→lobby: the regression trace
  })

  it('AFTER (joining hold + character-keyed plan): ONE boot, ZERO spectate entries', () => {
    const new_plan = ({ world, joining }) =>
      plan_scene({
        show_world: true,
        authenticated: true,
        on_world_tab: true,
        joining,
        world,
        character_id: CHAR,
      })
    expect(drive(new_plan, 'lobby:none')).toEqual({ boots: 1, spectate_entries: 0 }) // hold → hold → resident lobby:<char>
  })
})

// ─── CHARACTER↔WORLD SESSION BINDING — the create RECEIPT drives the join (one pipeline, not a
// DiscoveryPrompts poll noticing `unjoined`), and a stale in-flight read never rebinds the active char BACKWARDS. ───

describe('join_request — the create→play join is REQUESTED off the create receipt (one pipeline)', () => {
  it('join_started outputs a join_request EFFECT REQUEST — {character_id} (red today: only failsafe)', () => {
    const gate = make_gate()
    gate.begin_join(CHAR)
    expect(gate.store.getState().join_request?.character_id).toBe(CHAR)
  })

  it('a repeat join_started re-arms a fresh join_request identity (the edge re-fires)', () => {
    const gate = make_gate()
    gate.begin_join(CHAR)
    const first = gate.store.getState().join_request
    gate.begin_join(CHAR)
    expect(gate.store.getState().join_request).not.toBe(first)
  })

  it('join_request clears on join_ended, on a MATCHING terminal, and on reset', () => {
    const gate = make_gate()
    gate.begin_join(CHAR)
    gate.end_join()
    expect(gate.store.getState().join_request).toBe(null)
    gate.begin_join(CHAR)
    gate.input({ type: 'join_failed', character_id: CHAR })
    expect(gate.store.getState().join_request).toBe(null)
    gate.begin_join(CHAR)
    gate.reset()
    expect(gate.store.getState().join_request).toBe(null)
  })

  it('a switch (character_selected) NEVER requests a join — only a create→play hold does', () => {
    const gate = make_gate()
    gate.input({ type: 'character_selected', character_id: CHAR, world_id: WORLD })
    expect(gate.store.getState().join_request).toBe(null)
  })

  it('subscribe_join_request fires once when the request appears (the edge that runs auto_join_world)', () => {
    const gate = make_gate()
    const fired = []
    subscribe_join_request(gate.store, (req) => fired.push(req.character_id))
    gate.begin_join(CHAR)
    expect(fired).toEqual([CHAR])
  })
})

describe('FLOOR — a stale async read never rebinds the ACTIVE character BACKWARDS', () => {
  it('after selecting B, a late POLL for the previous char A does not switch the active char back (red today)', () => {
    const gate = make_gate()
    gate.input({ type: 'character_selected', character_id: CHAR, world_id: WORLD }) // active = CHAR/WORLD (manual)
    gate.publish(OTHER_CHAR, WORLD_B, 'poll') // a stale in-flight doc read for the previously-active character
    expect(gate.store.getState().character_id).toBe(CHAR)
    expect(gate.store.getState().world).toBe(WORLD)
  })

  it('bootstrap is untouched: with no active char yet, a poll may still establish the first binding', () => {
    const gate = make_gate()
    gate.publish(CHAR, WORLD, 'poll') // first read, no active char established → allowed to bootstrap
    expect(gate.store.getState().character_id).toBe(CHAR)
    expect(gate.store.getState().world).toBe(WORLD)
  })

  it('a MANUAL switch still moves the active char forward (the floor gates polls only)', () => {
    const gate = make_gate()
    gate.publish(CHAR, WORLD, 'manual')
    gate.publish(OTHER_CHAR, WORLD_B, 'manual') // an explicit re-key is never stale
    expect(gate.store.getState().character_id).toBe(OTHER_CHAR)
    expect(gate.store.getState().world).toBe(WORLD_B)
  })
})
