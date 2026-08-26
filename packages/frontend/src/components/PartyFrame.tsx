// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Crown, Plus, X } from 'lucide-react'
import type { PartyRow } from '@aresrpg/protocol'
import { useMemo } from 'react'

import type { AppCopy } from '../i18n/copy.ts'
import { copy_text } from '../i18n/copy.ts'
import { owned_party_invite_view, selected_party, selected_party_invitation } from '../modules/party.ts'
import { dispatch_app, useAppStore } from '../store.ts'

import './party_frame.css'

export const party_frame_visible = (party: Readonly<PartyRow> | null, pending: string | null): boolean =>
  party !== null && pending !== 'leave'

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
  const characters = useAppStore((state) => state.session.characters)
  const memberships = useAppStore((state) => state.party.party_by_character)
  const pending = useAppStore((state) =>
    state.session.selected_character_id ? state.party.pending_by_character[state.session.selected_character_id] : null
  )
  const own_invites = useMemo(
    () => owned_party_invite_view(characters, selected, memberships, party),
    [characters, memberships, party, selected]
  )
  const { candidates: owned_candidates, enabled: can_invite_owned, leader } = own_invites
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
        <div
          className={`party-frame__member${member.character_id === selected ? ' is-selected' : ''}`}
          key={member.character_id}
        >
          {member.character_id === leader ? <Crown aria-label={text('leader')} size={11} /> : <span />}
          <b>{member.name || text('adventurer')}</b>
          {selected === leader && member.character_id !== leader && (
            <button
              aria-label={text('kick')}
              disabled={!!pending}
              onClick={() => dispatch_app({ type: 'party/kick', character_id: member.character_id })}
              type="button"
            >
              <X size={10} />
            </button>
          )}
        </div>
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
      {can_invite_owned &&
        owned_candidates.map((character) => (
          <div className="party-frame__member is-invited" key={character.id}>
            <span />
            <b>{character.name || text('adventurer')}</b>
            <button
              aria-label={text('invite_owned')}
              disabled={!!pending}
              onClick={() => dispatch_app({ type: 'party/invite_owned', character_id: character.id })}
              type="button"
            >
              <Plus size={10} />
            </button>
          </div>
        ))}
    </section>
  ) : null
}
