// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Panel, ProgressBar } from '@aresrpg/ui'
import { experience_progress } from '@aresrpg/immutable/experience'
import type { CharacterRow } from '@aresrpg/protocol'

import type { AppCopy } from '../i18n/copy.ts'
import { useAppStore } from '../store.ts'
import { character_icon } from '../content/assets.ts'
import { titleize } from '../content/catalog.ts'

import { hero_health } from './account.ts'
import { dapp_text } from './copy.ts'
import { hero_status, type HeroStatus } from './state.ts'

import './dapp_parts.css'

type Hero = Readonly<CharacterRow>

/** One tick a second while something on screen moves with the clock: elapsed time and regenerating health. */
export const useClock = (running: boolean): number => {
  const [now, set_now] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => set_now(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running])
  return now
}

/** The class as the game names it, with its role when the locale has one: "Senshi · Warrior". */
export const hero_class = (copy: AppCopy, { classe }: Pick<Hero, 'classe'>): string =>
  [titleize(classe), copy.simulator_page[`class_${classe}_title`]].filter(Boolean).join(' · ')

/** The hero's 2D portrait in its own colours. It decorates a name that is always written beside it. */
export const HeroPortrait = ({ hero, small = false }: Readonly<{ hero: Hero; small?: boolean }>) => {
  const { color_1, color_2, color_3 } = hero
  const portrait = character_icon(hero.classe, hero.sex, { color_1, color_2, color_3 })
  return portrait ? (
    <img className="dapp-portrait" data-small={small || undefined} src={portrait} alt="" />
  ) : (
    <span className="dapp-portrait" data-small={small || undefined} aria-hidden="true" />
  )
}

/**
 * A hero's health. In a fight it is its fighter's and moves with the fight, never with the clock: the
 * fight row is decoded once per push. In its kiosk it regenerates by the chain's rule, so it ticks.
 */
export const HeroHealth = ({ copy, hero }: Readonly<{ copy: AppCopy; hero: Hero }>) => {
  const fights = useAppStore(({ session }) => session.agent_inventory.fights)
  const owner = useAppStore(({ session }) => session.inventory_pairing?.address ?? null)
  const fighting = Boolean(hero.active_fight)
  const now = useClock(!fighting && hero.custody === 'kiosk')
  const seated = useMemo(
    () => (fighting ? hero_health(hero, { fights }, owner, 0) : null),
    [fighting, hero, fights, owner]
  )
  const hp = fighting ? seated : hero_health(hero, { fights }, owner, now)
  if (!hp) return null
  return (
    <ProgressBar
      label={dapp_text(copy, 'position_hp')}
      value={hp.current}
      max={hp.maximum}
      detail={`${Math.round(hp.current)} / ${Math.round(hp.maximum)}`}
    />
  )
}

/** What the hero does now, in the bot's words. Nothing is claimed before the bot has answered. */
const HeroStatusLine = ({ copy, status }: Readonly<{ copy: AppCopy; status: HeroStatus | null }>) =>
  status && (
    <span className="dapp-hero-state">
      <i className="dapp-dot" data-tone={status === 'free' ? undefined : 'live'} aria-hidden="true" />
      {dapp_text(copy, `status_${status}`)}
    </span>
  )

/**
 * One hero of the bot account: who it is, how far it is and what it does now. What the player can do
 * with it is the caller's: `actions` is a slot. `compact` is the one-line form of a list row.
 */
export const DappHeroCard = ({
  copy,
  hero,
  actions,
  compact = false,
}: Readonly<{ copy: AppCopy; hero: Hero; actions?: ReactNode; compact?: boolean }>) => {
  const status = useAppStore(({ dapp }) => hero_status(dapp, hero))
  const progress = experience_progress(Number(hero.experience))
  return (
    <Panel
      className="dapp-hero-card"
      aria-label={hero.name}
      data-hero={hero.id}
      data-status={status ?? undefined}
      data-compact={compact || undefined}
    >
      <HeroPortrait hero={hero} small={compact} />
      <div className="dapp-hero-id">
        <div className="dapp-hero-line">
          <strong>{hero.name}</strong>
          <span className="dapp-hero-level">{dapp_text(copy, 'hero_level', { level: String(hero.level) })}</span>
        </div>
        <span className="dapp-hero-class">{hero_class(copy, hero)}</span>
        {!compact && (
          <>
            <ProgressBar label={dapp_text(copy, 'hero_xp')} value={progress.percent} max={100} />
            <HeroHealth copy={copy} hero={hero} />
          </>
        )}
      </div>
      {(status !== null || actions) && (
        <footer className="dapp-hero-foot">
          <HeroStatusLine copy={copy} status={status} />
          {actions && <span className="dapp-hero-actions">{actions}</span>}
        </footer>
      )}
    </Panel>
  )
}
