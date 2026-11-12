// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { Command } from './control.ts'
import type { ControlStore } from './store.ts'
import type { Bot, BotConfig } from './model.ts'
import type { GameplayContext } from './gameplay_context.ts'
import { run_tick, run_observation } from './run_runtime.ts'
import type { Run } from './run_plan.ts'
import type { RunKind } from './run_ref.ts'

/** All retained objectives borrow the same live actor and durable command lane. */
export const process_bot_run = async (
  key: string,
  options: Readonly<{
    store: ControlStore
    config: BotConfig
    actor_id: string
    report_failure: (error: unknown) => void
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
  const run = await store.read<Run>(key)
  if (!run || !['active', 'waiting'].includes(run.status)) return
  const bot = await store.read<Bot>(`bot:${run.bot_id}`)
  if (!bot) throw new Error('BOT_MISSING')
  const kind = key.split(':')[0] as RunKind
  const observation = run_observation(kind, run)
  const session = await options.session(bot, observation)
  const input = {
    store,
    config,
    actor_id,
    report_failure: options.report_failure,
    context: session.context,
    fence: session.fence,
    now: options.now(),
  }
  const status = await run_tick(kind, { ...input, run })
  if (['active', 'waiting'].includes(String(status))) await session.connect()
}
