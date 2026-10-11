// Local fixture of the production JobsTab. Only the character's job levels are simulated.
import { createRoot } from 'react-dom/client'
import { useEffect, useRef, useState } from 'react'
import { PreviewSurface, SegmentedControl, Workspace } from '@aresrpg/ui'
import { job_slugs, job_xp_for_level } from '@aresrpg/immutable'
import { Pickaxe } from 'lucide-react'

import JobsTab from '../src/characters/JobsTab.tsx'
import { adventure_character } from '../src/adventure/character.ts'
import { adventure_character_row } from '../src/adventure/projection.ts'
import { load_app_copy } from '../src/i18n/copy.ts'
import { dispatch_app } from '../src/store.ts'
import '../src/tailwind.css'
import '@aresrpg/ui/styles.css'
import '../src/characters/characters.css'
import './jobs-readiness.css'

const copy = await load_app_copy('en')
dispatch_app({ type: 'locale/loaded', locale: 'en', copy })
const levels: Readonly<Record<string, number>> = { JEWELER: 8, FARMER: 28, HERBALIST: 28, MINER: 20 }
const base_character = adventure_character_row(adventure_character())
type Mode = 'beginner' | 'experienced'
const Preview = () => {
  const [mode, set_mode] = useState<Mode>('beginner')
  const character = {
    ...base_character,
    jobs: Object.fromEntries(
      job_slugs.map((job) => [job, String(job_xp_for_level(mode === 'experienced' ? 100 : (levels[job] ?? 1)))])
    ),
  }
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    Array.from(root.current!.querySelectorAll<HTMLButtonElement>('.jobs__list button'))
      .find((button) => button.textContent?.includes('Jeweler'))
      ?.click()
  }, [])
  return (
    <main className="readiness-study" data-mode={mode}>
      <div className="readiness-study-window" ref={root}>
        <PreviewSurface>
          <Workspace
            title="Jobs"
            icon={<Pickaxe />}
            close={() => {}}
            close_label="Close"
            className="aui-feature-port aui-jobs-port"
            toolbar={
              <div className="readiness-study-controls">
                <div>
                  <strong>Recipe readiness preview</strong>
                  <p>Green: best · ~ Missing chain requirements</p>
                </div>
                <SegmentedControl
                  label="Character job levels"
                  value={mode}
                  on_change={set_mode}
                  options={[
                    { value: 'beginner', label: 'Jeweler Lv. 8' },
                    { value: 'experienced', label: 'All jobs Lv. 100' },
                  ]}
                />
              </div>
            }
          >
            <JobsTab character={character} copy={copy} preview />
          </Workspace>
        </PreviewSurface>
      </div>
    </main>
  )
}
// eslint-disable-next-line fp-law/no-module-scope-effects -- This standalone preview entry owns mounting its React root.
createRoot(document.getElementById('root')!).render(<Preview />)
