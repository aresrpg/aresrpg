// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// JOB level-up congrats card — the sibling of LevelUp.jsx (character), for a GATHER/CRAFT job crossing a
// level. Same locked house language as the character card (opaque .result--fe ground, the glowing level
// number in a ring, the ice-blue accent, mono nums) reusing result.css atoms, so the two celebrations read
// as one family. Gated off the discrete `job_level_up` slice owned by core/modules/job_progression.js.
//
// The card names the CONCRETE gains, never a bare "you leveled" — via level_unlocks.js: a gathering job
// shows the resources now gatherable + whether the per-node yield stepped up (chain gather-yield formula,
// off the @aresrpg/sdk/jobs roster); a craft job shows the recipes now craftable, resolved from the LIVE
// `/v1` crafting projection (issue #800 — it used to read the bundled seed catalog, `{}` in this repo BY
// CONSTRUCTION, so a craft level-up could never announce a recipe). Sections with nothing to show are
// omitted (no empty card) — except an in-flight recipe read, which shows a loading row rather than lying
// by omission. Persists until the player dismisses it (issue #369 pair — no auto-dismiss timer); hides
// while the character level-up / fight-result cards are up (never card-over-card).

import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { JOB_CATEGORY, JOBS, get_job, item_icon_url } from '@aresrpg/sdk/jobs'

import { use_game_state, context } from '../../store.js'
import { play_fight_sfx } from '../../core/audio/sfx.js'
import { get_encyclopedia } from '../../../rpc/client'
import { use_rpc_view } from '../../../rpc/use_view'
import { craft_recipes_for_job } from '../../../pages/encyclopedia/recipes'
import { job_unlocks } from './level_unlocks.js'
import './result.css'
import './joblevelup.css'

/**
 * One unlocked resource/recipe chip — the real assets-CDN art with a tasteful glyph fallback (the JobsDrawer
 * ItemIcon pattern: a blocked/missing asset never renders a broken-image box).
 * @param {{ icon: string, name: string }} props
 * @returns {import('react').JSX.Element}
 */
function UnlockChip({ icon, name }) {
  const [failed, set_failed] = useState(false)
  const url = item_icon_url(icon)
  return (
    <span className="jlu-chip">
      <span className="jlu-chip__art" aria-hidden="true">
        {url && !failed ? (
          <img
            src={url}
            alt=""
            crossOrigin="anonymous"
            width={22}
            height={22}
            referrerPolicy="no-referrer"
            onError={() => set_failed(true)}
            onLoad={(event) => {
              if (!event.currentTarget.naturalWidth) set_failed(true)
            }}
          />
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M12 3 21 12 12 21 3 12Z" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <span className="jlu-chip__name">{name}</span>
    </span>
  )
}

/**
 * The job level-up congrats card. Renders null when no job level-up is pending (or while a character-level /
 * fight-result card is up).
 * @returns {import('react').JSX.Element | null}
 */
export function JobLevelUp() {
  const { t } = useTranslation()
  const job_level_up = use_game_state(s => s.job_level_up)
  // Never card-over-card: the character level-up + the end-fight result own the center stage first.
  const blocked = use_game_state(s => !!s.level_up || !!s.fight_result)
  const visible = !!job_level_up && !blocked

  const job_id = job_level_up?.job_id ?? null
  const job = job_id ? get_job(job_id) : null
  // The live crafting corpus (issue #800) — the SAME batched, session-cached `/v1/encyclopedia` read the
  // Jobs drawer projects through `craft_recipes_for_job`, so the card announces exactly what the drawer
  // will let the player craft. A gathering job crafts nothing, so it never fires the read.
  const is_craft = !!job && job.category !== JOB_CATEGORY.GATHERING
  const { data: encyclopedia, loading } = use_rpc_view((signal) => get_encyclopedia(undefined, signal), {
    enabled: visible && is_craft,
    deps: [job_id],
  })
  const job_index = useMemo(() => JOBS.findIndex(j => j.id === job_id), [job_id])
  const craft_rows = useMemo(
    () => craft_recipes_for_job(encyclopedia?.recipes, encyclopedia?.items, job_index),
    [encyclopedia, job_index]
  )

  // First paint of the card: play the win-family SFX. Issue #369 pair: the card used to auto-dismiss on a
  // timer — deleted. It now persists until the player explicitly presses the CTA below; nothing else may
  // unmount it.
  useEffect(() => {
    if (!visible) return
    play_fight_sfx('win')
  }, [visible])

  if (!visible) return null

  const { level, levels_gained } = job_level_up
  const unlocks = job_unlocks(job_id, level - levels_gained, level, { recipes: craft_rows, loading })
  const dismiss = () => context.dispatch('action/job_level_up/close')

  return (
    <div className="hud-middle lvlup-stage jlu-stage">
      <div
        className="result result--tall result--fe"
        role="dialog"
        aria-modal="true"
        aria-label={t('job_level_up.aria_label', { job: job?.label ?? job_id, level })}
      >
        <div className="lvllabel">{t('job_level_up.title')}</div>

        <div className="lvlhero">
          <div className="lvlring" />
          <span className="spark" style={{ left: '26%', top: '16px', width: '5px', height: '5px' }} />
          <span
            className="spark"
            style={{ left: '72%', top: '30px', width: '4px', height: '4px', animationDelay: '90ms' }}
          />
          <div className="lvlnum">
            <span className="pre">{t('job_level_up.reached')}</span>
            {level}
          </div>
        </div>

        {job && (
          <div className="lvlcap">
            {job.label} &middot; {t(`jobs.category.${job.category}`)}
          </div>
        )}

        {unlocks.has_any && <hr className="hr" />}

        {/* Gathering: newly gatherable resources */}
        {unlocks.resources.length > 0 && (
          <div className="jlu-sec">
            <div className="jlu-lbl">
              {t('job_level_up.new_resources')} <span className="hud-num">({unlocks.resources.length})</span>
            </div>
            <div className="jlu-chips">
              {unlocks.resources.map(r => (
                <UnlockChip key={r.id} icon={r.icon} name={r.name} />
              ))}
            </div>
          </div>
        )}

        {/* Craft: the live recipe read still in flight — a loading row, never a silent omission that would
            claim the level-up opened nothing (cache law: absence is not emptiness). */}
        {unlocks.recipes_loading && (
          <div className="jlu-sec">
            <div className="jlu-lbl">{t('job_level_up.new_recipes')}</div>
            <div className="jlu-chips">
              <span className="jlu-chip">
                <span className="jlu-chip__name">{t('common.loading')}</span>
              </span>
            </div>
          </div>
        )}

        {/* Craft: newly craftable recipes. The chip art is the row's on-chain `item_type` — the key the
            assets CDN serves `items/{item_type}.png` under; the Sui object id is not an art identity. */}
        {unlocks.recipes.length > 0 && (
          <div className="jlu-sec">
            <div className="jlu-lbl">
              {t('job_level_up.new_recipes')} <span className="hud-num">({unlocks.recipes.length})</span>
            </div>
            <div className="jlu-chips">
              {unlocks.recipes.map(r => (
                <UnlockChip key={r.recipe_id} icon={r.item_type} name={r.name?.trim() || r.item_type} />
              ))}
            </div>
          </div>
        )}

        {/* Gathering: the per-node yield stepped up (chain gather-yield formula) */}
        {unlocks.yield.improved && (
          <div className="jlu-sec">
            <div className="unlock jlu-yield">
              <div className="unlock__well">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="M2 22 16 8M17 7l5-5M14 4l6 6M9 9l4 4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div>
                <div className="unlock__l">{t('job_level_up.better_harvests')}</div>
                <div className="unlock__n">{t('job_level_up.yield_amount', { amount: unlocks.yield.amount })}</div>
                <div className="unlock__m">{t('job_level_up.yield_note')}</div>
              </div>
            </div>
          </div>
        )}

        <div className="cta">
          <button type="button" className="btn btn--primary" onClick={dismiss}>
            {t('job_level_up.dismiss')}
          </button>
        </div>
      </div>
    </div>
  )
}
