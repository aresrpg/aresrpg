import { describe, expect, it } from 'bun:test'

import { create_fight_render_queue } from './fight_render_queue.js'

const make_clock = () => {
  let time = 0
  return {
    now: () => time,
    sleep: async (ms) => {
      time += ms
    },
    time: () => time,
  }
}

const event = (kind, at, duration, render) => ({ kind, at, duration, render })

describe('create_fight_render_queue', () => {
  it('plays complete source turns and their carried renders in strict FIFO timing order', async () => {
    const clock = make_clock()
    const trace = []
    const queue = create_fight_render_queue({ sleep: clock.sleep, now: clock.now })

    const player_turn = queue.enqueue_turn({
      source_turn: 'player:7',
      events: [
        event('move', 0, 100, async () => {
          trace.push(['move:start', clock.time()])
          await clock.sleep(40)
          trace.push(['move:end', clock.time()])
        }),
        event('cast', 120, 30, () => trace.push(['cast', clock.time()])),
        // Its requested beat is already past after cast's floor; FIFO wins, so it starts at 150 rather than 120.
        event('damage', 120, 20, () => trace.push(['damage', clock.time()])),
      ],
    })
    const enemy_turn = queue.enqueue_turn({
      source_turn: 'enemy:8',
      events: [event('move', 50, 10, () => trace.push(['enemy-move', clock.time()]))],
    })

    await Promise.all([player_turn, enemy_turn])
    expect(trace).toEqual([
      ['move:start', 0],
      ['move:end', 40],
      ['cast', 120],
      ['damage', 150],
      ['enemy-move', 220],
    ])
    expect(clock.time()).toBe(230)
    expect(queue.size()).toBe(0)
  })

  it('snapshots every carried render before enqueue and ignores later producer mutation', async () => {
    const rendered = []
    const render = () => rendered.push('prebuilt')
    const events = [event('trap-mark', 0, 0, render)]
    const queue = create_fight_render_queue()

    const done = queue.enqueue_turn({ source_turn: 'player:9', events })
    events[0].render = () => rendered.push('mutated')
    events.push(event('late-addition', 0, 0, () => rendered.push('late')))
    await done

    expect(rendered).toEqual(['prebuilt'])
  })

  it('validates a whole turn atomically before any render is accepted', async () => {
    const rendered = []
    const queue = create_fight_render_queue()
    const bad_timings = [-1, Number.NaN, Number.POSITIVE_INFINITY]

    for (const at of bad_timings) {
      expect(() =>
        queue.enqueue_turn({
          source_turn: 'bad-at',
          events: [event('valid-first', 0, 0, () => rendered.push('never')), event('bad', at, 0, () => {})],
        })
      ).toThrow(/at must be a finite nonnegative number/)
    }
    expect(() => queue.enqueue_turn({ source_turn: 'bad-duration', events: [event('bad', 0, -1, () => {})] })).toThrow(
      /duration must be a finite nonnegative number/
    )
    expect(() => queue.enqueue_turn({ source_turn: 'bad-render', events: [event('bad', 0, 0, null)] })).toThrow(
      /render must be a function/
    )

    await queue.idle()
    expect(rendered).toEqual([])
    expect(queue.size()).toBe(0)
  })

  it('never overlaps renders, even when the following event is already due', async () => {
    const trace = []
    let release_first
    const first_gate = new Promise((resolve) => {
      release_first = resolve
    })
    const queue = create_fight_render_queue()
    const done = queue.enqueue_turn({
      source_turn: 'enemy:10',
      events: [
        event('push-slide', 0, 0, async () => {
          trace.push('push:start')
          await first_gate
          trace.push('push:end')
        }),
        event('trap-boom', 0, 0, () => trace.push('trap-boom')),
      ],
    })

    await Promise.resolve()
    expect(trace).toEqual(['push:start'])
    release_first()
    await done
    expect(trace).toEqual(['push:start', 'push:end', 'trap-boom'])
  })

  it('clear drops every not-started render but lets the in-flight event and its floor finish', async () => {
    const clock = make_clock()
    const trace = []
    const sizes = []
    let release_running
    const running_gate = new Promise((resolve) => {
      release_running = resolve
    })
    const queue = create_fight_render_queue({
      sleep: clock.sleep,
      now: clock.now,
      on_change: (size) => sizes.push(size),
    })
    const done = queue.enqueue_turn({
      source_turn: 'enemy:11',
      events: [
        event('cast', 0, 50, async () => {
          trace.push(['cast:start', clock.time()])
          await running_gate
          trace.push(['cast:end', clock.time()])
        }),
        event('damage', 0, 0, () => trace.push(['damage', clock.time()])),
        event('death', 0, 0, () => trace.push(['death', clock.time()])),
      ],
    })

    await Promise.resolve()
    expect(queue.size()).toBe(3)
    queue.clear()
    expect(queue.size()).toBe(1)
    release_running()
    await Promise.all([done, queue.idle()])

    expect(trace).toEqual([
      ['cast:start', 0],
      ['cast:end', 0],
    ])
    expect(clock.time()).toBe(50)
    expect(sizes).toEqual([3, 1, 0])
  })

  it('clear cancels an event waiting for its at beat without invoking its render', async () => {
    let release_sleep
    const sleeping = new Promise((resolve) => {
      release_sleep = resolve
    })
    const rendered = []
    const queue = create_fight_render_queue({
      now: () => 0,
      sleep: () => sleeping,
    })
    const done = queue.enqueue_turn({
      source_turn: 'player:12',
      events: [event('walk-arrival', 100, 0, () => rendered.push('arrival'))],
    })

    await Promise.resolve()
    queue.clear()
    await Promise.all([done, queue.idle()])
    release_sleep()

    expect(rendered).toEqual([])
    expect(queue.size()).toBe(0)
  })

  it('a failed render rejects its turn but does not wedge later events or turns', async () => {
    const trace = []
    const queue = create_fight_render_queue()
    const failed = queue.enqueue_turn({
      source_turn: 'enemy:13',
      events: [
        event('cast', 0, 0, () => {
          trace.push('failed-cast')
          throw new Error('missing cast mesh')
        }),
        event('damage', 0, 0, () => trace.push('same-turn-damage')),
      ],
    })
    const next = queue.enqueue_turn({
      source_turn: 'player:14',
      events: [event('move', 0, 0, () => trace.push('next-turn-move'))],
    })

    await expect(failed).rejects.toThrow('missing cast mesh')
    await next
    expect(trace).toEqual(['failed-cast', 'same-turn-damage', 'next-turn-move'])
    expect(queue.size()).toBe(0)
  })
})
