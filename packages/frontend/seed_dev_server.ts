// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import type { Plugin } from 'vite'

import { seed_content_domains } from './src/editor/seed_editor.ts'

export type SeedValidation = Readonly<{ reds: readonly string[]; warns: readonly string[] }>
type SeedFileServiceOptions = Readonly<{
  content_dir: string
  files: readonly string[]
  validate: (content: Readonly<Record<string, unknown>>) => Promise<SeedValidation>
}>

const revision_of = (source: string): string => createHash('sha256').update(source).digest('hex')
const serialize = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`

export const new_seed_reds = (baseline: SeedValidation, candidate: SeedValidation): readonly string[] => {
  const allowed = new Map<string, number>()
  baseline.reds.forEach((issue) => allowed.set(issue, (allowed.get(issue) ?? 0) + 1))
  return candidate.reds.filter((issue) => {
    const remaining = allowed.get(issue) ?? 0
    if (remaining === 0) return true
    allowed.set(issue, remaining - 1)
    return false
  })
}

export const create_seed_file_service = ({ content_dir, files, validate }: SeedFileServiceOptions) => {
  const allowed = new Set(files)
  const filename = (file: string): string => {
    if (!allowed.has(file)) throw new TypeError(`Seed file "${file}" is not editable`)
    return join(content_dir, file)
  }
  const read = async (file: string) => {
    const source = await readFile(filename(file), 'utf8')
    return Object.freeze({ file, revision: revision_of(source), value: JSON.parse(source) as unknown })
  }
  const corpus = async (): Promise<Readonly<Record<string, unknown>>> =>
    Object.freeze(
      Object.fromEntries(
        await Promise.all(files.map(async (file) => [file, JSON.parse(await readFile(filename(file), 'utf8'))]))
      )
    )
  return Object.freeze({
    read,
    read_all: async () => Promise.all(files.map(read)),
    validate: async () => validate(await corpus()),
    write: async (file: string, expected_revision: string, value: unknown) => {
      const path = filename(file)
      const current_source = await readFile(path, 'utf8')
      if (revision_of(current_source) !== expected_revision)
        throw new Error(`${file} changed on disk; reload before saving`)
      const baseline_content = await corpus()
      const candidate_content = Object.freeze({ ...baseline_content, [file]: value })
      const [baseline, candidate] = await Promise.all([validate(baseline_content), validate(candidate_content)])
      const introduced = new_seed_reds(baseline, candidate)
      if (introduced.length > 0) throw new Error(introduced.join('\n'))
      const source = serialize(value)
      const temporary = join(content_dir, `.${file}.${randomUUID()}.tmp`)
      try {
        await writeFile(temporary, source, { flag: 'wx' })
        await rename(temporary, path)
      } finally {
        await unlink(temporary).catch(() => undefined)
      }
      return Object.freeze({
        file,
        revision: revision_of(source),
        value,
        validation: candidate,
      })
    },
  })
}

export type SeedFileService = ReturnType<typeof create_seed_file_service>

const exec_file = promisify(execFile)

export const seed_content_files = Object.freeze(seed_content_domains.map(({ file }) => file))

export const create_seed_validator =
  ({
    repo_dir,
    script = join(repo_dir, 'scripts', 'validate_seed.mjs'),
  }: Readonly<{ repo_dir: string; script?: string }>) =>
  async (content: Readonly<Record<string, unknown>>) => {
    const directory = await mkdtemp(join(tmpdir(), 'aresrpg-seed-validation-'))
    try {
      await Promise.all(
        seed_content_files.map((file) => writeFile(join(directory, file), serialize(content[file]), { flag: 'wx' }))
      )
      let stdout = ''
      try {
        ;({ stdout } = await exec_file('bun', [script, '--content-dir', directory, '--json'], {
          cwd: repo_dir,
          encoding: 'utf8',
        }))
      } catch (error) {
        stdout = String((error as Readonly<{ stdout?: string }>).stdout ?? '')
        if (!stdout) throw error
      }
      const result = JSON.parse(stdout) as Readonly<{ reds?: unknown; warns?: unknown }>
      return Object.freeze({
        reds: Object.freeze(Array.isArray(result.reds) ? result.reds.map(String) : []),
        warns: Object.freeze(Array.isArray(result.warns) ? result.warns.map(String) : []),
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }

const response_json = (response: import('node:http').ServerResponse, status: number, body: unknown): void => {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(JSON.stringify(body))
}

const read_request_json = async (request: import('node:http').IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk)
    size += buffer.length
    if (size > 20 * 1024 * 1024) throw new Error('Seed edit exceeds the 20 MB request limit')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

export const seed_dev_plugin = ({
  repo_dir,
  content_dir,
}: Readonly<{ repo_dir: string; content_dir: string }>): Plugin => {
  const token = randomUUID()
  const service = create_seed_file_service({
    content_dir,
    files: seed_content_files,
    validate: create_seed_validator({ repo_dir }),
  })
  return {
    name: 'aresrpg-seed-editor',
    // A seed save must not full-reload the editing client mid-session: the JSON modules are
    // deliberately NOT invalidated here — clients get a custom event instead and choose their
    // own reload moment (the /demo editor defers it to the next tab switch).
    handleHotUpdate: ({ file, server }) => {
      if (!file.startsWith(`${content_dir}/`) || !file.endsWith('.json')) return undefined
      server.ws.send({ type: 'custom', event: 'aresrpg:seed-changed' })
      return []
    },
    configureServer: (server) => {
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
        if (url.pathname === '/__seed/files' && request.method === 'GET') {
          void Promise.all([service.read_all(), service.validate()]).then(
            ([files, validation]) => response_json(response, 200, { files, validation, token }),
            (error) => response_json(response, 500, { error: error instanceof Error ? error.message : String(error) })
          )
          return
        }
        const match = /^\/__seed\/files\/([^/]+)$/.exec(url.pathname)
        if (!match || request.method !== 'PUT') return next()
        const { origin } = request.headers
        const same_origin = !origin || new URL(origin).host === request.headers.host
        if (!same_origin || request.headers['x-aresrpg-seed-token'] !== token) {
          response_json(response, 403, { error: 'The seed editor token or origin is invalid' })
          return
        }
        void read_request_json(request)
          .then((body) => {
            if (body === null || typeof body !== 'object') throw new TypeError('Seed write body must be an object')
            const candidate = body as Readonly<{ revision?: unknown; value?: unknown }>
            if (typeof candidate.revision !== 'string') throw new TypeError('Seed write revision is required')
            return service.write(decodeURIComponent(match[1]), candidate.revision, candidate.value)
          })
          .then(
            (saved) => response_json(response, 200, saved),
            (error) => response_json(response, 409, { error: error instanceof Error ? error.message : String(error) })
          )
      })
    },
  }
}
