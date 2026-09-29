// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { KolizeumFighterRow, KolizeumLobbyRow, CharacterRow } from '@aresrpg/protocol'
import { Loader2, Plus, Swords } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button, NativeModal, GameWindow } from '@aresrpg/ui'

import { Text } from '../i18n/Text.tsx'
import { useNumbers } from '../i18n/useNumbers.ts'
import type { AppCopy, CopyText } from '../i18n/copy.ts'
import { copy_text } from '../i18n/copy.ts'
import { kolizeum_side_open, parse_kolizeum_pledge, selected_kolizeum_pending } from '../modules/kolizeum.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { format_sui } from '../wallet_amount.ts'

import { KolizeumCreate, FormatChips, type Format } from './KolizeumControls.tsx'
import { kolizeum_join_review, type KolizeumJoinReview } from './join_confirmation.ts'

import './kolizeum.css'

type Tab = 'open' | 'mine'

const STATUS_COLOR = Object.freeze({ open: '#4a9eff', started: '#f59e0b', settling: '#34d399' })
const CLASS_COLORS: Readonly<Record<string, string>> = Object.freeze({
  senshi: '#e0533a',
  yajin: '#4ec97a',
  yogan: '#2bb6a8',
  tomoda: '#caa14a',
  ikari: '#c0334a',
  mori: '#7faa45',
  tokei: '#5a8fe0',
  shugo: '#b07a3a',
  rojin: '#9c7b52',
  shusen: '#54c0a0',
  asobi: '#c95aa8',
  iyashi: '#6fc6e0',
})

const short_address = (address: string): string => `${address.slice(0, 6)}…${address.slice(-4)}`
const full_pot = (lobby: Readonly<KolizeumLobbyRow>): bigint => BigInt(lobby.pledge_mist) * BigInt(lobby.format) * 2n
const pot_label = (mist: bigint, free: string, format: typeof format_sui): string =>
  mist === 0n ? free : `${format(mist, 2)} SUI`

const lobby_visible = (
  lobby: Readonly<KolizeumLobbyRow>,
  tab: Tab,
  filter_format: Format | null,
  address: string | null,
  owned_ids: ReadonlySet<string>
): boolean => {
  if (filter_format && lobby.format !== filter_format) return false
  if (tab === 'open') return lobby.status === 'open'
  return lobby.creator === address || lobby.fighters.some(({ character_id }) => owned_ids.has(character_id))
}

const SelectedPot = ({ lobby, t }: Readonly<{ lobby: KolizeumLobbyRow; t: CopyText }>) => {
  const localized_numbers = useNumbers()
  const settling = lobby.status === 'settling'
  const remaining = BigInt(lobby.pot_mist)
  return (
    <div className="kz-pot">
      <small>{t(settling ? 'settlement_remaining' : 'total_pot')}</small>
      <b>{settling && remaining === 0n ? t('paid_out') : pot_label(remaining, t('free'), localized_numbers.sui)}</b>
    </div>
  )
}

const FighterRow = ({ fighter }: Readonly<{ fighter: KolizeumFighterRow }>) => {
  const color = CLASS_COLORS[fighter.classe] ?? '#6b7280'
  return (
    <div className="kz-fighter">
      <span style={{ background: `${color}1a`, borderColor: `${color}55`, color }}>
        {(fighter.classe || '?').slice(0, 2)}
      </span>
      <b>{fighter.name}</b>
      <small>
        <Text path="encyclopedia_page.level_short" values={{ level: fighter.level }} />
      </small>
    </div>
  )
}

const SideRoster = ({
  lobby,
  side,
  disabled,
  request_join,
  t,
}: Readonly<{
  lobby: KolizeumLobbyRow
  side: 0 | 1
  disabled: boolean
  request_join: (side: 0 | 1) => void
  t: CopyText
}>) => (
  <div className={`kz-roster ${side === 0 ? 'is-a' : 'is-b'}`}>
    <label>{t(side === 0 ? 'side_a' : 'side_b')}</label>
    <div className="kz-fighters">
      {lobby.fighters
        .filter((fighter) => fighter.team === side && (lobby.status !== 'open' || !fighter.settled))
        .map((fighter) => (
          <FighterRow fighter={fighter} key={fighter.seat} />
        ))}
    </div>
    {lobby.status === 'open' && (
      <Button
        className={`kz-join-side ${side === 0 ? 'is-a' : 'is-b'}`}
        disabled={disabled || !kolizeum_side_open(lobby, side)}
        onClick={() => request_join(side)}
        type="button"
      >
        {t(side === 0 ? 'join_a' : 'join_b')}
      </Button>
    )}
  </div>
)

const join_review = (
  lobby: Readonly<KolizeumLobbyRow>,
  character: Readonly<{ id: string; name: string }> | null,
  disabled: boolean,
  side: 0 | 1
): KolizeumJoinReview | null =>
  !character || disabled || !kolizeum_side_open(lobby, side) ? null : kolizeum_join_review(lobby, character, side)

const JoinConfirmation = ({
  copy,
  intent,
  pending,
  close,
  confirm,
  t,
}: Readonly<{
  copy: AppCopy
  intent: KolizeumJoinReview | null
  pending: boolean
  close: () => void
  confirm: (intent: KolizeumJoinReview) => void
  t: CopyText
}>) => {
  const numbers = useNumbers()
  if (!intent) return null
  const side = t(intent.side === 0 ? 'side_a' : 'side_b')
  return (
    <NativeModal close={close} label={t('join_confirm_title')} className="aui-modal-scrim">
      <GameWindow title={t('join_confirm_title')} close={close} close_label={copy.cancel} className="aui-arena-confirm">
        <div className="kz-join-confirm">
          <p>
            {t('join_confirm_body', {
              character: intent.character_name,
              amount: numbers.amount(intent.stake_mist, 9),
              side,
            })}
          </p>
          <div>
            <Button className="btn-outline" onClick={close} type="button">
              {copy.cancel}
            </Button>
            <Button className="btn-gold" disabled={pending} onClick={() => confirm(intent)} type="button">
              {t('join_confirm_cta', { amount: numbers.amount(intent.stake_mist, 9), side })}
            </Button>
          </div>
        </div>
      </GameWindow>
    </NativeModal>
  )
}

export default function KolizeumPage({ copy }: Readonly<{ copy: AppCopy }>) {
  const localized_numbers = useNumbers()
  const t = copy_text(copy.kolizeum_page)
  const lobbies = useAppStore((state) => state.kolizeum.lobbies)
  const address = useAppStore((state) => state.session.wallet?.address ?? null)
  const characters = useAppStore((state) => state.session.characters)
  const selected_character_id = useAppStore((state) => state.session.selected_character_id)
  const pending = useAppStore(selected_kolizeum_pending)
  const has_friends = useAppStore((state) => state.friends.rows.length > 0)
  return (
    <KolizeumView
      copy={copy}
      lobbies={lobbies}
      address={address}
      characters={characters}
      selected_character_id={selected_character_id}
      pending={pending}
      has_friends={has_friends}
      dispatch={dispatch_app}
    />
  )
}
export const KolizeumView = ({
  copy,
  lobbies,
  address,
  characters,
  selected_character_id,
  pending,
  has_friends,
  dispatch,
}: Readonly<{
  copy: AppCopy
  lobbies: readonly KolizeumLobbyRow[]
  address: string | null
  characters: readonly CharacterRow[]
  selected_character_id: string | null
  pending: string | null
  has_friends: boolean
  dispatch: (input: import('../modules/kolizeum.ts').KolizeumInput) => void
}>) => {
  const localized_numbers = useNumbers()
  const t = copy_text(copy.kolizeum_page)
  const selected_character = characters.find(({ id }) => id === selected_character_id) ?? null
  const [tab, set_tab] = useState<Tab>('open')
  const [creating, set_creating] = useState(false)
  const [filter_format, set_filter_format] = useState<Format | null>(null)
  const [selected_id, set_selected_id] = useState<string | null>(null)
  const [join_intent, set_join_intent] = useState<KolizeumJoinReview | null>(null)
  const owned_ids = useMemo(() => new Set(characters.map(({ id }) => id)), [characters])
  const rows = useMemo(
    () => lobbies.filter((lobby) => lobby_visible(lobby, tab, filter_format, address, owned_ids)),
    [address, filter_format, lobbies, owned_ids, tab]
  )
  const selected = lobbies.find(({ id }) => id === selected_id) ?? null

  const character_available = selected_character?.custody === 'kiosk'
  const join_disabled = (lobby: Readonly<KolizeumLobbyRow>): boolean =>
    !selected_character ||
    !character_available ||
    pending !== null ||
    !lobby.can_join ||
    selected_character.level < lobby.level_min ||
    selected_character.level > lobby.level_max ||
    lobby.fighters.some(({ character_id }) => character_id === selected_character.id)
  const request_join = (lobby: Readonly<KolizeumLobbyRow>, side: 0 | 1): void => {
    set_join_intent(join_review(lobby, selected_character, join_disabled(lobby), side))
  }
  const confirm_join = (intent: KolizeumJoinReview): void => {
    dispatch({
      type: 'kolizeum/join',
      kolizeum: intent.kolizeum,
      side: intent.side,
      character_id: intent.character_id,
    })
    set_join_intent(null)
  }

  return (
    <>
      <section className="kz-page" data-kolizeum-page="">
        <header className="kz-header">
          <Swords aria-hidden="true" size={14} />
          <b>{t('title')}</b>
          <span>{t('tagline')}</span>
        </header>
        <div className="kz-body">
          <div className="kz-main">
            <nav className="kz-tabs">
              {(['open', 'mine'] as const).map((next) => (
                <Button
                  className={tab === next ? 'is-active' : ''}
                  key={next}
                  onClick={() => set_tab(next)}
                  type="button"
                >
                  {t(`tab_${next}`)}
                </Button>
              ))}
              <FormatChips active={filter_format} pick={set_filter_format} />
              <Button tone="primary" className="aui-arena-create-trigger" onClick={() => set_creating(true)}>
                <Plus size={13} />
                {t('create_title')}
              </Button>
            </nav>
            <div className="kz-table">
              <div className="kz-row kz-columns">
                <span>{t('col_format')}</span>
                <span>{t('col_access')}</span>
                <span>{t('col_status')}</span>
                <span>{t('col_pledge')}</span>
                <span>{t('col_full_pot')}</span>
                <span>{t('col_creator')}</span>
                <span />
              </div>
              {rows.length === 0 ? (
                <div className="kz-empty">{t('empty')}</div>
              ) : (
                rows.map((lobby) => (
                  <Button
                    className={`kz-row kz-lobby${selected_id === lobby.id ? ' is-selected' : ''}`}
                    key={lobby.id}
                    onClick={() => set_selected_id(lobby.id)}
                    type="button"
                  >
                    <strong>
                      <Text path="ui.team_format" values={{ size: lobby.format }} />
                    </strong>
                    <small className={lobby.public ? '' : 'is-private'}>
                      {t(lobby.public ? 'access_public' : 'access_friends')}
                    </small>
                    <small style={{ color: STATUS_COLOR[lobby.status] }}>● {t(`status_${lobby.status}`)}</small>
                    <span>
                      <span className="kz-field-label">{t('col_pledge')}</span>
                      {pot_label(BigInt(lobby.pledge_mist), t('free'), localized_numbers.sui)}
                    </span>
                    <span className="kz-gold">
                      <span className="kz-field-label">{t('col_full_pot')}</span>
                      {pot_label(full_pot(lobby), t('free'), localized_numbers.sui)}
                    </span>
                    <small>
                      <span className="kz-field-label">{t('col_creator')}</span>
                      {short_address(lobby.creator)}
                    </small>
                    {lobby.status === 'open' ? (
                      <span aria-hidden="true" className="kz-row-open">
                        ›
                      </span>
                    ) : (
                      <em>● {t(`status_${lobby.status}`)}</em>
                    )}
                  </Button>
                ))
              )}
            </div>
            {selected && (
              <section className="kz-selected">
                <header>
                  <b>{t('selected')}</b>
                  <span>
                    <Text path="ui.team_format" values={{ size: selected.format }} /> ·{' '}
                    {t(selected.public ? 'access_public' : 'access_friends')}
                  </span>
                </header>
                <div className="kz-rosters">
                  <SideRoster
                    disabled={join_disabled(selected)}
                    lobby={selected}
                    request_join={(side) => request_join(selected, side)}
                    side={0}
                    t={t}
                  />
                  <SelectedPot lobby={selected} t={t} />
                  <SideRoster
                    disabled={join_disabled(selected)}
                    lobby={selected}
                    request_join={(side) => request_join(selected, side)}
                    side={1}
                    t={t}
                  />
                </div>
              </section>
            )}
          </div>
        </div>
      </section>
      {creating && (
        <NativeModal label={t('create_title')} close={() => set_creating(false)} className="aui-modal-scrim">
          <GameWindow
            title={t('create_title')}
            close={() => set_creating(false)}
            close_label={copy.wallet_close}
            className="aui-arena-create-window"
          >
            <KolizeumCreate
              copy={copy}
              selected_character={selected_character}
              pending={pending}
              has_friends={has_friends}
              dispatch={dispatch}
            />
          </GameWindow>
        </NativeModal>
      )}
      <JoinConfirmation
        close={() => set_join_intent(null)}
        confirm={confirm_join}
        copy={copy}
        intent={join_intent}
        pending={pending !== null}
        t={t}
      />
    </>
  )
}
