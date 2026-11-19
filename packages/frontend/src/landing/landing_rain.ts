// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Rain drawn drop by drop on a half-resolution canvas: every drop has its own depth, length, speed and
// brightness, and one shared wind gusts and eases, so no streak pattern repeats.
/* eslint-disable no-param-reassign, functional/immutable-data, functional/prefer-immutable-types -- this module draws on the canvas context it is given. */

type Drop = Readonly<{
  x: number
  y: number
  depth: number
  length: number
  speed: number
  alpha: number
  floor: number
}>
type Splash = Readonly<{ x: number; y: number; age: number; alpha: number }>
type Size = Readonly<{ width: number; height: number }>
type Wind = Readonly<{ current: number; target: number; until: number }>

/** One canvas pixel covers this many CSS pixels, for the pixel-art look. */
const PIXEL = 2
const SPLASH_SECONDS = 0.22
const SPLASH_DEPTH = 0.35
/** Measured ceilings: enough drops for a 4K backdrop, and few enough splashes to stay one cheap pass. */
const MAX_DROPS = 520
const MAX_SPLASHES = 60

const new_drop = ({ width, height }: Size, anywhere: boolean): Drop => {
  const depth = Math.random() * Math.random()
  return {
    x: Math.random() * (width + 240) - 120,
    y: anywhere ? Math.random() * height : -20 - Math.random() * 60,
    depth,
    length: 3 + depth * 11 + Math.random() * 3,
    speed: 190 + depth * 430 + Math.random() * 70,
    alpha: 0.07 + depth * 0.33 + Math.random() * 0.06,
    floor: height * (0.5 + Math.random() * 0.5),
  }
}

const lean_of = (wind: number, depth: number): number => wind * (0.55 + depth * 0.6)

const next_wind = (wind: Wind, now: number, seconds: number): Wind => {
  const gust =
    now > wind.until
      ? {
          target: Math.random() < 0.3 ? 0.5 + Math.random() * 0.5 : Math.random() * 0.35 - 0.05,
          until: now + 900 + Math.random() * 4200,
        }
      : wind
  return { ...gust, current: wind.current + (gust.target - wind.current) * Math.min(1, seconds * 0.9) }
}

const draw_drop = (context: CanvasRenderingContext2D, drop: Drop, lean: number): void => {
  context.globalAlpha = drop.alpha
  for (let step = 0; step < drop.length; step += 1)
    context.fillRect(Math.round(drop.x + step * lean), Math.round(drop.y - step), 1, 1)
}

const draw_splash = (context: CanvasRenderingContext2D, splash: Splash): void => {
  const reach = 1 + Math.round(splash.age * 14)
  context.globalAlpha = splash.alpha * (1 - splash.age / SPLASH_SECONDS)
  context.fillRect(Math.round(splash.x - reach), Math.round(splash.y), 1, 1)
  context.fillRect(Math.round(splash.x + reach), Math.round(splash.y), 1, 1)
  context.fillRect(Math.round(splash.x), Math.round(splash.y - 1), 1, 1)
}

/** Starts the rain on `canvas` and returns its stop function. The caller decides whether motion is allowed. */
export const start_landing_rain = (canvas: Readonly<HTMLCanvasElement>): (() => void) => {
  const context = canvas.getContext('2d')
  if (!context) return () => undefined
  const tint = getComputedStyle(canvas).color
  let size: Size = { width: 1, height: 1 }
  let drops: readonly Drop[] = []
  let splashes: readonly Splash[] = []
  let wind: Wind = { current: 0.2, target: 0.2, until: 0 }
  let last = 0
  let frame_id = 0

  const resize = (): void => {
    const box = canvas.getBoundingClientRect()
    size = { width: Math.max(1, Math.round(box.width / PIXEL)), height: Math.max(1, Math.round(box.height / PIXEL)) }
    canvas.setAttribute('width', String(size.width))
    canvas.setAttribute('height', String(size.height))
    const count = Math.min(MAX_DROPS, Math.round((size.width * size.height) / 1500))
    drops = Array.from({ length: count }, () => new_drop(size, true))
  }

  const frame = (now: number): void => {
    const seconds = last ? Math.min(0.05, (now - last) / 1000) : 0
    last = now
    wind = next_wind(wind, now, seconds)
    context.clearRect(0, 0, size.width, size.height)
    context.fillStyle = tint
    const moved = drops.map((drop) => {
      const lean = lean_of(wind.current, drop.depth)
      const next = { ...drop, y: drop.y + drop.speed * seconds, x: drop.x - drop.speed * lean * seconds }
      draw_drop(context, next, lean)
      return next
    })
    const landed = moved.filter((drop) => drop.y > drop.floor)
    drops = moved.map((drop) => (drop.y > drop.floor ? new_drop(size, false) : drop))
    splashes = [
      ...splashes.map((splash) => ({ ...splash, age: splash.age + seconds })),
      ...landed
        .filter((drop) => drop.depth > SPLASH_DEPTH)
        .map((drop) => ({ x: drop.x, y: drop.floor, age: 0, alpha: drop.alpha })),
    ]
      .filter((splash) => splash.age <= SPLASH_SECONDS)
      .slice(-MAX_SPLASHES)
    splashes.forEach((splash) => draw_splash(context, splash))
    frame_id = document.hidden ? 0 : requestAnimationFrame(frame)
  }
  const resume = (): void => {
    if (document.hidden || frame_id) return
    last = 0
    frame_id = requestAnimationFrame(frame)
  }

  resize()
  globalThis.addEventListener('resize', resize)
  document.addEventListener('visibilitychange', resume)
  resume()
  return () => {
    globalThis.removeEventListener('resize', resize)
    document.removeEventListener('visibilitychange', resume)
    cancelAnimationFrame(frame_id)
  }
}
