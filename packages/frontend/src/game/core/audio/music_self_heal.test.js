import { describe, expect, it } from 'bun:test'

import { create_music_self_heal, is_autoplay_block, music_retry_delay } from './music_self_heal.js'

const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

function fake_player(src) {
  return {
    src,
    load_calls: 0,
    pause_calls: 0,
    play_calls: 0,
    paused: true,
    rejection: null,
    getAttribute() {
      return this.src
    },
    load() {
      this.load_calls++
      this.paused = true
    },
    pause() {
      this.pause_calls++
      this.paused = true
    },
    play() {
      this.play_calls++
      if (this.rejection) return Promise.reject(this.rejection)
      this.paused = false
      return Promise.resolve()
    },
  }
}

function harness(overrides = {}) {
  const timers = []
  const logs = []
  const listeners = new Map()
  let ready = overrides.ready ?? true
  const players = ready
    ? { roam: fake_player('https://walrus/roam.mp3'), battle: fake_player('https://walrus/battle.mp3') }
    : { roam: fake_player('/roam.mp3'), battle: fake_player('/battle.mp3') }
  let selected_players = players
  const target = {
    addEventListener: (event, fn) => listeners.set(event, fn),
    removeEventListener: (event) => listeners.delete(event),
  }
  const heal = create_music_self_heal({
    get_players: () => selected_players,
    get_active_players: () => selected_players,
    get_tracks: () =>
      ready
        ? { roam: 'https://walrus/roam.mp3', battle: 'https://walrus/battle.mp3' }
        : { roam: '/roam.mp3', battle: '/battle.mp3' },
    is_active: () => true,
    manifest_ready: () => ready,
    reload_manifest: async () => {
      ready = true
      return true
    },
    get_gesture_target: () => target,
    set_timer: (fn, delay) => {
      const timer = { fn, delay, cleared: false }
      timers.push(timer)
      return timer
    },
    clear_timer: (timer) => {
      timer.cleared = true
    },
    quiet_log: (line) => logs.push(line),
  })
  return {
    heal,
    listeners,
    logs,
    players,
    select_players: (next) => (selected_players = next),
    timers,
  }
}

describe('music self-heal policy', () => {
  it('switching tracks stops the previous stream and stop leaves no stream active', async () => {
    const h = harness()
    h.select_players({ roam: h.players.roam, battle: null })
    h.heal.start()
    await flush()
    expect(Object.values(h.players).filter((player) => !player.paused)).toHaveLength(1)

    h.select_players({ roam: null, battle: h.players.battle })
    h.heal.play()
    await flush()
    expect(Object.values(h.players).filter((player) => !player.paused)).toHaveLength(1)
    expect(h.players.roam.pause_calls).toBe(1)

    h.heal.stop()
    expect(Object.values(h.players).filter((player) => !player.paused)).toHaveLength(0)
  })

  it('uses saturating backoff instead of giving up after the final retry', () => {
    expect([0, 1, 4, 99].map((attempt) => music_retry_delay(attempt))).toEqual([750, 2_000, 30_000, 30_000])
  })

  it('recognizes browser autoplay policy rejections only', () => {
    const blocked = { name: 'NotAllowedError' }
    expect(is_autoplay_block(blocked)).toBe(true)
    expect(is_autoplay_block(new Error('network'))).toBe(false)
  })

  it('resumes on the first gesture after autoplay is blocked and logs once', async () => {
    const h = harness()
    const blocked = new Error('gesture required')
    blocked.name = 'NotAllowedError'
    h.players.roam.rejection = blocked
    h.heal.start()
    await flush()

    expect(h.listeners.has('pointerdown')).toBe(true)
    h.players.roam.rejection = null
    h.listeners.get('pointerdown')()
    await flush()

    expect(h.listeners.size).toBe(0)
    expect(h.logs).toEqual(['[music] self-heal: autoplay resumed on user gesture'])
  })

  it('coalesces duplicate failure signals and logs once per recovered incident', async () => {
    const h = harness()
    h.players.roam.rejection = new Error('network')
    h.heal.start()
    await flush()
    h.heal.on_load_error()
    expect(h.timers[0].delay).toBe(750)
    expect(h.timers).toHaveLength(1)

    h.players.roam.rejection = null
    h.timers[0].fn()
    await flush()
    expect(h.players.roam.load_calls).toBe(1)
    expect(h.logs).toEqual(['[music] self-heal: failed stream reloaded'])

    h.heal.on_load_error()
    h.timers[1].fn()
    await flush()
    expect(h.logs).toEqual(['[music] self-heal: failed stream reloaded', '[music] self-heal: failed stream reloaded'])
  })

  it('ignores stale play rejection after stop and restart', async () => {
    const h = harness()
    let reject_old
    h.players.roam.play = () => new Promise((_, reject) => (reject_old = reject))
    h.heal.start()
    h.heal.stop()
    h.players.roam.play = () => Promise.resolve()
    h.heal.start()

    const blocked = new Error('gesture required')
    blocked.name = 'NotAllowedError'
    reject_old(blocked)
    await flush()
    expect(h.listeners.size).toBe(0)
    expect(h.timers).toHaveLength(0)
  })

  it('cancels a duplicate retry signal when the in-flight recovery succeeds', async () => {
    const h = harness()
    let resolve_retry
    h.players.roam.rejection = new Error('network')
    h.heal.start()
    await flush()
    h.players.roam.play = () => new Promise((resolve) => (resolve_retry = resolve))
    h.players.battle.play = () => Promise.resolve()
    h.timers[0].fn()
    h.heal.on_load_error()
    expect(h.timers).toHaveLength(2)

    resolve_retry()
    await flush()
    expect(h.timers[1].cleared).toBe(true)
    expect(h.logs).toEqual(['[music] self-heal: failed stream reloaded'])
  })

  it('re-resolves and plays Walrus URLs when the manifest arrives late', async () => {
    const h = harness({ ready: false })
    h.heal.start()
    expect(h.timers[0].delay).toBe(750)

    await h.timers[0].fn()
    await flush()
    expect(h.players.roam.src).toBe('https://walrus/roam.mp3')
    expect(h.players.battle.src).toBe('https://walrus/battle.mp3')
    expect(h.logs).toEqual(['[music] self-heal: late asset manifest applied'])
  })
})
