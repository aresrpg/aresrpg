// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Button } from '@aresrpg/ui'
import type { CharacterRow } from '@aresrpg/protocol'

import type { AppCopy } from '../i18n/copy.ts'
import { useAppStore } from '../store.ts'

import { dapp_text } from './copy.ts'
import { hero_class, HeroPortrait } from './DappHeroCard.tsx'
import { hero_status, hero_sendable } from './state.ts'

import './dapp_parts.css'

type Hero = Readonly<CharacterRow>

/** Whether a busy hero can still be chosen: the caller's own rule for what its pick does. */
type BusySelectable = (hero: Hero) => boolean
const NEVER: BusySelectable = () => false

/** One choice replaces the pick; several choices keep the order they were made in. */
export const toggled_heroes = (selected: readonly string[], hero_id: string, multiple: boolean): readonly string[] => {
  if (!multiple) return [hero_id]
  return selected.includes(hero_id) ? selected.filter((id) => id !== hero_id) : [...selected, hero_id]
}

const HeroChoice = ({
  copy,
  hero,
  pressed,
  busy_selectable,
  choose,
}: Readonly<{ copy: AppCopy; hero: Hero; pressed: boolean; busy_selectable: BusySelectable; choose: () => void }>) => {
  const status = useAppStore(({ dapp }) => hero_status(dapp, hero))
  const sendable = useAppStore(({ dapp }) => hero_sendable(dapp, hero))
  // A hero in a fight, in a dungeon or already out says so in place of its class, beside its level.
  const busy = status !== null && status !== 'free'
  // It stays a choice when it can still be sent (a fight the bot does not play is taken over by the
  // run), or when the caller can take it anyway.
  const locked = busy && !sendable && !busy_selectable(hero)
  const level = dapp_text(copy, 'hero_level', { level: String(hero.level) })
  return (
    <Button
      aria-pressed={pressed && !locked}
      disabled={locked}
      data-hero={hero.id}
      data-status={status ?? undefined}
      onClick={choose}
    >
      <HeroPortrait hero={hero} small />
      <span className="dapp-hero-pick-text">
        {hero.name}
        <small>{`${level} · ${busy ? dapp_text(copy, `status_${status}`) : hero_class(copy, hero)}`}</small>
      </span>
    </Button>
  )
}

/**
 * A choice among heroes: one, or several in the order picked. It holds no state: the caller gives the
 * pick and receives the next one. Busy heroes stay in the list, disabled, with what they do.
 */
export const DappHeroPicker = ({
  copy,
  label,
  heroes,
  selected,
  multiple = false,
  busy_selectable = NEVER,
  on_change,
}: Readonly<{
  copy: AppCopy
  /** What is being chosen, for assistive technology. */
  label: string
  heroes: readonly Hero[]
  selected: readonly string[]
  multiple?: boolean
  /** The busy heroes this pick can still take: all of them where the pick only chooses whom to look
   * at, or the ones a planner lets go on (a hero inside the dungeon a raid is planned for). */
  busy_selectable?: BusySelectable
  on_change: (hero_ids: readonly string[]) => void
}>) => (
  <div className="dapp-hero-picker" role="group" aria-label={label}>
    {heroes.map((hero) => (
      <HeroChoice
        key={hero.id}
        copy={copy}
        hero={hero}
        pressed={selected.includes(hero.id)}
        busy_selectable={busy_selectable}
        choose={() => on_change(toggled_heroes(selected, hero.id, multiple))}
      />
    ))}
  </div>
)
