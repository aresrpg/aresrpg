// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { hosted_keys } from '../../src/hosted_keys.ts'
import { create_telegram_access } from '../../src/telegram_access.ts'

/** The real access module over the few Redis commands it sends, on in-memory sets. `admitted` seeds the allowlist. */
export const memory_access = (now?: () => number, admitted: readonly string[] = []) => {
  const sets = new Map([[hosted_keys('telegram').key('admitted'), new Set(admitted)]])
  const scores = new Map<string, Map<string, number>>()
  const set = (key: string) => sets.get(key) ?? sets.set(key, new Set()).get(key)!
  const sorted = (key: string) => scores.get(key) ?? scores.set(key, new Map()).get(key)!
  const commands: Readonly<Record<string, (args: readonly string[]) => unknown>> = {
    SADD: ([key, member]) => void set(key!).add(member!),
    SREM: ([key, member]) => void set(key!).delete(member!),
    SISMEMBER: ([key, member]) => (set(key!).has(member!) ? 1 : 0),
    SMEMBERS: ([key]) => [...set(key!)],
    // Only the NX form is sent: a member keeps its first score.
    ZADD: ([key, , score, member]) => void (sorted(key!).has(member!) || sorted(key!).set(member!, Number(score))),
    ZSCORE: ([key, member]) => sorted(key!).get(member!) ?? null,
    ZRANGE: ([key]) => [...sorted(key!)].sort((left, right) => left[1] - right[1]),
  }
  return create_telegram_access(async (command, args) => commands[command]!(args), undefined, now)
}
