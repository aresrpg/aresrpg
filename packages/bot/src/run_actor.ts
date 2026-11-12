// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { Command } from './control.ts'
import type { ControlStore } from './store.ts'
import type { Bot, BotConfig } from './model.ts'
import type { GameplayContext } from './gameplay_context.ts'
import { combat_observation, combat_tick } from './combat_runtime.ts'
import type { CombatRun } from './combat_control.ts'
import { profession_observation, profession_tick } from './profession_runtime.ts'
import type { ProfessionRun } from './profession_control.ts'

/** Both finite objectives borrow the same live actor and durable command lane. */
export const process_bot_run = async (
  key: string,
  options: Readonly<{
    store: ControlStore
    config: BotConfig
    actor_id: string
    now: () => number
    session: (
      bot: Bot,
      command: Command
    ) => Promise<
      Readonly<{
        context: GameplayContext
        fence: number
        connect: () => Promise<void>
      }>
    >
  }>
) => {
  const { store, config, actor_id } = options
  const run = await store.read<CombatRun | ProfessionRun>(key)
  if (!run || !['active', 'waiting'].includes(run.status)) return
  const bot = await store.read<Bot>(`bot:${run.bot_id}`)
  if (!bot) throw new Error('BOT_MISSING')
  const combat = key.startsWith('combat:')
  const observation = combat ? combat_observation(run as CombatRun) : profession_observation(run as ProfessionRun)
  const session = await options.session(bot, observation)
  const input = { store, config, actor_id, context: session.context, fence: session.fence, now: options.now() }
  const status = combat
    ? await combat_tick({ ...input, run: run as CombatRun })
    : await profession_tick({ ...input, run: run as ProfessionRun })
  if (['active', 'waiting'].includes(String(status))) await session.connect()
}
