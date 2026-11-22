// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Button } from '@aresrpg/ui'

import { character_send_eligible } from '../agents/character_send.ts'
import { send_character_to_agent } from '../agents/send_character.ts'
import type { AppCopy } from '../i18n/copy.ts'
import { useAppStore } from '../store.ts'

import { dapp_text } from './copy.ts'
import { DappHeroCard } from './DappHeroCard.tsx'

/**
 * The heroes the player's own game account holds, each with the way to the bot account. The move is
 * the game's own gesture (`send_character_to_agent`): the player signs it, and it reports by itself.
 * A hero in a fight cannot move; its button is disabled and the game's rule says why on a try.
 */
export const DappGameHeroes = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const heroes = useAppStore(({ session }) => session.characters)
  if (heroes.length === 0) return null
  const title = dapp_text(copy, 'game_heroes_title')
  return (
    <section className="dapp-section" aria-label={title} data-game-heroes="">
      <header className="dapp-home-title">
        <h2>{title}</h2>
        <span className="dapp-note">{heroes.length}</span>
      </header>
      <div className="dapp-home-heroes">
        {heroes.map((hero) => (
          <DappHeroCard
            key={hero.id}
            copy={copy}
            hero={hero}
            compact
            actions={
              <Button
                disabled={!character_send_eligible(hero)}
                data-give={hero.id}
                onClick={() => send_character_to_agent(hero.id, copy)}
              >
                {dapp_text(copy, 'hero_give_bot')}
              </Button>
            }
          />
        ))}
      </div>
    </section>
  )
}
