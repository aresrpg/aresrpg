// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useState } from 'react'
import { GameWindow, IconButton, NativeModal } from '@aresrpg/ui'
import { Check, Copy, Info } from 'lucide-react'

import { InventoryItemCell } from '../characters/InventoryItemCell.tsx'
import { copy_text } from '../i18n/copy.ts'
import { useAppStore } from '../store.ts'

import { useLeaderboardDispatch, useLeaderboardState } from './LeaderboardSource.tsx'
import { player_name } from './presentation.ts'
import '../characters/characters.css'
import './player_profile.css'

const ProfileRoster = () => {
  const copy = useAppStore((state) => state.copy)
  const { inspection } = useLeaderboardState()
  const dispatch = useLeaderboardDispatch()
  if (!copy || !inspection.profile) return null
  const { profile, selected, cursors } = inspection
  const text = copy_text(copy.leaderboard_page)
  const character_text = copy_text(copy.characters_page)
  return (
    <section className="player-profile-roster">
      <h2>
        {copy.characters} <span>{profile.character_count}</span>
      </h2>
      <div className="player-profile-characters">
        {profile.characters.map((character) => (
          <button
            type="button"
            key={character.id}
            className="player-profile-character"
            aria-pressed={selected === character.id}
            onClick={() => dispatch({ type: 'leaderboards/inspect_character', character_id: character.id })}
          >
            <strong>{character.name}</strong>
            <span>
              {character.classe} · {character_text('level', { level: character.level })}
            </span>
          </button>
        ))}
      </div>
      {(cursors.length > 1 || profile.next) && (
        <div className="player-profile-pagination">
          <button
            type="button"
            disabled={cursors.length < 2}
            onClick={() => dispatch({ type: 'leaderboards/inspect_page', direction: 'previous' })}
          >
            {text('profile_previous')}
          </button>
          <button
            type="button"
            disabled={!profile.next}
            onClick={() => dispatch({ type: 'leaderboards/inspect_page', direction: 'next' })}
          >
            {text('profile_next')}
          </button>
        </div>
      )}
    </section>
  )
}

const ProfileEquipment = () => {
  const copy = useAppStore((state) => state.copy)
  const { equipment, profile, status, selected } = useLeaderboardState().inspection
  if (!copy) return null
  const text = copy_text(copy.leaderboard_page)
  const notices = {
    loading: 'loading',
    error: 'profile_unavailable',
    missing: 'profile_missing',
    ready: profile?.character_count ? 'profile_select' : 'profile_empty',
  }
  return (
    <section className="player-profile-equipment">
      <h2>
        {copy_text(copy.characters_page)('equipment_head')} <span>{equipment?.length}</span>
      </h2>
      {equipment ? (
        <>
          <div className="player-profile-items">
            {equipment.map((item) => (
              <InventoryItemCell key={`${selected}:${item.id}`} item={item} show_level />
            ))}
          </div>
          {equipment.length === 0 && (
            <p className="player-profile-empty">{copy_text(copy.characters_page)('no_gear_equipped')}</p>
          )}
        </>
      ) : (
        <p className="player-profile-empty" role={status === 'error' ? 'alert' : 'status'}>
          {text(notices[status])}
        </p>
      )}
    </section>
  )
}

const ProfileJobs = () => {
  const copy = useAppStore((state) => state.copy)
  const { profile } = useLeaderboardState().inspection
  if (!copy || !profile?.jobs.length) return null
  const text = copy_text(copy.leaderboard_page)
  return (
    <section className="player-profile-jobs">
      <h2>
        {copy_text(copy.characters_page)('tab_jobs')}{' '}
        <Info size={14} aria-label={text('profile_jobs')}>
          <title>{text('profile_jobs')}</title>
        </Info>
      </h2>
      <dl>
        {profile.jobs.map(({ job, level }) => (
          <div key={job}>
            <dt>{text(`job_${job}`)}</dt>
            <dd>{level}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/** The live modal and isolated workshop render the same window and inspection state. */
export const PlayerProfileWindow = () => {
  const copy = useAppStore((state) => state.copy)
  const { inspection } = useLeaderboardState()
  const dispatch = useLeaderboardDispatch()
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
      className="player-profile-window"
      aria-label={text('profile_title')}
      close={() => dispatch({ type: 'leaderboards/inspect_close' })}
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
      <div className="player-profile-body">
        <div className="player-profile-main">
          <ProfileRoster />
          <ProfileEquipment />
        </div>
        <ProfileJobs />
      </div>
    </GameWindow>
  )
}

export const PlayerProfileModal = () => {
  const copy = useAppStore((state) => state.copy)
  const { target } = useLeaderboardState().inspection
  const dispatch = useLeaderboardDispatch()
  if (!copy || !target) return null
  return (
    <NativeModal
      label={copy_text(copy.leaderboard_page)('profile_title')}
      className="aui-modal-scrim"
      close={() => dispatch({ type: 'leaderboards/inspect_close' })}
    >
      <PlayerProfileWindow key={target.address} />
    </NativeModal>
  )
}
