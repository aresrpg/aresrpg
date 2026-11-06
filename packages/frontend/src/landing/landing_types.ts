// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Draft authored by Claude Opus 5.5 (claude-opus-5-5): mechanical React port of the accepted V19 landing.
import type { ReactNode } from 'react'

/** Every player-facing string. The entry supplies it from the YAML locales (not authored here). */
export type LandingCopy = Readonly<{
  new_tab: string
  sign_alt: string
  nav_label: string
  sound_on: string
  sound_off: string
  nav: Readonly<{ encyclopedia: string; journal: string; discord: string }>
  kares: Readonly<{ trigger: string; trigger_detail: string; modal_label: string; close: string }>
  hero: Readonly<{ title: readonly [string, string, string]; lede: string; play: string; let_ai_play: string }>
  earn: Readonly<{
    title: string
    intro: string
    bays: readonly [string, string, string]
    paths: readonly [
      Readonly<{ title: string; body: string }>,
      Readonly<{ title: string; body: string; link: string }>,
      Readonly<{ title: string; body: string }>,
    ]
  }>
  world: Readonly<{
    title: string
    label: string
    beats: readonly [
      Readonly<{ title: string; body: string }>,
      Readonly<{ title: string; body: string }>,
      Readonly<{ title: string; body: string }>,
    ]
    keys_label: string
    keys_then: string
    alt_world: string
    alt_goblins: string
    alt_combat: string
    marks: Readonly<{ you: string; tiles: string; goblins: string }>
  }>
  agent: Readonly<{
    title: string
    intro: string
    character: string
    status_connecting: string
    status_watching: string
    stop: string
    you: string
    your_agent: string
    said: readonly string[]
    bubbles: readonly [string, string, string]
    call_title: string
    call_detail: string
    log: readonly [string, string, string, string, string]
    replay: string
    note: string
  }>
  end: Readonly<{ title: string; body: string; play: string; discord: string }>
  footer: Readonly<{
    wordmark: string
    tagline: string
    game: string
    community: string
    play: string
    encyclopedia: string
    journal: string
    discord: string
    telegram: string
    x: string
  }>
}>

/** Approved art. The entry passes canonical asset URLs; nothing here copies files into the repository. */
export type LandingAssets = Readonly<{
  surface_desktop: string
  surface_phone: string
  sign: string
  world_capture: string
  combat_capture: string
  portrait: string
  item_key: string
  item_horn: string
  item_bow: string
}>

/** Public destinations, owned by their existing modules (AccountControls, links page). */
export type LandingLinks = Readonly<{
  encyclopedia: string
  journal: string
  discord: string
  telegram: string
  x: string
}>

export type LandingProps = Readonly<{
  copy: LandingCopy
  assets: LandingAssets
  links: LandingLinks
  /** Enters the game through the existing player surface; the landing owns no route. */
  on_play: () => void
  /** From agents/entry_intent.ts `agent_connect_url()`; login and pairing keep their owners. */
  agent_connect_url: string
  /** The shared TokenomicsPanel. Rendered only while the modal is open. */
  tokenomics: ReactNode
}>
