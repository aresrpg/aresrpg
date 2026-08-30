// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { ArrowLeft, ArrowRight, Check, X } from 'lucide-react'
import type { HydratedFightCheckpoint } from '@aresrpg/fight'
import { useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties } from 'react'

import { read_scene, subscribe_scene } from '../game/core/scene_feed.ts'
import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { indexing_blocked } from '../components/IndexingCatchupModal.tsx'
import { selected_dungeon_run } from '../modules/dungeon.ts'
import { dispatch_app, useAppStore } from '../store.ts'

import {
  completed_tutorials_from,
  tutorial_id_for,
  tutorial_steps,
  type TutorialId,
  type TutorialStep,
  type TutorialTarget,
} from './tutorial.ts'

type TargetRect = Readonly<{ left: number; top: number; width: number; height: number }>

const same_rect = (left: TargetRect | null, right: TargetRect | null): boolean =>
  left === right ||
  (!!left &&
    !!right &&
    Math.abs(left.left - right.left) < 0.5 &&
    Math.abs(left.top - right.top) < 0.5 &&
    Math.abs(left.width - right.width) < 0.5 &&
    Math.abs(left.height - right.height) < 0.5)

const visible_rect = (rect: Readonly<TargetRect>, width: number, height: number): TargetRect | null => {
  const left = Math.max(8, rect.left - 8)
  const top = Math.max(8, rect.top - 8)
  const right = Math.min(width - 8, rect.left + rect.width + 8)
  const bottom = Math.min(height - 8, rect.top + rect.height + 8)
  return right > left && bottom > top ? Object.freeze({ left, top, width: right - left, height: bottom - top }) : null
}

const resolve_target_rect = (
  target: Readonly<TutorialTarget> | null,
  character_id: string,
  scene: ReturnType<typeof read_scene>
): TargetRect | null => {
  if (!target) return null
  if (target.kind === 'entity') {
    const anchor = scene?.project_entity(character_id)
    if (!anchor) return null
    const height = Math.max(180, Math.min(560, innerHeight * 0.58))
    const width = Math.max(96, Math.min(220, height * 0.38))
    return visible_rect({ left: anchor.x - width / 2, top: anchor.y - 12, width, height }, innerWidth, innerHeight)
  }
  const element = document.querySelector<HTMLElement>(`[data-tutorial-target="${target.name}"]`)
  if (!element) return null
  const rect = element.getBoundingClientRect()
  return visible_rect(
    { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    innerWidth,
    innerHeight
  )
}

const useTutorialTargetRect = (
  target: Readonly<TutorialTarget> | null,
  character_id: string,
  scene: ReturnType<typeof read_scene>
): TargetRect | null => {
  const [rect, set_rect] = useState<TargetRect | null>(null)

  useEffect(() => {
    if (target?.kind === 'dom')
      document
        .querySelector<HTMLElement>(`[data-tutorial-target="${target.name}"]`)
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    let frame = 0
    const sample = (): void => {
      const next = resolve_target_rect(target, character_id, scene)
      set_rect((current) => (same_rect(current, next) ? current : next))
      frame = requestAnimationFrame(sample)
    }
    sample()
    return () => cancelAnimationFrame(frame)
  }, [character_id, scene, target])

  return rect
}

const card_style = (rect: Readonly<TargetRect> | null): CSSProperties => {
  if (!rect || innerWidth < 700 || innerHeight < 620)
    return { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }
  const width = Math.min(380, innerWidth - 32)
  const height = 280
  const gap = 18
  if (innerWidth - (rect.left + rect.width) >= width + gap)
    return { left: rect.left + rect.width + gap, top: Math.max(16, Math.min(rect.top, innerHeight - height - 16)) }
  if (rect.left >= width + gap)
    return { left: rect.left - width - gap, top: Math.max(16, Math.min(rect.top, innerHeight - height - 16)) }
  if (innerHeight - (rect.top + rect.height) >= height + gap)
    return {
      left: Math.max(16, Math.min(rect.left + rect.width / 2 - width / 2, innerWidth - width - 16)),
      top: rect.top + rect.height + gap,
    }
  return {
    left: Math.max(16, Math.min(rect.left + rect.width / 2 - width / 2, innerWidth - width - 16)),
    top: Math.max(16, rect.top - height - gap),
  }
}

const TutorialShade = ({ rect }: Readonly<{ rect: TargetRect | null }>) => {
  if (!rect) return <div className="pointer-events-auto fixed inset-0 bg-black/70 backdrop-blur-[2px]" />
  const right = rect.left + rect.width
  const bottom = rect.top + rect.height
  const shade = 'pointer-events-auto fixed bg-black/70 backdrop-blur-[2px]'
  return (
    <>
      <div className={shade} style={{ inset: `0 0 auto 0`, height: rect.top }} />
      <div className={shade} style={{ left: 0, top: rect.top, width: rect.left, height: rect.height }} />
      <div className={shade} style={{ left: right, right: 0, top: rect.top, height: rect.height }} />
      <div className={shade} style={{ inset: `${bottom}px 0 0 0` }} />
      <div
        className="pointer-events-auto fixed border border-[#67adff]/80 shadow-[0_0_0_2px_rgba(103,173,255,0.18),0_0_34px_rgba(74,158,255,0.34)]"
        style={rect}
      />
    </>
  )
}

const TutorialSequence = ({
  character_id,
  complete,
  copy,
  id,
  scene,
}: Readonly<{
  character_id: string
  complete: () => void
  copy: AppCopy
  id: TutorialId
  scene: ReturnType<typeof read_scene>
}>) => {
  const [index, set_index] = useState(0)
  const text = copy_text(copy.tutorial)
  const steps = tutorial_steps(id)
  const step = steps[index]!
  const rect = useTutorialTargetRect(step.target, character_id, scene)
  const last = index === steps.length - 1

  useEffect(() => {
    const keydown = (event: Readonly<KeyboardEvent>): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        complete()
        return
      }
      if (event.key === 'Tab' || event.key === 'Enter' || event.key === 'Shift') return
      event.preventDefault()
      event.stopPropagation()
    }
    globalThis.addEventListener('keydown', keydown, { capture: true })
    return () => globalThis.removeEventListener('keydown', keydown, { capture: true })
  }, [complete])

  return (
    <section className="pointer-events-none fixed inset-0 z-[260]" data-tutorial={id}>
      <TutorialShade rect={rect} />
      <article
        aria-labelledby={`tutorial-title-${step.key}`}
        aria-modal="true"
        className="pointer-events-auto fixed max-h-[calc(100vh-32px)] w-[min(380px,calc(100vw-32px))] overflow-y-auto border border-white/10 border-t-[#c8963c] bg-bg/97 p-6 shadow-[0_24px_90px_rgba(0,0,0,0.75)]"
        role="dialog"
        style={card_style(rect)}
      >
        <div className="flex items-start justify-between gap-4">
          <p className="text-[8px] tracking-[0.28em] text-[#c8963c] uppercase">
            {text('progress', { current: index + 1, total: steps.length })}
          </p>
          <button
            aria-label={text('skip')}
            className="flex cursor-pointer items-center gap-1.5 text-[8px] tracking-[0.14em] text-[#777b86] uppercase transition-colors hover:text-[#e8e4dc]"
            onClick={complete}
            type="button"
          >
            {text('skip')} <X size={13} />
          </button>
        </div>
        <h2 className="mt-3 text-lg font-semibold tracking-[0.04em] text-[#e8e4dc]" id={`tutorial-title-${step.key}`}>
          {text(`${step.key}_title`)}
        </h2>
        <p className="mt-4 text-[11px] leading-6 text-[#9da0a9]">{text(`${step.key}_body`)}</p>
        <div className="mt-6 flex items-center justify-between gap-3">
          <button
            className="flex h-9 cursor-pointer items-center gap-2 border border-white/10 px-4 text-[9px] tracking-[0.16em] text-[#8d9099] uppercase hover:border-white/25 hover:text-[#d6d1c8] disabled:cursor-default disabled:opacity-0"
            disabled={index === 0}
            onClick={() => set_index((current) => Math.max(0, current - 1))}
            type="button"
          >
            <ArrowLeft size={12} /> {text('back')}
          </button>
          <button
            autoFocus
            className="flex h-9 cursor-pointer items-center gap-2 border border-[#4a9eff]/55 bg-[#4a9eff]/10 px-5 text-[9px] tracking-[0.16em] text-[#80c2ff] uppercase hover:border-[#80c2ff]"
            onClick={() => (last ? complete() : set_index((current) => current + 1))}
            type="button"
          >
            {id === 'fight' ? text('fight_enter') : last ? text('finish') : text('next')}
            {last ? <Check size={12} /> : <ArrowRight size={12} />}
          </button>
        </div>
      </article>
    </section>
  )
}

const owns_fighter = (
  checkpoint: Readonly<HydratedFightCheckpoint> | null,
  character_id: string | null,
  owner: string | null
): boolean =>
  !!character_id &&
  !!owner &&
  !!checkpoint?.contract.fighters.some(
    (fighter) =>
      fighter.kind.type === 'player' && fighter.kind.character === character_id && fighter.kind.owner === owner
  )

export const TutorialHost = ({ blocked, copy }: Readonly<{ blocked: boolean; copy: AppCopy }>) => {
  const scene = useSyncExternalStore(subscribe_scene, read_scene, () => null)
  const navigation = useAppStore((state) => state.navigation)
  const settings = useAppStore((state) => state.settings)
  const selected_character_id = useAppStore((state) => state.session.selected_character_id)
  const roster_loaded = useAppStore((state) => state.session.roster_loaded)
  const link_status = useAppStore((state) => state.session.link_status)
  const indexing_lag = useAppStore((state) => state.session.indexing_lag)
  const game_frozen = useAppStore((state) => state.session.game_frozen)
  const owner = useAppStore((state) => state.session.wallet?.address ?? null)
  const engine_state = useAppStore((state) => state.engine.state)
  const fight_mounted = useAppStore((state) => state.fight.mounted)
  const checkpoint = useAppStore((state) => state.fight.checkpoint)
  const dungeon_active = useAppStore((state) => selected_dungeon_run(state) !== null)
  const completed = useMemo(
    () => completed_tutorials_from(settings.completed_tutorials),
    [settings.completed_tutorials]
  )
  const player_ready = [
    !blocked,
    !indexing_blocked(link_status, indexing_lag),
    roster_loaded,
    link_status === 'ready',
    game_frozen !== true,
    engine_state === 'ready' || engine_state === 'degraded',
  ].every(Boolean)
  const id = tutorial_id_for(
    {
      page: navigation.page,
      pathname: navigation.pathname,
      dialog_open: navigation.dialog !== null,
      player_ready,
      selected_character_id,
      fight_mounted,
      fight_owned: owns_fighter(checkpoint, selected_character_id, owner),
      world_available: !dungeon_active,
    },
    completed
  )
  if (!id || !selected_character_id) return null
  const complete = (): void =>
    dispatch_app({
      type: 'settings/changed',
      settings: Object.freeze({ ...settings, completed_tutorials: Object.freeze([...completed, id]) }),
    })
  return (
    <TutorialSequence
      character_id={selected_character_id}
      complete={complete}
      copy={copy}
      id={id}
      key={id}
      scene={scene}
    />
  )
}
