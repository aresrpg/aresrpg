// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

/** The `telegram_companion` section of one authored locale document. */
export type Copy = Readonly<
  Record<
    | 'waiting'
    | 'on_waitlist'
    | 'join_waitlist'
    | 'check_access'
    | 'check_status'
    | 'log_in_again'
    | 'inventory'
    | 'inventory_empty'
    | 'observation_unknown'
    | 'no_strategy'
    | 'strategy_active'
    | 'strategy_waiting'
    | 'replace_strategy'
    | 'fight'
    | 'ambush'
    | 'idle'
    | 'external_strategy'
    | 'menu'
    | 'choose_strategy'
    | 'failure_changed'
    | 'failure_reconnect'
    | 'failure_unlink_first'
    | 'failure_temporary'
    | 'failure_busy'
    | 'failure_run_limit'
    | 'city_review'
    | 'world_review'
    | 'gather_effects'
    | 'city_required'
    | 'loading'
    | 'empty'
    | 'play'
    | 'back'
    | 'status'
    | 'review'
    | 'approve'
    | 'effects'
    | 'link'
    | 'connect_google'
    | 'enable_agent'
    | 'play_consent'
    | 'linked'
    | 'unlinked'
    | 'confirm'
    | 'confirm_warning'
    | 'browser_expired'
    | 'balance'
    | 'pause'
    | 'resume'
    | 'wallet_scope'
    | 'stop'
    | 'stop_all'
    | 'completed'
    | 'attention'
    | 'unknown'
    | 'stopped'
    | 'stop_scope'
    | 'paused'
    | 'resumed',
    string
  > & { strategies: Readonly<Record<string, string>> }
>
export type CopyKey = Exclude<keyof Copy, 'strategies'>

// The authored locale documents are the supported languages; this package keeps no second list.
const directory = new URL('../../frontend/src/i18n/locales/', import.meta.url)
export const load_copies = async () => {
  const entries = await Promise.all(
    [...new Bun.Glob('*.yaml').scanSync(Bun.fileURLToPath(directory))].map(async (file) => {
      const document = Bun.YAML.parse(await Bun.file(new URL(file, directory)).text()) as { telegram_companion: Copy }
      return [file.slice(0, -'.yaml'.length), document.telegram_companion] as const
    })
  )
  const copies = Object.fromEntries(entries)
  return (locale: string): Copy => (Object.hasOwn(copies, locale) ? copies[locale]! : copies.en!)
}
