// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

/**
 * The one grammar of the hosted services' permanent Redis. Every key is
 *
 *   <namespace>:<collection>[:<id>]
 *
 * namespace   one per service; the bare namespace is reserved for that service's layout marker.
 * collection  one Redis type and one meaning, declared in this table and nowhere else.
 * id          one entity of the collection, opaque here; a collection that is one value has none.
 *
 * The hosted bot and Telegram share this Redis, so both build every key through this module.
 */
export const HOSTED_KEYSPACES = {
  bot: {
    namespace: 'bot:control',
    collections: {
      /** One control aggregate per id. The id is the bot's own `<kind>:<identity>`. */
      record: 'string',
      /** The record keys that still hold unfinished work, for discovery after a restart. */
      pending: 'zset',
    },
  },
  telegram: {
    namespace: 'telegram',
    collections: {
      /** Encrypted: an established login, by Telegram sender. */
      user: 'string',
      /** Encrypted: the sender an owner's login belongs to, by hashed owner address. */
      owner: 'string',
      /** Encrypted: one login attempt, by hashed link. */
      pending: 'string',
      /** Encrypted: a sender's open login attempts. */
      attempts: 'string',
      /** The owner addresses the operator admitted to Telegram. */
      admitted: 'set',
      /** The owner addresses that asked for access, scored by the time they joined in milliseconds. */
      waitlist: 'zset',
    },
  },
} as const

export type HostedService = keyof typeof HOSTED_KEYSPACES
export type HostedCollection<S extends HostedService> = keyof (typeof HOSTED_KEYSPACES)[S]['collections'] & string

/** One service's keys. Production uses the declared namespace; a test passes a disposable one. */
export const hosted_keys = <S extends HostedService>(
  service: S,
  namespace: string = HOSTED_KEYSPACES[service].namespace
) => {
  const prefix = `${namespace}:`
  const declared: Readonly<Record<string, string>> = HOSTED_KEYSPACES[service].collections
  return {
    namespace,
    key: (collection: HostedCollection<S>, id?: string): string =>
      id === undefined ? `${prefix}${collection}` : `${prefix}${collection}:${id}`,
    /** The inverse of `key`. Null for a key this service does not declare. */
    parse: (key: string): Readonly<{ collection: HostedCollection<S>; id: string | null }> | null => {
      if (!key.startsWith(prefix)) return null
      const [collection, ...rest] = key.slice(prefix.length).split(':')
      if (!Object.hasOwn(declared, collection!)) return null
      return { collection: collection as HostedCollection<S>, id: rest.length ? rest.join(':') : null }
    },
  }
}
export type HostedKeys<S extends HostedService> = ReturnType<typeof hosted_keys<S>>
