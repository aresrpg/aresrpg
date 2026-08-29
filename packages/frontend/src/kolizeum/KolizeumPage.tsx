// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { KolizeumFighterRow, KolizeumLobbyRow } from '@aresrpg/protocol'
import { Loader2, Plus, Swords } from 'lucide-react'
import { useMemo, useState } from 'react'

import { ModalFrame } from '../components/ModalFrame.tsx'
import type { AppCopy, CopyText } from '../i18n/copy.ts'
import { copy_text } from '../i18n/copy.ts'
import { kolizeum_side_open, parse_kolizeum_pledge, selected_kolizeum_pending } from '../modules/kolizeum.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { format_sui } from '../wallet_amount.ts'

import { kolizeum_join_review, type KolizeumJoinReview } from './join_confirmation.ts'

import './kolizeum.css'

type Tab = 'open' | 'mine'
type Format = 1 | 3 | 6

const FORMATS = Object.freeze([1, 3, 6] as const)
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

const format_of = (format: Format): string => `${format}V${format}`
const short_address = (address: string): string => `${address.slice(0, 6)}…${address.slice(-4)}`
const full_pot = (lobby: Readonly<KolizeumLobbyRow>): bigint => BigInt(lobby.pledge_mist) * BigInt(lobby.format) * 2n
const pot_label = (mist: bigint, free: string): string => (mist === 0n ? free : `${format_sui(mist, 2)} SUI`)

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
  const settling = lobby.status === 'settling'
  const remaining = BigInt(lobby.pot_mist)
  return (
    <div className="kz-pot">
      <small>{t(settling ? 'settlement_remaining' : 'total_pot')}</small>
      <b>{settling && remaining === 0n ? t('paid_out') : pot_label(remaining, t('free'))}</b>
    </div>
  )
}

const FormatChips = ({ active, pick }: Readonly<{ active: Format | null; pick: (format: Format | null) => void }>) => (
  <span className="kz-chips">
    {FORMATS.map((format) => (
      <button
        className={active === format ? 'is-active' : ''}
        key={format}
        onClick={() => pick(active === format ? null : format)}
        type="button"
      >
        {format_of(format)}
      </button>
    ))}
  </span>
)

const FighterRow = ({ fighter }: Readonly<{ fighter: KolizeumFighterRow }>) => {
  const color = CLASS_COLORS[fighter.classe] ?? '#6b7280'
  return (
    <div className="kz-fighter">
      <span style={{ background: `${color}1a`, borderColor: `${color}55`, color }}>
        {(fighter.classe || '?').slice(0, 2)}
      </span>
      <b>{fighter.name}</b>
      <small>LV.{fighter.level}</small>
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
    {lobby.fighters
      .filter((fighter) => fighter.team === side)
      .map((fighter) => (
        <FighterRow fighter={fighter} key={fighter.seat} />
      ))}
    {lobby.status === 'open' && (
      <button
        className={`kz-join-side ${side === 0 ? 'is-a' : 'is-b'}`}
        disabled={disabled || !kolizeum_side_open(lobby, side)}
        onClick={() => request_join(side)}
        type="button"
      >
        {t(side === 0 ? 'join_a' : 'join_b')}
      </button>
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
  if (!intent) return null
  const side = t(intent.side === 0 ? 'side_a' : 'side_b')
  return (
    <ModalFrame close={close} close_label={copy.cancel} label={t('join_confirm_title')} max_width="max-w-sm" soft>
      <div className="kz-join-confirm">
        <h2>{t('join_confirm_title')}</h2>
        <p>
          {t('join_confirm_body', {
            character: intent.character_name,
            amount: intent.stake_sui,
            side,
          })}
        </p>
        <div>
          <button className="btn-outline" onClick={close} type="button">
            {copy.cancel}
          </button>
          <button className="btn-gold" disabled={pending} onClick={() => confirm(intent)} type="button">
            {t('join_confirm_cta', { amount: intent.stake_sui, side })}
          </button>
        </div>
      </div>
    </ModalFrame>
  )
}

export default function KolizeumPage({ copy }: Readonly<{ copy: AppCopy }>) {
  const t = copy_text(copy.kolizeum_page)
  const lobbies = useAppStore((state) => state.kolizeum.lobbies)
  const address = useAppStore((state) => state.session.wallet?.address ?? null)
  const characters = useAppStore((state) => state.session.characters)
  const selected_character_id = useAppStore((state) => state.session.selected_character_id)
  const pending = useAppStore(selected_kolizeum_pending)
  const selected_character = characters.find(({ id }) => id === selected_character_id) ?? null
  const [tab, set_tab] = useState<Tab>('open')
  const [filter_format, set_filter_format] = useState<Format | null>(null)
  const [selected_id, set_selected_id] = useState<string | null>(null)
  const [form_format, set_form_format] = useState<Format>(3)
  const [access, set_access] = useState<'public' | 'friends'>('public')
  const [pledge, set_pledge] = useState('1.00')
  const [max_diff, set_max_diff] = useState('10')
  const [join_intent, set_join_intent] = useState<KolizeumJoinReview | null>(null)
  const owned_ids = useMemo(() => new Set(characters.map(({ id }) => id)), [characters])
  const rows = useMemo(
    () => lobbies.filter((lobby) => lobby_visible(lobby, tab, filter_format, address, owned_ids)),
    [address, filter_format, lobbies, owned_ids, tab]
  )
  const selected = lobbies.find(({ id }) => id === selected_id) ?? null
  const pledge_mist = parse_kolizeum_pledge(pledge)
  const has_friends = useAppStore((state) => state.friends.rows.length > 0)
  const character_available = selected_character?.custody === 'kiosk'
  const can_create =
    !!selected_character &&
    character_available &&
    pledge_mist !== null &&
    pending === null &&
    (access === 'public' || has_friends)
  const join_disabled = (lobby: Readonly<KolizeumLobbyRow>): boolean =>
    !selected_character ||
    !character_available ||
    pending !== null ||
    !lobby.can_join ||
    selected_character.level < lobby.level_min ||
    selected_character.level > lobby.level_max ||
    lobby.fighters.some(({ character_id, settled }) => character_id === selected_character.id && !settled)
  const request_join = (lobby: Readonly<KolizeumLobbyRow>, side: 0 | 1): void => {
    set_join_intent(join_review(lobby, selected_character, join_disabled(lobby), side))
  }
  const confirm_join = (intent: KolizeumJoinReview): void => {
    dispatch_app({
      type: 'kolizeum/join',
      kolizeum: intent.kolizeum,
      side: intent.side,
      character_id: intent.character_id,
    })
    set_join_intent(null)
  }
  const create = (): void => {
    if (!can_create || pledge_mist === null) return
    dispatch_app({
      type: 'kolizeum/create',
      format: form_format,
      pledge_mist,
      max_level_diff: Math.max(0, Number(max_diff) || 0),
      access,
    })
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
                <button
                  className={tab === next ? 'is-active' : ''}
                  key={next}
                  onClick={() => set_tab(next)}
                  type="button"
                >
                  {t(`tab_${next}`)}
                </button>
              ))}
              <FormatChips active={filter_format} pick={set_filter_format} />
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
                rows.map((lobby, index) => (
                  <div
                    className={`kz-row kz-lobby${selected_id === lobby.id ? ' is-selected' : ''}`}
                    key={lobby.id}
                    onClick={() => set_selected_id(lobby.id)}
                    style={{ background: index % 2 === 0 ? 'rgba(255,255,255,.02)' : 'transparent' }}
                  >
                    <strong>{format_of(lobby.format)}</strong>
                    <small className={lobby.public ? '' : 'is-private'}>
                      {t(lobby.public ? 'access_public' : 'access_friends')}
                    </small>
                    <small style={{ color: STATUS_COLOR[lobby.status] }}>● {t(`status_${lobby.status}`)}</small>
                    <span>{pot_label(BigInt(lobby.pledge_mist), t('free'))}</span>
                    <span className="kz-gold">{pot_label(full_pot(lobby), t('free'))}</span>
                    <small>{short_address(lobby.creator)}</small>
                    {lobby.status === 'open' ? (
                      <span aria-hidden="true" className="kz-row-open">
                        ›
                      </span>
                    ) : (
                      <em>● {t(`status_${lobby.status}`)}</em>
                    )}
                  </div>
                ))
              )}
            </div>
            {selected && (
              <section className="kz-selected">
                <header>
                  <b>{t('selected')}</b>
                  <span>
                    {format_of(selected.format)} · {t(selected.public ? 'access_public' : 'access_friends')}
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
          <aside className="kz-create">
            <h2>
              <Plus aria-hidden="true" size={11} /> {t('create_title')}
            </h2>
            <label>{t('form_format')}</label>
            <FormatChips active={form_format} pick={(format) => format && set_form_format(format)} />
            <label>{t('form_access')}</label>
            <span className="kz-chips">
              <button
                className={access === 'public' ? 'is-active' : ''}
                onClick={() => set_access('public')}
                type="button"
              >
                {t('access_public')}
              </button>
              <button
                className={access === 'friends' ? 'is-active' : ''}
                disabled={!has_friends}
                onClick={() => set_access('friends')}
                type="button"
              >
                {t('access_friends')}
              </button>
            </span>
            <label>{t('form_pledge')}</label>
            <input
              className="template-input"
              inputMode="decimal"
              onChange={(event) => set_pledge(event.target.value)}
              value={pledge}
            />
            <label>{t('form_max_diff')}</label>
            <input
              className="template-input"
              inputMode="numeric"
              onChange={(event) => set_max_diff(event.target.value.replace(/[^0-9]/g, ''))}
              value={max_diff}
            />
            <label>{t('form_character')}</label>
            {selected_character ? (
              <div className="kz-character">
                <b>{selected_character.name}</b>
                <span>{selected_character.classe}</span>
                <small>LV.{selected_character.level}</small>
              </div>
            ) : (
              <p>{t('no_character')}</p>
            )}
            <p>
              {t('full_pot_summary', {
                pot: format_sui((pledge_mist ?? 0n) * BigInt(form_format) * 2n, 2),
                format: format_of(form_format),
              })}
            </p>
            <button className="btn-gold kz-create-button" disabled={!can_create} onClick={create} type="button">
              {pending === 'create' && <Loader2 aria-hidden="true" className="animate-spin" size={11} />}
              {t('create_cta')}
            </button>
          </aside>
        </div>
      </section>
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
