import { useEffect, useRef, useState } from 'react'
import { BookOpen, Globe2, Menu, MessageCircle, SlidersHorizontal, Swords, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { use_game_state, context } from '../../store.js'
import { NAV_ITEMS } from '../../../constants/navigation'
import { use_active_page, use_navigate_page } from '../../../hooks/use_navigate_page'
import { FightOpennessToggle } from './world/FightOpennessToggle.jsx'
import { OnlinePlayers } from './world/OnlinePlayers.jsx'
import { PartyFrame } from './world/PartyFrame.jsx'
import { QualitySelect } from './world/QualitySelect.jsx'
import { QuestObjectiveCard } from './world/QuestObjectiveCard.jsx'
import { WorldChat } from './world/WorldChat.jsx'
import { WorldSwitcher } from './world/WorldSwitcher.jsx'
import { MobileDrawerFrame } from './MobileDrawerFrame.jsx'
import { next_mobile_drawer } from './mobile_layout.js'

import './mobile-hud.css'

const close_fights = () => context.dispatch('action/fights_modal', null)
const show_fights = () => context.dispatch('action/fights_modal', { focus_id: null })

/** @param {{ label: string, badge?: number, on_click: () => void }} props */
function MobileMenuFab({ label, badge = 0, on_click }) {
  return (
    <button
      type="button"
      className="mobile-hud-button mobile-hud-button--menu"
      aria-label={badge > 0 ? `${label} · ${badge}` : label}
      onClick={on_click}
    >
      <Menu />
      <span className="mobile-hud-button__label">{label}</span>
      {badge > 0 && <b className="mobile-hud-button__badge">{badge > 99 ? '99+' : badge}</b>}
    </button>
  )
}

/** @param {{ set_drawer: (drawer: string | null) => void, open_fights: () => void, show_quest: boolean }} props */
function MobileMenu({ set_drawer, open_fights, show_quest }) {
  const { t } = useTranslation()
  const active_page = use_active_page()
  const navigate = use_navigate_page()
  const items = NAV_ITEMS

  const utilities = [
    { id: 'chat', label: t('world_chat.header'), icon: <MessageCircle /> },
    { id: 'friends', label: t('presence.friends'), icon: <Users /> },
    { id: 'worlds', label: t('world_switcher.title'), icon: <Globe2 /> },
    { id: 'graphics', label: t('world.quality_label'), icon: <SlidersHorizontal /> },
    ...(show_quest ? [{ id: 'quests', label: t('quests.aria_label'), icon: <BookOpen /> }] : []),
  ]

  return (
    <div className="mobile-hud-menu">
      <div className="mobile-hud-menu__utilities">
        {utilities.map((item) => (
          <button type="button" key={item.id} onClick={() => set_drawer(item.id)}>
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
        <button type="button" onClick={open_fights}>
          <Swords />
          <span>{t('fights.panel_title')}</span>
        </button>
      </div>
      <nav className="mobile-hud-menu__nav" aria-label={t('nav.navigation')}>
        {items.map((item) => {
          const active = item.id === active_page
          if (item.disabled)
            return (
              <div key={item.id} className="is-disabled" aria-disabled="true">
                <item.Icon />
                <span>{t(item.label)}</span>
              </div>
            )
          return (
            <button
              type="button"
              key={item.id}
              className={active ? 'is-active' : ''}
              aria-current={active ? 'page' : undefined}
              onClick={() => {
                set_drawer(null)
                navigate(item.id)
              }}
            >
              <item.Icon />
              <span>{t(item.label)}</span>
            </button>
          )
        })}
      </nav>
    </div>
  )
}

/**
 * Mobile-only HUD surfaces. Desktop never mounts this tree.
 * @param {{ fight_mode: boolean, has_character: boolean, show_quest_card: boolean }} props
 */
export function MobileHud({ fight_mode, has_character, show_quest_card }) {
  const { t } = useTranslation()
  const history_count = use_game_state((state) => state.message_history.length)
  const fights_open = use_game_state((state) => !!state.fights_modal)
  const [drawer, set_drawer] = useState(null)
  const [seen_messages, set_seen_messages] = useState(history_count)
  const last_drawer = useRef(drawer)

  useEffect(() => {
    document.documentElement.classList.add('ares-mobile-hud')
    return () => document.documentElement.classList.remove('ares-mobile-hud', 'ares-mobile-drawer-open')
  }, [])

  useEffect(() => {
    const drawer_open = !!drawer || fights_open
    document.documentElement.classList.toggle('ares-mobile-drawer-open', drawer_open)
    return () => document.documentElement.classList.remove('ares-mobile-drawer-open')
  }, [drawer, fights_open])

  useEffect(() => {
    if (drawer === 'chat') set_seen_messages(history_count)
    if (fights_open && last_drawer.current) set_drawer(null)
    last_drawer.current = drawer
  }, [drawer, fights_open, history_count])

  const unread = drawer === 'chat' ? 0 : Math.max(0, history_count - seen_messages)
  const open_drawer = (requested) => {
    if (fights_open) close_fights()
    set_drawer((current) => next_mobile_drawer(current, requested))
  }
  const open_fights = () => {
    set_drawer(null)
    show_fights()
  }

  const title =
    drawer === 'chat'
      ? t('world_chat.header')
      : drawer === 'friends'
        ? t('presence.friends')
        : drawer === 'worlds'
          ? t('world_switcher.title')
          : drawer === 'graphics'
            ? t('world.quality_label')
            : drawer === 'quests'
              ? t('quests.aria_label')
              : t('nav.navigation')

  return (
    <>
      <div className={`mobile-hud-actions${fight_mode ? ' mobile-hud-actions--fight' : ''}`}>
        <MobileMenuFab label={t('touch.menu')} badge={unread} on_click={() => open_drawer('menu')} />
      </div>

      {drawer && (
        <MobileDrawerFrame
          drawer={drawer}
          title={title}
          close_label={t('common.close')}
          back_label={t('common.back')}
          on_close={() => set_drawer(null)}
          on_back={drawer === 'menu' ? undefined : () => set_drawer('menu')}
        >
          {drawer === 'chat' && <WorldChat />}
          {drawer === 'friends' && (
            <div className="mobile-hud-social-drawer">
              <PartyFrame />
              {has_character && <FightOpennessToggle />}
              {has_character && <OnlinePlayers />}
            </div>
          )}
          {drawer === 'worlds' && <WorldSwitcher />}
          {drawer === 'graphics' && <QualitySelect />}
          {drawer === 'quests' && show_quest_card && <QuestObjectiveCard />}
          {drawer === 'menu' && (
            <MobileMenu set_drawer={set_drawer} open_fights={open_fights} show_quest={show_quest_card} />
          )}
        </MobileDrawerFrame>
      )}
    </>
  )
}
