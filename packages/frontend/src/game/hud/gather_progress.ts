// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { gather_time_ms, job_level_from_xp } from '@aresrpg/immutable'

import { gathering_resources } from '../../modules/automation_route.ts'
import { selected_gathering } from '../../modules/world_gather.ts'
import { selected_character } from '../../modules/session.ts'
import type { PendingGather } from '../../modules/world.ts'
import type { AppState } from '../../store.ts'
import { resource_at } from '../gather_target.ts'

export const gather_progress = (
  gathering: Readonly<PendingGather>,
  now_ms: number
): Readonly<{ percent: number; remaining_seconds: number }> => {
  const span = Math.max(1, gathering.ends_at_ms - gathering.started_at_ms)
  const elapsed = Math.max(0, Math.min(span, now_ms - gathering.started_at_ms))
  return Object.freeze({
    percent: Math.round((elapsed * 100) / span),
    remaining_seconds: Math.ceil(Math.max(0, gathering.ends_at_ms - now_ms) / 1_000),
  })
}

export const gather_progress_view = (state: AppState, now_ms: number) => {
  const gathering = selected_gathering(state)
  if (gathering?.ambushed) return null
  const current = gathering ? gather_progress(gathering, now_ms) : { percent: 0, remaining_seconds: 0 }
  const { run } = state.automation
  if (run?.scope.type !== 'pack')
    return gathering ? { ...current, item_type: gathering.item_type, collect_all: false, completed: 0, total: 1 } : null
  const resource = gathering_resources(run.world).find(({ item_type }) => item_type === run.item_type)
  const character = selected_character(state.session)!
  const duration_ms = gather_time_ms(job_level_from_xp(Number(character.jobs[resource!.job] ?? 0)))
  const remaining = resource_at(run.scope.target.node!, state)?.pack.nodes ?? 0
  const nodes = gathering && run.step.type === 'gathering' ? run.step.nodes_before : remaining
  const completed = Math.max(0, run.scope.nodes - nodes)
  return {
    item_type: run.item_type,
    collect_all: true,
    completed,
    total: run.scope.nodes,
    percent: Math.min(100, Math.floor(((completed + current.percent / 100) * 100) / run.scope.nodes)),
    remaining_seconds:
      current.remaining_seconds + Math.ceil((Math.max(0, nodes - Number(gathering !== null)) * duration_ms) / 1_000),
  }
}
