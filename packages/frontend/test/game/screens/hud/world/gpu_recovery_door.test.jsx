// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2235 — a browser whose graphics acceleration is turned OFF (confirmed from the affected player's
// chrome://gpu: WebGL/WebGPU/OpenGL all "Disabled", GPU0 vendor 0x0000, on hardware that runs the game
// fine with the switch on) can create no WebGL context at all. Before this door, the world slot mounted
// the character creator anyway: a dead canvas, uncaught context rejections, and a "refresh to try again"
// toast that no refresh could fix — a broken screen where the answer is two clicks in browser settings.
//
// RED before the fix: `world_slot_content` had no capability input, so a GPU-less boot on '/' still
// answered 'create' and the surface rendered `data-world-slot="character-create"`.
//
// The retry BUTTON's click cannot be driven here — this repo's bun:test has no DOM (see
// contracts_paused_modal.test.tsx's header, same limit, same idiom), so the retry is proven in two
// halves: the probe genuinely re-asks the browser (it is not memoized — a recovered browser answers
// true on the very next call), and the door's button is wired to the handler that calls it.
import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import i18n from '../../../../../src/i18n'
import { probe_gl_context } from '../../../../../src/core/gl_support.js'
import {
  GpuDisabledDoor,
  WorldCharacterCreateSurface,
  world_slot_content,
} from '../../../../../src/game/screens/hud/world/WorldCharacterCreate.jsx'

const read_source = (relative_path) => readFileSync(new URL(relative_path, import.meta.url), 'utf8')

/** A canvas stub that fails context acquisition the two ways a real browser fails it, and counts the
 *  asks — the POSITIVE CONTROL: a stub nobody consulted would make every assertion below vacuous. */
const stub_canvas = (mode) => {
  const asked = []
  const context = {
    getExtension: (name) => (name === 'WEBGL_lose_context' ? { loseContext: () => asked.push('released') } : null),
  }
  return {
    asked,
    create: () => ({
      getContext(kind) {
        asked.push(kind)
        if (mode === 'throw') throw new Error('Error creating WebGL context.')
        return mode === 'live' ? context : null
      },
    }),
  }
}

const slot = (overrides = {}) =>
  world_slot_content({ pathname: '/', loaded: true, load_error: null, character_count: 0, ...overrides })

describe('#2235 detection — the one home of "can this browser draw 3D"', () => {
  test('a null context and a throwing context both read as NO GPU; a live one releases what it took', () => {
    const dead = stub_canvas('null')
    expect(probe_gl_context(dead.create)).toBe(false)
    expect(dead.asked).toEqual(['webgl2', 'webgl']) // positive control: the stub WAS consulted

    const broken = stub_canvas('throw')
    expect(probe_gl_context(broken.create)).toBe(false)
    expect(broken.asked).toEqual(['webgl2'])

    const live = stub_canvas('live')
    expect(probe_gl_context(live.create)).toBe(true)
    // probing must never eat one of the browser's few live contexts and break the next real renderer
    expect(live.asked).toEqual(['webgl2', 'released'])
  })

  test('the probe is never memoized — a browser that comes back after a relaunch is believed', () => {
    let accelerated = false
    const create = () => ({ getContext: () => (accelerated ? { getExtension: () => null } : null) })
    expect(probe_gl_context(create)).toBe(false)
    accelerated = true // the player enabled acceleration and relaunched, then pressed Retry
    expect(probe_gl_context(create)).toBe(true)
  })
})

describe('#2235 door — the world slot answers honestly instead of mounting a dead creator', () => {
  test('no GPU outranks every other face on the world slot, roster state notwithstanding', () => {
    expect(slot({ gl_supported: false })).toBe('no_gpu')
    expect(slot({ gl_supported: false, character_count: 3 })).toBe('no_gpu')
    expect(slot({ gl_supported: false, loaded: false })).toBe('no_gpu')
    expect(slot({ gl_supported: false, load_error: new Error('read failed') })).toBe('no_gpu')
    // and it never fires on a working browser, nor off the world route
    expect(slot()).toBe('create')
    expect(slot({ gl_supported: true, character_count: 1 })).toBe('world')
    expect(slot({ gl_supported: false, pathname: '/marketplace' })).toBe('inactive')
  })

  test('the door renders the honest copy and the broken create screen never mounts', () => {
    const html = renderToStaticMarkup(<WorldCharacterCreateSurface mode={slot({ gl_supported: false })} />)
    expect(html).toContain('data-world-slot="gpu-disabled"')
    expect(html).not.toContain('data-world-slot="character-create"')
    expect(html).not.toContain('data-world-slot="roster-error"')

    // what happened · whose fault it is not · the two real remedies · the way back
    expect(html).toContain(i18n.t('world.gpu_disabled_title'))
    expect(html).toContain(i18n.t('world.gpu_disabled_body'))
    expect(html).toContain('Use graphics acceleration when available') // the literal Chrome setting
    expect(html).toContain(i18n.t('world.gpu_disabled_other'))
    expect(html).toContain(i18n.t('world.retry'))
    // plain DOM by construction — the door must work exactly when nothing can be rendered
    expect(html).not.toContain('<canvas')
  })

  test('the retry button is wired to a fresh probe of the browser, feeding the state the slot renders from', () => {
    let retried = 0
    const door = renderToStaticMarkup(<GpuDisabledDoor on_retry={() => (retried += 1)} />)
    expect(door).toContain('data-gpu-retry')

    const source = read_source('../../../../../src/game/screens/hud/world/WorldCharacterCreate.jsx')
    expect(source).toContain('const retry_gl = () => set_gl_supported(probe_gl_context())')
    expect(source).toContain('on_gl_retry={retry_gl}')
    expect(source).toContain('<GpuDisabledDoor on_retry={on_gl_retry} />')
    expect(retried).toBe(0) // static render never fires it; the wiring above is the proof
  })

  test('the engine is never booted into a dead context (the black canvas + lying toast + rejection spam)', () => {
    const embed = read_source('../../../../../src/game/embed.js')
    expect(embed).toContain("import { probe_gl_context } from '../core/gl_support.js'")
    expect(embed).toMatch(
      /if \(!probe_gl_context\(\)\) \{[\s\S]*return \{ set_paused: \(\) => \{\}, destroy: \(\) => \{\} \}/
    )
    expect(embed.indexOf('if (!probe_gl_context())')).toBeLessThan(embed.indexOf("void import('./embed_voxel.js')"))
  })
})

test('every door string ships in all six locales', () => {
  const keys = ['gpu_disabled_title', 'gpu_disabled_body', 'gpu_disabled_chrome', 'gpu_disabled_other', 'retry']
  for (const locale of ['en', 'fr', 'es', 'de', 'ja', 'uk']) {
    const { world } = JSON.parse(read_source(`../../../../../src/i18n/locales/${locale}.json`))
    for (const key of keys) expect(`${locale}.${key}: ${world[key] ?? ''}`).not.toBe(`${locale}.${key}: `)
  }
})
