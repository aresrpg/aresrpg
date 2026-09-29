import { Flag } from 'lucide-react'
import { useState } from 'react'
import {
  Button,
  CombatHud,
  ConfirmDialog,
  Field,
  IconButton,
  NativeModal,
  Panel,
  PreviewSurface,
  SegmentedControl,
  Select,
  Slider,
  Toggle,
  GameWindow,
} from '@aresrpg/ui'
import { characteristic_names, characteristic_spending_quote, type CharacteristicValues } from '@aresrpg/immutable'

import { CharacterLevelUpView } from '../game/fight/CharacterLevelUpView.tsx'
import { JobLevelUpView } from '../game/jobs/JobLevelUpView.tsx'
import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { content_catalog } from '../content/catalog.ts'
import { item_icon, mob_icon } from '../content/assets.ts'
import { JourneyHost } from '../journey/JourneyHost.tsx'
import { JourneySourceContext } from '../journey/source.tsx'
import { initial_journey_state } from '../journey/model.ts'
import { JOURNEY_QUESTS } from '../journey/model.ts'
import { MobInspectionOverlay } from '../game/hud/MobInspectionOverlay.tsx'
import { MobDetailsDialog } from '../game/hud/MobDetailsDialog.tsx'
import { MobPackCard } from '../components/MobPackCard.tsx'
import { FightSpell } from '../game/fight/FightSpell.tsx'
import { to_spell_source } from '../content/fight_sources.ts'
import { VitalsDisplay } from '../game/hud/VitalsDisplay.tsx'
import '../game/fight/fight_hud.css'
import { FpsPanel } from '../components/FpsPanel.tsx'
import { CharacterWindow } from '../game/hud/CharacterWindow.tsx'
import type { DetailTab } from '../characters/character_navigation.ts'
import { adventure_character } from '../adventure/character.ts'
import { adventure_character_row, adventure_inventory, ADVENTURE_INVENTORY } from '../adventure/projection.ts'
import type { EquipmentMap } from '../characters/equipment_stage.ts'
import '../characters/characters.css'
import '../components/character_surfaces.css'
import inventory_icon from '../assets/quickslots/inventory.png'

import { SERVICE_PANELS, service_options, type ServiceView } from './workshop/catalog.tsx'
import './ui_workshop.css'

type View =
  | 'controls'
  | 'equipment'
  | 'stats'
  | 'spells'
  | 'combat'
  | 'mob'
  | 'journal'
  | 'progression'
  | 'character_progression'
  | ServiceView
const image = (src: string) => <img src={src} alt="" />

const Controls = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const [quality, set_quality] = useState('high')
  const [enabled, set_enabled] = useState(true)
  const [volume, set_volume] = useState(65)
  const [dialog, set_dialog] = useState(false)
  const [value, set_value] = useState('')
  const t = copy_text(copy.characters_page)
  return (
    <div className="ui-workshop-grid">
      <Panel>
        <h2>{copy.ui.design_controls}</h2>
        <div className="ui-workshop-row">
          <Button tone="primary" onClick={() => set_dialog(true)}>
            {t('common.confirm')}
          </Button>
          <Button onClick={() => set_dialog(true)}>{copy.ui.design_dialog}</Button>
          <Button disabled>{copy.ui.design_disabled}</Button>
          <Button busy>{copy.loading_universe}</Button>
          <Button tone="danger" onClick={() => set_dialog(true)}>
            {copy.ui.leave_game_confirm}
          </Button>
          <IconButton
            icon={image(inventory_icon)}
            label={t('tab_equipment')}
            hotkey="E"
            onClick={() => set_dialog(true)}
          />
        </div>
      </Panel>
      <Panel>
        <h2>{copy.settings}</h2>
        <FpsPanel
          active={false}
          quality={quality as 'low' | 'medium' | 'high'}
          change_quality={set_quality}

          fight_access={null}
          party_available={false}
          copy={copy}
        />
        <Select
          label={copy.quality}
          value={quality}
          onChange={(event) => set_quality(event.target.value)}
          options={['low', 'medium', 'high'].map((value) => ({
            value,
            label: copy[value as 'low' | 'medium' | 'high'],
          }))}
        />
        <Slider label={copy.ui.design_volume} value={volume} on_change={set_volume} />
        <Toggle label={copy.ui.design_motion} checked={enabled} on_change={set_enabled} />
        <Toggle label={copy.ui.design_disabled} checked={false} disabled on_change={() => undefined} />
        <Field label={copy.ui.design_search}>
          <input
            className="aui-input"
            type="search"
            value={value}
            onChange={(event) => set_value(event.target.value)}
          />
        </Field>
      </Panel>
      {dialog && (
        <ConfirmDialog
          title={copy.ui.leave_game_title}
          cancel_label={copy.ui.stay_in_game}
          confirm_label={copy.ui.leave_game_confirm}
          close_label={copy.wallet_close}
          on_cancel={() => set_dialog(false)}
          on_confirm={() => set_dialog(false)}
          icon={image(inventory_icon)}
        />
      )}
    </div>
  )
}

const WORKSHOP_INVENTORY = [
  ...ADVENTURE_INVENTORY,
  ...adventure_inventory(
    content_catalog.items
      .filter(
        (item) =>
          item.level <= 200 &&
          !ADVENTURE_INVENTORY.some(({ item_type }) => item_type === item.item_type) &&
          ['hat', 'cloak', 'belt', 'boots', 'amulet', 'ring', 'pet', 'relic', 'weapon'].includes(item.category)
      )
      .slice(0, 44)
  ),
]

/** These examples use the same controller and stat-cost rules as the live character panels. */
const useWorkshopCharacter = () => {
  const [source, set_source] = useState(() => ({
    ...adventure_character(200),
    spell_levels: {} as Readonly<Record<string, number>>,
  }))
  const raise_stats = (spending: CharacteristicValues): void => {
    const quote = characteristic_spending_quote('senshi', source, spending)
    if (!quote || quote.cost > adventure_character_row(source).available_points) return
    set_source({
      ...source,
      ...Object.fromEntries(characteristic_names.map((stat) => [stat, source[stat] + quote.gains[stat]])),
    })
  }
  const commit = (equipment: EquipmentMap): void =>
    set_source({
      ...source,
      loadout: Object.fromEntries(
        Object.entries(equipment).flatMap(([slot, item]) => (item ? [[slot, item.item_type]] : []))
      ),
    })
  return {
    character: adventure_character_row(source, WORKSHOP_INVENTORY),
    session: {
      inventory: WORKSHOP_INVENTORY,
      commit,
      raise_stats,
      raise_spell: (spell: string) =>
        set_source((current) => ({
          ...current,
          spell_levels: { ...current.spell_levels, [spell]: (current.spell_levels[spell] ?? 1) + 1 },
        })),
    },
  }
}
const CharacterExample = ({ copy, initial_tab }: Readonly<{ copy: AppCopy; initial_tab: DetailTab }>) => {
  const { character, session } = useWorkshopCharacter()
  const [open, set_open] = useState(true)
  return (
    <>
      <Button onClick={() => set_open(true)}>{copy_text(copy.characters_page)(`tab_${initial_tab}`)}</Button>
      {open && (
        <CharacterWindow
          tab={initial_tab}
          character={character}
          copy={copy}
          session={session}
          close={() => set_open(false)}
        />
      )}
    </>
  )
}
const Spells = ({ copy }: Readonly<{ copy: AppCopy }>) => <CharacterExample copy={copy} initial_tab="spells" />
const Equipment = ({ copy }: Readonly<{ copy: AppCopy }>) => <CharacterExample copy={copy} initial_tab="equipment" />
const Stats = ({ copy }: Readonly<{ copy: AppCopy }>) => <CharacterExample copy={copy} initial_tab="stats" />

const Combat = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const [selected, set_selected] = useState('Pressure')
  const [turn_remaining, set_turn_remaining] = useState(10)
  const [forfeit, set_forfeit] = useState(false)
  const spells = content_catalog.spells.filter((spell) => spell.classe === 'senshi')
  return (
    <div className="ui-workshop-stack">
      <CombatHud
        label={copy.ui.design_combat}
        vitals={<VitalsDisplay hp={1040n} max_hp={1040n} ap={6n} mp={3n} />}
        spells={spells.map((spell) => {
          const source = to_spell_source(spell)
          return (
            <FightSpell
              key={spell.name}
              spell={{ name: spell.name, level: 6n, source, details: source.levels[5]!, cooldown: 0n, turn: null }}
              selected={selected === spell.name}
              disabled={false}
              select={() => set_selected(spell.name)}
            />
          )
        })}
        timer={{ label: copy.fight_hud.end_turn, remaining: turn_remaining, duration: 45 }}
        controls={
          <>
            <Button tone="primary" disabled={turn_remaining === 0} onClick={() => set_turn_remaining(0)}>
              {copy.fight_hud.end_turn}
            </Button>
            <div className="aui-combat-utilities">
              <Button tone="danger" aria-label={copy.fight_hud.forfeit} onClick={() => set_forfeit(true)}>
                <Flag size={14} fill="currentColor" />
              </Button>
            </div>
          </>
        }
      />
      {forfeit && (
        <ConfirmDialog
          title={copy.fight_hud.forfeit}
          confirm_label={copy.fight_hud.confirm_forfeit}
          cancel_label={copy.wallet_close}
          close_label={copy.wallet_close}
          on_confirm={() => {
            set_forfeit(false)
            set_turn_remaining(0)
          }}
          on_cancel={() => set_forfeit(false)}
          danger
        />
      )}
    </div>
  )
}

const Mob = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const [open, set_open] = useState(true)
  const { mob } = content_catalog.mob('moka')!
  return (
    <>
      <div className="ui-workshop-pack">
        <MobPackCard
          copy={copy}
          active
          members={[0, 50, 100].map((level_scalar) => ({ mob_type: mob.mob_type, level_scalar }))}
        />
      </div>
      <Button onClick={() => set_open(true)}>{mob.name}</Button>
      {open && <MobDetailsDialog mob={mob} copy={copy} close={() => set_open(false)} />}
      <MobInspectionOverlay copy={copy} />
    </>
  )
}

const JOURNAL_QUESTS = JOURNEY_QUESTS.filter(({ kind }) => kind !== 'start').slice(0, 6)
const Journals = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const [open, set_open] = useState(true)
  const [completed, set_completed] = useState<readonly string[]>([])
  const text = copy_text(copy.journey)
  return (
    <JourneySourceContext
      value={{
        state: { ...initial_journey_state('workshop'), ready: true, journal_open: open, completed },
        quests: JOURNAL_QUESTS,
        available: true,
        text,
        icon: item_icon,
        name: (item) => content_catalog.item(item)?.item.name ?? '',
        journal: set_open,
        collapse: () => undefined,
        acknowledge: () => undefined,
        action_label: text('complete'),
        activate: (quest) => set_completed([...new Set([...completed, quest.id])]),
      }}
    >
      <Button onClick={() => set_open(true)}>{text('journal')}</Button>
      <JourneyHost copy={copy} />
    </JourneySourceContext>
  )
}

const Progression = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const [open, set_open] = useState(true)
  return (
    <>
      <Button onClick={() => set_open(true)}>{copy_text(copy.characters_page)('jobs.level_up_title')}</Button>
      {open && (
        <JobLevelUpView
          copy={copy}
          close={() => set_open(false)}
          level_up={{
            id: 'workshop',
            character_id: 'workshop',
            character_name: 'Senshi',
            job: 'MINER',
            level_before: 9,
            level_after: 10,
          }}
        />
      )}
    </>
  )
}
const CharacterProgression = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const [open, set_open] = useState(true)
  const [allocation, set_allocation] = useState(false)
  if (allocation) return <CharacterExample copy={copy} initial_tab="stats" />
  return (
    <>
      <Button onClick={() => set_open(true)}>{copy.fight_hud.level_up_title}</Button>
      {open && (
        <CharacterLevelUpView
          copy={copy}
          name="Senshi"
          classe="senshi"
          before={99}
          after={100}
          close={() => set_open(false)}
          allocate={() => {
            set_open(false)
            set_allocation(true)
          }}
        />
      )}
    </>
  )
}

const PANELS = {
  controls: Controls,
  equipment: Equipment,
  stats: Stats,
  spells: Spells,
  combat: Combat,
  mob: Mob,
  journal: Journals,
  progression: Progression,
  character_progression: CharacterProgression,
  ...SERVICE_PANELS,
}
export const UiWorkshop = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const [view, set_view] = useState<View>('controls')
  const [size, set_size] = useState('desktop')
  const t = copy_text(copy.characters_page)
  const Content = PANELS[view]
  return (
    <section className="ui-workshop">
      <header className="ui-workshop-heading">
        <h1>{copy.ui.design_library}</h1>
        <SegmentedControl
          label={copy.ui.design_viewport}
          value={size}
          on_change={set_size}
          options={[
            { value: 'desktop', label: copy.ui.design_desktop },
            { value: 'mobile', label: `${copy.ui.design_mobile} · 932 × 430` },
          ]}
        />
      </header>
      <nav className="ui-workshop-navigation">
        <SegmentedControl
          label={copy.ui.design_library}
          value={view}
          on_change={set_view}
          options={[
            { value: 'controls', label: copy.ui.design_controls },
            { value: 'equipment', label: t('tab_equipment') },
            { value: 'stats', label: t('tab_stats') },
            { value: 'spells', label: copy_text(copy.characters_page)('tab_spells') },
            { value: 'combat', label: copy.ui.design_combat },
            { value: 'mob', label: copy.demo_page.mob_group },
            { value: 'journal', label: copy_text(copy.journey)('journal') },
            { value: 'progression', label: t('jobs.level_up_title') },
            { value: 'character_progression', label: copy.fight_hud.level_up_title! },
            ...service_options(copy),
          ]}
        />
      </nav>
      <div className={`ui-workshop-preview ui-workshop-preview--${size}`} data-workshop-view={view}>
        {size === 'mobile' ? (
          <PreviewSurface>
            <Content copy={copy} />
          </PreviewSurface>
        ) : (
          <Content copy={copy} />
        )}
      </div>
      <div className="ui-workshop-rotate" role="status">
        {copy.ui.mobile_rotate}
      </div>
    </section>
  )
}
