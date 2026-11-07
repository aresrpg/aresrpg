// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { constants } from 'node:fs'
import { lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { randomUUID as random_uuid } from 'node:crypto'
import type { Stats } from 'node:fs'

const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT'

const private_owner = (stat: Stats) => {
  if (typeof process.getuid !== 'function' || stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0)
    throw new Error('PRIVATE_STORAGE_REQUIRED')
}

/** POSIX permissions are not a vault: code running as this OS user can read these files. */
export const check_agent_directory = async (directory: string) => {
  if (!isAbsolute(directory) || resolve(directory) !== directory) throw new Error('ABSOLUTE_STATE_DIRECTORY_REQUIRED')
  const stat = await lstat(directory)
  private_owner(stat)
  if (!stat.isDirectory() || (await realpath(directory)) !== directory) throw new Error('UNSAFE_STATE_DIRECTORY')
  return directory
}

export const create_agent_directory = async (directory: string) => {
  if (!isAbsolute(directory) || resolve(directory) !== directory) throw new Error('ABSOLUTE_STATE_DIRECTORY_REQUIRED')
  try {
    await mkdir(directory, { mode: 0o700 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'EEXIST') throw error
  }
  return check_agent_directory(directory)
}

const check_file = (stat: Stats) => {
  private_owner(stat)
  if (!stat.isFile() || stat.nlink !== 1) throw new Error('UNSAFE_STATE_FILE')
}

export const read_agent_file = async (directory: string, name: string): Promise<unknown | null> => {
  await check_agent_directory(directory)
  let file
  try {
    file = await open(join(directory, name), constants.O_RDONLY | constants.O_NOFOLLOW)
  } catch (error) {
    if (missing(error)) return null
    throw error
  }
  try {
    check_file(await file.stat())
    const text = await file.readFile('utf8')
    try {
      return JSON.parse(text) as unknown
    } catch {
      // Do not include JSON parser previews: this may be a private-key file.
      throw new Error('INVALID_STATE_FILE')
    }
  } finally {
    await file.close()
  }
}

const sync_directory = async (directory: string) => {
  const file = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY)
  try {
    await file.sync()
  } finally {
    await file.close()
  }
}

export const create_agent_file = async (directory: string, name: string, value: unknown) => {
  await check_agent_directory(directory)
  const file = await open(
    join(directory, name),
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600
  )
  try {
    await file.writeFile(JSON.stringify(value))
    await file.sync()
  } finally {
    await file.close()
  }
  await sync_directory(directory)
}

export const replace_agent_file = async (directory: string, name: string, value: unknown) => {
  // Validate any existing target before replacing it; the private directory excludes other OS users.
  await read_agent_file(directory, name)
  const temporary = `.${name}.${random_uuid()}`
  await create_agent_file(directory, temporary, value)
  await rename(join(directory, temporary), join(directory, name))
  await sync_directory(directory)
}

export const with_agent_lock = async <T>(directory: string, action: () => Promise<T>): Promise<T> => {
  await create_agent_file(directory, 'operation.lock', { pid: process.pid })
  try {
    return await action()
  } finally {
    await unlink(join(directory, 'operation.lock'))
    await sync_directory(directory)
  }
}
