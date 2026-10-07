// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect, useMemo, useRef } from 'react'

import { box_rewards, items_by_type } from '../content/items.ts'
import { item_detail_icon } from '../content/item_detail_assets.ts'
import { schedule_carousel_audio } from '../game/audio/audio_registry.ts'

import { BOX_SPIN_MS, carousel_crossings, carousel_plan, carousel_progress } from './box_carousel.ts'

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
    const measure = (): void => {
      const first = cards[0]!.getBoundingClientRect()
      layout = {
        offset: window.getBoundingClientRect().width / 2 - first.width / 2,
        stride: cards[1]!.getBoundingClientRect().left - first.left,
      }
    }
    measure()
    const resize = new ResizeObserver(measure)
    resize.observe(window)
    const draw = (now: number): void => {
      const time = Math.min(1, (now - started) / BOX_SPIN_MS)
      // eslint-disable-next-line functional/immutable-data -- This animation owns the DOM transform for its mounted track.
      strip.style.transform = `translate3d(${layout.offset - carousel_progress(time) * plan.target * layout.stride}px,0,0)`
      if (time < 1) frame = requestAnimationFrame(draw)
      else {
        cards[plan.target]!.classList.add('boxreveal__reel-card--landed')
        window.classList.add('boxreveal__reel--landed')
      }
    }
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
          <div key={index} className="aui-panel boxreveal__reel-card" data-item={item_type}>
            <img src={item_detail_icon(item_type) ?? undefined} alt="" draggable={false} />
            <span>{items_by_type[item_type]?.name}</span>
          </div>
        ))}
      </div>
      <div className="boxreveal__reel-pointer" />
    </div>
  )
}
