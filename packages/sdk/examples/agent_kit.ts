// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createInterface as create_interface } from 'node:readline'
import { resolve } from 'node:path'
import { pathToFileURL as path_to_file_url } from 'node:url'

import { create_agent_connection, type AgentConnectionOptions, type AgentTransport } from '../src/agent_connection.ts'

import { create_bun_agent_transport } from './agent_transport.ts'
import { assert_agent_endpoint } from './agent_deployment.ts'

type AgentConfig = Readonly<{
  version: 1
  strategy: 'observe'
  objective: string
  endpoint: string
  origin: string
  character_ids: readonly string[]
  duration_ms: number
  max_spend_mist: '0'
}>
type StopReason =
  'requested' | 'duration_elapsed' | 'input_closed' | 'signal' | 'connection_failed' | 'character_missing'
type RunStatus = Readonly<{
  type: 'status'
  status: string
  reason: StopReason | null
  character_ids: readonly string[]
}>
const config_fields = [
  'version',
  'strategy',
  'objective',
  'endpoint',
  'origin',
  'character_ids',
  'duration_ms',
  'max_spend_mist',
]
const normalized_id = (value: unknown): value is string => typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value)

export const parse_agent_config = (value: unknown): AgentConfig => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_CONFIG')
  const config = value as Record<string, unknown>
  const checks = [
    Object.keys(config).length === config_fields.length,
    Object.keys(config).every((key) => config_fields.includes(key)),
    config.version === 1,
    config.strategy === 'observe',
    config.max_spend_mist === '0',
    typeof config.objective === 'string' && config.objective.trim().length > 0,
    typeof config.endpoint === 'string',
    typeof config.origin === 'string',
    Number.isSafeInteger(config.duration_ms),
    Number(config.duration_ms) > 0,
    Number(config.duration_ms) <= 2_147_483_647,
  ]
  if (!checks.every(Boolean)) throw new Error('INVALID_CONFIG')
  const ids = config.character_ids
  if (!Array.isArray(ids)) throw new Error('INVALID_CONFIG')
  if (![ids.every(normalized_id), new Set(ids).size === ids.length].every(Boolean)) throw new Error('INVALID_CONFIG')
  const result = { ...config, character_ids: Object.freeze([...ids]) } as AgentConfig
  // Reuse the SDK's endpoint/Origin policy without opening transport or loading an adapter.
  create_agent_connection({
    endpoint: result.endpoint,
    origin: result.origin,
    signer: {
      address: `0x${'0'.repeat(64)}`,
      sign_personal_message: async () => {
        throw new Error('NOT_STARTED')
      },
    },
    transport: {
      open: () => {
        throw new Error('NOT_STARTED')
      },
    },
  })
  return Object.freeze(result)
}

/** Observe-only: no transaction SDK, automatic reconnect, or persisted credentials. */
export const create_agent_run = (
  input: unknown,
  options: Readonly<{
    signer: AgentConnectionOptions['signer']
    transport?: AgentTransport
    emit?: (status: RunStatus) => void
    local_preview?: boolean
  }>
) => {
  const config = parse_agent_config(input)
  assert_agent_endpoint(config.endpoint, options.transport !== undefined || options.local_preview === true)
  if (!normalized_id(options.signer?.address) || typeof options.signer.sign_personal_message !== 'function')
    throw new Error('INVALID_SIGNER')
  const transport = options.transport ?? create_bun_agent_transport()
  let reason: StopReason | null = null
  let previous = ''
  let finish!: (status: RunStatus) => void
  const done = new Promise<RunStatus>((resolve_done) => {
    finish = resolve_done
  })
  const connection = create_agent_connection({
    ...config,
    signer: options.signer,
    transport: {
      open: (url, handlers) =>
        transport.open(url, {
          ...handlers,
          on_message: async (raw) => {
            await handlers.on_message(raw)
            observe()
          },
          on_close: (code, detail) => {
            handlers.on_close(code, detail)
            observe()
          },
        }),
    },
  })
  const status = (): RunStatus => {
    const state = connection.state()
    return Object.freeze({
      type: 'status',
      status: state.status,
      reason,
      character_ids: state.characters.map(({ id }) => id),
    })
  }
  const report = () => {
    const snapshot = status()
    const serialized = JSON.stringify(snapshot)
    if (serialized !== previous) {
      previous = serialized
      options.emit?.(snapshot)
    }
    return snapshot
  }
  const stop = (why: StopReason = 'requested') => {
    if (reason) return
    reason = why
    clearTimeout(timer)
    connection.stop()
    finish(report())
  }
  const observe = () => {
    if (reason) return
    const state = connection.state()
    if (['failed', 'stopped', 'disconnected'].includes(state.status)) return stop('connection_failed')
    if (state.status === 'ready' && config.character_ids.some((id) => !state.characters.some((row) => row.id === id)))
      return stop('character_missing')
    report()
  }
  const timer = setTimeout(() => stop('duration_elapsed'), config.duration_ms)
  connection.connect()
  observe()
  return Object.freeze({ status, stop, done })
}

const output = (value: unknown) => console.log(JSON.stringify(value))
const describe = () => ({
  version: 1,
  strategies: ['observe'],
  commands: ['describe', 'check <config.json>', 'run <config.json> <local-adapter.ts>'],
  controls: ['status', 'stop'],
  limits: { duration_ms_max: 2_147_483_647, max_spend_mist: '0' },
  instructions: 'https://aresrpg.world/agents/client.txt',
  adapter: 'Reviewed local code exporting create_signer(); personal-message signing only. No secrets in config.',
  lifecycle:
    'Foreground only. EOF, signals, duration, connection failure or missing selected character stop the run. Stop and rerun to reconfigure.',
})

const run_cli = async (config: AgentConfig, adapter_path: string) => {
  if (!adapter_path.endsWith('.ts') || /^[a-z][a-z0-9+.-]*:/i.test(adapter_path)) throw new Error('INVALID_ADAPTER')
  let run: ReturnType<typeof create_agent_run> | undefined
  const started = Date.now()
  const terminate = (reason: StopReason) => {
    if (run) run.stop(reason)
    else output({ type: 'status', status: 'stopped', reason, character_ids: [] })
    process.exit(0)
  }
  // Install these before evaluating trusted adapter code, including top-level await.
  const timer = setTimeout(() => terminate('duration_elapsed'), config.duration_ms)
  process.once('SIGINT', () => terminate('signal'))
  process.once('SIGTERM', () => terminate('signal'))
  const input = create_interface({ input: process.stdin })
  input.on('line', (line) => {
    if (line === 'stop') terminate('requested')
    else if (line === 'status')
      output(run?.status() ?? { type: 'status', status: 'initializing', reason: null, character_ids: [] })
    else output({ type: 'error', code: 'INVALID_COMMAND' })
  })
  input.once('close', () => terminate('input_closed'))
  try {
    const adapter = await import(path_to_file_url(resolve(adapter_path)).href)
    const signer = await adapter.create_signer()
    const remaining = config.duration_ms - (Date.now() - started)
    if (remaining <= 0) return terminate('duration_elapsed')
    run = create_agent_run(
      { ...config, duration_ms: remaining },
      { signer, emit: output, local_preview: process.env.ARESRPG_LOCAL_PREVIEW === '1' }
    )
    const terminal = await run.done
    process.exit(terminal.reason === 'connection_failed' || terminal.reason === 'character_missing' ? 1 : 0)
  } catch {
    output({ type: 'error', code: 'INITIALIZATION_FAILED' })
    process.exit(1)
  } finally {
    clearTimeout(timer)
    input.close()
  }
}

const main = async () => {
  const args = Bun.argv.slice(2)
  const [command, config_path, adapter_path] = args
  const lengths: Record<string, number> = { describe: 1, check: 2, run: 3 }
  if (lengths[command!] !== args.length) throw new Error('INVALID_COMMAND')
  if (command === 'describe') return output(describe())
  const config = parse_agent_config(await Bun.file(config_path!).json())
  assert_agent_endpoint(config.endpoint, process.env.ARESRPG_LOCAL_PREVIEW === '1')
  if (command === 'check') return output({ type: 'checked', config })
  return run_cli(config, adapter_path!)
}

if (import.meta.main) {
  void main().catch(() => {
    output({ type: 'error', code: 'INVALID_COMMAND_OR_CONFIG' })
    process.exitCode = 1
  })
}
