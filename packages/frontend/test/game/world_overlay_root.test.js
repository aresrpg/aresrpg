// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2170 — world-anchored DOM belongs to the world view, not document.body. This driven lifecycle test
// models one delivered remote player, leaves the world route, then returns without rebuilding the session.

import { readFileSync } from 'node:fs'

import { afterEach, describe, expect, test } from 'bun:test'

import { create_world_overlay_root } from '../../src/game/world_overlay_root.js'

// eslint-disable-next-line functional/no-classes -- a parent-aware DOM fake is clearest as the shape it models.
class FakeElement {
  constructor(tag_name) {
    this.tagName = tag_name
    this.children = []
    this.dataset = {}
    this.parentElement = null
    this.style = {}
  }

  appendChild(child) {
    child.remove()
    child.parentElement = this
    this.children.push(child)
    return child
  }

  setAttribute(name, value) {
    if (name === 'data-world-overlay-root') this.dataset.worldOverlayRoot = value
    else if (name === 'data-world-overlay-layer') this.dataset.worldOverlayLayer = value
    else if (name === 'data-world-nametag') this.dataset.worldNametag = value
    else if (name === 'style') this.style.cssText = value
  }

  remove() {
    if (!this.parentElement) return
    this.parentElement.children = this.parentElement.children.filter((child) => child !== this)
    this.parentElement = null
  }
}

const descendants = (element) => element.children.flatMap((child) => [child, ...descendants(child)])

const create_document = () => {
  const body = new FakeElement('body')
  return {
    body,
    createElement: (tag_name) => new FakeElement(tag_name),
    querySelectorAll: (selector) => {
      if (selector !== '[data-world-nametag]') throw new Error(`unsupported selector: ${selector}`)
      return descendants(body).filter((element) => Object.hasOwn(element.dataset, 'worldNametag'))
    },
  }
}

const saved_document = globalThis.document

afterEach(() => {
  if (saved_document === undefined) delete globalThis.document
  else globalThis.document = saved_document
})

describe('world overlay root route lifecycle', () => {
  test('remote nametags and their updater leave the document with the world view, then return once', () => {
    const document = create_document()
    globalThis.document = document
    const frames = new Map()
    let next_frame = 1
    const overlays = create_world_overlay_root({
      request_frame(callback) {
        const id = next_frame++
        frames.set(id, callback)
        return id
      },
      cancel_frame(id) {
        frames.delete(id)
      },
    })
    const remote_layer = overlays.create_layer()
    const remote_nameplate = document.createElement('div')
    overlays.append_nametag(remote_nameplate, remote_layer)
    let position_updates = 0
    overlays.subscribe_frame(() => {
      position_updates += 1
    })

    overlays.set_active(true) // world route with one delivered remote player
    expect(document.querySelectorAll('[data-world-nametag]')).toHaveLength(1)
    expect(overlays.live_update_subscriptions()).toBe(1)
    expect(frames).toHaveLength(1)

    overlays.set_active(false) // navigate to any non-world page
    expect(document.querySelectorAll('[data-world-nametag]')).toHaveLength(0)
    expect(overlays.live_update_subscriptions()).toBe(0)
    expect(frames).toHaveLength(0)

    overlays.set_active(true) // navigate back without replacing the resident world session
    expect(document.querySelectorAll('[data-world-nametag]')).toHaveLength(1)
    expect(overlays.live_update_subscriptions()).toBe(1)
    expect(frames).toHaveLength(1)
    const [[frame_id, frame]] = frames
    frames.delete(frame_id) // a browser removes the fired request before invoking its callback
    frame(16)
    expect(position_updates).toBe(1)

    overlays.dispose()
    expect(frames).toHaveLength(0)
  })

  test('the whole entity-keyed DOM family uses the one root and its update scheduler', () => {
    const sources = new Map(
      ['local_nameplate.js', 'remote_players.js', 'world_spawns.js', 'cave_mobs.js'].map((name) => [
        name,
        readFileSync(new URL(`../../src/game/${name}`, import.meta.url), 'utf8'),
      ])
    )

    for (const [name, source] of sources) {
      expect(source, `${name} must mount tags through the family root`).toContain('overlay_root.append_nametag(')
      expect(source, `${name} must never escape to the document body`).not.toContain('document.body.appendChild(')
    }
    for (const name of ['remote_players.js', 'world_spawns.js', 'cave_mobs.js']) {
      expect(sources.get(name), `${name} must register its position updater at the root`).toContain(
        'overlay_root.subscribe_frame('
      )
      expect(sources.get(name), `${name} must not own a parallel animation-frame subscription`).not.toContain(
        'requestAnimationFrame('
      )
    }
    expect(sources.get('local_nameplate.js'), 'the local label must not survive as a store subscription').not.toContain(
      "events.on('STATE_UPDATED'"
    )

    const mount_source = readFileSync(new URL('../../src/game/embed_voxel.js', import.meta.url), 'utf8')
    expect(mount_source.match(/create_world_overlay_root\(\)/g)).toHaveLength(1)
    expect(mount_source).toContain('world_overlays.set_active(!paused)')
  })
})
