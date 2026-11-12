// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { SdkOptions } from '@aresrpg/sdk'
import type { AgentTransport } from '@aresrpg/sdk/agent-connection'

import type { BotConfig } from './model.ts'
import type { ControlStore } from './store.ts'
import type { ManagedProvider } from './managed_signer.ts'
import type { EnvelopeCipher } from './transaction_journal.ts'
export type ActorRuntimeOptions = Readonly<{
  store: ControlStore
  config: BotConfig
  provider: ManagedProvider
  cipher: EnvelopeCipher
  endpoint: string
  origin: string
  actor_id: string
  lease_ms: number
  event_limit: number
  scan_limit: number
  observation_freshness_ms: number
  sdk_options: Pick<SdkOptions, 'client' | 'rpc_url' | 'pins'>
  transport?: AgentTransport
  monotonic_now?: () => number
  now?: () => number
  report_failure: (error: unknown) => void
}>
