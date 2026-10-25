// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect, useState } from 'react'
import { Swords } from 'lucide-react'
import { Button, GameWindow } from '@aresrpg/ui'

import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { WorldStage } from '../game/core/WorldStage.tsx'
import { FightLayer } from '../game/fight/FightLayer.tsx'
import { worlds_source } from '../content/worlds.ts'

import { PracticeBracket } from './PracticeBracket.tsx'
import { next_practice_match } from './bracket.ts'
import { read_practice_source } from './entry.ts'
import '../tournament/tournament.css'

const fresh_seed = (): bigint => BigInt(crypto.getRandomValues(new Uint32Array(1))[0]!)

export const PracticePage = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const [source] = useState(read_practice_source)
  const [seed] = useState(fresh_seed)
  const practice = useAppStore((state) => state.practice)
  const fight = useAppStore((state) => state.fight)
  const quality = useAppStore((state) => state.settings.quality)
  const t = copy_text(copy.tournament_page)
  useEffect(() => {
    if (source) dispatch_app({ type: 'practice/start', source, seed })
  }, [seed, source])
  const next = next_practice_match(practice.matches)
  const champion = practice.matches[6]?.winner
  const finished = typeof champion === 'number'
  const leave = (): void => globalThis.location.assign('/kolizeum')
  return (
    <main className="app-ui fixed inset-0 overflow-hidden bg-bg font-mono text-white">
      <WorldStage terrain={worlds_source[0]?.terrain} quality={quality}>
        {(scene) => (fight.mounted ? <FightLayer copy={copy} scene={scene} exit_label={null} /> : null)}
      </WorldStage>
      {fight.mounted && (
        <Button className="tourney-practice-exit" onClick={leave}>
          {t('practice_leave')}
        </Button>
      )}
      {!fight.mounted && (
        <div className="tourney-practice-window">
          <GameWindow
            title={t('practice_title')}
            icon={<Swords size={18} />}
            close={leave}
            close_label={t('practice_leave')}
            className="aui-arena-port"
          >
            <section className="tourney-panel">
              <header className="tourney-practice-heading">
                <h2>{finished ? t(champion === 0 ? 'practice_won' : 'practice_lost') : t('bracket')}</h2>
                <p className="tourney-note">{source ? t('practice_notice') : t('practice_missing')}</p>
              </header>
              <div className="tourney-content">
                <PracticeBracket practice={practice} t={t} />
              </div>
              <footer className="tourney-dock">
                <div className="tourney-dock-team">
                  <small>{t('character')}</small>
                  <b>{source?.name}</b>
                </div>
                <div className="tourney-dock-actions">
                  {next >= 0 && (
                    <Button tone="primary" onClick={() => dispatch_app({ type: 'practice/next' })}>
                      {t('practice_next')}
                    </Button>
                  )}
                  {finished && (
                    <Button
                      tone="primary"
                      onClick={() =>
                        dispatch_app({
                          type: 'practice/start',
                          source: practice.entrants[0]!.source,
                          seed: fresh_seed(),
                        })
                      }
                    >
                      {t('practice_again')}
                    </Button>
                  )}
                </div>
              </footer>
            </section>
          </GameWindow>
        </div>
      )}
      {fight.error && (
        <p role="alert" className="absolute top-16 right-3 z-50 bg-bg p-3 text-red-300">
          {t('practice_error')}
        </p>
      )}
    </main>
  )
}
