// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { ReactNode } from 'react'

/** Every way into the one on-chain game, in display order. */
export const INTERFACE_IDS = ['world', 'dapp', 'agent', 'telegram', 'sdk'] as const
export type InterfaceId = (typeof INTERFACE_IDS)[number]

export type InterfaceCopy = Readonly<{
  name: string
  line: string
  tech: string
  status: string
  body: string
  runs_in: string
  role: string
  good_for: string
  cta: string
  preview: string
}>

type EarnPath = Readonly<{ tag: string; title: string; accent: string; body: string }>

/** Every player-facing string. The entry supplies it from the YAML locales (not authored here). */
export type LandingCopy = Readonly<{
  new_tab: string
  sign_alt: string
  nav_label: string
  sound_on: string
  sound_off: string
  nav: Readonly<{ docs: string; journal: string; discord: string }>
  kares: Readonly<{ trigger: string; trigger_detail: string }>
  account: Readonly<{
    login: string
    logging_in: string
    signed_in: string
    logout: string
    failed: string
    dev_only: string
  }>
  hero: Readonly<{
    eyebrow: readonly [string, string]
    title: readonly [string, string, string]
    lede: string
    play: string
    play_bots: string
    ways: readonly [string, string]
  }>
  chooser: Readonly<{
    section: string
    title: string
    intro: string
    interface: string
    specs: Readonly<{ runs_in: string; role: string; good_for: string; status: string }>
    /** The badge of a card: who makes the moves. */
    play: Readonly<{ manual: string; automated: string }>
    items: Readonly<Record<InterfaceId, InterfaceCopy>>
    /** What follows the Telegram card's action, which joins the waitlist as the signed-in account. */
    waitlist: Readonly<{ joining: string; joined: string; failed: string }>
    agent_guide: string
    source: string
    previews: Readonly<{
      keys_then: string
      dapp: Readonly<{
        title: string
        label: string
        character: string
        questing: string
        dungeon: string
        needs_key: string
        raid: string
        actions: readonly [string, string, string]
      }>
      agent: Readonly<{
        title: string
        label: string
        you: string
        agent: string
        call: string
        lines: readonly [string, string, string, string]
      }>
      telegram: Readonly<{
        choose: string
        patrol: string
        gather: string
        review: string
        review_detail: string
        approve: string
        menu: string
        running: string
        status: string
        stop: string
      }>
      sdk: Readonly<{
        label: string
        build: string
        build_lines: readonly [string, string]
        source: string
        source_lines: readonly [string, string]
      }>
    }>
  }>
  earn: Readonly<{
    section: string
    title: string
    intro: string
    paths: readonly [EarnPath, EarnPath & Readonly<{ link: string }>, EarnPath]
  }>
  control: Readonly<{
    section: string
    title: string
    intro: string
    you: string
    holds: string
    used_by: string
    automated: Readonly<{
      tag: string
      title: string
      body: string
      figure: string
      you_detail: string
      vault: string
      agent: string
      agent_detail: string
      points: readonly [string, string, string]
    }>
    self: Readonly<{
      tag: string
      title: string
      body: string
      figure: string
      you_detail: string
      vault: string
      points: readonly [string, string, string]
    }>
  }>
  end: Readonly<{ title: string; body: string; play: string; discord: string; pick: string }>
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
    allocation: string
    colophon: string
  }>
}>

/** Approved art. The entry passes canonical asset URLs; nothing here copies files into the repository. */
export type LandingAssets = Readonly<{
  surface_desktop: string
  surface_phone: string
  sign: string
  world_capture: string
  portrait: string
  item_key: string
  item_horn: string
  item_bow: string
  /** Tournament placement badges: first, second, third. */
  podium: readonly [string, string, string]
}>

/** Public destinations, owned by their existing modules (AccountControls, links page). */
export type LandingLinks = Readonly<{
  /** The standalone docs: guides plus the item, mob and class database. No sign-in. */
  docs: string
  items: string
  /** The engine-less web dapp, in the same app and sign-in. */
  dapp: string
  kares: string
  journal: string
  discord: string
  telegram: string
  x: string
  allocation: string
  playbook: string
  agent_guide: string
  source: string
}>

export type LandingProps = Readonly<{
  copy: LandingCopy
  assets: LandingAssets
  links: LandingLinks
  /** Enters the game through the existing player surface; the landing owns no route. */
  on_play: (url?: string) => void
  /** From agents/entry_intent.ts `agent_connect_url()`; login and pairing keep their owners. */
  agent_connect_url: string
  /** The shared sign-in control for the header. Absent in the build-time render. */
  account?: ReactNode
}>
