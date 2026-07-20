import {
  Crosshair,
  Swords,
  Trophy,
  BookOpen,
  Store,
  ShoppingBag,
  FlaskConical,
  Gamepad2,
  Settings,
  Gift,
} from 'lucide-react'

export type Page =
  | 'game-world'
  | 'characters'
  | 'leaderboard'
  | 'encyclopedia'
  | 'marketplace'
  | 'kolizeum'
  | 'shop'
  | 'simulator'
  | 'airdrop'
  | 'settings'

export interface NavItem {
  id: Page
  path: string
  label: string
  Icon: React.ComponentType<{ size?: number; className?: string }>
  // T55: visible-but-inert meta-tab — greyed out, non-clickable, no route navigation (coming-soon).
  disabled?: boolean
}

export const NAV_ITEMS: NavItem[] = [
  // The world lives at the BARE ROOT (no /game-world path segment — "just nothing at all").
  { id: 'game-world', path: '/', label: 'nav.world', Icon: Gamepad2 },
  { id: 'characters', path: '/characters', label: 'nav.characters', Icon: Swords },
  { id: 'leaderboard', path: '/leaderboard', label: 'nav.leaderboard', Icon: Trophy, disabled: true },
  { id: 'shop', path: '/shop', label: 'nav.shop', Icon: ShoppingBag },
  { id: 'simulator', path: '/simulator', label: 'nav.simulator', Icon: FlaskConical, disabled: true },
  { id: 'encyclopedia', path: '/encyclopedia', label: 'nav.encyclopedia', Icon: BookOpen },
  { id: 'marketplace', path: '/marketplace', label: 'nav.marketplace', Icon: Store },
  { id: 'airdrop', path: '/airdrop', label: 'nav.airdrop', Icon: Gift },
  { id: 'kolizeum', path: '/kolizeum', label: 'nav.kolizeum', Icon: Crosshair },
  // S-65/S-67: FRIENDS folded into the world HUD presence panel; SCRIBE lives as the Characters page's
  // RUNEFORGE sub-tab (/characters?tab=forge — /scribe redirects there). Neither is a nav destination.
  { id: 'settings', path: '/settings', label: 'nav.settings', Icon: Settings },
]

export const PAGE_PATHS: Record<Page, string> = Object.fromEntries(NAV_ITEMS.map((i) => [i.id, i.path])) as Record<
  Page,
  string
>

export function path_to_page(pathname: string): Page | null {
  const segment = '/' + pathname.split('/')[1]
  const item = NAV_ITEMS.find((i) => i.path === segment)
  return item?.id ?? null
}

// The mobile-reachable destination set (shared by the mobile page switcher). `disabled` T55 coming-soon
// placeholders (leaderboard/simulator) are inert on EVERY surface, so mobile drops them entirely (the
// desktop Sidebar keeps them, greyed-with-tooltip). Desktop passes `mobile: false` and keeps the full
// set. One home for this filter — the switcher and any future nav surface derive from here, never a
// second copy.
export function visible_nav_items(items: NavItem[], { mobile }: { mobile: boolean }): NavItem[] {
  return items.filter((item) => {
    if (mobile && item.disabled) return false
    return true
  })
}
