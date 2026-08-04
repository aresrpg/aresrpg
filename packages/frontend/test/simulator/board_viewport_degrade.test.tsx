// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2205 — the simulator's board pane must survive a dead GL context. `create_board_viewport` boots the whole
// engine, and a browser with acceleration off answers `canvas.getContext('webgl2')` with `null`. Every call
// the pane makes into that engine is a bare `void promise` inside an effect, so an unguarded failure is an
// UNHANDLED REJECTION and a dead black rectangle for the whole GPU-less cohort.
//
// WHERE it fails was MEASURED, not assumed (e2e/simulator_no_webgl.spec.ts, context nulled in a real
// Chromium): the engine survives construction — it catches and reports its own boot failure, handing back a
// renderer-less shell — and the first throw lands one paint later, in `show()` → `board.build()` →
// `engine.add_to_scene`. A guard on the constructor alone would have caught nothing, which is why the
// contract below is about the HANDLE, not the factory.
//
// So this drives the real mount (`mount_board_viewport`) down all three failure axes — the chunk fails, the
// factory throws, the first paint rejects — and pins: nothing escapes, `on_dead` fires AT MOST ONCE, and
// exactly ONE report_error tagged `simulator` carries the mechanical cause. Then it pins what the pane SHOWS
// in that state, over react-dom/server: the honest "board unavailable" notice instead of the click-a-cell
// hint, with the board's own read-out and the reroll still standing.
import { describe, test, expect, spyOn, afterEach } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'

import * as report from '../../src/core/report.js'
import en from '../../src/i18n/locales/en.json'
import { board_of } from '../../src/simulator/board'
import { BoardPaneView, mount_board_viewport } from '../../src/simulator/BoardPane'

const test_i18n = i18next.createInstance()
void test_i18n.init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
})

const BOARD = board_of(0xc81f3a92, 0)
/** A canvas stand-in — the mount only ever hands it to the engine factory, which never runs here. */
const CANVAS = {} as HTMLCanvasElement

/** Flush microtasks so a rejection nobody handled has actually been observed as unhandled. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

let unhandled: unknown[] = []
const track_unhandled = (reason: unknown) => unhandled.push(reason)
process.on('unhandledRejection', track_unhandled)

afterEach(() => {
  unhandled = []
})

const markup = (gl_degraded: boolean) =>
  renderToStaticMarkup(
    <I18nextProvider i18n={test_i18n}>
      <BoardPaneView board={BOARD} setup gl_degraded={gl_degraded} on_reroll={() => {}} />
    </I18nextProvider>
  )

/** A viewport handle that fails the way the real one does — everything builds, the PAINT is what dies. */
const dead_on_paint = (calls: string[]) => ({
  show: async () => {
    calls.push('show')
    throw new Error('THREE.WebGLRenderer: Error creating WebGL context.')
  },
  on_cell_click: () => {
    calls.push('subscribe')
    return () => {}
  },
  arm_fight: async () => {},
  disarm_fight: () => {},
  destroy: () => {},
})

describe('#2205 · a dead GL context degrades the board pane instead of killing the page', () => {
  test('the FIRST PAINT rejects (the measured failure) → show resolves, dead once, reported once', async () => {
    const report_spy = spyOn(report, 'report_error').mockImplementation(() => {})
    // the POSITIVE CONTROL: a stub nobody consulted would make every assertion below vacuous
    const calls: string[] = []
    const deaths: number[] = []
    const mounted = await mount_board_viewport({
      canvas: CANVAS,
      on_cell: () => {},
      on_dead: () => deaths.push(1),
      load: async () => ({ create_board_viewport: () => dead_on_paint(calls) }),
    })
    await settle()

    // the mount SUCCEEDS — the engine survives construction, so nothing has failed yet
    expect(mounted).not.toBeNull()
    expect(deaths).toEqual([])
    expect(report_spy).not.toHaveBeenCalled()

    // ① the paint the pane fires as a bare `void promise` must not reject
    await mounted?.handle.show({}, {})
    await settle()
    expect(unhandled).toEqual([])
    expect(calls).toEqual(['subscribe', 'show'])
    expect(deaths).toEqual([1])
    expect(report_spy).toHaveBeenCalledTimes(1)
    const [reported, context] = report_spy.mock.calls[0] as [unknown, { area: string }]
    expect(context.area).toBe('simulator')
    expect(String(reported instanceof Error ? reported.message : reported)).toMatch(/WebGL/i)

    // ② ONCE, not once per repaint — a reroll against a dead renderer must not re-report
    await mounted?.handle.show({}, {})
    await mounted?.handle.arm_fight()
    await settle()
    expect(unhandled).toEqual([])
    expect(deaths).toEqual([1])
    expect(report_spy).toHaveBeenCalledTimes(1)
    report_spy.mockRestore()
  })

  test('the engine factory THROWS outright → null, dead once, reported once, nothing escapes', async () => {
    const report_spy = spyOn(report, 'report_error').mockImplementation(() => {})
    const calls: string[] = []
    const deaths: number[] = []
    const mounted = await mount_board_viewport({
      canvas: CANVAS,
      on_cell: () => {},
      on_dead: () => deaths.push(1),
      load: async () => {
        calls.push('load')
        return {
          create_board_viewport: () => {
            calls.push('factory')
            throw new Error('Error creating WebGL context.')
          },
        }
      },
    })
    await settle()

    expect(mounted).toBeNull()
    expect(unhandled).toEqual([])
    expect(calls).toEqual(['load', 'factory'])
    expect(deaths).toEqual([1])
    expect(report_spy).toHaveBeenCalledTimes(1)
    expect((report_spy.mock.calls[0] as [unknown, { area: string }])[1].area).toBe('simulator')
    report_spy.mockRestore()
  })

  test('the lazy chunk itself fails to load → the same degraded contract, one report', async () => {
    const report_spy = spyOn(report, 'report_error').mockImplementation(() => {})
    const deaths: number[] = []
    const mounted = await mount_board_viewport({
      canvas: CANVAS,
      on_cell: () => {},
      on_dead: () => deaths.push(1),
      load: () => Promise.reject(new Error('Failed to fetch dynamically imported module')),
    })
    await settle()

    expect(mounted).toBeNull()
    expect(unhandled).toEqual([])
    expect(deaths).toEqual([1])
    expect(report_spy).toHaveBeenCalledTimes(1)
    expect((report_spy.mock.calls[0] as [unknown, { area: string }])[1].area).toBe('simulator')
    report_spy.mockRestore()
  })

  test('a LIVE context mounts, paints and relays clicks — the guard costs the happy path nothing', async () => {
    const report_spy = spyOn(report, 'report_error').mockImplementation(() => {})
    const relayed: unknown[] = []
    const painted: unknown[] = []
    const unsubscribe = () => {}
    const handle = {
      show: async (board: unknown) => {
        painted.push(board)
      },
      on_cell_click: (cb: (cell: { x: number; y: number } | null) => void) => {
        cb({ x: 3, y: 4 })
        return unsubscribe
      },
      arm_fight: async () => {},
      disarm_fight: () => {},
      destroy: () => {},
    }
    const deaths: number[] = []
    const mounted = await mount_board_viewport({
      canvas: CANVAS,
      on_cell: (cell) => relayed.push(cell),
      on_dead: () => deaths.push(1),
      load: async () => ({ create_board_viewport: () => handle }),
    })
    await mounted?.handle.show(BOARD, {})
    await settle()

    expect(mounted?.unsubscribe).toBe(unsubscribe)
    expect(relayed).toEqual([{ x: 3, y: 4 }]) // the click relay is wired, not just constructed
    expect(painted).toEqual([BOARD]) // the wrapper forwards the paint untouched
    expect(deaths).toEqual([])
    expect(report_spy).not.toHaveBeenCalled()
    expect(unhandled).toEqual([])
    report_spy.mockRestore()
  })

  test('the degraded pane says so, drops the gesture it can no longer offer, and keeps the page', () => {
    const html = markup(true)
    expect(html).toContain(en.simulator.board_unavailable)
    expect(html).toContain(en.simulator.board_unavailable_hint)
    // the click-a-cell hint is a lie with no board under it (the pedestal hides "drag to rotate" the same way)
    expect(html).not.toContain(en.simulator.board_hint)
    // never a blank hole: the board's own read-out and its verb are untouched
    expect(html).toContain(`${BOARD.width} × ${BOARD.height}`)
    expect(html).toContain(`${BOARD.anchor.x},${BOARD.anchor.z}`)
    expect(html).toContain(en.simulator.reroll_board)
  })

  test('a healthy pane shows no notice — the degraded chrome is not always-on (control)', () => {
    const html = markup(false)
    expect(html).toContain(en.simulator.board_hint)
    expect(html).not.toContain(en.simulator.board_unavailable)
    expect(html).not.toContain(en.simulator.board_unavailable_hint)
  })
})
