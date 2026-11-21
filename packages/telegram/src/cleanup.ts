// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { create_bot_client, type BotFetch } from '@aresrpg/protocol/hosted-bot-client'
import { OWNER_ADDRESS } from '@aresrpg/protocol/telegram-access'

import { integer, object, setting, text } from './config.ts'
import { create_links } from './link.ts'
import { secure_records, type RecordBackend } from './secure_records.ts'

// Exactly one named target. An operator knows the owner address it admitted; the chat id exists only
// inside the encrypted owner index, so --owner resolves it there.
const target_of = (args: readonly string[]): Readonly<{ sender: number } | { owner: string }> => {
  const [flag, value = ''] = args
  if (args.length === 2 && flag === '--sender' && /^[1-9]\d*$/.test(value)) return { sender: integer(Number(value)) }
  if (args.length === 2 && flag === '--owner' && OWNER_ADDRESS.test(value)) return { owner: value }
  throw new Error('cleanup_requires_exact_sender')
}
export const cleanup_sender = async (
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  backend: RecordBackend,
  http: BotFetch = fetch
) => {
  const target = target_of(args)
  const config = object(JSON.parse(setting(env, 'TELEGRAM_CONNECTED_CONFIG')))
  const limits = object(config.limits)
  const request_ms = integer(limits.request_ms)
  const link_ttl_ms = integer(limits.link_ttl_ms)
  if (!request_ms || !link_ttl_ms) throw new Error('cleanup_limits_required')
  const hosted = create_bot_client({ issuer: text(config.issuer), fetch: http, now: Date.now, timeout_ms: request_ms })
  const links = create_links(
    secure_records(backend, setting(env, 'TELEGRAM_STORAGE_KEY')),
    hosted,
    text(config.callback_url),
    link_ttl_ms
  )
  const sender = 'sender' in target ? target.sender : await links.sender_of(target.owner)
  if (sender === null) throw new Error('cleanup_owner_not_linked')
  await links.revoke(sender)
  await links.assert_revoked(sender)
}
