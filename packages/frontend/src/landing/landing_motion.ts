// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Draft authored by Claude Opus 5.5 (claude-opus-5-5): the accepted V19 motion script as one disposable lifecycle.
//
// Everything runs against the landing root, which is its own native scroll container. Listeners, observers, timers,
// animation frames and the reduced-motion watcher are all released by the returned dispose function. Motion only
// writes presentation attributes and styles on landing-owned nodes; it reads and writes no application store.

/* eslint-disable functional/immutable-data -- This disposable DOM lifecycle owns its animation state and presentation nodes; it never writes shared application state. */

const clamp = (value: number, low = 0, high = 1): number => Math.min(high, Math.max(low, value))
const ease = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2)
const random = (low: number, high: number): number => low + Math.random() * (high - low)
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'
const BEAT_A = 0.3
const BEAT_B = 0.58
/** Accepted stream choreography: [delay ms, step, speaker]. */
const SEQUENCE: readonly (readonly [number, number, '' | 'you' | 'ai'])[] = [
  [300, 1, 'you'],
  [2400, 2, 'ai'],
  [4400, 3, ''],
  [5400, 4, ''],
  [6700, 5, 'ai'],
  [8600, 6, 'ai'],
  [10600, 6, ''],
]

export type LandingMotionOptions = Readonly<{
  status_connecting: string
  status_watching: string
  /** The KARES modal keeps the trigger visible while open. */
  is_modal_open: () => boolean
}>

/** Stepped voxel wipe: 12 columns rise in 8 quantised rows, left leading right. */
const wipe = (progress: number): string => {
  if (progress <= 0) return 'inset(0 0 100% 0)'
  if (progress >= 1) return 'none'
  const columns = Array.from({ length: 12 }, (_, i) => {
    const rise = Math.round(clamp(progress * 1.5 - (i / 11) * 0.5) * 8) / 8
    return `${((i / 12) * 100).toFixed(3)}% ${100 - rise * 100}%,${(((i + 1) / 12) * 100).toFixed(3)}% ${100 - rise * 100}%`
  })
  return `polygon(0% 100%,${columns.join(',')},100% 100%)`
}
const beat_alpha = (progress: number, index: number): number => {
  const starts = [0, BEAT_A, BEAT_B]
  const ends = [BEAT_A, BEAT_B, 1]
  const enter = index > 0 ? clamp((progress - (starts[index]! - 0.02)) / 0.04) : 1
  const leave = index < 2 ? 1 - clamp((progress - (ends[index]! - 0.02)) / 0.04) : 1
  return Math.min(enter, leave)
}

/** Rain, wind-blown leaves and edge fireflies, sized to the viewport (accepted counts). */
const build_weather = (rain: Readonly<HTMLElement>, wind: Readonly<HTMLElement>, width: number): void => {
  const drops = Array.from({ length: Math.round(clamp(width / 26, 15, 60)) }, (_, i) => {
    const drop = document.createElement('i')
    if (i % 7 === 0) drop.className = 'h'
    drop.style.cssText = `--x:${random(0, 100).toFixed(2)}%;--l:${random(14, 28).toFixed(0)}px;--d:${random(1.1, 1.9).toFixed(2)}s;--dl:${(-random(0, 2)).toFixed(2)}s`
    return drop
  })
  const leaf_count = width < 720 ? 4 : width < 1440 ? 6 : 8
  const leaves = Array.from({ length: leaf_count }, (_, i) => {
    const leaf = document.createElement('i')
    const duration = random(11, 17)
    leaf.className = 'leaf'
    leaf.style.cssText = `--y:${random(8, 80).toFixed(1)}vh;--d:${duration.toFixed(1)}s;--dl:${(-(i / leaf_count) * duration - random(0, 2)).toFixed(1)}s;--dy1:${random(-4, 8).toFixed(1)}vh;--dy2:${random(4, 16).toFixed(1)}vh;--t:${random(1.2, 2.2).toFixed(2)}s`
    leaf.append(document.createElement('b'))
    return leaf
  })
  const flies = Array.from({ length: width < 720 ? 8 : width < 1440 ? 12 : 16 }, (_, i) => {
    const fly = document.createElement('i')
    fly.className = `fly${i % 3 === 0 ? ' cy' : ''}`
    const x = i % 2 ? random(80, 98) : random(2, 20)
    fly.style.cssText = `--x:${x.toFixed(1)}%;--y:${random(10, 92).toFixed(1)}%;--d:${random(6, 11).toFixed(1)}s;--b:${random(3, 6).toFixed(1)}s;--dl:${(-random(0, 6)).toFixed(1)}s;--wx:${random(14, 40).toFixed(0)}px;--wy:${random(10, 30).toFixed(0)}px`
    return fly
  })
  rain.replaceChildren(...drops)
  wind.replaceChildren(...leaves, ...flies)
}

export const start_landing_motion = (root: Readonly<HTMLElement>, options: LandingMotionOptions): (() => void) => {
  const one = <T extends Element = HTMLElement>(name: string): T => root.querySelector<T>(`[data-landing="${name}"]`)!
  const all = (name: string): readonly HTMLElement[] => [
    ...root.querySelectorAll<HTMLElement>(`[data-landing="${name}"]`),
  ]
  const art = one<HTMLImageElement>('art')
  const pan = one('pan')
  const rain = one('rain')
  const wind = one('wind')
  const world = one('world')
  const win = one('window')
  const layer_world = one('layer-world')
  const layer_combat = one('layer-combat')
  const ring = one('ring')
  const marks = all('mark')
  const beats = all('beat')
  const rail = all('rail')
  const dock = one('dock')
  const agent = one('agent')
  const broadcast = one('broadcast')
  const replay = one<HTMLButtonElement>('replay')
  const live = one('live')
  const mark_styles = marks.map((mark) => mark.getAttribute('style') ?? '')
  const media = matchMedia(REDUCED_MOTION)
  const status = [
    '',
    '',
    '',
    options.status_connecting,
    options.status_watching,
    options.status_watching,
    options.status_watching,
  ]
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const layout = {
    on: !media.matches,
    pinned: false,
    vh: 0,
    max: 1,
    pin_top: 0,
    pin_range: 1,
    travel: 0,
    measured: false,
  }
  const flow = { frame: 0, dock_y: 0, dock_away: false, played: false, seen: false, disposed: false }

  const top_in_root = (element: Readonly<HTMLElement>): number =>
    element.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop
  const reset_stage = (): void => {
    ;[win, layer_world, ring, ...beats].forEach((element) => element.removeAttribute('style'))
    marks.forEach((mark, i) => mark.setAttribute('style', mark_styles[i]!))
    layer_combat.setAttribute('style', 'clip-path:inset(0 0 100% 0)')
    rail.forEach((bit, i) => bit.classList.toggle('on', i === 0))
  }
  const measure = (): void => {
    layout.measured = true
    layout.vh = root.clientHeight
    const was_pinned = layout.pinned
    layout.pinned = layout.on && root.clientWidth >= 1100 && layout.vh >= 600
    root.toggleAttribute('data-pin', layout.pinned)
    if (was_pinned && !layout.pinned) reset_stage()
    layout.max = Math.max(1, root.scrollHeight - layout.vh)
    layout.travel = Math.max(0, art.getBoundingClientRect().height - layout.vh)
    layout.pin_top = top_in_root(world)
    layout.pin_range = Math.max(1, world.offsetHeight - layout.vh)
  }
  const stage = (scroll: number): void => {
    const progress = clamp((scroll - layout.pin_top) / layout.pin_range)
    const enter = clamp(1 - (layout.pin_top - scroll) / layout.vh)
    win.style.setProperty('--enter', (0.84 + 0.16 * ease(enter)).toFixed(4))
    const zoom =
      progress < BEAT_A
        ? 1 + 0.05 * (progress / BEAT_A)
        : 1.05 + 0.75 * ease(clamp((progress - BEAT_A) / (BEAT_B - BEAT_A)))
    layer_world.style.transform = `scale(${zoom.toFixed(4)})`
    ring.style.opacity = (clamp((progress - 0.36) / 0.06) * (1 - clamp((progress - 0.6) / 0.04))).toFixed(3)
    ring.style.setProperty('--inv', (1 / zoom).toFixed(4))
    const reveal = clamp((progress - BEAT_B) / 0.14)
    layer_combat.style.clipPath = wipe(reveal)
    layer_combat.style.transform = `scale(${(1.08 - 0.08 * ease(reveal)).toFixed(4)})`
    marks.forEach((mark, i) => mark.style.setProperty('--m', clamp((progress - (0.74 + i * 0.06)) / 0.05).toFixed(3)))
    const current = progress < BEAT_A ? 0 : progress < BEAT_B ? 1 : 2
    beats.forEach((beat, i) => {
      const alpha = beat_alpha(progress, i)
      beat.style.setProperty('opacity', alpha.toFixed(3))
      beat.style.setProperty('transform', `translateY(${((1 - alpha) * (i < current ? -12 : 12)).toFixed(1)}px)`)
    })
    rail.forEach((bit, i) => bit.classList.toggle('on', i <= current))
  }
  /** Top-right trigger: visible near the top and when scrolling up; out of the way while reading downward. */
  const place_dock = (scroll: number): void => {
    const delta = scroll - flow.dock_y
    if (scroll < layout.vh * 0.6) flow.dock_away = false
    else if (Math.abs(delta) > 8) flow.dock_away = delta > 0
    if (Math.abs(delta) > 8 || scroll < layout.vh * 0.6) flow.dock_y = scroll
    const keep = options.is_modal_open() || root.ownerDocument.activeElement === dock
    dock.classList.toggle('away', flow.dock_away && !keep)
  }
  const render = (): void => {
    flow.frame = 0
    if (!layout.measured) measure()
    const scroll = root.scrollTop
    const y = layout.on ? -layout.travel * clamp(scroll / layout.max) : 0
    pan.style.transform = `translate3d(-50%,${y.toFixed(1)}px,0)`
    if (layout.pinned) stage(scroll)
    place_dock(scroll)
  }
  const schedule = (): void => {
    if (!flow.frame && !flow.disposed) flow.frame = requestAnimationFrame(render)
  }
  const remeasure = (): void => {
    layout.measured = false
    schedule()
  }

  /* Scripted stream: plays once in view (motion allowed), Replay restarts it; otherwise the finished frame. */
  const set_step = (step: number, talk: '' | 'you' | 'ai'): void => {
    agent.classList.add('armed')
    ;[1, 2, 3, 4, 5, 6].forEach((i) => agent.classList.toggle(`s${i}`, i <= step))
    agent.classList.toggle('talk-you', talk === 'you')
    agent.classList.toggle('talk-ai', talk === 'ai')
    live.textContent = status[step] || options.status_watching
  }
  const stop_sequence = (): void => {
    timers.forEach(clearTimeout)
    timers.clear()
  }
  const finish_sequence = (): void => {
    stop_sequence()
    agent.classList.remove('armed', 'talk-you', 'talk-ai', 's1', 's2', 's3', 's4', 's5', 's6')
    live.textContent = options.status_watching
  }
  const play_sequence = (): void => {
    stop_sequence()
    if (!layout.on) return finish_sequence()
    flow.played = true
    set_step(0, '')
    SEQUENCE.forEach(([delay, step, talk]) => {
      const timer = setTimeout(() => {
        timers.delete(timer)
        set_step(step, talk)
      }, delay)
      timers.add(timer)
    })
  }
  const sync_sequence = (): void => {
    replay.hidden = !layout.on
    if (!layout.on) return finish_sequence()
    if (flow.played) return
    set_step(0, '')
    if (flow.seen) play_sequence()
  }
  const sequence_view = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      flow.seen = true
      if (layout.on && !flow.played) play_sequence()
    },
    { root, threshold: 0.45 }
  )

  /* Automatic system preference; there is no public motion control. */
  const apply_motion = (): void => {
    layout.on = !media.matches
    root.setAttribute('data-motion', layout.on ? 'on' : 'reduced')
    if (layout.on) build_weather(rain, wind, root.clientWidth)
    else {
      rain.replaceChildren()
      wind.replaceChildren()
    }
    remeasure()
    sync_sequence()
  }
  const resize = new ResizeObserver(remeasure)

  replay.addEventListener('click', play_sequence)
  media.addEventListener('change', apply_motion)
  root.addEventListener('scroll', schedule, { passive: true })
  globalThis.addEventListener('resize', remeasure, { passive: true })
  art.addEventListener('load', remeasure)
  sequence_view.observe(broadcast)
  resize.observe(one('flow'))
  void root.ownerDocument.fonts?.ready.then(() => {
    if (!flow.disposed) remeasure()
  })
  apply_motion()

  return () => {
    flow.disposed = true
    if (flow.frame) cancelAnimationFrame(flow.frame)
    stop_sequence()
    replay.removeEventListener('click', play_sequence)
    media.removeEventListener('change', apply_motion)
    root.removeEventListener('scroll', schedule)
    globalThis.removeEventListener('resize', remeasure)
    art.removeEventListener('load', remeasure)
    sequence_view.disconnect()
    resize.disconnect()
    rain.replaceChildren()
    wind.replaceChildren()
  }
}
