import { lazy, Suspense } from 'react'
import { CarvedIcon, GameWindow, NativeModal } from '@aresrpg/ui'
import type { CharacterRow } from '@aresrpg/protocol'
import type { DetailTab } from '../../characters/character_navigation.ts'
import type { CharacterSession } from '../../characters/character_session.ts'
import { copy_text, type AppCopy } from '../../i18n/copy.ts'
import '../../characters/characters.css'
import '../../components/character_surfaces.css'

const Equipment = lazy(() => import('../../characters/EquipmentTab.tsx'))
const Stats = lazy(() => import('../../characters/StatsTab.tsx'))
const Jobs = lazy(() => import('../../characters/JobsTab.tsx'))
const Forge = lazy(() => import('../../characters/RuneforgeTab.tsx'))
const Spells = lazy(() => import('../../characters/SpellsTab.tsx'))
export const CHARACTER_TABS = [
  { tab: 'equipment', icon: 'inventory', layout: '' },
  { tab: 'stats', icon: 'stats', layout: '' },
  { tab: 'spells', icon: 'spells', layout: '' },
  { tab: 'jobs', icon: 'jobs', layout: 'aui-feature-port aui-jobs-port' },
  { tab: 'runeforge', icon: 'runeforge', layout: 'aui-feature-port aui-forge-port' },
] as const
const PanelBody = ({
  tab,
  character,
  copy,
  session,
}: Readonly<{ tab: DetailTab; character: Readonly<CharacterRow>; copy: AppCopy; session?: CharacterSession }>) => {
  switch (tab) {
    case 'equipment':
      return <Equipment character={character} copy={copy} session={session} />
    case 'stats':
      return <Stats character={character} copy={copy} raise_stats={session?.raise_stats} />
    case 'jobs':
      return <Jobs character={character} copy={copy} preview={!!session} />
    case 'runeforge':
      return <Forge character={character} copy={copy} inventory={session?.inventory} />
    case 'spells':
      return <Spells character={character} copy={copy} session={session} />
  }
}

export const CharacterWindow = ({
  tab,
  character,
  copy,
  session,
  close,
}: Readonly<{
  tab: DetailTab
  character: Readonly<CharacterRow>
  copy: AppCopy
  session?: CharacterSession
  close: () => void
}>) => {
  const text = copy_text(copy.characters_page)
  const title = text(tab === 'equipment' ? 'inventory_title' : `tab_${tab}`)
  const tab_layout = CHARACTER_TABS.find((entry) => entry.tab === tab)!
  return (
    <NativeModal className="game-character-scrim" close={close} label={title}>
      <GameWindow
        className={`gw-tab game-character-window game-character-window--${tab} ${tab_layout.layout}`}
        data-character-panel={tab}
        title={title}
        icon={<CarvedIcon name={tab_layout.icon} />}
        hotkey="E"
        meta={`${character.name} · ${character.level}`}
        close={close}
        close_label={copy.wallet_close}
      >
        <div className="game-character-body aui-workspace-main">
          <Suspense fallback={<div className="p-8">{copy.loading_universe}</div>}>
            <PanelBody tab={tab} character={character} copy={copy} session={session} />
          </Suspense>
        </div>
      </GameWindow>
    </NativeModal>
  )
}
