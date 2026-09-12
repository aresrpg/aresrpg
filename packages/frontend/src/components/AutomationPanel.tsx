// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Pickaxe } from 'lucide-react'
import { createPortal } from 'react-dom'
import type { CharacterRow } from '@aresrpg/protocol'

import { content_catalog, type WorldResource } from '../content/catalog.ts'
import { gather_gate } from '../game/gather_gate.ts'
import { copy_text, type AppCopy, type CopyText } from '../i18n/copy.ts'
import { gathering_resources } from '../modules/automation_route.ts'
import { automation_available, automation_resource_gate } from '../modules/automation_step.ts'
import { selected_character } from '../modules/session.ts'
import { dispatch_app, useAppStore, type AppState } from '../store.ts'

import { HudPanel } from './ui/HudPanel.tsx'

const ResourceOption = ({
  resource,
  character,
  text,
}: Readonly<{ resource: WorldResource; character: CharacterRow; text: CopyText }>) => {
  const gate = gather_gate(character, resource)
  const requirement = gate.ok ? '' : text(gate.reason, gate.reason === 'level' ? { level: gate.level } : {})
  const name = content_catalog.item(resource.item_type)?.item.name ?? resource.item_type
  return (
    <option value={resource.item_type} disabled={!gate.ok}>
      {name}
      {requirement ? ` · ${requirement}` : ''}
    </option>
  )
}

const stop_gathering = (): void => dispatch_app({ type: 'automation/stop', reason: 'stopped' })
const start_gathering = (): void => dispatch_app({ type: 'automation/start', id: crypto.randomUUID() })

const activity_text = (state: AppState): string => {
  const { run, reason } = state.automation
  if (!run) return reason ?? 'idle'
  if (!automation_available(state)) return 'unavailable'
  return run.step.type === 'gathering' && run.step.fight ? 'protector' : run.step.type
}

const GatheringControls = ({
  state,
  character,
  copy,
}: Readonly<{ state: AppState; character: CharacterRow; copy: AppCopy }>) => {
  const { item_type, quantity, run } = state.automation
  const text = copy_text(copy.automation_panel)
  const resources = gathering_resources(character.world ?? null)
  const running = run !== null
  const enabled = running || [automation_available(state), automation_resource_gate(state)].every(Boolean)
  return (
    <HudPanel className="pointer-events-auto w-56 overflow-hidden !rounded-[9px]" data-automation-panel="">
      <div className="flex items-center gap-2 border-b border-white/8 px-3 py-2 text-[9px] tracking-[0.18em] text-cyan-200 uppercase">
        <Pickaxe size={13} aria-hidden="true" />
        {text('title')}
      </div>
      <div className="space-y-2 p-3">
        <label className="block text-[8px] tracking-widest text-white/55 uppercase" htmlFor="automation-resource">
          {text('gathering')}
        </label>
        <select
          id="automation-resource"
          value={item_type}
          disabled={running}
          className="w-full rounded-sm border border-white/15 bg-[#171226] px-2 py-2 text-[10px] text-white disabled:opacity-60"
          onChange={(event) => dispatch_app({ type: 'automation/resource', item_type: event.target.value })}
        >
          <option value="">{text('select_resource')}</option>
          {resources.map((resource) => (
            <ResourceOption key={resource.item_type} resource={resource} character={character} text={text} />
          ))}
        </select>
        <div className="text-[9px] leading-4 text-white/60" role="status">
          {text(activity_text(state))}
        </div>
        <div className="text-[9px] text-[#c8963c]">{text('quantity', { quantity })}</div>
        <button
          type="button"
          className="w-full cursor-pointer border border-cyan-200/25 bg-cyan-200/8 px-3 py-2 text-[9px] tracking-widest text-cyan-100 uppercase disabled:cursor-default disabled:opacity-35"
          disabled={!enabled}
          onClick={run ? stop_gathering : start_gathering}
        >
          {text(run ? 'stop' : 'start')}
        </button>
      </div>
    </HudPanel>
  )
}

export const AutomationPanel = ({ copy, enabled }: Readonly<{ copy: AppCopy; enabled: boolean }>) => {
  const state = useAppStore((value) => value)
  const character = selected_character(state.session)
  if (!enabled || !state.automation.unlocked || !character) return null
  const panel = <GatheringControls state={state} character={character} copy={copy} />
  if (state.navigation.page === 'world') return panel
  return state.automation.run
    ? createPortal(<div className="fixed right-4 bottom-4 z-[150] font-mono">{panel}</div>, document.body)
    : null
}
