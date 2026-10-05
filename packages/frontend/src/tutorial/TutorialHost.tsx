// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { ArrowLeft, ArrowRight, Check, X } from 'lucide-react'
import { Button, FloatingWindow, IconButton, Panel } from '@aresrpg/ui'
import type { HydratedFightCheckpoint } from '@aresrpg/fight'
import { createPortal } from 'react-dom'
import { useEffect, useMemo, useState, type CSSProperties } from 'react'

import { RUNE_UNLOCK_LEVEL } from '../characters/forge_eligibility.ts'
import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { indexing_blocked } from '../components/IndexingCatchupModal.tsx'
import { selected_dungeon_run } from '../modules/dungeon.ts'
import { dispatch_app, useAppStore } from '../store.ts'

import {
  completed_tutorials_from,
  tutorial_id_for,
  tutorial_steps,
  type TutorialId,
  type TutorialTarget,
} from './tutorial.ts'
import './tutorial.css'
import { CraftFailureNotice } from './CraftFailureNotice.tsx'

type TargetRect = Readonly<{ left: number; top: number; width: number; height: number }>
type Target = Readonly<{ rect: TargetRect | null; host: HTMLElement | null }>
const same_rect = (left: TargetRect | null, right: TargetRect | null): boolean =>
  left === right ||
  (!!left &&
    !!right &&
    ['left', 'top', 'width', 'height'].every(
      (key) => Math.abs(left[key as keyof TargetRect] - right[key as keyof TargetRect]) < 0.5
    ))

const useTutorialTarget = (target: TutorialTarget | null): Target => {
  const [measured, set_measured] = useState<Target>({ rect: null, host: null })
  useEffect(() => {
    let frame = 0
    const sample = () => {
      const element = target && document.querySelector<HTMLElement>(`[data-tutorial-target="${target.name}"]`)
      const box = element?.getBoundingClientRect()
      const rect =
        box && box.width > 0 && box.height > 0
          ? {
              left: Math.max(8, box.left - 4),
              top: Math.max(8, box.top - 4),
              width: Math.max(0, Math.min(box.right + 4, innerWidth - 8) - Math.max(8, box.left - 4)),
              height: Math.max(0, Math.min(box.bottom + 4, innerHeight - 8) - Math.max(8, box.top - 4)),
            }
          : null
      const host = target && !rect ? null : (element?.closest('dialog') ?? document.body)
      set_measured((current) => (current.host === host && same_rect(current.rect, rect) ? current : { rect, host }))
      frame = requestAnimationFrame(sample)
    }
    sample()
    return () => cancelAnimationFrame(frame)
  }, [target])
  return measured
}

const card_style = (rect: TargetRect | null): CSSProperties => {
  const width = Math.min(320, innerWidth - 24),
    height = 210,
    gap = 12
  if (!rect) return { left: 12, bottom: 12 }
  const top = Math.max(12, Math.min(rect.top, innerHeight - height - 12))
  if (innerWidth - rect.left - rect.width >= width + gap) return { left: rect.left + rect.width + gap, top }
  if (rect.left >= width + gap) return { left: rect.left - width - gap, top }
  return {
    left: Math.max(12, Math.min(rect.left, innerWidth - width - 12)),
    top:
      rect.top > height + gap
        ? rect.top - height - gap
        : Math.min(rect.top + rect.height + gap, innerHeight - height - 12),
  }
}

export const TutorialSequence = ({
  complete,
  copy,
  id,
  index,
  select_step,
}: Readonly<{
  complete: () => void
  copy: AppCopy
  id: TutorialId
  index: number
  select_step: (index: number) => void
}>) => {
  const text = copy_text(copy.tutorial)
  const steps = tutorial_steps(id),
    step = steps[index]!
  const { rect, host } = useTutorialTarget(step.target)
  const last = index === steps.length - 1
  if (!host) return null
  return createPortal(
    <FloatingWindow blocking={false} identity={`tutorial:${id}`} label={text(`${step.key}_title`)} close={complete}>
      {rect && <div className="tutorial-focus" style={rect} aria-hidden="true" />}
      <Panel className="tutorial-tip" data-tutorial={id} style={card_style(rect)}>
        <header>
          <span>{text('progress', { current: index + 1, total: steps.length })}</span>
          <IconButton label={text('skip')} onClick={complete} icon={<X size={14} />} />
        </header>
        <h2>{text(`${step.key}_title`)}</h2>
        <p>{text(`${step.key}_body`, { level: RUNE_UNLOCK_LEVEL })}</p>
        <footer>
          <Button disabled={index === 0} onClick={() => select_step(index - 1)}>
            <ArrowLeft size={13} /> {text('back')}
          </Button>
          <Button tone="primary" onClick={() => (last ? complete() : select_step(index + 1))}>
            {last ? text('finish') : text('next')}
            {last ? <Check size={13} /> : <ArrowRight size={13} />}
          </Button>
        </footer>
      </Panel>
    </FloatingWindow>,
    host
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
  const navigation = useAppStore((state) => state.navigation)
  const settings = useAppStore((state) => state.settings)
  const [progress, set_progress] = useState<Partial<Record<TutorialId, number>>>({})
  useEffect(() => {
    // Settings keeps this array when editing ordinary preferences; replacing it with an
    // empty list is the existing explicit tutorial reset, including an unfinished tour.
    if (settings.completed_tutorials?.length === 0) set_progress({})
  }, [settings.completed_tutorials])
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
      dialog: navigation.dialog,
      player_ready,
      selected_character_id,
      fight_mounted,
      fight_owned: owns_fighter(checkpoint, selected_character_id, owner),
      world_available: !dungeon_active,
    },
    completed
  )
  const complete = (id: TutorialId): void =>
    dispatch_app({
      type: 'settings/changed',
      settings: Object.freeze({ ...settings, completed_tutorials: Object.freeze([...completed, id]) }),
    })
  const available = [player_ready, !!selected_character_id, !fight_mounted].every(Boolean)
  return (
    <>
      {id && selected_character_id && (
        <TutorialSequence
          complete={() => complete(id)}
          copy={copy}
          id={id}
          key={id}
          index={progress[id] ?? 0}
          select_step={(index) => set_progress((current) => ({ ...current, [id]: index }))}
        />
      )}
      {owner && (
        <CraftFailureNotice
          key={owner}
          copy={copy}
          completed={completed.includes('craft_failure')}
          complete={() => complete('craft_failure')}
          available={available}
        />
      )}
    </>
  )
}
