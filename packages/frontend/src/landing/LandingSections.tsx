// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Presentation only: the page sections around the interface chooser.
import type { ReactNode } from 'react'

import { ExternalLink } from '../components/links.tsx'
import { version } from '../../../../package.json'

import { InterfaceActions, InterfaceState, type Selection } from './LandingChooser.tsx'
import { LandingWeather, LandingYajin } from './LandingLife.tsx'
import { LandingMusic } from './LandingMusic.tsx'
import {
  AgentLink,
  CHOOSER_ID,
  CTA,
  CTA_PRIMARY,
  EyeIcon,
  InterfaceIcon,
  PlayIcon,
  SectionRule,
  type Copy,
  type Play,
} from './landing_parts.tsx'
import { INTERFACE_IDS, type InterfaceId, type LandingAssets, type LandingLinks } from './landing_types.ts'

const CHOOSER_HREF = `#${CHOOSER_ID}`

export const LandingBackdrop = ({ assets }: Readonly<{ assets: LandingAssets }>) => (
  <div aria-hidden="true" className="backdrop">
    <picture>
      <source height="1708" media="(max-width:719px)" srcSet={assets.surface_phone} width="921" />
      <img alt="" decoding="async" fetchPriority="high" height="1616" src={assets.surface_desktop} width="973" />
    </picture>
    <LandingWeather />
  </div>
)

export const LandingHero = ({
  copy,
  assets,
  links,
  kares_trigger,
  account,
  selected,
  on_select,
  on_play,
}: Readonly<{
  assets: LandingAssets
  links: LandingLinks
  kares_trigger: ReactNode
  account: ReactNode
  on_play: Play
}> &
  Copy &
  Selection) => (
  <header className="hero wrap" id="landing-top">
    <div className="top">
      <a className="sign" href="#landing-top">
        <img alt={copy.sign_alt} fetchPriority="high" height="810" src={assets.sign} width="1940" />
      </a>
      <nav aria-label={copy.nav_label} className="topnav">
        <a href={links.docs}>{copy.nav.docs}</a>
        <ExternalLink new_tab={copy.new_tab} href={links.journal}>
          {copy.nav.journal}
        </ExternalLink>
        <ExternalLink new_tab={copy.new_tab} href={links.discord}>
          {copy.nav.discord}
        </ExternalLink>
        {kares_trigger}
        {account}
        <LandingMusic enable_label={copy.sound_on} mute_label={copy.sound_off} />
      </nav>
    </div>
    <p className="micro">
      {copy.hero.eyebrow[0]}
      <i>/</i>
      {copy.hero.eyebrow[1]}
    </p>
    <h1 className="display">
      {copy.hero.title.map((line) => (
        <span key={line}>{line}</span>
      ))}
    </h1>
    <div className="hero-row">
      <div>
        <p className="lede">{copy.hero.lede}</p>
        <div className="ctas">
          <button className={CTA} data-hue="green" onClick={() => on_play()} type="button">
            <PlayIcon />
            {copy.hero.play}
          </button>
          <AgentLink className={CTA} data_hue="gold" href={links.dapp} on_play={on_play}>
            <EyeIcon />
            {copy.hero.play_bots}
          </AgentLink>
        </div>
      </div>
      <nav aria-labelledby="landing-ways-title" className="via rim">
        <LandingYajin />
        <p className="micro" id="landing-ways-title">
          {copy.hero.ways[0]}
          <i>/</i>
          {copy.hero.ways[1]}
        </p>
        <ol>
          {INTERFACE_IDS.map((id) => (
            <li key={id}>
              <a aria-current={id === selected} data-if={id} href={CHOOSER_HREF} onClick={() => on_select(id)}>
                <span aria-hidden="true" className="via-logo">
                  <InterfaceIcon id={id} />
                </span>
                <span>{copy.chooser.items[id].name}</span>
                <span aria-hidden="true" className="via-lead" />
                <InterfaceState copy={copy} id={id} />
              </a>
            </li>
          ))}
        </ol>
      </nav>
    </div>
  </header>
)

const Good = ({ src, place }: Readonly<{ src: string; place?: number }>) => (
  <img alt="" data-place={place} height="512" loading="lazy" src={src} width="512" />
)

export const LandingEarn = ({
  copy,
  assets,
  links,
}: Readonly<{ assets: LandingAssets; links: LandingLinks }> & Copy) => {
  const [loot, craft, prize] = copy.earn.paths
  const [first, second, third] = assets.podium
  return (
    <section aria-labelledby="landing-earn-title" className="sec wrap">
      <SectionRule index="02" label={copy.earn.section} />
      <div className="sec-head" data-reveal="">
        <h2 className="h2" id="landing-earn-title">
          {copy.earn.title}
        </h2>
        <p>{copy.earn.intro}</p>
      </div>
      <ol className="pays">
        <li className="pay rim" data-reveal="">
          <span className="pay-tag">{loot.tag}</span>
          <div aria-hidden="true" className="goods">
            <Good src={assets.item_key} />
          </div>
          <h3>
            {loot.title} <b>{loot.accent}</b>
          </h3>
          <p>{loot.body}</p>
        </li>
        <li className="pay rim" data-reveal="">
          <span className="pay-tag">{craft.tag}</span>
          <div aria-hidden="true" className="goods">
            <Good src={assets.item_horn} />
            <Good src={assets.item_bow} />
          </div>
          <h3>
            {craft.title} <b>{craft.accent}</b>
          </h3>
          <p>{craft.body}</p>
          <a className="link" href={links.items}>
            {craft.link}
          </a>
        </li>
        <li className="pay rim" data-reveal="">
          <span className="pay-tag">{prize.tag}</span>
          <div aria-hidden="true" className="goods podium">
            <Good place={2} src={second} />
            <Good place={1} src={first} />
            <Good place={3} src={third} />
          </div>
          <h3>
            {prize.title} <b>{prize.accent}</b>
          </h3>
          <p>{prize.body}</p>
        </li>
      </ol>
    </section>
  )
}

const KeyHolder = ({ name, detail, vault }: Readonly<{ name: string; detail: string; vault?: boolean }>) => (
  <span data-vault={vault ? '' : undefined}>
    {name}
    <small>{detail}</small>
  </span>
)

const Mode = ({
  kind,
  mode,
  used_by,
  interfaces,
  copy,
  children,
}: Readonly<{
  kind: 'auto' | 'self'
  mode: Readonly<{ tag: string; title: string; body: string; figure: string; points: readonly string[] }>
  used_by: string
  interfaces: readonly InterfaceId[]
  children: ReactNode
}> &
  Copy) => (
  <article className="mode rim" data-mode={kind} data-reveal="">
    <p className="mode-tag">{mode.tag}</p>
    <h3>{mode.title}</h3>
    <p>{mode.body}</p>
    <div aria-label={mode.figure} className="keys-fig" role="img">
      {children}
    </div>
    <ul>
      {mode.points.map((point) => (
        <li key={point}>{point}</li>
      ))}
    </ul>
    <p className="mode-used">
      {used_by}{' '}
      {interfaces.map((id, index) => (
        <span key={id}>
          {index > 0 && ' / '}
          <b>{copy.chooser.items[id].name}</b>
        </span>
      ))}
    </p>
  </article>
)

export const LandingControl = ({ copy }: Copy) => {
  const { control } = copy
  return (
    <section aria-labelledby="landing-control-title" className="sec wrap">
      <SectionRule index="03" label={control.section} />
      <div className="sec-head" data-reveal="">
        <h2 className="h2" id="landing-control-title">
          {control.title}
        </h2>
        <p>{control.intro}</p>
      </div>
      <div className="modes">
        <Mode
          copy={copy}
          interfaces={['agent', 'telegram', 'dapp']}
          kind="auto"
          mode={control.automated}
          used_by={control.used_by}
        >
          <KeyHolder detail={control.automated.you_detail} name={control.you} />
          <b />
          <KeyHolder detail={control.holds} name={control.automated.vault} vault />
          <b />
          <KeyHolder detail={control.automated.agent_detail} name={control.automated.agent} />
        </Mode>
        <Mode copy={copy} interfaces={['world', 'sdk']} kind="self" mode={control.self} used_by={control.used_by}>
          <KeyHolder detail={control.self.you_detail} name={control.you} />
          <b />
          <KeyHolder detail={control.holds} name={control.self.vault} vault />
        </Mode>
      </div>
    </section>
  )
}

export const LandingEnd = ({
  copy,
  links,
  on_play,
  agent_connect_url,
  selected,
}: Readonly<{ links: LandingLinks; on_play: Play; agent_connect_url: string; selected: InterfaceId }> & Copy) => (
  <>
    <section aria-labelledby="landing-end-title" className="end wrap rim brackets" data-reveal="">
      <i aria-hidden="true" className="end-field" />
      <h2 className="h2" id="landing-end-title">
        {copy.end.title}
      </h2>
      <p className="end-body">{copy.end.body}</p>
      <div className="ctas">
        <button className={CTA_PRIMARY} data-hue="green" onClick={() => on_play()} type="button">
          <PlayIcon />
          {copy.end.play}
        </button>
        <ExternalLink className={CTA} new_tab={copy.new_tab} href={links.discord}>
          {copy.end.discord}
        </ExternalLink>
      </div>
      {selected !== 'world' && (
        <p className="pick" data-if={selected}>
          <span>
            {copy.end.pick} <b>{copy.chooser.items[selected].name}</b>
          </span>
          <InterfaceActions
            agent_connect_url={agent_connect_url}
            compact
            copy={copy}
            id={selected}
            links={links}
            on_play={on_play}
          />
        </p>
      )}
    </section>
    <footer className="wrap">
      <div className="foot">
        <div className="foot-id">
          <p className="wordmark">{copy.footer.wordmark}</p>
          <p>{copy.footer.tagline}</p>
        </div>
        <nav aria-labelledby="landing-foot-game">
          <h2 className="foot-h" id="landing-foot-game">
            {copy.footer.game}
          </h2>
          <ul>
            <li>
              <button className="foot-link" onClick={() => on_play()} type="button">
                {copy.footer.play}
              </button>
            </li>
            <li>
              <a href={links.items}>{copy.footer.encyclopedia}</a>
            </li>
            <li>
              <ExternalLink new_tab={copy.new_tab} href={links.journal}>
                {copy.footer.journal}
              </ExternalLink>
            </li>
            <li>
              <a href={links.allocation}>{copy.footer.allocation}</a>
            </li>
          </ul>
        </nav>
        <nav aria-labelledby="landing-foot-community">
          <h2 className="foot-h" id="landing-foot-community">
            {copy.footer.community}
          </h2>
          <ul>
            <li>
              <ExternalLink new_tab={copy.new_tab} href={links.discord}>
                {copy.footer.discord}
              </ExternalLink>
            </li>
            <li>
              <ExternalLink new_tab={copy.new_tab} href={links.telegram}>
                {copy.footer.telegram}
              </ExternalLink>
            </li>
            <li>
              <ExternalLink new_tab={copy.new_tab} href={links.x}>
                {copy.footer.x}
              </ExternalLink>
            </li>
          </ul>
        </nav>
      </div>
      <div aria-hidden="true" className="colophon">
        <span>aresrpg.world · v{version}</span>
        <span>{`// ${copy.footer.colophon}`}</span>
      </div>
    </footer>
  </>
)
