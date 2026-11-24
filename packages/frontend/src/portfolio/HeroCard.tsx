// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useState } from 'react'
import { experience_progress, hero_power } from '@aresrpg/immutable'
import type { CharacterRow } from '@aresrpg/protocol'
import { Button, ProgressBar } from '@aresrpg/ui'
import { ArrowLeftRight, Share2, Tag } from 'lucide-react'

import { character_icon, item_icon } from '../content/assets.ts'
import { titleize } from '../content/titles.ts'
import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { useNumbers } from '../i18n/useNumbers.ts'

import { HeroShare } from './HeroShare.tsx'

/** A hero card's box: the art column beside the body. */
const HERO =
  'grid grid-cols-[148px_minmax(0,1fr)] overflow-hidden rounded-ui border border-line bg-surface max-[560px]:grid-cols-[104px_minmax(0,1fr)]'
const BODY = 'flex min-w-0 flex-col gap-2.5 px-4 py-3.5 max-[560px]:p-3'
/** The hero cards' grid. */
export const HEROES = 'grid grid-cols-[repeat(auto-fill,minmax(min(100%,420px),1fr))] gap-3.5'
/** The row of a card's or an item's actions, pushed to the bottom of its box. */
export const ACTIONS = 'mt-auto flex flex-wrap gap-2'

/** A hero card's box while the account loads: the card's own grid, its art and body as skeletons. */
export const HeroSkeleton = () => (
  <div className={HERO} aria-hidden="true">
    <span className="aui-skeleton h-auto min-h-37 rounded-none" />
    <div className={BODY}>
      <span className="aui-skeleton aui-skeleton--title" />
      <span className="aui-skeleton aui-skeleton--block" />
      <span className="aui-skeleton aui-skeleton--short" />
      <span className="aui-skeleton mt-auto h-11 w-[40%]" />
    </div>
  </div>
)

/** The hero's move between the two accounts: its label and the gesture, or null where it has none. */
export type HeroMove = Readonly<{ label: string; run: () => void; disabled: boolean }>

/** A hero the account holds: who it is, how far it is, how strong its gear makes it, its one move, and its
 *  listing when the market takes it (`sell`: a bare hero of the game account, out of a fight). */
export const HeroCard = ({
  copy,
  hero,
  move,
  sell,
}: Readonly<{ copy: AppCopy; hero: CharacterRow; move: HeroMove | null; sell: (() => void) | null }>) => {
  const numbers = useNumbers()
  const [sharing, set_sharing] = useState(false)
  const text = copy_text(copy.portfolio_page)
  const character = copy_text(copy.characters_page)
  const { color_1, color_2, color_3 } = hero
  const art = character_icon(hero.classe, hero.sex, { color_1, color_2, color_3 })
  const experience = Number(hero.experience)
  const { into, span, percent } = experience_progress(experience)
  const power = hero_power(hero.equipment)
  const classe = titleize(hero.classe)
  return (
    <article className={HERO} data-portfolio-hero={hero.id}>
      <div className="portfolio-hero-art relative grid place-items-center p-3">
        {art && <img className="h-auto w-full [image-rendering:pixelated]" src={art} alt="" />}
        <span className="absolute top-2 left-2 rounded-ui border border-line-strong bg-void px-1.5 py-0.5 font-mono text-xs leading-[normal] font-bold tabular-nums">
          {character('stats.level', { level: hero.level })}
        </span>
      </div>
      <div className={BODY}>
        <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <div>
            <h3 className="font-title text-[22px]/[1.15] font-semibold wrap-anywhere">{hero.name}</h3>
            <p className="mt-0.5 text-[13px] text-muted">{classe}</p>
          </div>
          <span className="text-[13px] text-muted" title={text('power_hint')}>
            {text('power')}{' '}
            <strong className="font-mono text-base leading-[normal] font-bold text-orange tabular-nums">
              {numbers.number(power)}
            </strong>
          </span>
        </header>
        <ProgressBar
          label={character('common.experience')}
          value={percent}
          max={100}
          detail={
            span === 0
              ? `${numbers.number(experience)} ${copy.ui.xp} · ${copy.ui.experience_max}`
              : `${numbers.number(into)} / ${numbers.number(span)} ${copy.ui.xp}`
          }
        />
        {hero.equipment.length > 0 && (
          <ul className="flex flex-wrap gap-1" aria-label={character('tab_equipment')}>
            {hero.equipment.map((item) => {
              const icon = item_icon(item.item_type)
              return (
                <li
                  className="grid size-8 place-items-center rounded-ui border border-hair bg-surface-low p-0.75 text-xs/normal text-muted"
                  key={item.id}
                  title={item.name}
                >
                  {icon ? (
                    <img className="size-full object-contain" src={icon} alt={item.name} />
                  ) : (
                    item.name.slice(0, 1).toUpperCase()
                  )}
                </li>
              )
            })}
          </ul>
        )}
        <div className={ACTIONS}>
          {sell && (
            <Button onClick={sell}>
              <Tag size={16} aria-hidden="true" />
              {copy_text(copy.marketplace_page)('list_for_sale')}
            </Button>
          )}
          {move && (
            <Button disabled={move.disabled} onClick={move.run}>
              <ArrowLeftRight size={16} aria-hidden="true" />
              {move.label}
            </Button>
          )}
          <Button onClick={() => set_sharing(true)}>
            <Share2 size={16} aria-hidden="true" />
            {text('share')}
          </Button>
        </div>
      </div>
      {sharing && <HeroShare copy={copy} hero={hero} close={() => set_sharing(false)} />}
    </article>
  )
}
