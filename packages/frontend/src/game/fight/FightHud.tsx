// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/* eslint-disable complexity -- the HUD exhaustively composes sealed placement, turn, result, and spectator states. */
// The production fight HUD. It is a pure reader of the shared fight projection; its two
// commands re-enter the same fight input door as board and streamed actions.

import { CONTRACT_CONSTANTS } from '@aresrpg/fight'
import { Button, CombatHud, ConfirmDialog } from '@aresrpg/ui'
import { Swords, Flag } from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { content_catalog } from '../../content/catalog.ts'
import { spell_name, type AppCopy } from '../../i18n/copy.ts'
import { dispatch_app, useAppStore, type AppInput } from '../../store.ts'
import { owned_placement_readiness } from '../../modules/fight_identity.ts'
import { chain_deadline_reached, chain_now } from '../../modules/chain_clock.ts'
import { END_TURN_SUBMIT_GUARD_MS } from '../../modules/fight_lifecycle.ts'
import { world_keyboard_eligible } from '../core/world_input.ts'
import { ActionSlots } from '../hud/ActionSlots.tsx'
import { VitalsDisplay } from '../hud/VitalsDisplay.tsx'

import {
  select_fight_view,
  fight_turn_key,
  fight_view_with_display,
  turn_elapsed_percent,
  turn_seconds_remaining,
  type FightActionSelection,
  type FightFighterDisplay,
  type FightFighterView,
  type FightSpellView,
} from './fight_projection.ts'
import { FightTimeline, type MobIconLookup } from './FightTimeline.tsx'
import { FightPlacementBanner } from './FightPlacementBanner.tsx'
import { fight_turn_card_view, FightTurnCard, type FightTurnAnnouncement } from './FightTurnCard.tsx'
import { WorldChat } from '../../components/Chat.tsx'
import './fight_hud.css'

const LazyFightSpell = lazy(() => import('./FightSpell.tsx').then(({ FightSpell }) => ({ default: FightSpell })))

const template = (source: string, values: Readonly<Record<string, string | number>>): string =>
  Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), source)

const submit_end_turn = (fight: string | null, fighter: bigint): void =>
  dispatch_app({
    type: 'fight/input',
    fight,
    origin: 'local',
    input: { type: 'end_turn', fighter },
  })

const FightSpells = ({
  fighter,
  can_act,
  selected_action,
  select_action,
  text,
  copy,
}: Readonly<{
  fighter: FightFighterView
  can_act: boolean
  selected_action: FightActionSelection
  select_action: (action: FightActionSelection) => void
  text: Readonly<Record<string, string>>
  copy: AppCopy
}>) => {
  const weapon_item_type = useAppStore(
    ({ session }) =>
      session.characters.find(({ id }) => id === fighter.character_id)?.equipment.find(({ slot }) => slot === 'weapon')
        ?.item_type
  )
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
  return (
    <ActionSlots capacity={20} columns={10}>
      {weapon_spell && (
        <Suspense fallback={<div className="fight-hud__spell disabled" />}>
          <LazyFightSpell
            display_name={weapon_spell.name}
            disabled={!can_act || fighter.ap < weapon_spell.details.ap_cost}
            item_type={weapon_item_type}
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
              display_name={spell_name(copy, spell.name)}
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
    </ActionSlots>
  )
}

// 6px is the radius this HUD's own controls carry (`.fight-hud__controls button`)
const BANNER_BUTTON = 'mt-1 rounded-[6px] px-4 py-1.5 text-[10px] tracking-[0.14em]'

export const placement_readiness = (
  checkpoint: Parameters<typeof owned_placement_readiness>[0],
  session: Readonly<{ wallet: Readonly<{ address: string }> | null; characters: readonly Readonly<{ id: string }>[] }>,
  submitted: readonly number[],
  remote: boolean
) => {
  const readiness = owned_placement_readiness(
    checkpoint,
    remote ? (session.wallet?.address ?? null) : 'local',
    new Set(remote ? session.characters.map(({ id }) => id) : Object.keys(checkpoint.sources.players)),
    submitted
  )
  return Object.freeze({
    ...readiness,
    show_all: !checkpoint.contract.wagered && readiness.owned_count > 1,
  })
}

export const ready_all_inputs = (remote: boolean, fight: string, fighters: readonly bigint[]): readonly AppInput[] =>
  remote
    ? [{ type: 'fight/ready_all', fight, fighters }]
    : fighters.map((fighter) => ({
        type: 'fight/input',
        fight: null,
        origin: 'local',
        input: { type: 'ready', fighter },
      }))

export const end_turn_wait_ms = (observed_at_ms: number, now_ms: number): number =>
  Math.max(0, observed_at_ms + Number(CONTRACT_CONSTANTS.turn_min_ms) + END_TURN_SUBMIT_GUARD_MS - now_ms)

const inactive_turn_clock = Object.freeze({ progress: null, seconds: null })

const fight_turn_clock = (
  mode: string | null,
  visible: boolean | undefined,
  presented_turn_seat: bigint | null,
  turn_started_ms: bigint | undefined,
  now: number | null
): Readonly<{ progress: number | null; seconds: number | null }> => {
  if (mode !== 'remote' || !visible || presented_turn_seat !== null || turn_started_ms === undefined || now === null)
    return inactive_turn_clock
  return Object.freeze({
    progress: turn_elapsed_percent(turn_started_ms, now),
    seconds: turn_seconds_remaining(turn_started_ms, now),
  })
}

const spell_action_selected = (selected_action: FightActionSelection): boolean => selected_action?.type === 'spell'

export const end_turn_intent = ({
  can_end_turn,
  actions_locked,
  min_turn_ready,
  end_turn_queued,
  end_turn_submitted,
  transaction_pending,
}: Readonly<{
  can_end_turn: boolean
  actions_locked: boolean
  min_turn_ready: boolean
  end_turn_queued: boolean
  end_turn_submitted: boolean
  transaction_pending: boolean
}>): 'queue' | 'submit' | null => {
  if (!can_end_turn || actions_locked || end_turn_queued || end_turn_submitted || transaction_pending) return null
  return min_turn_ready ? 'submit' : 'queue'
}

type CrankAttempt = Readonly<{ turn_key: string; restore_serial: number }>

export const crank_prompt_hidden = (
  attempt: CrankAttempt | null,
  turn_key: string | null,
  restore_serial: number
): boolean => attempt !== null && attempt.turn_key === turn_key && attempt.restore_serial === restore_serial

/** The stall clearance — any non-acting participant may force a 45s-dead turn to pass. */
const CrankBanner = ({
  ready,
  on_crank,
  text,
}: Readonly<{
  ready: boolean
  on_crank: () => void
  text: Readonly<Record<string, string>>
}>) => {
  if (!ready) return null
  return (
    <div className="fight-hud__crank" role="status">
      <span>{text.crank_prompt}</span>
      <button className={`btn-gold ${BANNER_BUTTON}`} onClick={on_crank} type="button">
        {text.crank_button}
      </button>
    </div>
  )
}

export const FightHud = ({
  copy,
  display_fighters = Object.freeze([]),
  focus_fighter,
  target_fighter,
  targetable_fighter_cells,
  selected_action,
  select_action,
  actions_locked,
  presentation_queued = false,
  presented_turn_seat = null,
  turn_announcement = null,
  mob_icon_for,
  names: supplied_names,
  confirmation,
}: Readonly<{
  copy: AppCopy
  confirmation?: ReactNode
  display_fighters?: readonly FightFighterDisplay[]
  focus_fighter: (fighter: Pick<FightFighterView, 'cell' | 'seat'> | null) => void
  target_fighter: (fighter: Pick<FightFighterView, 'cell' | 'seat'>, pointer_type?: string) => void
  targetable_fighter_cells: readonly bigint[]
  selected_action: FightActionSelection
  select_action: (action: FightActionSelection) => void
  actions_locked: boolean
  presentation_queued?: boolean
  mob_icon_for: MobIconLookup
  names?: Readonly<Record<string, string>>
  // the seat whose TURN CUE is currently presented: the timeline card follows the played
  // cues (mob turns hold their floor), never the canonical head that reconciles instantly
  presented_turn_seat?: bigint | null
  turn_announcement?: FightTurnAnnouncement | null
}>) => {
  const fight = useAppStore((state) => state.fight)
  const session = useAppStore((state) => state.session)
  const simulator = useAppStore((state) => state.simulator)
  const [forfeit_open, set_forfeit_open] = useState(false)
  const end_turn_button = useRef<HTMLButtonElement>(null)
  const [crank_attempt, set_crank_attempt] = useState<CrankAttempt | null>(null)
  const clock = useAppStore((state) => state.chain_clock)
  const [monotonic_ms, set_monotonic_ms] = useState(() => performance.now())
  const now = chain_now(clock, monotonic_ms)
  const names = useMemo(
    () =>
      Object.freeze(
        Object.fromEntries([
          ...session.characters.map(({ id, name }) => [id, name]),
          ...simulator.characters.map(({ id, name }) => [id, name]),
          ...content_catalog.mobs.map(({ mob_type, name }) => [mob_type, name]),
          ...Object.entries(supplied_names ?? {}),
        ])
      ),
    [session.characters, simulator.characters, supplied_names]
  )
  const canonical_view = useMemo(
    () =>
      fight.checkpoint && fight.mode
        ? select_fight_view({
            checkpoint: fight.checkpoint,
            mode: fight.mode,
            owner: fight.mode === 'local' ? 'local' : (session.wallet?.address ?? null),
            character_id: fight.mode === 'remote' ? session.selected_character_id : null,
            canonical_ended: fight.canonical_ended,
            names,
          })
        : null,
    [fight.canonical_ended, fight.checkpoint, fight.mode, names, session.selected_character_id, session.wallet?.address]
  )
  const view = useMemo(
    () => (canonical_view ? fight_view_with_display(canonical_view, display_fighters) : null),
    [canonical_view, display_fighters]
  )
  const turn_key = fight.checkpoint && view ? fight_turn_key(fight.checkpoint.contract, view.active_seat) : null
  const displayed_turn_card = fight_turn_card_view(view?.timeline ?? Object.freeze([]), turn_announcement)
  const turn_clock = fight_turn_clock(
    fight.mode,
    view?.show_turn_timer,
    presented_turn_seat,
    fight.checkpoint?.contract.turn_started_ms,
    now
  )
  const [observed_turn, set_observed_turn] = useState(() => ({ key: turn_key, at_ms: performance.now() }))
  const crank_hidden = crank_prompt_hidden(crank_attempt, turn_key, fight.restore_serial)
  useEffect(() => {
    if (observed_turn.key !== turn_key) set_observed_turn({ key: turn_key, at_ms: performance.now() })
  }, [observed_turn.key, turn_key])
  useEffect(() => {
    if (crank_attempt && !crank_hidden) set_crank_attempt(null)
  }, [crank_attempt, crank_hidden])
  const wait_ms = observed_turn.key === turn_key ? end_turn_wait_ms(observed_turn.at_ms, performance.now()) : Infinity
  const min_turn_ready = wait_ms === 0

  useEffect(() => {
    if (!view?.can_end_turn || min_turn_ready) return undefined
    const timer = setInterval(() => set_monotonic_ms(performance.now()), 100)
    return () => clearInterval(timer)
  }, [min_turn_ready, view?.can_end_turn])

  // Countdown interpolation follows the sampled chain clock; only a confirmed sample unlocks crank.
  const watching_turn_clock = fight.mode === 'remote' && view?.phase === 'active' && view.show_turn_timer
  const watching_stall = watching_turn_clock && !view?.can_end_turn
  useEffect(() => {
    if (!watching_turn_clock) return undefined
    const timer = setInterval(() => set_monotonic_ms(performance.now()), 1_000)
    return () => clearInterval(timer)
  }, [watching_turn_clock])

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
    const admitted_keydown = (event: Readonly<KeyboardEvent>): void => {
      if (!world_keyboard_eligible(event)) return
      if (event.code === 'F1') {
        event.preventDefault()
        if (!event.repeat) end_turn_button.current?.click()
        return
      }
      keydown(event)
    }
    globalThis.addEventListener('keydown', admitted_keydown)
    return () => globalThis.removeEventListener('keydown', admitted_keydown)
  }, [actions_locked, select_action, selected_action, view])

  if (!view || !fight.checkpoint) return null
  const fight_id = fight.checkpoint.contract.id
  const command_fight = fight.mode === 'remote' ? fight_id : null
  const chat_names = Object.freeze(Object.fromEntries(view.timeline.map(({ seat, name }) => [Number(seat), name])))
  const chat = <WorldChat copy={copy} fight={fight_id} names={chat_names} />
  if (view.phase === 'placement') {
    const own_seat = view.selected?.seat
    const readiness = placement_readiness(
      fight.checkpoint,
      session,
      fight.ready_submitted_seats,
      fight.mode === 'remote'
    )
    const own_ready =
      own_seat !== undefined
        ? (fight.checkpoint.contract.fighters[Number(own_seat)]?.ready ?? false) ||
          fight.ready_submitted_seats.includes(Number(own_seat))
        : null
    // the `--fh-*` palette, the mono face and the card's own chrome are all declared on
    // `.fight-hud`; a banner rendered outside it inherits nothing and reads as bare text
    return (
      <div className="fight-hud" data-chat-viewport="">
        <FightPlacementBanner
          can_forfeit={view.can_forfeit}
          deadline={view.placement_deadline_ms}
          on_force_start={(observed_ms) =>
            dispatch_app({
              type: 'fight/input',
              fight: command_fight,
              origin: 'local',
              input: { type: 'start', observed_ms },
            })
          }
          on_forfeit={() =>
            own_seat !== undefined &&
            dispatch_app({
              type: 'fight/input',
              fight: command_fight,
              origin: 'local',
              input: { type: 'forfeit', fighter: own_seat },
            })
          }
          on_ready={() =>
            own_seat !== undefined &&
            dispatch_app({
              type: 'fight/input',
              fight: command_fight,
              origin: 'local',
              input: { type: 'ready', fighter: own_seat },
            })
          }
          on_ready_all={() =>
            ready_all_inputs(fight.mode === 'remote', fight_id, readiness.unready_seats).forEach(dispatch_app)
          }
          ready={own_ready}
          ready_all={readiness.show_all}
          ready_all_disabled={readiness.unready_seats.length === 0}
          ready_all_progress={fight.ready_all_progress}
          starting={Boolean(own_ready && view.ready_starts_fight)}
          locked={actions_locked}
          sides_manned={view.sides_manned}
          text={copy.fight_hud}
        />
        {chat}
        <div className="fight-hud__bottom">{confirmation}</div>
      </div>
    )
  }
  if (view.phase !== 'active') return null
  const selected = view.selected
  const turn_intent = end_turn_intent({
    can_end_turn: view.can_end_turn,
    actions_locked,
    min_turn_ready,
    end_turn_queued: fight.end_turn_queued,
    end_turn_submitted: fight.end_turn_submitted,
    transaction_pending: fight.transaction_pending,
  })
  const queue_or_end_turn = (seat: bigint): void => {
    if (turn_intent === 'queue') {
      dispatch_app({ type: 'fight/end_turn_queued', fight: fight_id, queued: true })
      return
    }
    if (turn_intent === 'submit') submit_end_turn(command_fight, seat)
  }
  const forfeit = (seat: bigint): void => {
    set_forfeit_open(false)
    dispatch_app({
      type: 'fight/input',
      fight: command_fight,
      origin: 'local',
      input: { type: 'forfeit', fighter: seat },
    })
  }
  return (
    <div className="fight-hud" data-chat-viewport="">
      {displayed_turn_card && (
        <FightTurnCard
          fighter={displayed_turn_card.fighter}
          key={displayed_turn_card.key}
          level_label={template(copy.simulator_page.level, { level: displayed_turn_card.fighter.level.toString() })}
          mob_icon_for={mob_icon_for}
        />
      )}
      <FightTimeline
        collapse_label={copy.fight_hud.turn_order_collapse}
        copy={copy}
        expand_label={copy.fight_hud.turn_order_expand}
        fighters={
          presented_turn_seat === null
            ? view.timeline
            : view.timeline.map((fighter) =>
                Object.freeze({ ...fighter, active: fighter.seat === presented_turn_seat })
              )
        }
        focus={focus_fighter}
        label={copy.fight_hud.turn_order}
        mob_icon_for={mob_icon_for}
        target={target_fighter}
        targetable_cells={targetable_fighter_cells}
        targeting={spell_action_selected(selected_action)}
        turn_progress={turn_clock.progress}
        turn_seconds={turn_clock.seconds}
      />
      {chat}
      {selected && (
        <>
          {watching_stall && !crank_hidden && (
            <CrankBanner
              ready={chain_deadline_reached(
                clock,
                fight.checkpoint.contract.turn_started_ms + CONTRACT_CONSTANTS.turn_max_ms,
                monotonic_ms
              )}
              on_crank={() => {
                if (!turn_key || actions_locked) return
                set_crank_attempt(Object.freeze({ turn_key, restore_serial: fight.restore_serial }))
                dispatch_app({
                  type: 'fight/input',
                  fight: command_fight,
                  origin: 'local',
                  input: { type: 'crank' },
                })
              }}
              text={copy.fight_hud}
            />
          )}
          <div className="fight-hud__bottom">
            {confirmation}
            <CombatHud
              spell_count={selected.spells.length + Number(!!selected.weapon)}
              label={copy.ui.design_combat}
              vitals={<VitalsDisplay ap={selected.ap} hp={selected.hp} max_hp={selected.max_hp} mp={selected.mp} />}
              spells={
                <FightSpells
                  can_act={view.can_end_turn && !actions_locked}
                  copy={copy}
                  fighter={selected}
                  select_action={select_action}
                  selected_action={selected_action}
                  text={copy.fight_hud}
                />
              }
              timer={
                turn_clock.seconds === null
                  ? null
                  : {
                      label: copy.fight_hud.end_turn,
                      hint: copy.fight_hud.turn_timer_hint,
                      remaining: turn_clock.seconds,
                      duration: Number(CONTRACT_CONSTANTS.turn_max_ms) / 1000,
                    }
              }
              controls={
                <>
                  <Button
                    ref={end_turn_button}
                    aria-keyshortcuts="F1"
                    title={`${copy.fight_hud.end_turn} (F1)`}
                    tone="primary"
                    disabled={turn_intent === null}
                    onClick={() => queue_or_end_turn(selected.seat)}
                  >
                    {fight.end_turn_queued ? copy.fight_hud.end_turn_queued : copy.fight_hud.end_turn}
                  </Button>
                  <div className="aui-combat-utilities">
                    <Button
                      tone="danger"
                      aria-label={copy.fight_hud.forfeit}
                      disabled={!view.can_forfeit || actions_locked}
                      onClick={() => set_forfeit_open(true)}
                    >
                      <Flag size={14} />
                    </Button>
                  </div>
                </>
              }
            />
          </div>
          {forfeit_open && (
            <ConfirmDialog
              danger
              title={template(copy.fight_hud.forfeit_title, { name: selected.name })}
              description={template(copy.fight_hud.forfeit_body, { name: selected.name })}
              close_label={copy.dismiss}
              cancel_label={copy.cancel}
              confirm_label={copy.fight_hud.confirm_forfeit}
              on_cancel={() => set_forfeit_open(false)}
              on_confirm={() => forfeit(selected.seat)}
            />
          )}
        </>
      )}
    </div>
  )
}
