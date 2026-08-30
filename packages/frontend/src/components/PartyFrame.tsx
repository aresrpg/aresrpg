// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Crown, Footprints, X } from 'lucide-react'
import type { PartyRow } from '@aresrpg/protocol'
import { client_to_chain_coordinate } from '@aresrpg/immutable'
import { useRef, useSyncExternalStore, type MouseEvent as ReactMouseEvent } from 'react'

import type { AppCopy, CopyText } from '../i18n/copy.ts'
import { copy_text } from '../i18n/copy.ts'
import { selected_party, selected_party_invitation } from '../modules/party.ts'
import { run_to_available, run_to_progress_percent, type RunTo } from '../modules/run_to.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { read_party_follow, subscribe_party_follow } from '../game/core/party_follow_feed.ts'
import type { PartyFollowerView } from '../game/core/party_follow_feed.ts'
import { useWorldPose, type WorldPose } from '../game/core/pose_feed.ts'

import './party_frame.css'

export const party_frame_visible = (party: Readonly<PartyRow> | null, pending: string | null): boolean =>
  party !== null && pending !== 'leave'

export const party_run_available = (owned: readonly Readonly<{ id: string }>[], character_id: string): boolean =>
  !owned.some(({ id }) => id === character_id)

export const party_run_distance = (run: RunTo | null, pose: WorldPose | null, character_id: string): number | null =>
  run?.status === 'running' &&
  run.source === 'character' &&
  run.target_character_id === character_id &&
  pose?.character_id === run.controlled_character_id
    ? Math.hypot(run.x - client_to_chain_coordinate(pose.x), run.z - client_to_chain_coordinate(pose.z))
    : null

const PartyDistanceProgress = ({ distance, running = false }: Readonly<{ distance: number; running?: boolean }>) => {
  const initial = useRef(distance)
  const known = Number.isFinite(distance)
  const distance_percent = running
    ? run_to_progress_percent(initial.current, distance)
    : known
      ? Math.max(0, 100 - (Math.min(distance, 64) / 64) * 100)
      : 0
  const label = known ? `${Math.ceil(distance)}m` : '—'
  return (
    <span className={`party-distance-progress${running ? ' is-running' : ''}`} title={label}>
      <i>
        <em style={{ width: `${distance_percent}%` }} />
      </i>
      <small>{label}</small>
    </span>
  )
}

const PartyMemberIcon = ({
  leader,
  follower,
  text,
}: Readonly<{ leader: boolean; follower: PartyFollowerView | null; text: CopyText }>) => {
  if (leader) return <Crown aria-label={text('leader')} size={11} />
  if (follower) return <Footprints aria-label={text('follow_leader')} size={11} />
  return <span />
}

const PartyMemberControl = ({
  member,
  leader,
  selected,
  following,
  follower,
  run_distance,
  run_key,
  pending,
  text,
}: Readonly<{
  member: PartyRow['members'][number]
  leader: string | null
  selected: string | null
  following: boolean
  follower: PartyFollowerView | null
  run_distance: number | null
  run_key: string | null
  pending: string | null | undefined
  text: CopyText
}>) => {
  const settings = useAppStore((state) => state.settings)
  if (member.character_id === leader && selected === leader)
    return (
      <label className="party-follow-toggle">
        <input
          checked={following}
          onChange={(event) => {
            dispatch_app({
              type: 'settings/changed',
              settings: Object.freeze({ ...settings, follow_leader: event.target.checked }),
            })
          }}
          role="switch"
          type="checkbox"
        />
        <span>{text('follow_leader')}</span>
      </label>
    )
  if (run_distance !== null) return <PartyDistanceProgress distance={run_distance} key={run_key} running />
  if (follower) return <PartyDistanceProgress distance={follower.distance} />
  return selected === leader && member.character_id !== leader ? (
    <button
      aria-label={text('kick')}
      disabled={!!pending}
      onClick={(event) => {
        event.stopPropagation()
        dispatch_app({ type: 'party/kick', character_id: member.character_id })
      }}
      type="button"
    >
      <X size={10} />
    </button>
  ) : null
}

const PartyMemberRow = ({
  member,
  leader,
  selected,
  following,
  follower,
  run_distance,
  run_key,
  pending,
  can_run,
  text,
}: Readonly<{
  member: PartyRow['members'][number]
  leader: string | null
  selected: string | null
  following: boolean
  follower: PartyFollowerView | null
  run_distance: number | null
  run_key: string | null
  pending: string | null | undefined
  can_run: boolean
  text: CopyText
}>) => (
  <div
    className={`party-frame__member${member.character_id === selected ? ' is-selected' : ''}${can_run ? ' can-run' : ''}`}
    onClick={
      can_run
        ? (event: Readonly<ReactMouseEvent<HTMLDivElement>>) =>
            dispatch_app({
              type: 'world/player_menu',
              menu: {
                character_id: member.character_id,
                x: event.clientX,
                y: event.clientY,
                source: 'party',
              },
            })
        : undefined
    }
  >
    <PartyMemberIcon follower={follower} leader={member.character_id === leader} text={text} />
    <b>{member.name || text('adventurer')}</b>
    <PartyMemberControl
      follower={follower}
      following={following}
      leader={leader}
      member={member}
      pending={pending}
      run_distance={run_distance}
      run_key={run_key}
      selected={selected}
      text={text}
    />
  </div>
)

const followed_members = (
  following: boolean,
  followers: readonly PartyFollowerView[]
): ReadonlyMap<string, PartyFollowerView> => new Map((following ? followers : []).map((row) => [row.character_id, row]))

const party_is_following = (party: Readonly<PartyRow> | null, enabled: boolean): boolean => party !== null && enabled

const party_leader = (party: Readonly<PartyRow> | null): string | null =>
  party === null ? null : (party.members[0]?.character_id ?? null)

export const PartyInviteCard = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const text = copy_text(copy.party_panel)
  const invitation = useAppStore(selected_party_invitation)
  const party = useAppStore(selected_party)
  const selected = useAppStore((state) => state.session.selected_character_id)
  const character = useAppStore((state) => state.session.characters.find(({ id }) => id === selected) ?? null)
  const pending = useAppStore((state) => (selected ? state.party.pending_by_character[selected] : null))
  const can_answer = character?.custody === 'kiosk'
  return invitation ? (
    <section className="party-invite-card">
      <span>{text('invited_by', { name: invitation.members[0]?.name ?? text('adventurer') })}</span>
      <button
        className="btn-gold"
        disabled={!!pending || !can_answer || !!party}
        onClick={() => dispatch_app({ type: 'party/accept', party: invitation.id })}
        type="button"
      >
        {text('accept')}
      </button>
      <button
        className="btn-outline"
        disabled={!!pending || !can_answer}
        onClick={() => dispatch_app({ type: 'party/decline', party: invitation.id })}
        type="button"
      >
        {text('decline')}
      </button>
    </section>
  ) : null
}

export const PartyFrame = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const text = copy_text(copy.party_panel)
  const party = useAppStore(selected_party)
  const selected = useAppStore((state) => state.session.selected_character_id)
  const owned = useAppStore((state) => state.session.characters)
  const controlled_can_run = useAppStore(run_to_available)
  const run = useAppStore((state) => state.run_to.run)
  const pose = useWorldPose()
  const follow_leader = useAppStore((state) => state.settings.follow_leader === true)
  const follow = useSyncExternalStore(subscribe_party_follow, read_party_follow, read_party_follow)
  const pending = useAppStore((state) =>
    state.session.selected_character_id ? state.party.pending_by_character[state.session.selected_character_id] : null
  )
  const leader = party_leader(party)
  const following = party_is_following(party, follow_leader)
  const follower_by_id = followed_members(following, follow.followers)
  return party_frame_visible(party, pending) ? (
    <section className="party-frame">
      <header>
        <span>{text('title')}</span>
        <small>{party?.members.length ?? 1}/6</small>
        {party && (
          <button disabled={!!pending} onClick={() => dispatch_app({ type: 'party/leave' })} type="button">
            {party.members.length === 1 ? text('disband') : text('leave')}
          </button>
        )}
      </header>
      {party?.members.map((member) => (
        <PartyMemberRow
          can_run={controlled_can_run && party_run_available(owned, member.character_id)}
          follower={follower_by_id.get(member.character_id) ?? null}
          following={following}
          key={member.character_id}
          leader={leader}
          member={member}
          pending={pending}
          run_distance={party_run_distance(run, pose, member.character_id)}
          run_key={
            run?.status === 'running' && run.source === 'character' && run.target_character_id === member.character_id
              ? `${run.controlled_character_id}:${run.x}:${run.z}`
              : null
          }
          selected={selected}
          text={text}
        />
      ))}
      {party?.invited.map((invited) => (
        <div className="party-frame__member is-invited" key={invited.character_id}>
          <span />
          <b>{invited.name || text('adventurer')}</b>
          {selected === leader && (
            <button
              aria-label={text('rescind')}
              disabled={!!pending}
              onClick={() => dispatch_app({ type: 'party/rescind', character_id: invited.character_id })}
              type="button"
            >
              <X size={10} />
            </button>
          )}
        </div>
      ))}
    </section>
  ) : null
}
