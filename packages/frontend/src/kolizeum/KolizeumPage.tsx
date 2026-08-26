// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { KolizeumFighterRow, KolizeumLobbyRow } from '@aresrpg/protocol'
import { Loader2, Plus, Swords } from 'lucide-react'
import { useMemo, useState } from 'react'

import type { AppCopy, CopyText } from '../i18n/copy.ts'
import { copy_text } from '../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { format_sui } from '../wallet_amount.ts'
import { kolizeum_side_open, parse_kolizeum_pledge, selected_kolizeum_pending } from '../modules/kolizeum.ts'

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

const SideActions = ({
  lobby,
  disabled,
  join,
  t,
}: Readonly<{
  lobby: KolizeumLobbyRow
  disabled: boolean
  join: (side: 0 | 1) => void
  t: CopyText
}>) => (
  <span className="kz-side-actions">
    {([0, 1] as const).map((side) => (
      <button
        aria-label={t(side === 0 ? 'join_a' : 'join_b')}
        className={side === 0 ? 'is-a' : 'is-b'}
        disabled={disabled || !kolizeum_side_open(lobby, side)}
        key={side}
        onClick={(event) => {
          event.stopPropagation()
          join(side)
        }}
        type="button"
      >
        {side === 0 ? 'A' : 'B'}
      </button>
    ))}
  </span>
)

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
  const owned_ids = useMemo(() => new Set(characters.map(({ id }) => id)), [characters])
  const rows = useMemo(
    () =>
      lobbies.filter(
        (lobby) =>
          (!filter_format || lobby.format === filter_format) &&
          (tab === 'open' ||
            lobby.creator === address ||
            lobby.fighters.some(({ character_id }) => owned_ids.has(character_id)))
      ),
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
  const join = (lobby: Readonly<KolizeumLobbyRow>, side: 0 | 1): void =>
    dispatch_app({ type: 'kolizeum/join', kolizeum: lobby.id, side })
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
                    <SideActions
                      disabled={join_disabled(lobby)}
                      join={(side) => join(lobby, side)}
                      lobby={lobby}
                      t={t}
                    />
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
                <div>
                  <label>{t('side_a')}</label>
                  {selected.fighters
                    .filter(({ team }) => team === 0)
                    .map((fighter) => (
                      <FighterRow fighter={fighter} key={fighter.seat} />
                    ))}
                </div>
                <div className="kz-pot">
                  <small>{t('total_pot')}</small>
                  <b>{pot_label(BigInt(selected.pot_mist), t('free'))}</b>
                </div>
                <div>
                  <label>{t('side_b')}</label>
                  {selected.fighters
                    .filter(({ team }) => team === 1)
                    .map((fighter) => (
                      <FighterRow fighter={fighter} key={fighter.seat} />
                    ))}
                </div>
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
  )
}
