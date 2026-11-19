// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One preview per interface. Tool names and commands are code and stay untranslated.
import type { Copy } from './landing_parts.tsx'
import type { InterfaceId, LandingAssets } from './landing_types.ts'

type Assets = Readonly<{ assets: LandingAssets }>

const TermBar = ({ title, label }: Readonly<{ title: string; label: string }>) => (
  <div className="term-bar">
    <span>{title}</span>
    <span>{label}</span>
  </div>
)
const Line = ({ who, kind, children }: Readonly<{ who: string; kind?: string; children: string }>) => (
  <p className="tl" data-kind={kind}>
    <span className="who">{who}</span>
    <span>{children}</span>
  </p>
)

const WorldPreview = ({ copy, assets }: Copy & Assets) => (
  <div className="pv pv-shot">
    <img alt={copy.chooser.items.world.preview} height="1080" loading="lazy" src={assets.world_capture} width="1920" />
    <span aria-hidden="true" className="keys">
      <kbd>W</kbd>
      {copy.chooser.previews.keys_then}
      <kbd>F</kbd>
    </span>
  </div>
)

const DappPreview = ({ copy, assets }: Copy & Assets) => {
  const { dapp } = copy.chooser.previews
  return (
    <div aria-label={copy.chooser.items.dapp.preview} className="pv" role="img">
      <TermBar label={dapp.label} title={dapp.title} />
      <div className="dapp">
        <div className="dapp-row">
          <img alt="" className="dapp-face" height="38" loading="lazy" src={assets.portrait} width="38" />
          <b>{dapp.character}</b>
          <em>{dapp.questing}</em>
          <span className="dapp-bar">
            <i />
          </span>
        </div>
        <div className="dapp-row">
          <img alt="" className="dapp-item" height="38" loading="lazy" src={assets.item_key} width="38" />
          <b>{dapp.dungeon}</b>
          <em>{dapp.needs_key}</em>
          <small>{dapp.raid}</small>
        </div>
        <div className="dapp-acts">
          {dapp.actions.map((action, index) => (
            <span data-go={index === 0 ? '' : undefined} key={action}>
              {action}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

const AgentPreview = ({ copy }: Copy) => {
  const { agent } = copy.chooser.previews
  const [ask, accept, found, fight] = agent.lines
  return (
    <div aria-label={copy.chooser.items.agent.preview} className="pv" role="img">
      <TermBar label={agent.label} title={agent.title} />
      <div className="term">
        <Line kind="you" who={agent.you}>
          {ask}
        </Line>
        <Line kind="agent" who={agent.agent}>
          {accept}
        </Line>
        <Line kind="call" who={agent.call}>
          {'bot_observe {"spells":[]}'}
        </Line>
        <Line kind="call" who={agent.call}>
          bot_start_behavior
        </Line>
        <Line kind="agent" who={agent.agent}>
          {found}
        </Line>
        <Line kind="call" who={agent.call}>
          bot_combat_status
        </Line>
        <Line kind="agent" who={agent.agent}>
          {fight}
        </Line>
      </div>
    </div>
  )
}

const TelegramPreview = ({ copy }: Copy) => {
  const { telegram: chat } = copy.chooser.previews
  return (
    <div aria-label={copy.chooser.items.telegram.preview} className="pv pv-chat" role="img">
      <div className="tg">
        {chat.choose}
        <div className="tg-keys">
          <span>{chat.patrol}</span>
          <span>{chat.gather}</span>
        </div>
      </div>
      <div className="tg">
        {chat.review}
        <small>{chat.review_detail}</small>
        <div className="tg-keys">
          <span data-go="">{chat.approve}</span>
          <span>{chat.menu}</span>
        </div>
      </div>
      <div className="tg">
        {chat.running}
        <div className="tg-keys">
          <span>{chat.status}</span>
          <span>{chat.stop}</span>
        </div>
      </div>
    </div>
  )
}

const SdkPreview = ({ copy }: Copy) => {
  const { sdk } = copy.chooser.previews
  return (
    <div aria-label={copy.chooser.items.sdk.preview} className="pv" role="img">
      <TermBar label={sdk.label} title="aresrpg.world / llms.txt" />
      <div className="term">
        <Line who="$">curl https://aresrpg.world/llms.txt</Line>
        <Line kind="head" who="##">
          {sdk.build}
        </Line>
        {sdk.build_lines.map((line) => (
          <Line key={line} who="-">
            {line}
          </Line>
        ))}
        <Line kind="head" who="##">
          {sdk.source}
        </Line>
        {sdk.source_lines.map((line) => (
          <Line key={line} who="-">
            {line}
          </Line>
        ))}
      </div>
    </div>
  )
}

export const InterfacePreview = ({ id, copy, assets }: Readonly<{ id: InterfaceId }> & Copy & Assets) => {
  switch (id) {
    case 'world':
      return <WorldPreview assets={assets} copy={copy} />
    case 'dapp':
      return <DappPreview assets={assets} copy={copy} />
    case 'agent':
      return <AgentPreview copy={copy} />
    case 'telegram':
      return <TelegramPreview copy={copy} />
    case 'sdk':
      return <SdkPreview copy={copy} />
  }
}
