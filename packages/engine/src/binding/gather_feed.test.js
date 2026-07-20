// Seam 3 gate — the pure proximity helper + the feed's affordance emission + marker bookkeeping (headless;
// the visual glow is proven by the demo screenshot).

import { test, expect, describe } from 'bun:test'

import { DEFAULT_WORLD_GEN_CONFIG } from '../config/world_gen_config.js'

import { ground_height } from './ground_height.js'
import { create_gather_feed, nearest_within, GATHER_RANGE_DEFAULT } from './gather_feed.js'

/** A scene-tracking mock engine (no GPU). */
const make_engine = () => {
  const children = new Set()
  return {
    add_to_scene: (o) => children.add(o),
    remove_from_scene: (o) => children.delete(o),
    get_camera: () => null,
    _children: children,
  }
}

describe('binding/nearest_within (pure)', () => {
  const nodes = [
    { id: 'a', x: 0, z: 0 },
    { id: 'b', x: 10, z: 0 },
    { id: 'c', x: 3, z: 4 }, // distance 5 from origin
  ]
  test('returns the closest node within range', () => {
    const r = nearest_within(nodes, 0, 0, 6)
    expect(r.node.id).toBe('a')
    expect(r.distance).toBe(0)
  })
  test('excludes nodes beyond range', () => {
    expect(nearest_within(nodes, 0, 0, 4.9)?.node.id).toBe('a')
    const only_c = nearest_within([{ id: 'c', x: 3, z: 4 }], 0, 0, 4.9)
    expect(only_c).toBe(null)
  })
  test('empty set → null', () => {
    expect(nearest_within([], 0, 0, 100)).toBe(null)
  })
})

describe('binding/create_gather_feed', () => {
  test('arms animation only while resources or markers exist', () => {
    const previous_raf = globalThis.requestAnimationFrame
    const previous_cancel_raf = globalThis.cancelAnimationFrame
    const frames = new Map()
    let next_frame_id = 1
    globalThis.requestAnimationFrame = (callback) => {
      const id = next_frame_id++
      frames.set(id, callback)
      return id
    }
    globalThis.cancelAnimationFrame = (id) => frames.delete(id)

    try {
      const engine = make_engine()
      const feed = create_gather_feed({ engine, world_config: DEFAULT_WORLD_GEN_CONFIG })
      expect(frames.size).toBe(0)

      feed.set_spawns({ resources: [{ id: 'iron', x: 5, z: 5 }] })
      expect(frames.size).toBe(1)

      const [frame_id, frame] = frames.entries().next().value
      frames.delete(frame_id)
      frame(16)
      expect(frames.size).toBe(1)

      feed.set_spawns({ resources: [], mob_groups: [] })
      expect(frames.size).toBe(0)

      feed.set_spawns({ mob_groups: [{ id: 'wolves', x: 10, z: 10 }] })
      expect(frames.size).toBe(1)
      feed.dispose()
      expect(frames.size).toBe(0)
    } finally {
      if (previous_raf === undefined) delete globalThis.requestAnimationFrame
      else globalThis.requestAnimationFrame = previous_raf
      if (previous_cancel_raf === undefined) delete globalThis.cancelAnimationFrame
      else globalThis.cancelAnimationFrame = previous_cancel_raf
    }
  })

  test('adds one scene group; markers count = resources + mob_groups; grounded by the Y-oracle', () => {
    const engine = make_engine()
    const feed = create_gather_feed({ engine, world_config: DEFAULT_WORLD_GEN_CONFIG })
    expect(engine._children.size).toBe(1)
    const [group] = [...engine._children]

    const resources = [
      { id: 'iron', x: 20, z: 30, template_id: 'iron_ore' },
      { id: 'wood', x: -40, z: 12, template_id: 'oak_log' },
    ]
    const mob_groups = [{ id: 'wolves', x: 60, z: -10, template_id: 'wolf_pack' }]
    feed.set_spawns({ resources, mob_groups })

    expect(feed._marker_count()).toBe(3)
    expect(group.children.length).toBe(3)
    // resource marker sits at the canonical ground + a small lift.
    const iron_marker = group.children.find((m) => Math.round(m.position.x) === 20)
    expect(iron_marker.position.y).toBeCloseTo(ground_height(DEFAULT_WORLD_GEN_CONFIG, 20, 30) + 0.06, 5)
    feed.dispose()
    expect(engine._children.size).toBe(0)
  })

  test("emits gather_affordance on entering/leaving a resource's range (resources only)", () => {
    const engine = make_engine()
    const feed = create_gather_feed({ engine, world_config: DEFAULT_WORLD_GEN_CONFIG })
    const events = []
    feed.on('gather_affordance', (p) => events.push(p))

    feed.set_spawns({
      resources: [{ id: 'iron', x: 100, z: 100, template_id: 'iron_ore' }],
      mob_groups: [{ id: 'wolves', x: 100, z: 100 }], // co-located mob group must NOT trigger a gather
    })

    // far away → no affordance.
    feed.set_player_position([0, 0])
    feed.tick(0.016)
    expect(events.length).toBe(0)

    // walk into range → one enter event naming the node.
    feed.set_player_position([100 + GATHER_RANGE_DEFAULT - 1, 100])
    feed.tick(0.016)
    expect(events.length).toBe(1)
    expect(events[0].node.id).toBe('iron')
    expect(events[0].distance).toBeLessThanOrEqual(GATHER_RANGE_DEFAULT)

    // staying in range does not re-emit (state-change only).
    feed.tick(0.016)
    expect(events.length).toBe(1)

    // leave range → a null-node (leave) event.
    feed.set_player_position([0, 0])
    feed.tick(0.016)
    expect(events.length).toBe(2)
    expect(events[1].node).toBe(null)
    feed.dispose()
  })

  test('set_player_position accepts an [x, y, z] triple (takes x + z)', () => {
    const engine = make_engine()
    const feed = create_gather_feed({ engine, world_config: DEFAULT_WORLD_GEN_CONFIG })
    const events = []
    feed.on('gather_affordance', (p) => events.push(p))
    feed.set_spawns({ resources: [{ id: 'iron', x: 5, z: 5 }] })
    feed.set_player_position([5, 128, 5]) // y ignored — x/z are in range
    feed.tick(0.016)
    expect(events.at(-1).node.id).toBe('iron')
    feed.dispose()
  })
})
