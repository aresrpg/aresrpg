// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { sign_hosted_message, type HostedSigningIntent } from '../../src/agents/hosted_challenge.ts'

const intent: HostedSigningIntent = {
  issuer: 'https://bot.fixture.example',
  web_origin: 'https://game.fixture.example',
  input: {
    purpose: 'consent',
    authorization_id: 'auth',
    owner: 'owner',
    zklogin_public_identifier: 'google',
    bot_id: 'bot',
    generation: 1,
    policy_revision: 2,
    address: 'address',
    multisig_public_key: 'public',
  },
  consent: {
    authorization_id: 'auth',
    client_id: 'client',
    client_name: 'Assistant',
    redirect_uri: 'https://assistant.fixture.example/callback',
    scopes: ['bot:observe'],
    resource: 'https://bot.fixture.example/mcp',
    network: 'mainnet',
  },
}
const data = () => ({
  purpose: 'consent',
  issuer: intent.issuer,
  network: 'mainnet',
  authority_generation: 'generation',
  authorization_id: 'auth',
  session_hash: 'session',
  nonce: 'challenge',
  owner: 'owner',
  zklogin_public_identifier: 'google',
  client_id: 'client',
  redirect_uri: intent.consent!.redirect_uri,
  resource: intent.consent!.resource,
  scopes: ['bot:observe'],
  expires_at: Date.now() + 60_000,
  consent: {
    bot_id: 'bot',
    generation: 1,
    policy_revision: 2,
    address: 'address',
    multisig_public_key: 'public',
  },
})
const response = (
  value: ReturnType<typeof data>,
  message = `AresRPG hosted bot consent v1\n${JSON.stringify(value)}`
) => ({
  authorization_id: 'auth',
  challenge_id: 'challenge',
  expires_at: value.expires_at,
  message,
})
for (const [name, patch] of Object.entries({
  bot: { consent: { ...data().consent, bot_id: 'other' } },
  client: { client_id: 'other' },
  purpose: { purpose: 'session' },
  owner: { owner: 'other' },
  google: { zklogin_public_identifier: 'other' },
  generation: { consent: { ...data().consent, generation: 9 } },
  policy: { consent: { ...data().consent, policy_revision: 9 } },
  address: { consent: { ...data().consent, address: 'other' } },
  public_key: { consent: { ...data().consent, multisig_public_key: 'other' } },
  resource: { resource: 'https://other.example/mcp' },
  issuer: { issuer: 'https://other.example' },
  network: { network: 'testnet' },
  redirect: { redirect_uri: 'https://other.example/callback' },
  scopes: { scopes: ['bot:execute'] },
  authorization: { authorization_id: 'other' },
  nonce: { nonce: 'other' },
}))
  test(`refuses substituted ${name} before invoking the wallet`, async () => {
    const calls: Uint8Array[] = []
    await expect(
      sign_hosted_message(response({ ...data(), ...patch }), intent, async (bytes) => {
        calls.push(bytes)
        return 'fixture'
      })
    ).rejects.toThrow()
    expect(calls).toHaveLength(0)
  })
test('refuses an unrelated personal message before invoking the wallet', async () => {
  const calls: Uint8Array[] = []
  await expect(
    sign_hosted_message(response(data(), 'Authorize another application'), intent, async (bytes) => {
      calls.push(bytes)
      return 'fixture'
    })
  ).rejects.toThrow()
  expect(calls).toHaveLength(0)
})
test('signs the exact reviewed canonical bytes once', async () => {
  const challenge = response(data())
  const calls: Uint8Array[] = []
  expect(
    await sign_hosted_message(challenge, intent, async (bytes) => {
      calls.push(bytes)
      return 'fixture'
    })
  ).toBe('fixture')
  expect(calls.map((bytes) => new TextDecoder().decode(bytes))).toEqual([challenge.message])
})

test('rejects mismatched displayed authorization and missing consent review', async () => {
  for (const consent of [null, { ...intent.consent!, authorization_id: 'different-review' }]) {
    const calls: Uint8Array[] = []
    await expect(
      sign_hosted_message(response(data()), { ...intent, consent }, async (bytes) => {
        calls.push(bytes)
        return 'fixture'
      })
    ).rejects.toThrow()
    expect(calls).toHaveLength(0)
  }
})
test('standalone session signs only the local first-party login intent', async () => {
  const session_intent: HostedSigningIntent = {
    ...intent,
    consent: null,
    input: { purpose: 'session', owner: 'owner', zklogin_public_identifier: 'google' },
  }
  const session = {
    ...data(),
    purpose: 'session',
    client_id: 'first-party',
    redirect_uri: intent.web_origin,
    scopes: [],
    consent: null,
  }
  const challenge = {
    authorization_id: 'auth',
    challenge_id: 'challenge',
    expires_at: session.expires_at,
    message: `AresRPG hosted bot session v1\n${JSON.stringify(session)}`,
  }
  const calls: Uint8Array[] = []
  expect(
    await sign_hosted_message(challenge, session_intent, async (bytes) => {
      calls.push(bytes)
      return 'fixture'
    })
  ).toBe('fixture')
  expect(calls).toHaveLength(1)
})
test('rejects expired and envelope-mismatched response lifetimes before signing', async () => {
  for (const expires_at of [Date.now() - 1, Date.now() + 600_000, NaN]) {
    const calls: Uint8Array[] = []
    await expect(
      sign_hosted_message({ ...response(data()), expires_at }, intent, async (bytes) => {
        calls.push(bytes)
        return 'fixture'
      })
    ).rejects.toThrow()
    expect(calls).toHaveLength(0)
  }
})

test('consent identity uses the registered HTTPS destination, not client branding', async () => {
  const { hosted_consent_destination } = await import('../../src/agents/hosted_challenge.ts')
  expect(hosted_consent_destination('https://receiver.example:8443/callback?state=value')).toBe('receiver.example:8443')
  for (const uri of [
    'http://receiver.example',
    'https://ChatGPT@receiver.example/callback',
    'https://receiver.example/#fake',
    'not a URL',
  ])
    expect(() => hosted_consent_destination(uri)).toThrow()
})

test('only the exact documented ChatGPT callback receives its friendly name', async () => {
  const { hosted_consent_destination } = await import('../../src/agents/hosted_challenge.ts')
  expect(hosted_consent_destination('https://chatgpt.com/connector_platform_oauth_redirect')).toBe('ChatGPT')
  for (const uri of [
    'https://chatgpt.com.attacker.example/connector_platform_oauth_redirect',
    'https://chatgpt.com:8443/connector_platform_oauth_redirect',
    'https://chatgpt.com/unrelated',
    'https://chatgpt.com/connector_platform_oauth_redirect?next=attacker',
  ])
    expect(hosted_consent_destination(uri)).not.toBe('ChatGPT')
})
