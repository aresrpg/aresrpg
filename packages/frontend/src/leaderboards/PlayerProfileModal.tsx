// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useState } from 'react'
import { GameWindow, IconButton, NativeModal } from '@aresrpg/ui'
import { Check, Copy, Info } from 'lucide-react'

import { InventoryItemCell } from '../characters/InventoryItemCell.tsx'
import { copy_text } from '../i18n/copy.ts'
import { dispatch_app, useSiteStore } from '../store.ts'

import { AgentBadge } from './AgentBadge.tsx'
import { is_agent_entry, player_name } from './presentation.ts'
import '../characters/characters.css'

/** A section's caption: its name in small caps, its count in brass. */
const HEADING =
  'mb-3 flex items-center gap-2 text-[12px] font-medium tracking-[0.08em] text-soft uppercase [&>span]:text-gold [&>span]:tabular-nums'
const NOTE = 'text-[13px] text-soft'
const PAGE = 'min-h-11 cursor-pointer text-[12px] disabled:cursor-default disabled:opacity-40'

const ProfileRoster = () => {
  const copy = useSiteStore((state) => state.copy)
  const { inspection } = useSiteStore((state) => state.leaderboards)
  if (!copy || !inspection.profile) return null
  const { profile, selected, cursors } = inspection
  const text = copy_text(copy.leaderboard_page)
  const character_text = copy_text(copy.characters_page)
  return (
    <section>
      <h2 className={HEADING}>
        {copy.characters} <span>{profile.character_count}</span>
      </h2>
      <div className="grid max-h-80 gap-2 overflow-y-auto">
        {profile.characters.map((character) => (
          <button
            type="button"
            key={character.id}
            className="flex min-h-16 cursor-pointer flex-col items-start gap-[5px] border border-l-3 border-steel/[33.3%] border-l-transparent px-3.5 py-3 text-left aria-pressed:border-l-gold aria-pressed:bg-peak/[26.7%]"
            aria-pressed={selected === character.id}
            onClick={() => dispatch_app({ type: 'leaderboards/inspect_character', character_id: character.id })}
          >
            <strong className="text-[15px] wrap-anywhere">{character.name}</strong>
            <span className="text-[12px] text-soft">
              {character.classe} · {character_text('level', { level: character.level })}
            </span>
          </button>
        ))}
      </div>
      {(cursors.length > 1 || profile.next) && (
        <div className="mt-2 flex justify-between gap-3">
          <button
            className={PAGE}
            type="button"
            disabled={cursors.length < 2}
            onClick={() => dispatch_app({ type: 'leaderboards/inspect_page', direction: 'previous' })}
          >
            {text('profile_previous')}
          </button>
          <button
            className={PAGE}
            type="button"
            disabled={!profile.next}
            onClick={() => dispatch_app({ type: 'leaderboards/inspect_page', direction: 'next' })}
          >
            {text('profile_next')}
          </button>
        </div>
      )}
    </section>
  )
}

const ProfileEquipment = () => {
  const copy = useSiteStore((state) => state.copy)
  const { equipment, profile, status, selected } = useSiteStore((state) => state.leaderboards).inspection
  if (!copy) return null
  const text = copy_text(copy.leaderboard_page)
  const notices = {
    loading: 'loading',
    error: 'profile_unavailable',
    missing: 'profile_missing',
    ready: profile?.character_count ? 'profile_select' : 'profile_empty',
  }
  return (
    <section>
      <h2 className={HEADING}>
        {copy_text(copy.characters_page)('equipment_head')} <span>{equipment?.length}</span>
      </h2>
      {equipment ? (
        <>
          <div className="grid auto-rows-[48px] grid-cols-[repeat(auto-fill,48px)] gap-2">
            {equipment.map((item) => (
              <InventoryItemCell key={`${selected}:${item.id}`} item={item} show_level />
            ))}
          </div>
          {equipment.length === 0 && <p className={NOTE}>{copy_text(copy.characters_page)('no_gear_equipped')}</p>}
        </>
      ) : (
        <p className={NOTE} role={status === 'error' ? 'alert' : 'status'}>
          {text(notices[status])}
        </p>
      )}
    </section>
  )
}

const ProfileJobs = () => {
  const copy = useSiteStore((state) => state.copy)
  const { profile } = useSiteStore((state) => state.leaderboards).inspection
  if (!copy || !profile?.jobs.length) return null
  const text = copy_text(copy.leaderboard_page)
  return (
    <section className="mt-6 border-t border-steel/40 pt-4.5">
      <h2 className={HEADING}>
        {copy_text(copy.characters_page)('tab_jobs')}{' '}
        <Info size={14} aria-label={text('profile_jobs')}>
          <title>{text('profile_jobs')}</title>
        </Info>
      </h2>
      <dl className="grid grid-cols-3 gap-x-7 gap-y-3 @max-[480px]:grid-cols-2">
        {profile.jobs.map(({ job, level }) => (
          <div className="flex min-w-0 justify-between gap-3 text-[13px]" key={job}>
            <dt className="wrap-anywhere">{text(`job_${job}`)}</dt>
            <dd className="text-gold tabular-nums">{level}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/** The live modal and isolated workshop render the same window and inspection state. */
export const PlayerProfileWindow = () => {
  const copy = useSiteStore((state) => state.copy)
  const { inspection } = useSiteStore((state) => state.leaderboards)
  const [copied, set_copied] = useState(false)
  if (!copy || !inspection.target) return null
  const { target } = inspection
  const text = copy_text(copy.leaderboard_page)
  const copy_address = (): void => {
    void navigator.clipboard
      .writeText(target.address)
      .then(() => set_copied(true))
      .catch((error: unknown) => console.error('Profile address copy failed', error))
  }
  return (
    <GameWindow
      title={player_name(target)}
      icon={is_agent_entry(target) ? <AgentBadge /> : undefined}
      className="w-[min(820px,100%)] max-h-[calc(100cqh-24px)] text-text [&_.aui-window-header]:justify-start [&_.aui-window-header]:pr-25 [&_.aui-window-header]:pl-5 [&_.aui-window-meta]:right-10 [&_.aui-window-meta]:bottom-[5px] [&_.aui-window-meta]:left-auto [&_.aui-window-meta]:flex [&_.aui-window-meta]:gap-1"
      aria-label={text('profile_title')}
      close={() => dispatch_app({ type: 'leaderboards/inspect_close' })}
      close_label={copy.wallet_close}
      meta={
        <IconButton
          icon={copied ? <Check /> : <Copy />}
          label={copy.wallet_copy_address}
          title={target.address}
          onClick={copy_address}
        />
      }
    >
      <div className="@container min-h-0 overflow-y-auto p-5.5">
        <div className="grid grid-cols-[minmax(170px,0.8fr)_minmax(0,1.5fr)] items-start gap-6 @max-[480px]:grid-cols-1 @max-[480px]:gap-5">
          <ProfileRoster />
          <ProfileEquipment />
        </div>
        <ProfileJobs />
      </div>
    </GameWindow>
  )
}

export const PlayerProfileModal = () => {
  const copy = useSiteStore((state) => state.copy)
  const { target } = useSiteStore((state) => state.leaderboards).inspection
  if (!copy || !target) return null
  return (
    <NativeModal
      label={copy_text(copy.leaderboard_page)('profile_title')}
      className="aui-modal-scrim"
      close={() => dispatch_app({ type: 'leaderboards/inspect_close' })}
    >
      <PlayerProfileWindow key={target.address} />
    </NativeModal>
  )
}
