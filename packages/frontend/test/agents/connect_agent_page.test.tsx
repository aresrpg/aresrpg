// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { afterEach, expect, spyOn, test } from 'bun:test'
import type { HostedBotDescriptor } from '@aresrpg/protocol'

import { AgentSetup, AgentSetupButton } from '../../src/agents/AgentSetup.tsx'
import { ConnectAgentRoute } from '../../src/agents/ConnectAgentRoute.tsx'
import { empty_hosted, type HostedState } from '../../src/agents/hosted_state.ts'
import type { OwnerAnswer } from '../../src/agents/owner_state.ts'
import * as hosted from '../../src/agents/useHostedConnect.ts'
import * as owner from '../../src/agents/useOwnerAnswer.ts'
import * as telegram from '../../src/agents/useTelegramRequest.ts'
import type { AuthSession } from '../../src/auth.ts'
import type { AppCopy } from '../../src/i18n/copy.ts'
import en from '../../src/i18n/locales/en.yaml'
import { dispatch_app, initialize_app_store } from '../../src/store.ts'
import { render_english } from '../i18n/render.ts'
import { automation_fixture } from '../modules/automation_fixture.ts'

const copy = en as AppCopy
const text = copy.ui
const located = Object.getOwnPropertyDescriptor(globalThis, 'location')
const spies: { mockRestore: () => void }[] = []
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore()
  if (located) Object.defineProperty(globalThis, 'location', located)
  else Reflect.deleteProperty(globalThis, 'location')
  initialize_app_store(automation_fixture().settings)
})
/** One arrival on the page: its address, the signed-in account, and what each question answered so far. */
const arrive = (
  options: Readonly<{
    search?: string
    signed_in?: boolean
    /** What the bot said the request is; `null` while it is being asked. */
    telegram?: boolean | null
    answer?: OwnerAnswer
    /** False for a check that failed: "not connected" is then not a real answer. */
    answered?: boolean
    hosted?: Partial<HostedState<HostedBotDescriptor>>
  }>
) => {
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { search: options.search ?? '' } })
  initialize_app_store(automation_fixture().settings)
  if (options.signed_in ?? true) {
    dispatch_app({ type: 'auth/connecting' })
    dispatch_app({ type: 'auth/connected', session: { address: 'owner', identity: 'zklogin' } as AuthSession })
  }
  const dispatched: unknown[] = []
  const consent = spyOn(hosted, 'useHostedConnect').mockReturnValue({
    state: { ...empty_hosted<HostedBotDescriptor>(), ...options.hosted },
    dispatch: (input) => void dispatched.push(input),
    eligible: true,
  })
  spies.push(consent)
  if (options.telegram !== undefined)
    spies.push(spyOn(telegram, 'useTelegramRequest').mockReturnValue(options.telegram))
  if (options.answer) {
    spies.push(spyOn(owner, 'useOwnerAnswer').mockReturnValue(options.answer))
    // A real "not connected" opens the setup by itself; a failed check (`answered: false`) does not.
    const opens = options.answer === 'not_connected' && options.answered !== false
    spies.push(spyOn(owner, 'useSetupOpensItself').mockReturnValue(opens))
  }
  return { consent, dispatched }
}
/** The page's own content. The header holds the account's popover and is not what these tests read. */
const page = () => `<main${render_english(<ConnectAgentRoute copy={copy} />).split('<main')[1]!}`
const button_labels = (html: string) => [...html.matchAll(/<button[^>]*>(.*?)<\/button>/gs)].map((match) => match[1]!)

// Regression: during the owner check the page opened the "Choose your agent" setup and labelled its
// button "Cancel" under the heading "Connect your agent", then flipped to "Agent connected".
test('while the owner check runs, the page says so and shows nothing it would have to take back', () => {
  arrive({ answer: 'unknown' })
  const html = page()
  expect(html).toContain(text.agent_checking)
  expect(html).toContain('role="status"')
  expect(html).toContain('aria-busy="true"')
  for (const guessed of [
    `<h1>${text.agent_connect_your}</h1>`,
    text.agent_connected,
    text.agent_choose,
    text.agent_setup,
    `>${text.agent_cancel}<`,
    'agent-provider-card',
    'role="dialog"',
    '<dialog',
  ])
    expect(html).not.toContain(guessed)
})

test('an account known to have no agent reads Connect your agent and gets the setup opened for it', () => {
  arrive({ answer: 'not_connected' })
  const html = page()
  expect(html).toContain(`<h1>${text.agent_connect_your}</h1>`)
  expect(html).toContain(text.agent_choose)
  expect(html).toContain('agent-provider-card')
  expect(html).not.toContain(text.agent_checking)
})

test('a connected account reads Agent connected and has no dialog to close', () => {
  arrive({ answer: 'connected' })
  const html = page()
  expect(html).toContain(`<h1>${text.agent_connected}</h1>`)
  expect(html).not.toContain(text.agent_connect_your)
  expect(html).not.toContain(text.agent_choose)
  expect(html).not.toContain('<dialog')
})

test('a connected account gets one status line, a quiet Disconnect and the log, with no setup and no card', () => {
  arrive({ answer: 'connected' })
  const html = page()
  expect(html).toContain('data-agent-answer="connected"')
  // The way out is the shared neutral button: never the primary tone, never the setup control.
  expect(button_labels(html)).toEqual([copy.wallet_disconnect])
  expect(html).toMatch(/<button[^>]*class="aui-button aui-button--neutral "[^>]*>Disconnect<\/button>/)
  for (const gone of ['aui-panel', 'light-page-card', 'agent-btn', text.agent_page_body, text.agent_setup])
    expect(html).not.toContain(gone)
  // No hero was read yet: the page names that wait, and already says it only shows.
  expect(html).toContain(copy.dapp_page.reading_heroes)
  expect(html).toContain('Read only. Your AI assistant decides what happens here.')
})

test('the agent page keeps the orange aura of the shared light page in every state', () => {
  for (const answer of ['unknown', 'not_connected', 'connected'] as const) {
    arrive({ answer })
    expect(render_english(<ConnectAgentRoute copy={copy} />)).toContain('class="light-page aui-aura" data-aura="ember"')
  }
})

test('the setup button names the check and is never labelled Cancel during it', () => {
  const label = (answer: OwnerAnswer) => {
    arrive({ answer })
    // The same state the page has while the check is in flight.
    dispatch_app({ type: 'agent/connection_refresh' })
    return button_labels(render_english(<AgentSetupButton copy={copy} label={text.agent_setup} />)).join('|')
  }
  expect(label('unknown')).toContain(text.agent_checking)
  expect(label('unknown')).not.toContain(text.agent_cancel)
  expect(label('unknown')).not.toContain(text.agent_setup)
  expect(label('connected')).toContain(text.agent_connected)
  expect(label('not_connected')).toContain(text.agent_setup)
  expect(label('not_connected')).not.toContain(text.agent_cancel)
})

test('the setup dialog opened during the check says it is checking and offers no setup yet', () => {
  arrive({ answer: 'unknown' })
  const html = render_english(<AgentSetup copy={copy} close={() => {}} />)
  expect(html).toContain(`>${text.agent_checking}</h2>`)
  expect(html).toContain('aria-busy="true"')
  for (const guessed of ['agent-provider-card', text.agent_choose, text.agent_connected, `>${text.agent_cancel}<`])
    expect(html).not.toContain(guessed)
})

test('an assistant’s request still waits for the player: the dialog with Continue, and nothing starts', () => {
  // The owner check never runs on a consent link, so the request is shown whatever the reading is.
  for (const answer of ['unknown', 'not_connected', 'connected'] as const) {
    const { dispatched } = arrive({ search: '?intent=connect-agent&authorization_id=request', telegram: false, answer })
    const html = page()
    expect(html).toContain(text.agent_hosted_consent)
    expect(html).toContain(text.agent_hosted_review)
    expect(html).toContain(`>${text.agent_guide_continue}<`)
    expect(html).not.toContain(text.telegram_link_title)
    expect(dispatched).toEqual([])
  }
})

test('without the Telegram setting every request is an assistant’s, a Telegram-shaped one included', () => {
  // This build has no VITE_TELEGRAM_CALLBACK_URL: the real hook answers at once and asks the bot nothing.
  const fetched = spyOn(globalThis, 'fetch')
  spies.push(fetched)
  arrive({ search: '?intent=connect-agent&authorization_id=telegram-request' })
  const html = page()
  expect(html).toContain(text.agent_hosted_review)
  expect(html).toContain(`>${text.agent_guide_continue}<`)
  expect(html).not.toContain(text.telegram_link_title)
  expect(fetched).not.toHaveBeenCalled()
})

test('until the bot says what the request is, the page signs nothing and shows only that it is working', () => {
  const { consent } = arrive({ search: '?intent=connect-agent&authorization_id=request', telegram: null })
  const html = page()
  expect(html).toContain('role="status"')
  expect(html).toContain('aria-busy="true"')
  // No consent machinery is mounted: no owner proof, no wallet provisioning, no challenge.
  expect(consent).not.toHaveBeenCalled()
  for (const early of [text.telegram_link_title, text.agent_hosted_review, text.agent_connect_your, '<button'])
    expect(html).not.toContain(early)
})

test('a Telegram login asks nothing: no consent screen, no Continue, no Connect, no Cancel', () => {
  const { consent } = arrive({ search: '?intent=connect-agent&authorization_id=request', telegram: true })
  const main = page()
  expect(main).toContain(`<h1>${text.telegram_link_title}</h1>`)
  expect(main).toContain(text.agent_hosted_pending)
  expect(main).toContain('role="status"')
  expect(consent).toHaveBeenCalled()
  expect(button_labels(main)).toEqual([])
  for (const asked of [
    text.agent_hosted_consent,
    text.agent_hosted_review,
    text.agent_hosted_authority,
    text.agent_connect_your,
    text.agent_choose,
    '<dialog',
  ])
    expect(main).not.toContain(asked)
})

test('a Telegram login in a browser with no session asks only for the Google sign-in', () => {
  const { consent } = arrive({
    search: '?intent=connect-agent&authorization_id=request',
    telegram: true,
    signed_in: false,
  })
  const main = page()
  expect(main).toContain(`<h1>${text.telegram_link_title}</h1>`)
  expect(main).toContain(text.telegram_link_signin)
  expect(main).toContain(copy.continue_google)
  expect(main).not.toContain(text.agent_page_signin)
  expect(consent).not.toHaveBeenCalled()
})

test('a Telegram login that fails says so in plain words and offers no retry that could approve again', () => {
  for (const failed of [{ phase: 'failed' as const }, { phase: 'failed' as const, failure: 'restart' as const }]) {
    arrive({ search: '?intent=connect-agent&authorization_id=request', telegram: true, hosted: failed })
    const main = page()
    expect(main).toContain('role="alert"')
    expect(main).toContain(text.telegram_link_failed)
    expect(main).not.toContain(text.agent_hosted_pending)
    expect(button_labels(main)).toEqual([])
  }
})

// Regression: on the agent page the connected button carries the primary tone, whose ink is the dark
// `--aui-orange-ink`, over the connected control's dark face: the label could not be read.
test('the connected control sets its own readable ink, whatever tone its caller gave the button', async () => {
  const css = await Bun.file(new URL('../../src/agents/agent_connected.css', import.meta.url)).text()
  const face = css.match(/\.aui-button\.opt-e \{[^}]*\}/)?.[0] ?? ''
  expect(face).toContain('background: var(--keyline);')
  expect(face).toMatch(/\n {2}color: var\(--aui-ink\);/)
  // The rule must outrank the shared `.aui-button--primary` colour: two classes against one.
  const tokens = await Bun.file(new URL('../../../ui/src/base.css', import.meta.url)).text()
  expect(tokens).toMatch(/\.aui-button--primary \{[^}]*color: var\(--aui-orange-ink\);/)
  expect(tokens).toContain('--aui-ink: #f0eee8;')
})

// Review finding: a failed owner check read as "not connected" and opened the setup as if the answer were known.
test('a failed check opens nothing by itself', () => {
  arrive({ answer: 'not_connected', answered: false })
  expect(page()).not.toContain('Choose your agent')
})
