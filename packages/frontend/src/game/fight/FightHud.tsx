// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The production fight HUD. It is a pure reader of the shared fight projection; its two
// commands re-enter the same fight input door as board and streamed actions.

import { CONTRACT_CONSTANTS } from '@aresrpg/fight'
import { Swords } from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'

import { ModalFrame } from '../../components/ModalFrame.tsx'
import type { AppCopy } from '../../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../../store.ts'

import {
  select_fight_view,
  type FightActionSelection,
  type FightFighterView,
  type FightSpellView,
} from './fight_projection.ts'
import { active_effect_lines, FightEffectLines } from './FightEffectLines.tsx'
import { Chat } from '../../components/Chat.tsx'
import './fight_hud.css'

const LazyFightSpell = lazy(() => import('./FightSpell.tsx').then(({ FightSpell }) => ({ default: FightSpell })))

const template = (source: string, values: Readonly<Record<string, string | number>>): string =>
  Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), source)

const percent = (value: bigint, maximum: bigint): number =>
  maximum <= 0n ? 0 : Math.max(0, Math.min(100, Number((value * 10_000n) / maximum) / 100))

const FightTimeline = ({
  fighters,
  label,
  focus,
}: Readonly<{
  fighters: readonly FightFighterView[]
  label: string
  focus: (fighter: bigint | null) => void
}>) => (
  <aside aria-label={label} className="fight-hud__turns">
    {fighters.map((fighter) => (
      <article
        className={`fight-hud__turn ${fighter.team === 0n ? 'ally' : 'enemy'}${fighter.active ? ' active' : ''}${fighter.dead ? ' dead' : ''}`}
        key={fighter.seat.toString()}
        onBlur={() => focus(null)}
        onFocus={() => focus(fighter.seat)}
        onMouseEnter={() => focus(fighter.seat)}
        onMouseLeave={() => focus(null)}
        tabIndex={0}
      >
        <div aria-hidden="true" className="fight-hud__portrait">
          {fighter.name.slice(0, 1).toUpperCase()}
        </div>
        <div className="fight-hud__turn-body">
          <div className="fight-hud__turn-id">
            <span className="fight-hud__turn-name">{fighter.name}</span>
            <span className="fight-hud__turn-level">Lv {fighter.level.toString()}</span>
          </div>
          <div className="fight-hud__turn-hp" title={`${fighter.hp} / ${fighter.max_hp} HP`}>
            <span style={{ width: `${percent(fighter.hp, fighter.max_hp)}%` }} />
            <b>{fighter.hp.toString()}</b>
          </div>
          {fighter.effects.length > 0 && <FightEffectLines effects={active_effect_lines(fighter.effects)} />}
        </div>
      </article>
    ))}
  </aside>
)

const StatGem = ({ kind, value }: Readonly<{ kind: 'ap' | 'mp'; value: bigint }>) => (
  <div aria-label={`${kind.toUpperCase()} ${value}`} className={`fight-hud__gem fight-hud__gem--${kind}`}>
    <i />
    <span>{value.toString()}</span>
  </div>
)

const FightVitals = ({
  fighter,
  can_act,
  selected_action,
  select_action,
  text,
}: Readonly<{
  fighter: FightFighterView
  can_act: boolean
  selected_action: FightActionSelection
  select_action: (action: FightActionSelection) => void
  text: Readonly<Record<string, string>>
}>) => {
  const [percent_visible, set_percent_visible] = useState(false)
  const weapon_label = fighter.weapon?.bare_hands ? text.bare_hands : text.weapon_attack
  const weapon_spell: FightSpellView | null = fighter.weapon
    ? Object.freeze({
        name: weapon_label,
        level: 1n,
        details: fighter.weapon.details,
        source: Object.freeze({ classe: '', unlock_level: 1n, levels: [fighter.weapon.details] }),
        cooldown: 0n,
        turn: fighter.weapon.turn,
      })
    : null
  const card_count = fighter.spells.length + (weapon_spell ? 1 : 0)
  return (
    <>
      <div className="fight-hud__vitals">
        <button
          className="fight-hud__hp-gem"
          onClick={() => set_percent_visible((visible) => !visible)}
          title={`${fighter.hp} / ${fighter.max_hp} HP`}
          type="button"
        >
          <i />
          {percent_visible ? (
            <span>{Math.round(percent(fighter.hp, fighter.max_hp))}%</span>
          ) : (
            <span>
              {fighter.hp.toString()}
              <b />
              {fighter.max_hp.toString()}
            </span>
          )}
        </button>
        <div className="fight-hud__stat-gems">
          <StatGem kind="ap" value={fighter.ap} />
          <StatGem kind="mp" value={fighter.mp} />
        </div>
      </div>
      <div
        className="fight-hud__spells"
        style={{ gridTemplateColumns: `repeat(${Math.max(1, Math.ceil(card_count / 2))}, 50px)` }}
      >
        {weapon_spell && (
          <Suspense fallback={<div className="fight-hud__spell disabled" />}>
            <LazyFightSpell
              disabled={!can_act || fighter.ap < weapon_spell.details.ap_cost}
              fallback_icon={<Swords aria-hidden="true" size={25} strokeWidth={1.6} />}
              select={() => select_action(selected_action?.type === 'weapon' ? null : { type: 'weapon' })}
              selected={selected_action?.type === 'weapon'}
              spell={weapon_spell}
            />
          </Suspense>
        )}
        {fighter.spells.map((spell) => {
          const disabled = !can_act || spell.cooldown > 0n || fighter.ap < spell.details.ap_cost
          return (
            <Suspense fallback={<div className={`fight-hud__spell${disabled ? ' disabled' : ''}`} />} key={spell.name}>
              <LazyFightSpell
                disabled={disabled}
                select={() =>
                  select_action(
                    selected_action?.type === 'spell' && selected_action.name === spell.name
                      ? null
                      : { type: 'spell', name: spell.name }
                  )
                }
                selected={selected_action?.type === 'spell' && selected_action.name === spell.name}
                spell={spell}
              />
            </Suspense>
          )
        })}
      </div>
    </>
  )
}

// 6px is the radius this HUD's own controls carry (`.fight-hud__controls button`)
const BANNER_BUTTON = 'mt-1 rounded-[6px] px-4 py-1.5 text-[10px] tracking-[0.14em]'

const PlacementBanner = ({
  deadline,
  text,
  ready,
  sides_manned,
  can_forfeit,
  on_ready,
  on_force_start,
  on_forfeit,
}: Readonly<{
  deadline: bigint | null
  text: Readonly<Record<string, string>>
  /** null hides the button (local fights pre-ready everyone); true disables it (already ready) */
  ready: boolean | null
  /** false = a side is empty, so the chain would refuse a start (fight.move `start`) */
  sides_manned: boolean
  can_forfeit: boolean
  on_ready: () => void
  on_force_start: () => void
  on_forfeit: () => void
}>) => {
  const [now, set_now] = useState(() => Date.now())
  useEffect(() => {
    if (deadline === null) return undefined
    const timer = setInterval(() => set_now(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [deadline])
  const seconds = deadline === null ? null : Math.max(0, Math.ceil((Number(deadline) - now) / 1_000))
  // the window closed with someone still unready — every participant may force the start
  // (the chain door admits anyone once the placement deadline passes)
  const stalled = sides_manned && ready !== null && seconds === 0
  return (
    <div className="fight-hud__placement" role="status">
      <span>{text.placement_title}</span>
      {/* an empty side has nobody to wait for: a countdown would be theatre */}
      {seconds !== null && sides_manned && (
        <strong className={seconds <= 10 ? 'urgent' : ''}>0:{String(seconds).padStart(2, '0')}</strong>
      )}
      <small>
        {!sides_manned ? text.placement_no_opponent : stalled ? text.placement_force_prompt : text.placement_hint}
      </small>
      {sides_manned && ready !== null && !stalled && (
        <button className={`btn-gold ${BANNER_BUTTON}`} disabled={ready} onClick={on_ready} type="button">
          {ready ? text.placement_waiting : text.placement_ready}
        </button>
      )}
      {stalled && (
        <button className={`btn-gold ${BANNER_BUTTON}`} onClick={on_force_start} type="button">
          {text.placement_force_button}
        </button>
      )}
      {/* leaving is legal for the whole of placement, not only when a side is empty: an
          opponent who joins and then vanishes strands you exactly the same way */}
      {can_forfeit && (
        <button className={`btn-outline ${BANNER_BUTTON}`} onClick={on_forfeit} type="button">
          {text.forfeit}
        </button>
      )}
    </div>
  )
}

/** The stall clearance — any non-acting participant may force a 45s-dead turn to pass. */
const CrankBanner = ({
  turn_started_ms,
  now,
  on_crank,
  text,
}: Readonly<{
  turn_started_ms: bigint
  now: number
  on_crank: () => void
  text: Readonly<Record<string, string>>
}>) => {
  const crank_at = turn_started_ms + CONTRACT_CONSTANTS.turn_max_ms
  if (BigInt(now) < crank_at) return null
  return (
    <div className="fight-hud__crank" role="status">
      <span>{text.crank_prompt}</span>
      <button onClick={on_crank} type="button">
        {text.crank_button}
      </button>
    </div>
  )
}

export const FightHud = ({
  copy,
  focus_fighter,
  selected_action,
  select_action,
  actions_locked,
  presented_turn_seat = null,
}: Readonly<{
  copy: AppCopy
  focus_fighter?: (fighter: bigint | null) => void
  selected_action: FightActionSelection
  select_action: (action: FightActionSelection) => void
  actions_locked: boolean
  // the seat whose TURN CUE is currently presented: the timeline card follows the played
  // cues (mob turns hold their floor), never the canonical head that reconciles instantly
  presented_turn_seat?: bigint | null
}>) => {
  const fight = useAppStore((state) => state.fight)
  const session = useAppStore((state) => state.session)
  const simulator = useAppStore((state) => state.simulator)
  const [forfeit_open, set_forfeit_open] = useState(false)
  const [now, set_now] = useState(() => Date.now())
  const names = useMemo(
    () =>
      Object.freeze(
        Object.fromEntries([
          ...session.characters.map(({ id, name }) => [id, name]),
          ...simulator.characters.map(({ id, name }) => [id, name]),
        ])
      ),
    [session.characters, simulator.characters]
  )
  const view = useMemo(
    () =>
      fight.checkpoint && fight.mode
        ? select_fight_view({
            checkpoint: fight.checkpoint,
            mode: fight.mode,
            owner: fight.mode === 'local' ? 'local' : (session.wallet?.address ?? null),
            names,
          })
        : null,
    [fight.checkpoint, fight.mode, names, session.wallet?.address]
  )
  const ready_at = fight.checkpoint ? fight.checkpoint.contract.turn_started_ms + CONTRACT_CONSTANTS.turn_min_ms : 0n
  const min_turn_ready = BigInt(now) >= ready_at

  useEffect(() => {
    if (!view?.can_end_turn || min_turn_ready) return undefined
    const timer = setInterval(() => set_now(Date.now()), 100)
    return () => clearInterval(timer)
  }, [min_turn_ready, view?.can_end_turn])

  // the stall watch: while SOMEONE ELSE holds the turn in a remote fight, a slow clock keeps
  // `now` honest so the crank banner appears the second the chain would accept the clearance
  const watching_stall = fight.mode === 'remote' && view?.phase === 'active' && !view.can_end_turn
  useEffect(() => {
    if (!watching_stall) return undefined
    const timer = setInterval(() => set_now(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [watching_stall])

  useEffect(() => {
    if (!view?.can_end_turn || !view.selected || actions_locked) return undefined
    const keydown = (event: Readonly<KeyboardEvent>): void => {
      if (event.code === 'Escape') {
        select_action(null)
        return
      }
      if (event.code === 'Backquote') {
        if (!view.selected?.weapon || view.selected.ap < view.selected.weapon.details.ap_cost) return
        event.preventDefault()
        select_action(selected_action?.type === 'weapon' ? null : { type: 'weapon' })
        return
      }
      const match = /^(?:Numpad|Digit)([0-9])$/.exec(event.code)
      if (!match) return
      const number = Number(match[1])
      const index = number === 0 ? 9 : number - 1
      const spell = view.selected?.spells[index]
      if (!spell || spell.cooldown > 0n || view.selected.ap < spell.details.ap_cost) return
      event.preventDefault()
      select_action(
        selected_action?.type === 'spell' && selected_action.name === spell.name
          ? null
          : { type: 'spell', name: spell.name }
      )
    }
    globalThis.addEventListener('keydown', keydown)
    return () => globalThis.removeEventListener('keydown', keydown)
  }, [actions_locked, select_action, selected_action, view])

  if (!view || !fight.checkpoint) return null
  if (view.phase === 'placement') {
    const own_seat = view.selected?.seat
    const own_ready =
      fight.mode === 'remote' && own_seat !== undefined
        ? (fight.checkpoint.contract.fighters[Number(own_seat)]?.ready ?? false)
        : null
    // the `--fh-*` palette, the mono face and the card's own chrome are all declared on
    // `.fight-hud`; a banner rendered outside it inherits nothing and reads as bare text
    return (
      <div className="fight-hud">
        <PlacementBanner
          can_forfeit={view.can_forfeit}
          deadline={view.placement_deadline_ms}
          on_force_start={() =>
            dispatch_app({
              type: 'fight/input',
              origin: 'local',
              input: { type: 'start', observed_ms: BigInt(Date.now()) },
            })
          }
          on_forfeit={() =>
            own_seat !== undefined &&
            dispatch_app({ type: 'fight/input', origin: 'local', input: { type: 'forfeit', fighter: own_seat } })
          }
          on_ready={() =>
            own_seat !== undefined &&
            dispatch_app({ type: 'fight/input', origin: 'local', input: { type: 'ready', fighter: own_seat } })
          }
          ready={own_ready}
          sides_manned={view.sides_manned}
          text={copy.fight_hud}
        />
      </div>
    )
  }
  if (view.phase !== 'active' || !view.selected) return null
  const selected = view.selected
  const end_turn = (): void =>
    dispatch_app({
      type: 'fight/input',
      origin: 'local',
      input: { type: 'end_turn', fighter: selected.seat, observed_ms: BigInt(Date.now()) },
    })
  const forfeit = (): void => {
    set_forfeit_open(false)
    dispatch_app({
      type: 'fight/input',
      origin: 'local',
      input: { type: 'forfeit', fighter: selected.seat },
    })
  }
  const reset_turn = (): void => {
    select_action(null)
    dispatch_app({ type: 'fight/reset_turn' })
  }

  return (
    <div className="fight-hud">
      {watching_stall && (
        <CrankBanner
          turn_started_ms={fight.checkpoint.contract.turn_started_ms}
          now={now}
          on_crank={() =>
            dispatch_app({
              type: 'fight/input',
              origin: 'local',
              input: { type: 'crank', observed_ms: BigInt(Date.now()) },
            })
          }
          text={copy.fight_hud}
        />
      )}
      <FightTimeline
        fighters={
          presented_turn_seat === null
            ? view.timeline
            : view.timeline.map((fighter) =>
                Object.freeze({ ...fighter, active: fighter.seat === presented_turn_seat })
              )
        }
        focus={focus_fighter ?? (() => undefined)}
        label={copy.fight_hud.turn_order}
      />
      <Chat
        names={Object.fromEntries(view.timeline.map(({ seat, name }) => [Number(seat), name]))}
        self_name={selected.name}
        // stat_* display names live in ONE home (simulator_page, stat_name's section) — the
        // chat resolves them through this merge instead of carrying duplicate rows
        text={{ ...copy.simulator_page, ...copy.fight_hud }}
      />
      <div className="fight-hud__bottom">
        <div className="fight-hud__bar">
          <div className="fight-hud__controls">
            <button
              className="fight-hud__end-turn"
              disabled={!view.can_end_turn || !min_turn_ready || actions_locked}
              onClick={end_turn}
              type="button"
            >
              {copy.fight_hud.end_turn}
            </button>
            <div className="fight-hud__secondary-controls">
              {fight.mode === 'local' && (
                <button disabled={actions_locked} onClick={reset_turn} type="button">
                  {copy.fight_hud.reset_turn}
                </button>
              )}
              <button
                className="fight-hud__forfeit"
                disabled={!view.can_forfeit || actions_locked}
                onClick={() => set_forfeit_open(true)}
                type="button"
              >
                {copy.fight_hud.forfeit}
              </button>
            </div>
          </div>
          <FightVitals
            can_act={view.can_end_turn && !actions_locked}
            fighter={selected}
            select_action={select_action}
            selected_action={selected_action}
            text={copy.fight_hud}
          />
        </div>
      </div>
      {forfeit_open && (
        <ModalFrame
          close={() => set_forfeit_open(false)}
          close_label={copy.dismiss}
          label={template(copy.fight_hud.forfeit_title, { name: selected.name })}
        >
          <div className="p-7">
            <h2 className="text-sm font-semibold tracking-[0.16em] text-[#f87171] uppercase">
              {template(copy.fight_hud.forfeit_title, { name: selected.name })}
            </h2>
            <p className="mt-4 text-[11px] leading-6 text-[#a3a5ad]">
              {template(copy.fight_hud.forfeit_body, { name: selected.name })}
            </p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                className="h-11 cursor-pointer border border-white/10 text-[9px] tracking-[0.16em] uppercase"
                onClick={() => set_forfeit_open(false)}
                type="button"
              >
                {copy.cancel}
              </button>
              <button
                className="h-11 cursor-pointer border border-[#f87171]/50 bg-[#2a1014] text-[9px] tracking-[0.16em] text-[#f87171] uppercase"
                onClick={forfeit}
                type="button"
              >
                {copy.fight_hud.confirm_forfeit}
              </button>
            </div>
          </div>
        </ModalFrame>
      )}
    </div>
  )
}
