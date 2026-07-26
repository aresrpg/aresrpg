// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// First-time coachmark tour (#15) — pure DATA, no JSX (content-is-data convention). A SHORT, linear
// "what's where" tour: each step spotlights ONE sidebar NAV TAB and explains, in simple friendly words,
// what that tab is for. The component (Tutorial.jsx) walks these in order with Next / Skip. First-session-
// only (the seen flag is a localStorage UI PREFERENCE — house law: preferences only there, never gameplay).
//
// Targets are the companion SIDEBAR nav tabs (`[data-nav="…"]` in components/sidebar.tsx), which carry a
// stable `data-nav={item.id}` hook. Ids come from constants/navigation.ts NAV_ITEMS — we tour only the FIVE
// core tabs: game-world, characters, shop, encyclopedia, marketplace. Everything else is intentionally
// untoured: the disabled coming-soon tabs (leaderboard/simulator), the
// kolizeum later-game surface, and other secondary destinations. `placement: 'right'` sits the card
// beside the vertical sidebar tab; a null
// target is a centered card with no cutout (the closing step). House voice: plain, warm, no jargon — the
// only crypto word allowed is "Sui" (the game's currency). No em-dashes, no emoji.
//
// D165 RE-TARGET: the tour used to spotlight HUD elements (the always-on HP/XP self-plate `.gw-selfplate`,
// plus a `[data-nav="map"]` tab that does not exist — a dead selector). D165 re-points every
// step at a sidebar nav tab so a new player learns the menu, not the combat HUD.
//
/**
 * @typedef {{
 *   id: string,
 *   target: string | null,
 *   placement: 'top' | 'bottom' | 'right' | 'center',
 *   title_key: string,
 *   body_key: string,
 * }} TourStep
 */

/** The curated first-session tour: one card per CORE sidebar nav tab (see the header list), then a send-off.
 *  title_key/body_key are i18n keys under `tutorial.*` (see i18n/locales/en.json) — Tutorial.jsx resolves
 *  them via t(), this file stays pure data with no translated strings baked in.
 *  @type {TourStep[]} */
export const TOUR_STEPS = [
  {
    id: 'world',
    target: '[data-nav="game-world"]',
    placement: 'right',
    title_key: 'tutorial.world_title',
    body_key: 'tutorial.world_body',
  },
  {
    id: 'characters',
    target: '[data-nav="characters"]',
    placement: 'right',
    title_key: 'tutorial.characters_title',
    body_key: 'tutorial.characters_body',
  },
  {
    id: 'shop',
    target: '[data-nav="shop"]',
    placement: 'right',
    title_key: 'tutorial.shop_title',
    body_key: 'tutorial.shop_body',
  },
  {
    id: 'encyclopedia',
    target: '[data-nav="encyclopedia"]',
    placement: 'right',
    title_key: 'tutorial.encyclopedia_title',
    body_key: 'tutorial.encyclopedia_body',
  },
  {
    id: 'marketplace',
    target: '[data-nav="marketplace"]',
    placement: 'right',
    title_key: 'tutorial.marketplace_title',
    body_key: 'tutorial.marketplace_body',
  },
  {
    id: 'go',
    target: null,
    placement: 'center',
    title_key: 'tutorial.go_title',
    body_key: 'tutorial.go_body',
  },
]
