// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FIGHTS PANEL — opened by the [V] "See fights in the area" prompt / the FightsCount card — the
// list of the current fights in range, friends on top, capped at 20, with the two filter toggles + per-row
// SPECTATE (a started fight) / JOIN (public + placement). Pure render off state.visible_fights (reconciled by
// world_fights_discovery.js) + the resolved friend/party character-id sets; every legality/sort/cap decision is
// the pure nearby_fights.js core (unit-tested). House DNA reused VERBATIM from DungeonsModal (gw-dg glass panel,
// gold primary, JetBrains mono, uppercase, sharp) — no bespoke chrome, no left-accent rails (design law).

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { use_game_state, context } from '../../../store.js'
import { use_auth } from '../../../../auth'
import { use_party } from '../../../../world-shell/party_store.js'
import { use_dungeon } from '../../../../world-shell/dungeon_store.js'
import { join_world_fight, as_one_toast } from '../../../../world-shell/dungeon_actions.js'
import { enter_world_fight } from '../../../../world-shell/world_fight.js'
import { enter_after_world_join_receipt } from '../../../../world-shell/world_fight_receipt.js'
import { read_friend_list } from '../../../../world-shell/friends_reads.js'
import { get_characters } from '../../../../rpc/client'
import { get_mob_template } from '@aresrpg/sdk/game'
import { get_sdk } from '../../../../chain/sdk'
import { resolve_character_docs } from '../../../../world-shell/character_name_resolve.js'
import { fight_hover_teams } from '../../../../world-shell/fight_area_panel.js'
import {
  cap_and_filter,
  is_join_legal,
  is_dungeon_join_legal,
  is_spectatable,
  party_character_ids,
  section_fight_rows,
  FIGHT_LIST_CAP,
} from '@aresrpg/world'

const close = () => context.dispatch('action/fights_modal', null)

/** Resolve the character ids owned by a set of wallet ADDRESSES (fight participants are char ids; friends/party
 *  are addresses) — one /v1/characters?owner read per address, best-effort, LRU-cached. Empty set on no input. */
async function resolve_char_ids(addresses) {
  const unique = [...new Set((addresses ?? []).filter(Boolean))]
  if (unique.length === 0) return new Set()
  const lists = await Promise.all(
    unique.map((owner) =>
      get_characters({ owner })
        .then((cs) => cs.map((c) => c.id))
        .catch(() => [])
    )
  )
  return new Set(lists.flat())
}

/** @returns {import('react').ReactElement | null} */
export function FightsModal() {
  const { t } = useTranslation()
  const open = use_game_state((s) => s.fights_modal)
  const visible = use_game_state((s) => s.visible_fights)
  const dungeon_fights = use_game_state((s) => s.visible_dungeon_fights)
  // In a dungeon the SAME panel lists my party's room-fights (team up for the boss fight) — a distinct
  // data source (party runs) + join door (dungeon::join_fight), but one panel, one look.
  const in_dungeon = use_dungeon((s) => !!s.dungeon_id)
  const address = use_auth((s) => s.address)
  const party_members = use_party((s) => s.party?.members ?? null)
  // The client's ONE mob-name catalog (group_template id → name), fed by world_spawns' nearby group cards +
  // the fight board's own resolver + the miss-resolver below. The hover card reads it to name each opponent.
  const mob_names = use_dungeon((s) => s.mob_names)

  const [friends_only, set_friends_only] = useState(false)
  const [group_only, set_group_only] = useState(false)
  const [friend_char_ids, set_friend_char_ids] = useState(() => new Set())
  const [busy_id, set_busy_id] = useState(/** @type {string | null} */ (null))
  const [hovered_id, set_hovered_id] = useState(/** @type {string | null} */ (null))
  const [character_docs, set_character_docs] = useState(() => new Map())

  // Party already carries exact character-keyed members. Never widen one member to every character owned by the
  // same wallet: same-owner alts are distinct group slots and only signed accepts add them.
  const party_char_ids = useMemo(() => party_character_ids(party_members), [party_members])

  // Resolve friend character ids while the panel is OPEN (on-demand — the discovery poll stays cheap). Friends are
  // still wallet-address keyed, so this one path intentionally expands each friend through /v1/characters?owner=.
  useEffect(() => {
    if (!open) return
    let alive = true
    ;(async () => {
      const [friends] = await Promise.all([read_friend_list(address).catch(() => ({ friends: [] }))])
      const fset = await resolve_char_ids(friends?.friends ?? [])
      if (!alive) return
      set_friend_char_ids(fset)
    })()
    return () => {
      alive = false
    }
  }, [open, address])

  // Esc closes (every companion overlay).
  useEffect(() => {
    if (!open) return
    const on_key = /** @param {KeyboardEvent} e */ (e) => {
      if (e.code === 'Escape') close()
    }
    window.addEventListener('keydown', on_key)
    return () => window.removeEventListener('keydown', on_key)
  }, [open])

  const rows = useMemo(() => {
    const markers = [...((in_dungeon ? dungeon_fights : visible)?.values?.() ?? [])]
    return cap_and_filter(markers, { friend_char_ids, party_char_ids, friends_only, group_only, cap: FIGHT_LIST_CAP })
  }, [in_dungeon, visible, dungeon_fights, friend_char_ids, party_char_ids, friends_only, group_only])
  const sections = useMemo(() => section_fight_rows(rows), [rows])
  const roster_ids = useMemo(() => [...new Set(rows.flatMap((row) => row.participant_ids))], [rows])
  const hovered_marker = useMemo(() => rows.find((row) => row.id === hovered_id) ?? rows[0] ?? null, [rows, hovered_id])
  const hover_teams = useMemo(
    () => (hovered_marker ? fight_hover_teams(hovered_marker, character_docs, mob_names) : null),
    [hovered_marker, character_docs, mob_names]
  )
  const group_templates = useMemo(
    () => [...new Set(rows.map((row) => row.group_template).filter(Boolean))],
    [rows]
  )

  // Option A's team card resolves every player in one batched /v1 character read (the character_name_resolve
  // ONE HOME — design ruling 2026-07-19, shared with the live fight-HUD roster). Missing rows deliberately keep the
  // shortened id supplied by fight_hover_teams; a transient lookup failure must not hide a fight.
  useEffect(() => {
    if (!open || roster_ids.length === 0) {
      set_character_docs(new Map())
      return
    }
    let alive = true
    void resolve_character_docs(roster_ids).then((docs) => {
      if (alive) set_character_docs(docs)
    })
    return () => {
      alive = false
    }
  }, [open, roster_ids])

  // Resolve the mob-group NAME for any visible fight whose group_template isn't in the catalog yet. A fight's
  // spawn is CONSUMED at claim, so world_spawns may never have rendered its group card (especially for a fight
  // ANOTHER player started) — so name resolution can't rely on that path alone. Read the id → name directly (the
  // chain-direct MobTemplate read the fight board already uses) and seed the ONE catalog home via
  // note_group_identity, the same door world_spawns uses. id-gated + immutable id + cached, so this fires once
  // per unseen group; a failed/nameless read stays unseeded → the honest "Enemies #N" fallback.
  useEffect(() => {
    if (!open) return
    const known = use_dungeon.getState().mob_names
    const unseen = group_templates.filter((id) => !(id in known))
    if (unseen.length === 0) return
    let alive = true
    void (async () => {
      const sdk = await get_sdk()
      const read = get_mob_template({ grpc_client: sdk.grpc_client })
      await Promise.all(
        unseen.map((id) =>
          read(id)
            .then((tpl) => {
              if (alive && tpl?.name) use_dungeon.getState().note_group_identity(id, tpl.name, tpl.min_level, tpl.element)
            })
            .catch(() => null)
        )
      )
    })().catch(() => null) // get_sdk() unreadable → the names just stay the honest "Enemies #N" fallback
    return () => {
      alive = false
    }
  }, [open, group_templates])

  if (!open) return null

  const selected_character_id = context.get_state().selected_character_id
  const my_party_id = use_party.getState().party_id

  const on_join = (marker) => {
    if (!selected_character_id || busy_id) return
    set_busy_id(marker.id)
    // DUNGEON: join my party member's room-fight with MY OWN pass (dungeon::join_fight — same-room proven
    // on-chain from the creator's pass). WORLD: fight::join (public+placement gate is on-chain); group-only
    // fights are joined via the party flow, so party_id only rides a group fight I'm a party member of.
    const run = () => {
      if (in_dungeon)
        return use_dungeon.getState().join_shared_dungeon(marker.run_pass_id, marker.id, selected_character_id)
      // The join receipt is already proof that this character is seated. Enter immediately from that boundary;
      // the old flow only closed the modal, so the one-shot boot resume had already passed and a party member
      // stayed in the world until refresh. Full-board hydration uses the same receipt-backed sync as the creator.
      return enter_after_world_join_receipt({
        execute: () =>
          join_world_fight({
            fight_id: marker.id,
            character_id: selected_character_id,
            party_id: marker.public ? null : my_party_id,
          }),
        enter: enter_world_fight,
        fight_id: marker.id,
        character_id: selected_character_id,
      })
    }
    void as_one_toast(t('fights.action_join_fight'), run)
      .then(() => close())
      .finally(() => set_busy_id(null))
  }

  // PORTAL TO <body> (a world nameplate was bleeding through this modal) — mirrors PlayerActionMenu's own
  // body-portal. Inline, this backdrop's position:absolute sizes off the buried game-frame ancestor's box,
  // whose OWN z-12 stacking context sits at whatever the LOCAL React tree gives it; the body-appended nameplate
  // layer (remote_players.js chip_layer) is a position:fixed TOP-LEVEL sibling with an explicit z-index, so it
  // can paint over that buried subtree regardless of this backdrop's internal z-index:30. Portaling makes this
  // modal a genuine top-level sibling too; `.gw-ft-backdrop` (game-world-hud.css) switches it to position:fixed
  // at the same "world modal" z-tier .gw-travel__backdrop/.wsh-modal already use — comfortably above every
  // fixed HUD/canvas/nameplate layer. `.gw-dg-backdrop` itself stays untouched (DungeonsModal/CommissionModal
  // still render inline in the z-12 HUD tree; only this one modal needed the escape hatch).
  return createPortal(
    <div className="gw-dg-backdrop gw-ft-backdrop" onClick={close}>
      <div className="gw-ft gw-dg gw-panel" onClick={(e) => e.stopPropagation()}>
        <header className="gw-dg__head">
          <div>
            <h2 className="gw-dg__title">{t(in_dungeon ? 'fights.dungeon_panel_title' : 'fights.panel_title')}</h2>
            <p className="gw-dg__sub">{t(in_dungeon ? 'fights.dungeon_panel_subtitle' : 'fights.panel_subtitle')}</p>
          </div>
          <button type="button" className="gw-dg__x" aria-label={t('dungeons.close')} onClick={close}>
            ✕
          </button>
        </header>

        {/* two filter toggles — clickable status words (design law: no checkboxes/switches), gold when on */}
        <div className="gw-ft__filters">
          <FilterToggle
            on={friends_only}
            onClick={() => set_friends_only((v) => !v)}
            label={t('fights.filter_friends')}
          />
          <FilterToggle on={group_only} onClick={() => set_group_only((v) => !v)} label={t('fights.filter_group')} />
        </div>

        <div className="gw-dg__body">
          {rows.length === 0 ? (
            <div className="gw-dg__empty">
              <span className="gw-dg__empty-h">{t('fights.none_in_range')}</span>
            </div>
          ) : (
            <div className="gw-ft__layout">
              <div className="gw-ft__list-pane">
                <div className="gw-ft__section-head gw-ft__section-head--root">
                  <span>{t('fights.openness_label')}</span>
                  <span className="gw-ft__section-count">{rows.length}</span>
                </div>
                {sections.map((section) => (
                  <section className="gw-ft__section" key={section.key}>
                    <div className="gw-ft__section-head">
                      <span>{section.key === 'public' ? t('fights.badge_public') : t('fights.badge_group')}</span>
                      <span className="gw-ft__section-count">{section.rows.length}</span>
                    </div>
                    <ul className="gw-ft__list">
                      {section.rows.map((m) => (
                        <FightRow
                          key={m.id}
                          marker={m}
                          dungeon={in_dungeon}
                          is_friend={m.participant_ids.some((id) => friend_char_ids.has(id))}
                          group_member={m.participant_ids.some((id) => party_char_ids.has(id))}
                          selected={m.id === hovered_marker?.id}
                          busy={busy_id === m.id}
                          on_hover={() => set_hovered_id(m.id)}
                          on_join={() => on_join(m)}
                          t={t}
                        />
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
              <FightHoverCard marker={hovered_marker} teams={hover_teams} dungeon={in_dungeon} t={t} />
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

/** A single-line fight row (design law #6: strict one line): dot + fighters/phase + openness badge + distance +
 *  the ONE action (Join when public+placement, Spectate when started, else a muted phase label). */
function FightRow({ marker, dungeon, is_friend, group_member, selected, busy, on_hover, on_join, t }) {
  const joinable = dungeon ? is_dungeon_join_legal(marker) : is_join_legal(marker, group_member)
  const watchable = is_spectatable(marker)
  const phase_label = t(`fights.phase_${marker.status}`, { defaultValue: marker.status })
  return (
    <li
      className={`gw-ft__row${is_friend ? ' gw-ft__row--friend' : ''}${selected ? ' gw-ft__row--selected' : ''}`}
      onMouseEnter={on_hover}
      onFocusCapture={on_hover}
    >
      <span className="gw-ft__dot" aria-hidden="true" />
      <span className="gw-ft__who">
        {dungeon && marker.room ? (
          <span className="gw-ft__room">{t('fights.room_n', { room: marker.room })} · </span>
        ) : null}
        {t('fights.fighters_n', { count: marker.participant_count })}
        <span className="gw-ft__phase"> · {phase_label}</span>
      </span>
      {/* openness badge + distance are OVERWORLD-only — a dungeon room-fight is always private + co-located. */}
      {!dungeon && (
        <span className={`gw-ft__badge${marker.public ? '' : ' gw-ft__badge--group'}`}>
          {marker.public ? t('fights.badge_public') : t('fights.badge_group')}
        </span>
      )}
      {!dungeon && <span className="gw-ft__dist hud-num">{Math.round(marker.distance ?? 0)}m</span>}
      {joinable ? (
        <button type="button" className="gw-ft__act gw-ft__act--join" disabled={busy} onClick={on_join}>
          {busy ? t('fights.joining') : t('fights.join')}
        </button>
      ) : watchable ? (
        // SPECTATE is a wave-2 read-only board mount (a seatless viewer must bypass the settlement path — declared
        // in the return). The affordance is present + honest so the panel reads complete; enabled next update.
        <button type="button" className="gw-ft__act" disabled title={t('fights.spectate_soon')}>
          {t('fights.spectate')}
        </button>
      ) : (
        <span className="gw-ft__act gw-ft__act--muted">{phase_label}</span>
      )}
    </li>
  )
}

/** Large two-column hover detail: all player Character docs on the left and every discovered opponent slot right. */
function FightHoverCard({ marker, teams, dungeon, t }) {
  if (!marker || !teams) return null
  const phase_label = t(`fights.phase_${marker.status}`, { defaultValue: marker.status })
  return (
    <aside className="gw-ft__hover-card">
      <div className="gw-ft__hover-head">
        <h3 className="gw-ft__hover-title">{t('fights.fighters_n', { count: marker.participant_count })}</h3>
        {!dungeon && (
          <span className={`gw-ft__badge${marker.public ? '' : ' gw-ft__badge--group'}`}>
            {marker.public ? t('fights.badge_public') : t('fights.badge_group')}
          </span>
        )}
        <span className="gw-ft__phase">{phase_label}</span>
      </div>
      <div className="gw-ft__teams">
        <FightTeam title={t('fight_end.your_party')} members={teams.players} t={t} />
        <FightTeam title={t('fight_end.enemies')} members={teams.opponents} enemy t={t} />
      </div>
    </aside>
  )
}

function FightTeam({ title, members, enemy = false, t }) {
  return (
    <section className={`gw-ft__team${enemy ? ' gw-ft__team--enemy' : ''}`}>
      <div className="gw-ft__team-title">{title}</div>
      <ul className="gw-ft__roster">
        {members.map((member) => (
          <li className="gw-ft__member" key={member.id}>
            <span className="gw-ft__member-name">
              {enemy
                ? member.name
                  ? `${member.name} #${member.ordinal}`
                  : `${t('fight_end.enemies')} #${member.ordinal}`
                : member.name}
            </span>
            {member.level ? (
              <span className="gw-ft__member-meta">{t('spells.level', { level: member.level })}</span>
            ) : null}
            {member.class_name ? <span className="gw-ft__member-class">{member.class_name}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  )
}

/** A filter toggle rendered as a clickable status word (6px dot + one word, row clickable) — never a checkbox. */
function FilterToggle({ on, onClick, label }) {
  return (
    <button
      type="button"
      className={`gw-ft__filter${on ? ' gw-ft__filter--on' : ''}`}
      aria-pressed={on}
      onClick={onClick}
    >
      <span className="gw-ft__filter-dot" aria-hidden="true" />
      {label}
    </button>
  )
}
