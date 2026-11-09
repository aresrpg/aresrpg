// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { create_redis_store } from '../../src/store.ts'
import { lane_key_for, type Lane } from '../../src/control.ts'

import { runtime_fixture } from './runtime_fixture.ts'
import { fixture_redis } from './redis_fixture.ts'

export const start_process = async (url: string, namespace: string, actor_id: string) => {
  let sequence = 0
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  const wait = (id: number) =>
    new Promise<unknown>((resolve, reject) => {
      pending.set(id, { resolve, reject })
    })
  const started = wait(0)
  const shutdown = wait(-1)
  // Startup can fail before a caller has received the fixture handle.
  void shutdown.catch(() => undefined)
  const child = Bun.spawn(
    [
      process.execPath,
      '--no-env-file',
      new URL('./router_process.ts', import.meta.url).pathname,
      url,
      namespace,
      actor_id,
    ],
    {
      env: { PATH: process.env.PATH ?? '' },
      stdout: 'inherit',
      stderr: 'inherit',
      ipc: (message: { id: number; ok: boolean; value?: unknown; error?: string }) => {
        const waiting = pending.get(message.id)
        if (!waiting) return
        pending.delete(message.id)
        if (message.ok) waiting.resolve(message.value)
        else waiting.reject(new Error(message.error))
      },
    }
  )
  void child.exited.then(() => {
    for (const waiting of pending.values()) waiting.reject(new Error('fixture_process_exited'))
    pending.clear()
  })
  try {
    await deadline(started)
  } catch (error) {
    child.kill('SIGKILL')
    await child.exited
    throw error
  }
  return {
    pid: child.pid,
    exited: child.exited,
    exit_code: () => child.exitCode,
    shutdown,
    signal: () => child.kill('SIGTERM'),
    terminate: async () => {
      if (child.exitCode !== null || child.signalCode !== null) return
      child.kill('SIGTERM')
      try {
        const code = await deadline(child.exited)
        if (code !== 0) throw new Error(`fixture_shutdown_exit:${code}`)
      } catch (error) {
        child.kill('SIGKILL')
        await child.exited
        throw error
      }
    },
    call: async <T = unknown>(command: string, payload: Record<string, unknown> = {}): Promise<T> => {
      const id = ++sequence
      const result = wait(id)
      child.send({ id, command, payload })
      return result as Promise<T>
    },
    kill: async () => {
      child.kill('SIGKILL')
      await child.exited
    },
  }
}
export const process_pair = async (url: string, spawn_process = start_process) => {
  const redis = fixture_redis(url)
  const namespace = `bot:fixture:process:${crypto.randomUUID()}`
  const store = create_redis_store(redis, namespace)
  const children: Awaited<ReturnType<typeof start_process>>[] = []
  const close = async () => {
    const results = await Promise.allSettled(children.map((child) => child.terminate()))
    try {
      if (redis.connected) {
        const keys = (await redis.send('KEYS', [`${namespace}*`])) as string[]
        if (keys.length) await redis.send('DEL', keys)
      }
    } finally {
      redis.close()
    }
    const failed = results.find((result) => result.status === 'rejected')
    if (failed?.status === 'rejected') throw failed.reason
  }
  try {
    await redis.connect()
    const f = await runtime_fixture(store)
    await f.runtime.stop()
    const first = await spawn_process(url, namespace, `${namespace}:a`)
    children.push(first)
    const second = await spawn_process(url, namespace, `${namespace}:b`)
    children.push(second)
    console.log(
      `PROCESS_PROOF parent=${process.pid} first=${first.pid} second=${second.pid} bun=${Bun.version} executable=${process.execPath} namespace=${namespace}`
    )
    return { ...f, redis, first, second, store, lane: () => store.read<Lane>(lane_key_for(f.bot)), close }
  } catch (error) {
    try {
      await close()
    } catch (cleanup_error) {
      throw new AggregateError([error, cleanup_error], 'fixture_setup_failed', { cause: cleanup_error })
    }
    throw error
  }
}
const deadline = async <T>(operation: Promise<T>): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('fixture_process_timeout')), 3000)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

export const until = async (predicate: () => Promise<boolean>) => {
  const deadline = Date.now() + 3000
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error('fixture_condition_timeout')
    await Bun.sleep(10)
  }
}
