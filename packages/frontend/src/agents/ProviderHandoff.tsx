// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { copy_text, type AppCopy } from '../i18n/copy.ts'

import { AgentPrompt } from './AgentHandoff.tsx'

// Reference layouts: owner-supplied Codex and Claude dialogs. These are illustrations,
// never forms or a claim that either provider has connected. Only the copy button acts.
const ProviderExample = ({ copy, provider, url }: Readonly<{ copy: AppCopy; provider: string; url: string }>) => {
  const text = copy_text(copy.ui)
  const chatgpt = provider === 'ChatGPT'
  return (
    <figure className="agent-provider-example" data-provider-example={provider}>
      <figcaption>{text('agent_guide_example', { provider })}</figcaption>
      <div className="agent-provider-example-modal">
        <h3>{text(chatgpt ? 'agent_guide_chatgpt_title' : 'agent_guide_claude_title')}</h3>
        <dl>
          <dt>{text('agent_guide_name')}</dt>
          <dd>AresRPG</dd>
          {chatgpt && (
            <>
              <dt>{text('agent_guide_description')}</dt>
              <dd className="agent-provider-example-empty">—</dd>
            </>
          )}
          <dt>{text(chatgpt ? 'agent_guide_server_url' : 'agent_guide_mcp_url')}</dt>
          <dd className="agent-provider-example-url">{url}</dd>
          {chatgpt && (
            <>
              <dt>{text('agent_guide_authentication')}</dt>
              <dd>OAuth</dd>
            </>
          )}
        </dl>
        <p className="agent-provider-example-warning">{text('agent_guide_warning')}</p>
        {chatgpt && (
          <p className="agent-provider-example-ack">
            <span aria-hidden="true">□</span> {text('agent_guide_acknowledge')}
          </p>
        )}
        <div className="agent-provider-example-footer">
          <span>{text(chatgpt ? 'agent_guide_create_plugin' : 'agent_guide_continue')}</span>
        </div>
      </div>
    </figure>
  )
}

/** Provider navigation is guidance only; the provider owns installation and OAuth approval. */
export const ProviderHandoff = ({
  copy,
  provider,
  url,
}: Readonly<{ copy: AppCopy; provider: string; url: string }>) => {
  const text = copy_text(copy.ui)
  const name = provider.toLowerCase()
  if (!['chatgpt', 'claude', 'grok'].includes(name)) return null
  return (
    <div className="agent-provider-guide" data-provider-guide={provider}>
      <ol>
        <li>{text(`agent_guide_${name}_open`)}</li>
        <li>{text(`agent_guide_${name}_fill`)}</li>
        <li>{text('agent_guide_finish', { provider })}</li>
      </ol>
      <AgentPrompt copy={copy} request={url}>
        {provider !== 'Grok' && <ProviderExample copy={copy} provider={provider} url={url} />}
      </AgentPrompt>
    </div>
  )
}
