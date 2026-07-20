// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Spellbook — the character-detail SPELLS tab (D30 owner LIST layout, mockups/spellbook/list.png). A tactical-RPG
// grimoire: a scrollable spell LIST (left) + a per-spell DETAIL panel (right). The detail panel's field order
// reads: identity header → clickable LEVEL TABS 1..6 (locked levels stay browsable to preview their numbers) →
// the selected level's facts → DESCRIPTION → EFFECTS (token-coloured one-liners) → the UPGRADE button (last).
// Mounts as the HUD `spells` drawer (or EMBEDDED in the CharactersDrawer detail strip); the GEAR/STATS/JOBS tabs
// deep-link to their existing drawers via `on_open` (reusing the panel router — no duplicate sheets). Data +
// upgrade-state logic lives in spellbook-data.js; effect ranges render through seed-effect-line.js, the shared
// grammar used by every spell surface.
//
// ON-CHAIN REALITY (LIVE, #55 — S-46 model): the grimoire's ROWS are the DEPLOYED class spells (fight-spells.js
// resolver — each row carries its shared `SpellTemplate` object id + all 6 chain levels), the character's REAL
// per-spell invested levels + spent points are namespaced DFs on the Character (read_spell_state.js — absent
// spell = free baseline 1; unspent points DERIVE as (level − 1) − spent), and the LEVEL-UP button drives the
// permissionless `spell_level::raise_spell_level` entry with the row's own SpellTemplate
// (world-shell/spell_actions.js). The upgrade PREDICTS ON THE RECEIPT (#55, CLIENT-INDEPENDENCE law): a proven
// success records a durable projection (spell_alloc_session — spell +1, spent +cost) that survives this drawer's
// remounts and FLOORS the chain read until the fullnode indexes the tx (a stale read can never regress it — the
// a spell that just leveled must never re-display as unlevelled); an on-chain abort surfaces one humanized toast, nothing to roll back.
// The button ENABLES only when the client predicts success (points ≥ the S8 cost AND the target level's own
// min_char_level is met — the same facts the chain asserts) — otherwise it stays honestly disabled with the
// reason in its tooltip (never a dead click). No lying UI: what you see is the chain.

import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { xp_progress } from '@aresrpg/sdk/experience'
import { spell_icon_url } from '@aresrpg/sdk/jobs'

import { use_game_state } from '../../store.js'
import { get_class } from '../../data/classes.js'
import { upgrade_spell } from '../../../world-shell/spell_actions.js'
import { mark_ui_updated } from '../../../world-shell/tx.js'
import { read_spell_state } from '../../../chain/read_spell_state.js'
import { use_toast } from '../../../toast'

import {
  apply_upgrade_receipt,
  clear_confirmed_spell,
  merge_confirmed,
  record_confirmed_spell,
  spell_alloc_caught_up,
  use_spell_alloc_session,
} from './spell_alloc_session.js'

import { class_spells } from './fight-spells.js'
import { grimoire, upgrade_state, crit_pct, spell_effects, MAX_SPELL_LEVEL } from './spellbook-data.js'
import { seed_effect_parts, seed_el_label } from './seed-effect-line.js'
import { EffectLine } from './EffectLine.jsx'
import './spellbook.css'

/** i18n-first spell copy with the on-chain string as the honest fallback (the fight lane's spell_card rule);
 *  a missing key + no fallback renders NOTHING (suffix keys like `_desc` never show a raw slug). */
const chain_copy = (t, name_key, suffix = '', fallback = null) => {
  const key = `spells.spell_${name_key}${suffix}`
  const translated = t(key)
  return translated === key ? fallback : translated
}

/** Spell art tile with a graceful element-tinted fallback (only ~24 seeded spells carry CDN art). */
function Art({ icon, color, name, cls }) {
  const [failed, set_failed] = useState(false)
  const url = failed ? null : spell_icon_url(icon)
  if (!url)
    return (
      <span
        className={`${cls} sb__art--fallback`}
        style={/** @type {import('react').CSSProperties} */ ({ '--el': color })}
        aria-hidden="true"
      >
        {(name || '?').slice(0, 1).toUpperCase()}
      </span>
    )
  return <img className={cls} src={url} alt="" draggable={false} onError={() => set_failed(true)} />
}

/** @param {{ on_open?: (panel: string) => void }} props */
export function Spellbook({ on_open, embedded = false }) {
  const { t } = useTranslation()
  const characters = use_game_state((s) => s.sui.characters)
  const selected_character_id = use_game_state((s) => s.selected_character_id)
  const [sel_id, set_sel] = useState(/** @type {string | null} */ (null))

  const character = useMemo(
    () => characters?.find((c) => c.id === selected_character_id) ?? null,
    [characters, selected_character_id]
  )
  const class_id = character?.classe ?? character?.class_id

  // #55 CHAIN-TRUE allocation — `chain_alloc` is the raw read_spell_state (null = loading; a failed read degrades
  // to the honest baselines with `degraded`, keeping the spend disabled per the predict-failure rule (never enable a spend the chain would reject).
  // `confirmed` is the receipt-proven projection (spell_alloc_session — survives this drawer's remounts); the
  // rendered `alloc` is the chain read FLOORED up to it, so a stale fullnode snapshot can never regress a just-
  // proven upgrade (a spell that just leveled must never re-display as unlevelled). One home per fact, receipt floor, no async set().
  const [chain_alloc, set_chain_alloc] = useState(
    /** @type {{ spent: number, levels: Record<string, number>, degraded?: boolean } | null} */ (null)
  )
  const confirmed = use_spell_alloc_session().confirmed[character?.id] ?? null
  const alloc = useMemo(() => merge_confirmed(chain_alloc, confirmed), [chain_alloc, confirmed])
  useEffect(() => {
    set_chain_alloc(null)
    if (!character?.id) return
    let live = true
    const ids = class_spells(class_id).map((s) => s.object_id)
    read_spell_state(character.id, ids)
      .then((state) => {
        if (live) set_chain_alloc(state)
      })
      .catch(() => {
        if (live) set_chain_alloc({ spent: 0, levels: {}, degraded: true })
      })
    return () => {
      live = false
    }
  }, [character?.id, class_id])
  // Drop the receipt-proven projection the instant the chain read reaches it (Stats.jsx's caught-up law) — after
  // that the chain read alone is truth. Never regresses: spell_alloc_caught_up only fires when chain ≥ the floor.
  useEffect(() => {
    if (character?.id && spell_alloc_caught_up(chain_alloc, confirmed)) clear_confirmed_spell(character.id, confirmed)
  }, [chain_alloc, confirmed, character?.id])

  const book = useMemo(() => {
    if (!character) return null
    const { level } = xp_progress(character.experience)
    // REAL on-chain spell economy (#55, S-46): unspent points DERIVE from progression — (level − 1) earned
    // (+1 per level-up from 2) minus the chain's running spent total; per-spell invested levels come off the
    // SpellLevelKey DFs (absent = the free baseline 1).
    const points = Math.max(0, level - 1 - (alloc?.spent ?? 0))
    return { ...grimoire(class_id, level, points, alloc?.levels ?? {}), level, points }
  }, [character, class_id, alloc])

  const refetch = () => {
    if (!character?.id) return
    const ids = class_spells(class_id).map((s) => s.object_id)
    read_spell_state(character.id, ids)
      .then(set_chain_alloc) // merge_confirmed FLOORS this — a stale read can never regress the receipt
      .catch(() => {}) // keep the confirmed projection — the next mount/refetch reconciles
  }
  // PREDICT ON RECEIPT (#39, CLIENT-INDEPENDENCE law): a proven raise_spell_level success records the projection
  // (spell +1, spent +cost) into the shared session — it survives this drawer's remounts and FLOORS the chain
  // read until the fullnode indexes the tx. No optimistic-before-receipt paint (so no rollback on an abort).
  const on_upgraded = (spell_id, cost) => {
    if (!character?.id) return
    record_confirmed_spell(character.id, apply_upgrade_receipt(confirmed, chain_alloc, spell_id, cost))
    refetch()
  }

  if (!character || !book)
    return (
      <div className="sb">
        <div className="sb__empty">{t('spells.no_character')}</div>
      </div>
    )

  const cls = get_class(character.classe ?? character.class_id)
  // Coverage audit (read all spell effects for all levels): a LOCKED row (class unlock not yet reached) is
  // still SELECTABLE for reading — aspirational browsing is the point, the grimoire is a reference for every
  // class spell, not just the ones already usable. The unlocked-first fallback only kicks in when nothing has
  // been explicitly picked yet (sel_id null on mount) — once picked, the exact row (locked or not) sticks.
  const selected = book.rows.find((r) => r.id === sel_id) ?? book.rows.find((r) => r.unlocked) ?? book.rows[0]

  const TABS = [
    { key: 'inventory', label: t('spells.tab_gear') },
    { key: 'stats', label: t('spells.tab_stats') },
    { key: 'spells', label: t('spells.tab_spells'), active: true },
    { key: 'jobs', label: t('spells.tab_jobs') },
  ]

  return (
    <div className="sb">
      {/* header — identity + spell-points capital */}
      <div className="sb__top">
        <div className="sb__crest">
          <span className="sb__sigil">⚔</span>
          <div>
            <div className="sb__name">{character.name}</div>
            <div className="sb__sub">
              {cls?.title ?? character.classe} · {t('spells.level', { level: book.level })}
            </div>
          </div>
        </div>
        <div className="sb__points">
          <div>
            <div className="sb__points-lab">{t('spells.spell_points')}</div>
            <div className="sb__points-sub">{t('spells.available')}</div>
          </div>
          {/* '—' until the chain allocation lands — never a guessed capital (the spend gate waits too) */}
          <div className="sb__points-val">{alloc ? book.points : '—'}</div>
        </div>
      </div>

      {/* tab strip (canon) — SPELLS active; the rest deep-link to their drawers. HIDDEN when EMBEDDED in the
          CharactersDrawer detail strip (which owns EQUIPMENT/STATS/SPELLS/JOBS nav) — no double strip. */}
      {!embedded && (
        <div className="sb__tabs">
          {TABS.map((tab) => (
            <button
              type="button"
              key={tab.key}
              className={`sb__tab${tab.active ? ' is-active' : ''}`}
              onClick={() => !tab.active && on_open?.(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      <div className="sb__main">
        {/* LIST */}
        <div className="sb__list">
          <div className="sb__lhead">
            <span className="sb__lhead-t">{t('spells.grimoire')}</span>
            <span className="sb__lhead-n">
              {t('spells.unlocked', { unlocked: book.unlocked_count, total: book.total })}
            </span>
          </div>
          <div className="sb__rows">
            {book.rows.map((row) => {
              const name = chain_copy(t, row.name_key, '', row.name)
              return (
                <button
                  type="button"
                  key={row.id}
                  onClick={() => set_sel(row.id)}
                  className={`sb__row${row.id === selected?.id ? ' is-sel' : ''}${row.unlocked ? '' : ' is-locked'}`}
                  style={/** @type {import('react').CSSProperties} */ ({ '--el': row.color })}
                >
                  <Art icon={row.icon} color={row.color} name={name} cls="sb__ic" />
                  <span className="sb__meta">
                    <span className="sb__nm">{name}</span>
                    <span className="sb__rl">
                      {row.unlocked
                        ? `${seed_el_label(t, row.subline_kind)} · ${t(`spells.tag_${row.subline_descriptor}`)}`
                        : t('spells.locked')}
                    </span>
                  </span>
                  <span className="sb__right">
                    {row.unlocked ? (
                      <>
                        <span className="sb__lvbadge">
                          {t('spells.lv_of', { cur: row.current_level, max: MAX_SPELL_LEVEL })}
                        </span>
                        <span className="sb__dot" />
                      </>
                    ) : (
                      <span className="sb__lockchip">🔒 {t('spells.unlocks_at', { level: row.unlock_tier })}</span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* DETAIL — keyed on the spell id so the level-tab selection resets per spell (the panel itself
            follows async current-level changes; a value-key here would remount MID-FLIGHT when the receipt
            projection lands and drop the in-flight guard). */}
        {selected ? (
          <SpellDetailPanel
            key={selected.id}
            t={t}
            row={selected}
            char_level={book.level}
            points={book.points}
            character_id={character.id}
            ready={!!chain_alloc && !chain_alloc.degraded}
            on_upgraded={on_upgraded}
          />
        ) : (
          <div className="sb__detail">
            <div className="sb__empty">{t('spells.select_prompt')}</div>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * The right-hand per-spell detail: identity header → clickable LEVEL TABS (1..6, locked
 * levels above the current one stay BROWSABLE for a preview) → the selected level's facts strip → DESCRIPTION
 * → EFFECTS (punchy token-coloured one-liners) → the UPGRADE button (current → current+1, gated by
 * upgrade_state, independent of the browsed level). Keyed on spell id so `sel` resets to the current level.
 */
function SpellDetailPanel({ t, row, char_level, points, character_id, ready, on_upgraded }) {
  const cur = row.current_level
  const name = chain_copy(t, row.name_key, '', row.name)
  const description = chain_copy(t, row.name_key, '_desc') // null (renders nothing) until a locale ships one
  const [sel, set_sel] = useState(Math.max(1, cur)) // the BROWSED level (defaults to the real current level)
  const [upgrading, set_upgrading] = useState(false) // in-flight guard (one tx per spell at a time)
  // Follow the REAL current level when it changes under the panel (the async allocation landing, a proven
  // upgrade's receipt projection) — the browsed tab snaps to the new truth, exactly like the mount default.
  useEffect(() => set_sel(Math.max(1, cur)), [cur])
  const sl = row.levels[sel - 1]
  const crit = crit_pct(sl)
  const state = upgrade_state(row, char_level, points)
  const effects = spell_effects(sl)

  // #17d/#17e/#55 — the CTA is a COMPACT "LEVEL UP SPELL · N pts" button. It ENABLES only when the chain
  // allocation is LOADED (`ready` — never an enable on a guess) and the client predicts an on-chain SUCCESS
  // (`state === 'enabled'`: the target level's min_char_level met AND points ≥ the S8 cost) and no tx is in
  // flight; otherwise it is honestly DISABLED — never a dead click — with the reason in its tooltip (level
  // short → requires_lv; points short → no_points). Predict-failure law: we never fire a tx the chain
  // would reject, so the only failure path is a stale-read race (→ one humanized toast; the projection is only
  // ever recorded on a proven receipt, so there is nothing to undo).
  const can_level_up = ready && state.state === 'enabled' && !upgrading
  const level_up_hint =
    upgrading || !ready
      ? undefined
      : state.state === 'enabled'
        ? undefined
        : state.state === 'char_short'
          ? t('spells.requires_lv', { level: state.req })
          : t('spells.no_points')

  // #55 PREDICT-ON-RECEIPT upgrade: fire the permissionless `raise_spell_level` PTB against the row's own
  // SpellTemplate object, and ONLY on the proven success record the durable projection (on_upgraded → the shared
  // session that floors the chain read) + a quiet refetch; an abort surfaces ONE humanized toast, nothing to undo.
  const on_level_up = async () => {
    if (!can_level_up) return
    set_upgrading(true)
    try {
      const { timing } = await upgrade_spell({ character_id, spell_template_id: row.id })
      mark_ui_updated(timing)
      on_upgraded(row.id, state.cost) // PREDICT on the proven receipt (record the confirmed projection) + refetch
      use_toast.getState().add(t('spells.upgrade_success', { spell: name }), 'info')
    } catch (error) {
      // run_tx already humanized a chain abort (spell_level codes 101-104 → player copy); our own throws pass.
      // Nothing to roll back — the projection is recorded ONLY on the proven receipt (predict-on-receipt law).
      use_toast.getState().add(error?.message || t('errors.tx_failed'), 'error')
    } finally {
      set_upgrading(false)
    }
  }

  const facts = [
    { k: t('spells.ap_cost'), v: `${sl?.ap ?? '—'}` },
    { k: t('spells.range'), v: sl ? `${sl.range[0]}–${sl.range[1]}` : '—' },
    { k: t('spells.cooldown'), v: sl?.cooldown > 0 ? `${sl.cooldown}` : '—' },
    {
      k: t('spells.crit_chance'),
      v:
        crit > 0 ? (
          <>
            {crit}
            <small>%</small>
          </>
        ) : (
          '—'
        ),
    },
    // #55 reference-standard lines, DATA-TRUE off the chain SpellLevel (spell_effect.move): casts_per_turn
    // (u8; 255 = spell_bands::CASTS_UNLIMITED) + modifiable_range (bool). Seed uniform (255/false).
    {
      k: t('spells.casts_per_turn'),
      v: sl ? (sl.casts_per_turn === 255 ? t('spells.unlimited') : `${sl.casts_per_turn}`) : '—',
    },
    { k: t('spells.modifiable_range'), v: sl ? t(sl.modifiable_range ? 'spells.yes' : 'spells.no') : '—' },
  ]

  return (
    <div className="sb__detail" style={/** @type {import('react').CSSProperties} */ ({ '--el': row.color })}>
      <div className="sb__dhead">
        <Art icon={row.icon} color={row.color} name={name} cls="sb__bigic" />
        <div className="sb__dtitle">
          <h2>{name}</h2>
          <div className="sb__tagrow">
            <span className="sb__chip sb__chip--el">
              <span className="sb__chip-d" />
              {seed_el_label(t, row.subline_kind)}
            </span>
            <span className="sb__chip sb__chip--type">{t(`spells.tag_${row.subline_descriptor}`)}</span>
            <span className="sb__clvl">
              {t('spells.current_level')}{' '}
              <b>
                {cur} / {MAX_SPELL_LEVEL}
              </b>
            </span>
          </div>
        </div>
      </div>

      {/* LEVEL TABS 1..6 — locked (above the current level) stay clickable to PREVIEW their numbers. */}
      <div className="sb__ltabs">
        <span className="sb__ltabs-lab">{t('spells.levels_head')}</span>
        <div className="sb__ltabs-row">
          {Array.from({ length: MAX_SPELL_LEVEL }, (_, i) => {
            const lv = i + 1
            return (
              <button
                type="button"
                key={lv}
                onClick={() => set_sel(lv)}
                className={`sb__ltab${lv === sel ? ' is-sel' : ''}${lv === cur ? ' is-cur' : ''}${lv > cur ? ' is-locked' : ''}`}
              >
                {lv}
              </button>
            )
          })}
        </div>
      </div>

      {/* selected-level readout — AP / RANGE / AREA / CRIT re-render for the browsed level. */}
      <div className="sb__sgrid">
        {facts.map((f) => (
          <div className="sb__scell" key={f.k}>
            <div className="sb__scell-k">{f.k}</div>
            <div className="sb__scell-v">{f.v}</div>
          </div>
        ))}
      </div>

      {/* DESCRIPTION (first) */}
      {description && (
        <div className="sb__desc">
          <span className="sb__desc-lab">{t('spells.description')}</span>
          {description}
        </div>
      )}

      {/* EFFECTS — compact LINES (no cards, just lines): stat icon / element dot leading,
          grey text, only the VALUE coloured (+1 AP grammar), duration/crit/zone as a dim meta suffix.
          One renderer (EffectLine) + one grammar (seed_effect_parts) shared with the encyclopedia. */}
      {effects.length > 0 && (
        <div className="sb__fx">
          <span className="sb__desc-lab">{t('spells.effects')}</span>
          <div className="sb__fx-list">
            {effects.map((fx, i) => (
              <EffectLine key={i} view={seed_effect_parts(t, fx)} />
            ))}
          </div>
        </div>
      )}

      {/* UPGRADE (last) — always current → current+1, regardless of the browsed preview level. */}
      {state.state === 'mastered' ? (
        <div className="sb__mastered">{t('spells.mastered')}</div>
      ) : (
        <div className="sb__lup">
          {/* NO level-preview strip here — the LEVEL TABS above are how you browse other
              levels. This card used to ALSO repeat the spell-points counter the top
              header (.sb__points) already shows — a duplicate. It now carries ONLY the LEVEL-UP button. */}
          <div className="sb__actions">
            <button
              type="button"
              className={`sb__btn-compact${can_level_up ? ' sb__btn-gold' : ' sb__btn-off'}`}
              disabled={!can_level_up}
              title={level_up_hint}
              onClick={on_level_up}
            >
              {upgrading
                ? t('spells.upgrading')
                : `${t('spells.level_up_spell')} · ${t('spells.pts', { count: state.cost })}`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// The SEED effect → line + element/family label helpers now live in seed-effect-line.js (shared with the
// in-fight dungeon armed readout — one wording source). Imported at the top as seed_effect_line / seed_el_label.
