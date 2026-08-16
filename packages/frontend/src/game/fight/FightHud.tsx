// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The production fight HUD. It is a pure reader of the shared fight projection; its two
// commands re-enter the same fight input door as board and streamed actions.

import { CONTRACT_CONSTANTS } from '@aresrpg/fight'
import { useEffect, useMemo, useState } from 'react'

import { ModalFrame } from '../../components/ModalFrame.tsx'
import type { AppCopy } from '../../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../../store.ts'

import { select_fight_view, type FightFighterView } from './fight_projection.ts'
import './fight_hud.css'

const template = (source: string, values: Readonly<Record<string, string | number>>): string =>
  Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), source)

const percent = (value: bigint, maximum: bigint): number =>
  maximum <= 0n ? 0 : Math.max(0, Math.min(100, Number((value * 10_000n) / maximum) / 100))

const FightTimeline = ({ fighters, label }: Readonly<{ fighters: readonly FightFighterView[]; label: string }>) => (
  <aside aria-label={label} className="fight-hud__turns">
    {fighters.map((fighter) => (
      <article
        className={`fight-hud__turn ${fighter.team === 0n ? 'ally' : 'enemy'}${fighter.active ? ' active' : ''}${fighter.dead ? ' dead' : ''}`}
        key={fighter.seat.toString()}
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
          {fighter.effects.length > 0 && (
            <div className="fight-hud__effects">
              {fighter.effects.map((effect, index) => (
                <span
                  key={`${effect.source}:${effect.kind}:${effect.stat}:${index}`}
                  title={`${effect.element} · ${effect.value} · ${effect.turns_left}`}
                >
                  {effect.element.slice(0, 1).toUpperCase()}
                  <b>{effect.turns_left.toString()}</b>
                </span>
              ))}
            </div>
          )}
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

const FightVitals = ({ fighter, can_act }: Readonly<{ fighter: FightFighterView; can_act: boolean }>) => (
  <div className="fight-hud__bar">
    <div className="fight-hud__vitals">
      <div className="fight-hud__hp-gem" title={`${fighter.hp} / ${fighter.max_hp} HP`}>
        <i />
        <span>
          {fighter.hp.toString()}
          <b />
          {fighter.max_hp.toString()}
        </span>
      </div>
      <div className="fight-hud__stat-gems">
        <StatGem kind="ap" value={fighter.ap} />
        <StatGem kind="mp" value={fighter.mp} />
      </div>
    </div>
    <div className="fight-hud__spells">
      {fighter.spells.map((spell, index) => {
        const disabled = !can_act || spell.cooldown > 0n || fighter.ap < spell.details.ap_cost
        return (
          <div
            aria-disabled={disabled}
            className={`fight-hud__spell${disabled ? ' disabled' : ''}`}
            key={spell.name}
            title={`${spell.name} · Lv ${spell.level} · ${spell.details.ap_cost} AP`}
          >
            <kbd>{index + 1}</kbd>
            <span>{spell.name.slice(0, 1).toUpperCase()}</span>
            <b>{spell.details.ap_cost.toString()}</b>
            {spell.cooldown > 0n && <em>{spell.cooldown.toString()}</em>}
          </div>
        )
      })}
    </div>
  </div>
)

const PlacementBanner = ({
  deadline,
  text,
}: Readonly<{ deadline: bigint | null; text: Readonly<Record<string, string>> }>) => {
  const [now, set_now] = useState(() => Date.now())
  useEffect(() => {
    if (deadline === null) return undefined
    const timer = setInterval(() => set_now(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [deadline])
  const seconds = deadline === null ? null : Math.max(0, Math.ceil((Number(deadline) - now) / 1_000))
  return (
    <div className="fight-hud__placement" role="status">
      <span>{text.placement_title}</span>
      {seconds !== null && (
        <strong className={seconds <= 10 ? 'urgent' : ''}>0:{String(seconds).padStart(2, '0')}</strong>
      )}
      <small>{text.placement_hint}</small>
    </div>
  )
}

export const FightHud = ({ copy }: Readonly<{ copy: AppCopy }>) => {
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

  if (!view || !fight.checkpoint) return null
  if (view.phase === 'placement') return <PlacementBanner deadline={view.placement_deadline_ms} text={copy.fight_hud} />
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

  return (
    <div className="fight-hud">
      <FightTimeline fighters={view.timeline} label={copy.fight_hud.turn_order} />
      <div className="fight-hud__bottom">
        <div className="fight-hud__controls">
          <button disabled={!view.can_end_turn || !min_turn_ready} onClick={end_turn} type="button">
            {copy.fight_hud.end_turn}
          </button>
          <button disabled={!view.can_forfeit} onClick={() => set_forfeit_open(true)} type="button">
            {copy.fight_hud.forfeit}
          </button>
        </div>
        <FightVitals can_act={view.can_end_turn} fighter={selected} />
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
