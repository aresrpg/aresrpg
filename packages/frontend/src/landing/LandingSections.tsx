// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Draft authored by Claude Opus 5.5 (claude-opus-5-5): accepted V19 sections, mechanically ported.
// Presentation only: markup and class names match the accepted page; motion lives in landing_motion.ts.
import type { CSSProperties, ReactNode } from 'react'

import type { LandingAssets, LandingCopy, LandingLinks } from './landing_types.ts'

type Copy = Readonly<{ copy: LandingCopy }>
const vars = (values: Readonly<Record<string, string | number>>): CSSProperties => values as CSSProperties

const NewTab = ({ copy }: Copy) => <span className="sr">{copy.new_tab}</span>
const External = ({
  href,
  copy,
  className,
  children,
}: Readonly<{ href: string; className?: string; children: ReactNode }> & Copy) => (
  <a className={className} href={href} rel="noopener noreferrer" target="_blank">
    {children}
    <NewTab copy={copy} />
  </a>
)

const PlayIcon = ({ size }: Readonly<{ size: number }>) => (
  <svg aria-hidden="true" height={size} viewBox="0 0 20 20" width={size}>
    <path d="M5 3h3v2h3v2h3v2h2v2h-2v2h-3v2H8v2H5z" fill="currentColor" />
  </svg>
)
const EyeIcon = () => (
  <svg aria-hidden="true" height="22" viewBox="0 0 20 20" width="22">
    <path d="M1 9h2V7h2V5h10v2h2v2h2v2h-2v2h-2v2H5v-2H3v-2H1z" fill="none" stroke="currentColor" strokeWidth="1.6" />
    <path d="M8 8h4v4H8z" fill="currentColor" />
  </svg>
)

/** Gold Play enters the game through the entry's existing owner; it is a button, not a route of the landing. */
const PlayButton = ({ label, on_play }: Readonly<{ label: string; on_play: () => void }>) => (
  <span className="slab slab-gold">
    <button className="btn btn-gold n" onClick={on_play} type="button">
      <PlayIcon size={20} />
      {label}
    </button>
  </span>
)

export const LandingHero = ({
  copy,
  assets,
  links,
  on_play,
  agent_connect_url,
  kares_trigger,
}: Readonly<{
  assets: LandingAssets
  links: LandingLinks
  on_play: () => void
  agent_connect_url: string
  kares_trigger: ReactNode
}> &
  Copy) => (
  <header className="hero" id="landing-top">
    <p className="sign">
      <a href="#landing-top">
        <img alt={copy.sign_alt} fetchPriority="high" height="810" src={assets.sign} width="1940" />
      </a>
    </p>
    <nav aria-label={copy.nav_label} className="topnav">
      <External copy={copy} href={links.encyclopedia}>
        {copy.nav.encyclopedia}
      </External>
      <External copy={copy} href={links.journal}>
        {copy.nav.journal}
      </External>
      <External copy={copy} href={links.discord}>
        {copy.nav.discord}
      </External>
    </nav>
    {kares_trigger}
    <div className="hero-copy text">
      <h1 className="display">
        {copy.hero.title.map((line) => (
          <span key={line}>{line}</span>
        ))}
      </h1>
      <p className="lede">{copy.hero.lede}</p>
      <div className="ctas">
        <PlayButton label={copy.hero.play} on_play={on_play} />
        <span className="slab">
          <a className="btn btn-rune n" href={agent_connect_url}>
            <EyeIcon />
            {copy.hero.let_ai_play}
          </a>
        </span>
      </div>
    </div>
  </header>
)

const SWORD = (
  <>
    <rect fill="#d6dce3" height="19" width="2" x="15" y="2" />
    <rect fill="#f2b552" height="2" width="10" x="11" y="21" />
    <rect fill="#8a5a2b" height="5" width="2" x="15" y="23" />
    <rect fill="#f2b552" height="2" width="4" x="14" y="28" />
  </>
)
const Crest = () => (
  <svg className="crest" shapeRendering="crispEdges" viewBox="0 0 32 32">
    <g transform="rotate(45 16 16)">
      {SWORD}
      <rect fill="#ffffff" height="19" width="1" x="15" y="2" />
    </g>
    <g transform="rotate(-45 16 16)">
      {SWORD}
      <rect fill="#ffffff" height="19" width="1" x="16" y="2" />
    </g>
  </svg>
)

export const LandingEarn = ({
  copy,
  assets,
  links,
}: Readonly<{ assets: LandingAssets; links: LandingLinks }> & Copy) => (
  <section aria-labelledby="landing-earn-title" className="earn">
    <div className="wide">
      <div className="sec-head text">
        <h2 className="h2" id="landing-earn-title">
          {copy.earn.title}
        </h2>
        <p>{copy.earn.intro}</p>
      </div>
      <div aria-hidden="true" className="stall arch">
        <div className="stall-in arch">
          <div className="bay">
            <img alt="" className="item key" height="512" loading="lazy" src={assets.item_key} width="512" />
            <span className="bay-name">{copy.earn.bays[0]}</span>
          </div>
          <div className="bay">
            <div className="pair">
              <img alt="" className="item" height="512" loading="lazy" src={assets.item_horn} width="512" />
              <img alt="" className="item" height="512" loading="lazy" src={assets.item_bow} width="512" />
            </div>
            <span className="bay-name">{copy.earn.bays[1]}</span>
          </div>
          <div className="bay">
            <Crest />
            <span className="bay-name">{copy.earn.bays[2]}</span>
          </div>
        </div>
      </div>
      <div aria-hidden="true" className="ledge" />
      <ul className="counter">
        <li>
          <h3 className="h3">{copy.earn.paths[0].title}</h3>
          <p>{copy.earn.paths[0].body}</p>
        </li>
        <li>
          <h3 className="h3">{copy.earn.paths[1].title}</h3>
          <p>{copy.earn.paths[1].body}</p>
          <External copy={copy} href={links.encyclopedia}>
            {copy.earn.paths[1].link}
          </External>
        </li>
        <li>
          <h3 className="h3">{copy.earn.paths[2].title}</h3>
          <p>{copy.earn.paths[2].body}</p>
        </li>
      </ul>
    </div>
  </section>
)

/** Tile marks: positions measured on the 1920x1080 combat capture. */
const MARKS = [
  { key: 'you', side: 'mark-up', style: { '--x': '47.8%', '--y': '48.2%', '--c': '#7eb6ff', '--sw': '#7eb6ff' } },
  { key: 'tiles', side: 'mark-right', style: { '--x': '55.3%', '--y': '46.4%', '--c': '#efe8dc', '--sw': '#7fd6a4' } },
  { key: 'goblins', side: 'mark-down', style: { '--x': '44.5%', '--y': '59.3%', '--c': '#ffb070', '--sw': '#ff8a3d' } },
] as const

const Marks = ({ copy, live }: Readonly<{ live: boolean }> & Copy) =>
  MARKS.map((mark) => (
    <span
      aria-hidden="true"
      className={`mark ${mark.side}`}
      data-landing={live ? 'mark' : undefined}
      key={mark.key}
      style={vars(mark.style)}
    >
      <i />
      <b className="n">{copy.world.marks[mark.key]}</b>
    </span>
  ))

const Lens = ({ children, zoom = false }: Readonly<{ children: ReactNode; zoom?: boolean }>) => (
  <div className="drop">
    <div className="frame n">
      <div className={`lens n${zoom ? ' zoom-gob' : ''}`}>{children}</div>
    </div>
  </div>
)

export const LandingWorld = ({ copy, assets }: Readonly<{ assets: LandingAssets }> & Copy) => (
  <section aria-labelledby="landing-world-title" className="world" data-landing="world">
    <div className="world-pin">
      <figure aria-label={copy.world.label} className="window drop" data-landing="window">
        <div className="frame n">
          <div className="lens n">
            <div className="layer layer-world" data-landing="layer-world">
              <img alt={copy.world.alt_world} height="1080" loading="lazy" src={assets.world_capture} width="1920" />
              <span aria-hidden="true" className="gob-ring" data-landing="ring" />
            </div>
            <div className="layer layer-combat" data-landing="layer-combat" style={{ clipPath: 'inset(0 0 100% 0)' }}>
              <img alt={copy.world.alt_combat} height="1080" loading="lazy" src={assets.combat_capture} width="1920" />
              <Marks copy={copy} live />
            </div>
          </div>
        </div>
      </figure>
      <div className="plaque-wrap">
        <div className="plaque n wide">
          <div className="plaque-head">
            <h2 className="h2" id="landing-world-title">
              {copy.world.title}
            </h2>
            <span aria-hidden="true" className="rail">
              <i className="on" data-landing="rail" />
              <i data-landing="rail" />
              <i data-landing="rail" />
            </span>
          </div>
          <div className="beats">
            <article className="beat" data-landing="beat">
              <figure className="beat-fig">
                <Lens>
                  <img
                    alt={copy.world.alt_world}
                    height="1080"
                    loading="lazy"
                    src={assets.world_capture}
                    width="1920"
                  />
                </Lens>
              </figure>
              <div className="beat-text">
                <h3 className="h3">{copy.world.beats[0].title}</h3>
                <p>{copy.world.beats[0].body}</p>
              </div>
            </article>
            <article className="beat" data-landing="beat">
              <figure className="beat-fig">
                <Lens zoom>
                  <div className="layer">
                    <img
                      alt={copy.world.alt_goblins}
                      height="1080"
                      loading="lazy"
                      src={assets.world_capture}
                      width="1920"
                    />
                    <span aria-hidden="true" className="gob-ring" />
                  </div>
                </Lens>
              </figure>
              <div className="beat-text">
                <div aria-label={copy.world.keys_label} className="keys">
                  <kbd className="n">W</kbd>
                  <span aria-hidden="true">{copy.world.keys_then}</span>
                  <kbd className="n">F</kbd>
                </div>
                <h3 className="h3">{copy.world.beats[1].title}</h3>
                <p>{copy.world.beats[1].body}</p>
              </div>
            </article>
            <article className="beat" data-landing="beat">
              <figure className="beat-fig">
                <Lens>
                  <img
                    alt={copy.world.alt_combat}
                    height="1080"
                    loading="lazy"
                    src={assets.combat_capture}
                    width="1920"
                  />
                  <Marks copy={copy} live={false} />
                </Lens>
              </figure>
              <div className="beat-text">
                <h3 className="h3">{copy.world.beats[2].title}</h3>
                <p>{copy.world.beats[2].body}</p>
              </div>
            </article>
          </div>
        </div>
      </div>
    </div>
  </section>
)

const ORB_WAVE = [
  0.35, 0.6, 0.9, 0.5, 0.75, 1, 0.55, 0.3, 0.7, 0.95, 0.6, 0.4, 0.8, 0.5, 0.3, 0.65, 0.9, 0.45, 0.7, 0.35,
]
const MIC_WAVE = [0.4, 0.7, 1, 0.6, 0.85, 0.5, 0.3, 0.75, 0.95, 0.55, 0.4, 0.7, 0.5, 0.3]
const Wave = ({ heights }: Readonly<{ heights: readonly number[] }>) => (
  <span aria-hidden="true" className="wave">
    {heights.map((height, index) => (
      <i key={index} style={vars({ '--h': height })} />
    ))}
  </span>
)

/** The scripted stream illustration: real captures, the real portrait and real spectator states. No audio or agent. */
export const LandingAgent = ({ copy, assets }: Readonly<{ assets: LandingAssets }> & Copy) => (
  <section aria-labelledby="landing-agent-title" className="agent" data-landing="agent" id="landing-agent">
    <div className="wide">
      <div className="sec-head text">
        <h2 className="h2" id="landing-agent-title">
          {copy.agent.title}
        </h2>
        <p>{copy.agent.intro}</p>
      </div>
      <div className="broadcast" data-landing="broadcast">
        <div className="cell">
          <div aria-hidden="true" className="screen n">
            <img alt="" className="cap" height="1080" loading="lazy" src={assets.world_capture} width="1920" />
            <div className="cap-combat">
              <img alt="" height="1080" loading="lazy" src={assets.combat_capture} width="1920" />
            </div>
            <div className="hud">
              <div className="hud-l">
                <span className="status n">
                  <i />
                  <span data-landing="live">{copy.agent.status_watching}</span>
                </span>
                <span className="ctab n">
                  <img alt="" height="1024" loading="lazy" src={assets.portrait} width="1024" />
                  {copy.agent.character}
                </span>
              </div>
              <span className="stop n">{copy.agent.stop}</span>
            </div>
            <div className="orb">
              <span className="who">{copy.agent.you}</span>
              <Wave heights={ORB_WAVE} />
              <p className="say">
                {copy.agent.said.map((word, index) => (
                  <span className="w" key={index} style={vars({ '--i': index })}>
                    {word}{' '}
                  </span>
                ))}
              </p>
            </div>
            <div className="bubble">
              {copy.agent.bubbles.map((line, index) => (
                <p className={`b${index + 1}`} key={line}>
                  {line}
                </p>
              ))}
            </div>
          </div>
          <div aria-hidden="true" className="vtuber">
            <img alt="" height="1024" loading="lazy" src={assets.portrait} width="1024" />
            <span className="nameplate n">
              <i />
              {copy.agent.character}
            </span>
          </div>
        </div>
        <aside aria-labelledby="landing-call-title" className="call">
          <div className="call-head">
            <h3 id="landing-call-title">{copy.agent.call_title}</h3>
            <span>{copy.agent.call_detail}</span>
          </div>
          <ol className="log">
            {copy.agent.log.map((line, index) => (
              <li className={`msg ${index === 0 ? 'you' : 'ai'} m${index + 1}`} key={index}>
                <b>{index === 0 ? copy.agent.you : copy.agent.your_agent}</b>
                <p>{line}</p>
              </li>
            ))}
          </ol>
          <div className="mic">
            <svg aria-hidden="true" height="18" viewBox="0 0 20 20" width="18">
              <path d="M8 2h4v9H8zM5 8h2v3h1v2h4v-2h1V8h2v4h-1v2h-3v2h2v2H7v-2h2v-2H6v-2H5z" fill="currentColor" />
            </svg>
            <Wave heights={MIC_WAVE} />
            <button className="replay" data-landing="replay" hidden type="button">
              <svg aria-hidden="true" height="16" viewBox="0 0 20 20" width="16">
                <path d="M9 2h2v2h2v2h-2v2H9V6H6v2H4v6h2v2h8v-2h2V8h2v8h-2v2H4v-2H2V6h2V4h5z" fill="currentColor" />
              </svg>
              {copy.agent.replay}
            </button>
          </div>
        </aside>
      </div>
      <p className="stream-note">{copy.agent.note}</p>
    </div>
  </section>
)

export const LandingEnd = ({ copy, links, on_play }: Readonly<{ links: LandingLinks; on_play: () => void }> & Copy) => (
  <>
    <section aria-labelledby="landing-end-title" className="end text">
      <h2 className="h2" id="landing-end-title">
        {copy.end.title}
      </h2>
      <p>{copy.end.body}</p>
      <div className="ctas">
        <PlayButton label={copy.end.play} on_play={on_play} />
        <span className="slab">
          <External className="btn btn-rune n" copy={copy} href={links.discord}>
            {copy.end.discord}
          </External>
        </span>
      </div>
    </section>
    <footer className="site-foot wide">
      <div aria-hidden="true" className="ledge" />
      <div className="foot-in">
        <div className="foot-id">
          <p className="wordmark">{copy.footer.wordmark}</p>
          <p>{copy.footer.tagline}</p>
        </div>
        <nav aria-labelledby="landing-foot-game" className="foot-nav">
          <h2 className="foot-h" id="landing-foot-game">
            {copy.footer.game}
          </h2>
          <ul>
            <li>
              <button className="foot-link" onClick={on_play} type="button">
                {copy.footer.play}
              </button>
            </li>
            <li>
              <External copy={copy} href={links.encyclopedia}>
                {copy.footer.encyclopedia}
              </External>
            </li>
            <li>
              <External copy={copy} href={links.journal}>
                {copy.footer.journal}
              </External>
            </li>
          </ul>
        </nav>
        <nav aria-labelledby="landing-foot-community" className="foot-nav">
          <h2 className="foot-h" id="landing-foot-community">
            {copy.footer.community}
          </h2>
          <ul>
            <li>
              <External copy={copy} href={links.discord}>
                {copy.footer.discord}
              </External>
            </li>
            <li>
              <External copy={copy} href={links.telegram}>
                {copy.footer.telegram}
              </External>
            </li>
            <li>
              <External copy={copy} href={links.x}>
                {copy.footer.x}
              </External>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  </>
)
