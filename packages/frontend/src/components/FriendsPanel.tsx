// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Plus, UserRoundPlus, UsersRound, X } from 'lucide-react'
import { useMemo, useState } from 'react'

import type { AppCopy } from '../i18n/copy.ts'
import { copy_text } from '../i18n/copy.ts'
import { friend_name } from '../modules/friends.ts'
import { owned_party_invite_view, selected_party } from '../modules/party.ts'
import { dispatch_app, useAppStore } from '../store.ts'

import { ModalFrame } from './ModalFrame.tsx'
import { PartyInviteCard } from './PartyFrame.tsx'
import { HudPanel } from './ui/HudPanel.tsx'
import './friends_panel.css'

export const FriendsPanel = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const text = copy_text(copy.friends_panel)
  const rows = useAppStore((state) => state.friends.rows)
  const pending = useAppStore((state) => state.friends.pending)
  const players = useAppStore((state) => state.world.players)
  const selected_character_id = useAppStore((state) => state.session.selected_character_id)
  const characters = useAppStore((state) => state.session.characters)
  const memberships = useAppStore((state) => state.party.party_by_character)
  const party = useAppStore(selected_party)
  const party_pending = useAppStore((state) =>
    state.session.selected_character_id ? state.party.pending_by_character[state.session.selected_character_id] : null
  )
  const [open, set_open] = useState(false)
  const [target, set_target] = useState('')
  const [removing, set_removing] = useState<string | null>(null)
  const own_party_invites = useMemo(
    () => owned_party_invite_view(characters, selected_character_id, memberships, party),
    [characters, memberships, party, selected_character_id]
  )
  const observed = new Set(Object.values(players).map(({ owner }) => owner.toLowerCase()))
  const ordered = [...rows].sort(
    (a, b) => Number(observed.has(b.address.toLowerCase())) - Number(observed.has(a.address.toLowerCase()))
  )
  const add = (): void => {
    const value = target.trim()
    if (!value || pending) return
    set_target('')
    dispatch_app({ type: 'friends/add', target: value })
  }

  return (
    <>
      <HudPanel className="pointer-events-auto overflow-hidden !rounded-[9px]">
        <button
          className="flex min-w-44 cursor-pointer items-center gap-2.5 px-3 py-2 text-left hover:bg-white/5"
          data-friends-card=""
          onClick={() => set_open(true)}
          type="button"
        >
          <UsersRound className="text-[#67adff]" size={14} />
          <span className="flex-1 text-[8px] font-semibold tracking-[0.18em] text-[#d6d1c8] uppercase">
            {text('title')}
          </span>
          <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[8px] text-[#8d9099]">
            {rows.length}
          </span>
        </button>
      </HudPanel>
      <PartyInviteCard copy={copy} />

      {open && (
        <ModalFrame
          close={() => set_open(false)}
          close_label={text('cancel')}
          label={text('title')}
          max_width="max-w-2xl"
          soft
        >
          <section className="friends-manager">
            <header>
              <UsersRound size={18} />
              <div>
                <h2>{text('title')}</h2>
                <p>{rows.length}</p>
              </div>
            </header>
            <div className="friends-manager__add">
              <UserRoundPlus size={15} />
              <input
                autoFocus
                onChange={(event) => set_target(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && add()}
                placeholder={text('placeholder')}
                value={target}
              />
              <button disabled={!target.trim() || !!pending} onClick={add} type="button">
                <Plus size={13} /> {text('add')}
              </button>
            </div>
            <div className="friends-manager__rows">
              {ordered.map((row) => {
                const seen = observed.has(row.address.toLowerCase())
                const observed_character = Object.values(players).find(
                  ({ owner }) => owner.toLowerCase() === row.address.toLowerCase()
                )
                return (
                  <article className={seen ? '' : 'is-unseen'} key={row.address}>
                    <i title={seen ? text('observed') : text('unseen')} />
                    <div>
                      <strong>{observed_character?.name ?? friend_name(row)}</strong>
                      <span>{row.characters.join(' · ') || row.address}</span>
                    </div>
                    <button aria-label={text('remove')} onClick={() => set_removing(row.address)} type="button">
                      <X size={13} />
                    </button>
                  </article>
                )
              })}
              {ordered.length === 0 && <p>{text('empty')}</p>}
            </div>
            {own_party_invites.enabled && own_party_invites.candidates.length > 0 && (
              <div className="friends-manager__owned">
                <h3>{copy.party_panel.invite_owned}</h3>
                {own_party_invites.candidates.map((character) => (
                  <button
                    disabled={!!party_pending || !selected_character_id}
                    key={character.id}
                    onClick={() =>
                      dispatch_app({ type: 'party/invite', character_id: character.id, name: character.name })
                    }
                    type="button"
                  >
                    <span>{character.name}</span>
                    <Plus size={12} />
                  </button>
                ))}
              </div>
            )}
          </section>
        </ModalFrame>
      )}

      {removing && (
        <ModalFrame close={() => set_removing(null)} close_label={text('cancel')} label={text('remove_title')} soft>
          <div className="friends-panel__confirm">
            <h2>{text('remove_title')}</h2>
            <p>
              {text('remove_body', {
                name: friend_name(
                  rows.find(({ address }) => address === removing) ?? { address: removing, characters: [] }
                ),
              })}
            </p>
            <div>
              <button className="btn-outline" onClick={() => set_removing(null)} type="button">
                {text('cancel')}
              </button>
              <button
                className="btn-gold"
                onClick={() => {
                  dispatch_app({ type: 'friends/remove', address: removing })
                  set_removing(null)
                }}
                type="button"
              >
                {text('remove')}
              </button>
            </div>
          </div>
        </ModalFrame>
      )}
    </>
  )
}
