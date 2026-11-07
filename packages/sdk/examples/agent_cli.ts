// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { resolve } from 'node:path'
import { pathToFileURL as path_to_file_url } from 'node:url'

import { agent_status, initialize_agent, load_agent_signer, pair_agent } from './agent_host.ts'

export { load_agent_signer, pair_agent } from './agent_host.ts'

const read_link = async () => {
  if (process.env.ARESRPG_SETUP_LINK) return process.env.ARESRPG_SETUP_LINK
  if (process.stdin.isTTY) throw new Error('SETUP_LINK_REQUIRED_USE_PRIVATE_STDIN_OR_ENV')
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8').trim()
}

const parse_arguments = () => {
  const [command, directory, ...flags] = process.argv.slice(2)
  if (!command || !directory || !['init', 'pair', 'status', 'reload'].includes(command))
    throw new Error('USAGE_INIT_PAIR_STATUS_RELOAD_ABSOLUTE_STATE_DIRECTORY')
  if (flags.some((flag) => flag !== '--approve-key-creation') || (flags.length && command !== 'init'))
    throw new Error('INVALID_ARGUMENTS')
  return { command, directory, flags }
}

const run = async () => {
  const { command, directory, flags } = parse_arguments()
  switch (command) {
    case 'init':
      return initialize_agent(directory, flags.includes('--approve-key-creation'))
    case 'status':
      return agent_status(directory)
    case 'reload':
      return { status: 'paired', address: (await load_agent_signer(directory)).address }
    case 'pair':
      return {
        status: 'paired',
        address: (
          await pair_agent(directory, await read_link(), { local_preview: process.env.ARESRPG_LOCAL_PREVIEW === '1' })
        ).address,
      }
  }
}

if (process.argv[1] && path_to_file_url(resolve(process.argv[1])).href === import.meta.url) {
  try {
    console.log(JSON.stringify(await run()))
  } catch (error) {
    // Errors may originate in parsing a secret URL/key. Never print arbitrary messages or stacks.
    const message =
      error instanceof Error && /^[A-Z][A-Z_]+$/.test(error.message) ? error.message : 'AGENT_SETUP_FAILED'
    console.error(JSON.stringify({ error: message }))
    process.exitCode = 1
  }
}
