// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Crown, Footprints, X } from 'lucide-react'
import type { PartyRow } from '@aresrpg/protocol'
import { useRef, useSyncExternalStore, type MouseEvent as ReactMouseEvent } from 'react'

import { useText } from '../i18n/useText.ts'
import type { AppCopy, CopyText } from '../i18n/copy.ts'
import { copy_text } from '../i18n/copy.ts'
import { selected_party, selected_party_invitation } from '../modules/party.ts'
import { run_to_available, run_to_distance, run_to_progress_percent, type RunTo } from '../modules/run_to.ts'
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
    ? (run_to_distance(run, pose) ?? Infinity)
    : null

const PartyDistanceProgress = ({ distance, running = false }: Readonly<{ distance: number; running?: boolean }>) => {
  const initial = useRef(distance)
  const ui = useText()
  const known = Number.isFinite(distance)
  if (known && !Number.isFinite(initial.current)) {
    // eslint-disable-next-line functional/immutable-data -- retain the first known length for this keyed route.
    initial.current = distance
  }
  const distance_percent = !known
    ? 0
    : running
      ? run_to_progress_percent(initial.current, distance)
      : Math.max(0, 100 - (Math.min(distance, 64) / 64) * 100)
  const label = known ? ui('ui.meters', { count: Math.ceil(distance) }) : '—'
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
  on_follow,
  on_kick,
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
  on_follow: (enabled: boolean) => void
  on_kick: ((id: string) => void) | null
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
  if (member.character_id === leader && selected === leader)
    return (
      <label className="party-follow-toggle">
        <input
          checked={following}
          onChange={(event) => on_follow(event.target.checked)}
          role="switch"
          type="checkbox"
        />
        <span>{text('follow_leader')}</span>
      </label>
    )
  if (run_distance !== null) return <PartyDistanceProgress distance={run_distance} key={run_key} running />
  if (follower) return <PartyDistanceProgress distance={follower.distance} />
  return on_kick && selected === leader && member.character_id !== leader ? (
    <button
      aria-label={text('kick')}
      disabled={!!pending}
      onClick={(event) => {
        event.stopPropagation()
        on_kick(member.character_id)
      }}
      type="button"
    >
      <X size={10} />
    </button>
  ) : null
}

const PartyMemberRow = ({
  on_follow,
  on_kick,
  on_select,
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
  on_follow: (enabled: boolean) => void
  on_kick: ((id: string) => void) | null
  on_select: ((id: string) => void) | null
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
      on_select
        ? () => on_select(member.character_id)
        : can_run
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
      on_follow={on_follow}
      on_kick={on_kick}
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

export type PartyFrameSource = Readonly<{
  party: PartyRow
  selected: string | null
  following: boolean
  follow: (enabled: boolean) => void
  select: (id: string) => void
}>

type PartyFrameViewProps = Readonly<{
  copy: AppCopy
  party: PartyRow
  selected: string | null
  following: boolean
  follow: (enabled: boolean) => void
  select: ((id: string) => void) | null
  leave: (() => void) | null
  kick: ((id: string) => void) | null
  pending: string | null | undefined
  rows: readonly Readonly<{
    member: PartyRow['members'][number]
    follower: PartyFollowerView | null
    run_distance: number | null
    run_key: string | null
    can_run: boolean
  }>[]
}>

const PartyFrameView = ({
  copy,
  party,
  selected,
  following,
  follow,
  select,
  leave,
  kick,
  pending,
  rows,
}: PartyFrameViewProps) => {
  const text = copy_text(copy.party_panel)
  const leader = party_leader(party)
  return (
    <section className="party-frame">
      <header>
        <span>{text('title')}</span>
        <small>{party.members.length}/6</small>
        {leave && (
          <button disabled={!!pending} onClick={leave} type="button">
            {text(party.members.length === 1 ? 'disband' : 'leave')}
          </button>
        )}
      </header>
      {rows.map((row) => (
        <PartyMemberRow
          {...row}
          key={row.member.character_id}
          leader={leader}
          selected={selected}
          following={following}
          pending={pending}
          text={text}
          on_follow={follow}
          on_kick={kick}
          on_select={select}
        />
      ))}
      {party.invited.map((invited) => (
        <div className="party-frame__member is-invited" key={invited.character_id}>
          <span />
          <b>{invited.name || text('adventurer')}</b>
          {selected === leader && (
            <button
              aria-label={text('rescind')}
              disabled={!!pending}
              type="button"
              onClick={() => dispatch_app({ type: 'party/rescind', character_id: invited.character_id })}
            >
              <X size={10} />
            </button>
          )}
        </div>
      ))}
    </section>
  )
}

const LivePartyFrame = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const party = useAppStore(selected_party)
  const selected = useAppStore((state) => state.session.selected_character_id)
  const owned = useAppStore((state) => state.session.characters)
  const controlled_can_run = useAppStore(run_to_available)
  const run = useAppStore((state) => state.run_to.run)
  const pose = useWorldPose()
  const settings = useAppStore((state) => state.settings)
  const follow = useSyncExternalStore(subscribe_party_follow, read_party_follow, read_party_follow)
  const pending = useAppStore((state) => (selected ? state.party.pending_by_character[selected] : null))
  const following = party_is_following(party, settings.follow_leader === true)
  const follower_by_id = followed_members(following, follow.followers)
  if (!party_frame_visible(party, pending ?? null) || !party) return null
  const rows = party.members.map((member) => ({
    member,
    can_run: controlled_can_run && party_run_available(owned, member.character_id),
    follower: follower_by_id.get(member.character_id) ?? null,
    run_distance: party_run_distance(run, pose, member.character_id),
    run_key: run?.status === 'running' ? `${run.controlled_character_id}:${run.x}:${run.z}` : null,
  }))
  return (
    <PartyFrameView
      copy={copy}
      party={party}
      selected={selected}
      following={following}
      pending={pending}
      rows={rows}
      follow={(enabled) =>
        dispatch_app({ type: 'settings/changed', settings: { ...settings, follow_leader: enabled } })
      }
      select={null}
      kick={(character_id) => dispatch_app({ type: 'party/kick', character_id })}
      leave={() => dispatch_app({ type: 'party/leave' })}
    />
  )
}

export const PartyFrame = ({ copy, source }: Readonly<{ copy: AppCopy; source?: PartyFrameSource }>) =>
  source ? (
    <PartyFrameView
      copy={copy}
      {...source}
      pending={null}
      leave={null}
      kick={null}
      rows={source.party.members.map((member) => ({
        member,
        can_run: false,
        follower: null,
        run_distance: null,
        run_key: null,
      }))}
    />
  ) : (
    <LivePartyFrame copy={copy} />
  )
