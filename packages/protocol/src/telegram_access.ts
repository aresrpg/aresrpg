// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { hosted_keys, type HostedKeys } from './hosted_keys.ts'

/** A verified owner is a zkLogin address in its canonical form. */
export const OWNER_ADDRESS = /^0x[0-9a-f]{64}$/
const owner_address = (value: string): string => {
  if (!OWNER_ADDRESS.test(value)) throw new Error('invalid_owner')
  return value
}

/** One Redis command; the caller owns the connection. */
type Send = (command: string, args: string[]) => Promise<unknown>
export type Waiting = Readonly<{ owner: string; joined_at: number }>

/**
 * Who may use Telegram. The operator's allowlist alone admits an owner; a player only joins the
 * waitlist. Both live in the permanent Redis and every call reads it, so a change needs no restart.
 */
export const create_telegram_access = (
  send: Send,
  keys: HostedKeys<'telegram'> = hosted_keys('telegram'),
  now: () => number = Date.now
) => {
  const admitted_key = keys.key('admitted')
  const waitlist_key = keys.key('waitlist')
  const admitted_owners = async () => [...((await send('SMEMBERS', [admitted_key])) as string[])].sort()
  return {
    admitted: async (owner: string): Promise<boolean> => (await send('SISMEMBER', [admitted_key, owner])) === 1,
    admit: async (owner: string): Promise<void> => {
      await send('SADD', [admitted_key, owner_address(owner)])
    },
    remove: async (owner: string): Promise<void> => {
      await send('SREM', [admitted_key, owner_address(owner)])
    },
    admitted_owners,
    /** Joining twice keeps the first time. It never admits. */
    join: async (owner: string): Promise<void> => {
      await send('ZADD', [waitlist_key, 'NX', String(now()), owner_address(owner)])
    },
    joined: async (owner: string): Promise<boolean> => (await send('ZSCORE', [waitlist_key, owner])) !== null,
    /** The owners still waiting, oldest first: everyone who joined and is not admitted. */
    waiting: async (): Promise<readonly Waiting[]> => {
      const admitted = new Set(await admitted_owners())
      const rows = ((await send('ZRANGE', [waitlist_key, '0', '-1', 'WITHSCORES'])) as unknown[]).flat()
      return rows
        .flatMap((owner, index) => (index % 2 ? [] : [{ owner: String(owner), joined_at: Number(rows[index + 1]) }]))
        .filter(({ owner }) => !admitted.has(owner))
    },
  }
}
export type TelegramAccess = ReturnType<typeof create_telegram_access>
