// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The crate's reel. It grows out of the opening's burst, keeps the opening's aura behind its centre, swells each
// card as it crosses the focus frame, and lands with the same flash and sparks the crate opened with.
import { useEffect, useMemo, useRef, type CSSProperties } from 'react'

import { box_rewards, items_by_type } from '../content/items.ts'
import { item_detail_icon } from '../content/item_detail_assets.ts'
import { schedule_carousel_audio } from '../game/audio/audio_registry.ts'

import { BOX_SPIN_MS, carousel_crossings, carousel_plan, carousel_progress } from './box_carousel.ts'

/** The sparks that gather into the crate while it charges and scatter when it bursts or its reward lands. */
export const BoxSparks = () => (
  <div aria-hidden="true" className="boxreveal__sparks">
    {Array.from({ length: 10 }, (_, index) => (
      <span
        className={`boxreveal__spark boxreveal__spark--${index % 2 ? 'cyan' : 'gold'}`}
        key={index}
        style={{ '--i': index } as CSSProperties}
      />
    ))}
  </div>
)

/** A card within this many strides of the centre is swollen; at the centre it gains FOCUS_GAIN. */
const FOCUS_REACH = 1.4
const FOCUS_GAIN = 0.12
const focus_scale = (distance: number): number => 1 + FOCUS_GAIN * Math.max(0, 1 - distance / FOCUS_REACH)

export const BoxCarousel = ({ box, reward, sound }: Readonly<{ box: string; reward: string; sound: boolean }>) => {
  const viewport = useRef<HTMLDivElement>(null)
  const track = useRef<HTMLDivElement>(null)
  const plan = useMemo(
    () =>
      carousel_plan(
        box_rewards(box).map(({ item_type }) => item_type),
        reward
      ),
    [box, reward]
  )
  useEffect(() => {
    const window = viewport.current
    const strip = track.current
    if (!window || !strip) return
    const cards = [...strip.children] as HTMLElement[]
    const started = performance.now()
    const stop_audio = sound ? schedule_carousel_audio(carousel_crossings(plan.target)) : () => {}
    let frame = 0
    let layout = { offset: 0, stride: 0 }
    let swollen: readonly HTMLElement[] = []
    // Layout sizes, so a swollen card never moves the reel.
    const measure = (): void => {
      layout = {
        offset: window.clientWidth / 2 - cards[0]!.offsetWidth / 2,
        stride: cards[1]!.offsetLeft - cards[0]!.offsetLeft,
      }
    }
    measure()
    const resize = new ResizeObserver(measure)
    resize.observe(window)
    /* eslint-disable functional/immutable-data -- This animation owns the DOM styles of its mounted track and cards. */
    const swell = (position: number | null): void => {
      for (const card of swollen) card.style.scale = ''
      const centre = position === null ? -1 : Math.round(position)
      swollen = position === null ? [] : cards.slice(Math.max(0, centre - 2), centre + 3)
      for (const card of swollen) card.style.scale = String(focus_scale(Math.abs(cards.indexOf(card) - position!)))
    }
    const draw = (now: number): void => {
      const time = Math.min(1, (now - started) / BOX_SPIN_MS)
      const position = carousel_progress(time) * plan.target
      strip.style.transform = `translate3d(${layout.offset - position * layout.stride}px,0,0)`
      if (time < 1) {
        swell(position)
        frame = requestAnimationFrame(draw)
      } else {
        swell(null)
        cards[plan.target]!.classList.add('boxreveal__reel-card--landed')
        window.classList.add('boxreveal__reel--landed')
      }
    }
    /* eslint-enable functional/immutable-data */
    frame = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(frame)
      resize.disconnect()
      stop_audio()
    }
  }, [plan, sound])
  return (
    <div className="boxreveal__reel" ref={viewport} aria-hidden="true">
      <div className="boxreveal__reel-track" ref={track}>
        {plan.items.map((item_type, index) => (
          <div key={index} className="boxreveal__reel-card" data-item={item_type}>
            <img src={item_detail_icon(item_type) ?? undefined} alt="" draggable={false} />
            <span>{items_by_type[item_type]?.name}</span>
          </div>
        ))}
      </div>
      <div className="boxreveal__reel-centre">
        <div className="boxreveal__aura" />
        <div className="boxreveal__reel-focus" />
        <BoxSparks />
        <div className="boxreveal__flash" />
      </div>
    </div>
  )
}
