// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// #2141 — A BUSY FLIP BETWEEN MOUSEDOWN AND MOUSEUP SILENTLY EATS THE CLICK.
//
// Found live on the forfeit button (#2136's leg-2 rig): the first press of a VISIBLE, ENABLED
// `BUTTON.hud-fightctl__abandon` did nothing — the click landed on the button, nothing covered it, no modal
// opened. Playwright's re-resolving `.click()` landed the second attempt; a human's single click just dies.
//
// THE MECHANISM, in two facts that are both true today:
//   1. the fight bar re-renders on its OWN clock — FightControls owns a 1Hz `setInterval` (200ms while the
//      min-turn floor gates) and reads `busy` from the run store, which flips synchronously the moment a chain
//      write starts. Neither is aligned with the player's gesture;
//   2. a control whose NATIVE `disabled` attribute is on at mouseup never sees the click at all. That is the
//      platform's own rule, not a heuristic — HTML Standard, `disabled`: a disabled form control "must prevent
//      any click events that are queued on the user interaction task source from being dispatched on the
//      element". No handler runs, nothing is logged, nothing is reported.
// So any bar control whose native `disabled` derives from `busy` has a live window in which a press is
// swallowed in silence. `drive_click` below models exactly those platform rules and nothing else.
//
// CLASS, NOT INSTANCE: the sweep asserts the law over EVERY control the bar renders — no fight-bar control is
// ever natively disabled, so the platform can never eat a queued click on any of them — while still rendering
// the refusal honestly (`aria-disabled`), so the fix cannot be "delete the disabled state".
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import i18next from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'

import en from '../../../../src/i18n/locales/en.json'
import { install_browser_globals } from '../../../../src/test_helpers/browser_globals.js'

const restore_browser_globals = install_browser_globals()
globalThis.Audio ??= /** @type {any} */ (
  class {
    play() {
      return Promise.resolve()
    }
    pause() {}
    addEventListener() {}
    removeEventListener() {}
  }
)

const { FightControls } = await import('../../../../src/game/screens/hud/FightControls.jsx')
const { DungeonBoardControls } = await import('../../../../src/game/screens/hud/world/DungeonBoardControls.jsx')
const { DungeonLeaveButton } = await import('../../../../src/game/screens/hud/world/DungeonLeaveButton.jsx')
const { seed_fight_core, reset_fight_core } = await import('../../../../src/test_helpers/fight_core_harness.js')
const { use_dungeon } = await import('../../../../src/world-shell/dungeon_store.js')
const { PHASE } = await import('../../../../src/fight-engine/phase.js')

const EN = i18next.createInstance()
await EN.init({ lng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } })

const ME = '0xme'
const PICKED_CELL = 100

/** The dungeon read DungeonBoardControls drills into the bar. No deadlines: the clock is not what is on trial. */
const DUNGEON = { placement_deadline_ms: 0, turn_deadline_ms: 0, status: 5 }

/** The bar exactly as the dungeon board mounts it — the composition that carries `abandon_disabled={busy}`. */
const board_props = (busy, handlers = {}) => ({
  t: (key) => key,
  phase: { phase: PHASE.PLACEMENT, unmet: [], outcome: null, desired: PHASE.PLACEMENT },
  dungeon: DUNGEON,
  busy,
  run_pass_id: '0xrun',
  effective_pick: PICKED_CELL,
  has_draft: false,
  leave_confirm: false,
  set_leave_confirm: () => {},
  on_end_turn: () => {},
  on_ready: () => {},
  on_leave_dungeon: () => {},
  on_leave_dungeon_confirmed: () => {},
  ...handlers,
})

/** Render the real board chrome at a given `busy`, both in the store (the bar's own read) and as the prop. */
const bar_markup = (busy, handlers = {}) => {
  use_dungeon.setState({ busy })
  return renderToStaticMarkup(
    <I18nextProvider i18n={EN}>
      <DungeonBoardControls {...board_props(busy, handlers)} />
    </I18nextProvider>
  )
}

/** One rendered control's own opening tag, straight out of the bar's markup. */
const control_tag = (markup, class_name) =>
  markup
    .split('<button')
    .map((chunk) => `<button${chunk.slice(0, chunk.indexOf('>') + 1)}`)
    .find((tag) => tag.includes(class_name)) ?? null

/** Does the platform's click pipeline treat this control as disabled? Only the NATIVE attribute does that. */
const natively_disabled = (tag) => / disabled=""/.test(tag ?? '')

/**
 * Capture the REAL element tree a component renders (its buttons with their live handlers), without a DOM.
 * Calling the component inside a probe makes its hooks the probe's — the tree it returns is production's.
 */
const capture = (render_component) => {
  let captured = /** @type {any} */ (null)
  const Probe = () => {
    captured = render_component()
    return captured
  }
  renderToStaticMarkup(
    <I18nextProvider i18n={EN}>
      <Probe />
    </I18nextProvider>
  )
  return captured
}

/**
 * Find a control by class anywhere in a captured tree and hand back the HOST `<button>` element — the one the
 * DOM actually receives, so `props.disabled` below means the native attribute and nothing else. A hook-free
 * wrapper component is expanded by calling it, the same seam idiom the rest of the HUD suite uses.
 */
const find_control = (node, class_name, override = null) => {
  if (node == null || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = find_control(child, class_name, override)
      if (hit) return hit
    }
    return null
  }
  if (typeof node.props?.className === 'string' && node.props.className.includes(class_name))
    // `override` swaps the wrapper's own props before it renders — how a control whose action is internal
    // (a local `set_confirm`) gets an observable one without changing production code.
    return typeof node.type === 'function' ? node.type({ ...node.props, ...(override ?? {}) }) : node
  return find_control(node.props?.children ?? null, class_name, override)
}

/**
 * ONE mouse click, driven through the two renders it straddles — the whole bug in four lines.
 * Both gates are the platform's, quoted at the top of this file: a disabled control receives no pointer
 * event to begin with, and a control disabled when the button comes back up never receives the queued click.
 * @param {any} at_press   the control as rendered when the player pushed down
 * @param {any} at_release the control as re-rendered (1Hz tick / busy flip) when they let go
 */
const drive_click = (at_press, at_release, node) => {
  if (at_press.props.disabled) return 'no-press' // the platform delivers nothing to a disabled control
  at_press.props.onPointerDown?.({ currentTarget: node })
  if (at_release.props.disabled) return 'eaten' // …and drops the already-queued click, silently
  at_release.props.onClick?.({ currentTarget: node })
  return 'delivered'
}

/** The bar's READY control — the dungeon derives its disabled from `busy` exactly like forfeit's. */
const ready_control = (busy, on_ready) => {
  use_dungeon.setState({ busy })
  return find_control(
    capture(() =>
      FightControls({
        placement: true,
        on_ready,
        ready_label: 'READY',
        ready_disabled: busy,
        abandon_disabled: busy,
      })
    ),
    'hud-fightctl__ready'
  )
}

beforeEach(() => {
  reset_fight_core()
  use_dungeon.setState({ busy: false })
  seed_fight_core({ my: ME, placement: true, active: ME })
})

/**
 * Drive a store-BACKED control in this DOM-free harness. A component that takes no props (DungeonLeaveButton)
 * reads every fact through `use_dungeon(selector)`, and zustand v5 serves a SERVER render the INITIAL state, not
 * the live one (`zustand/esm/react.mjs:9` — `selector(api.getInitialState())`); `setState` therefore cannot be
 * seen from `renderToStaticMarkup`, and `use_dungeon.getInitialState` cannot be swapped either, because
 * `Object.assign(useBoundStore, api)` copied it — the hook closes over the api, not over this handle. The one
 * real lever is the initial-state OBJECT itself, which the api holds by reference. Returns its own restore.
 */
const drive_store = (patch) => {
  const initial = use_dungeon.getInitialState()
  const before = Object.fromEntries(Object.keys(patch).map((key) => [key, initial[key]]))
  Object.assign(initial, patch)
  use_dungeon.setState(patch) // keep the live state honest too — nothing should depend on them disagreeing
  return () => Object.assign(initial, before)
}

afterEach(() => {
  use_dungeon.setState({ busy: false })
  reset_fight_core()
})

describe('#2141 · the fight bar presses on what the player SAW', () => {
  test('RED · a busy flip between the press and the release eats the click whole', () => {
    let readies = 0
    const node = {} // the one DOM node React keeps across the bar's own re-render
    const at_press = ready_control(false, () => {
      readies += 1
    })
    // …the 1Hz tick lands mid-gesture, carrying the store's synchronous `busy` edge with it.
    const at_release = ready_control(true, () => {
      readies += 1
    })

    expect(at_press, 'the player pressed a visible, enabled control').not.toBeNull()
    expect(drive_click(at_press, at_release, node)).toBe('delivered')
    expect(readies, 'one press by a human = one action, whatever the bar did between down and up').toBe(1)
  })

  test('SAFETY BOUND · a control the player saw DISABLED at press can never fire, however it flips after', () => {
    let readies = 0
    const node = {}
    const at_press = ready_control(true, () => {
      readies += 1
    })
    // busy clears while the button is still held down — the press must still be refused.
    const at_release = ready_control(false, () => {
      readies += 1
    })

    drive_click(at_press, at_release, node)
    expect(readies, 'the press is decided at PRESS time, in both directions').toBe(0)
  })

  test('a keyboard activation (no pointer gesture at all) still reads the live fact', () => {
    let readies = 0
    const armed = ready_control(false, () => {
      readies += 1
    })
    armed.props.onClick?.({ currentTarget: {} })
    expect(readies, 'Enter/Space has no down↔up window to race — it fires on the live truth').toBe(1)

    const refused = ready_control(true, () => {
      readies += 1
    })
    refused.props.onClick?.({ currentTarget: {} })
    expect(readies, '…and is refused when the control is genuinely disabled').toBe(1)
  })

  // ── THE CLASS SWEEP ───────────────────────────────────────────────────────────────────────────────────
  // Every control the bar renders, at busy=false and busy=true. The law is per-control and mechanical: the
  // native attribute the platform's click pipeline reads is never set, so no bar control can ever eat a click.
  const BAR_CONTROLS = ['hud-fightctl__ready', 'hud-fightctl__abandon', 'hud-fightctl__report']

  test('CLASS · no control on the fight bar is ever NATIVELY disabled, at any busy', () => {
    const idle = bar_markup(false)
    const busy = bar_markup(true)
    for (const control of BAR_CONTROLS) {
      expect(control_tag(idle, control), `${control} renders on the bar`).not.toBeNull()
      expect(natively_disabled(control_tag(idle, control)), `${control} @ idle`).toBe(false)
      expect(natively_disabled(control_tag(busy, control)), `${control} @ busy`).toBe(false)
    }
  })

  test('CLASS · …and the refusal is still rendered honestly, never silently dropped', () => {
    const busy = bar_markup(true)
    // READY and both exit doors derive their refusal from `busy`; the bug-report door has no disabled state.
    for (const control of ['hud-fightctl__ready', 'hud-fightctl__abandon'])
      expect(control_tag(busy, control), `${control} says it is refused`).toContain('aria-disabled="true"')
    expect(control_tag(bar_markup(false), 'hud-fightctl__ready')).toContain('aria-disabled="false"')
  })

  test('CLASS · the RUN door beside the bar (leave dungeon) presses on the same rule', () => {
    let leaves = 0
    const node = {}
    const leave_control = (busy) => {
      use_dungeon.setState({ busy })
      return find_control(
        capture(() =>
          DungeonBoardControls(
            board_props(busy, {
              on_leave_dungeon: () => {
                leaves += 1
              },
            })
          )
        ),
        'hud-fightctl__abandon'
      )
    }
    const at_press = leave_control(false)
    const at_release = leave_control(true)
    expect(drive_click(at_press, at_release, node)).toBe('delivered')
    expect(leaves).toBe(1)
  })

  // The PLANE-side twin of the same exit (DungeonLeaveButton): same `.hud-fightctl` chrome, same `busy`, and
  // it carried the bug TWICE — a native `disabled` AND a `!busy &&` re-read inside its own handler, which
  // refused a press the player made while the control was enabled. One rule, decided at pointerdown.
  test('CLASS · the plane-side exit (DungeonLeaveButton) presses on the same rule, in both directions', () => {
    reset_fight_core() // no live fight ⇒ the phase machine parks at ROAM, where this fallback exit mounts
    let opened = 0
    // A live escrowed run on the plane: latched, not spectating, no board mounted ⇒ this fallback exit shows.
    const restore = drive_store({
      busy: false,
      in_session: true,
      spectating: false,
      fight_id: null,
      run_pass_id: '0xrun',
      dungeon: { id: '0xd', status: 0 },
    })
    const plane_control = (busy) => {
      drive_store({ busy })
      return find_control(
        capture(() => DungeonLeaveButton()),
        'hud-fightctl__abandon',
        {
          on_click: () => {
            opened += 1
          },
        }
      )
    }

    try {
      // ① pressed while ENABLED, released after the chain write started: the exit still opens.
      const node = {}
      expect(plane_control(false), 'the plane exit is mounted and pressable').not.toBeNull()
      expect(drive_click(plane_control(false), plane_control(true), node)).toBe('delivered')
      expect(opened, 'a press the player made on an enabled control is honoured').toBe(1)

      // ② pressed while REFUSED, released after busy cleared: the click is delivered (nothing eats it any
      //    more) and the handler still refuses it — decided at pointerdown, not at release.
      expect(drive_click(plane_control(true), plane_control(false), {})).toBe('delivered')
      expect(opened, 'what the player saw disabled at press never fires, however busy flips after').toBe(1)
    } finally {
      restore()
    }
  })
})

process.on('exit', restore_browser_globals)
