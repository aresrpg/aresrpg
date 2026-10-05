import { access, rm } from 'node:fs/promises'

import { expect, test } from 'bun:test'
import Redis from 'ioredis'

import { create_discord_api } from '../src/api.ts'
import { create_renderer } from '../src/render.ts'
import { create_forwarder } from '../src/forward.ts'
import { load_copy } from '../src/copy.ts'

import { examples } from './fixtures.ts'

const connect = async (socket: string): Promise<Redis> => {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      await access(socket)
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      await Bun.sleep(10)
    }
  }
  const redis = new Redis({ path: socket, lazyConnect: true, retryStrategy: () => null })
  redis.on('error', () => undefined) // connect rejects startup failures; prevent an unhandled emitter error.
  await redis.connect()
  return redis
}

test('live Redis pub/sub forwards received events only and creates no stored state', async () => {
  const socket = `/tmp/ares-discord-${process.pid}.sock`
  const process_handle = Bun.spawn(
    ['redis-server', '--port', '0', '--save', '', '--appendonly', 'no', '--unixsocket', socket],
    { stdout: 'ignore', stderr: 'inherit' }
  )
  const publisher = await connect(socket).catch(async (error: unknown) => {
    process_handle.kill()
    await process_handle.exited
    throw error
  })
  const subscriber = await connect(socket)
  const messages: string[] = []
  const http = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: async (request) => {
      const data = await request.formData()
      const file = data.get('files[0]') as File
      expect(file.size).toBeGreaterThan(0)
      const payload = JSON.parse(String(data.get('payload_json'))) as { content: string }
      messages.push(payload.content)
      return Response.json({ id: String(messages.length) })
    },
  })
  const transport = ((url: string, options: RequestInit) =>
    fetch(new URL(new URL(url).pathname, http.url), options)) as typeof fetch
  const api = create_discord_api('test-token', '123', transport)
  const forward = create_forwarder({
    copy: await load_copy('en'),
    scope: 'test',
    network: 'mainnet',
    resolve_name: async () => null,
    render: await create_renderer(),
    send: api.send,
  })
  const channel = `evt:notifications:0x${'a'.repeat(64)}`
  try {
    expect(await publisher.publish(channel, JSON.stringify(examples[0]))).toBe(0)
    const received = new Promise<void>((resolve, reject) => {
      let count = 0
      subscriber.on('message', (_channel, raw: string) => {
        void forward(raw)
          .then(() => {
            count++
            if (count === examples.length) resolve()
          })
          .catch(reject)
      })
    })
    await subscriber.subscribe(channel)
    for (const event of examples) expect(await publisher.publish(channel, JSON.stringify(event))).toBe(1)
    await received
    expect(messages).toHaveLength(4)
    expect(await publisher.dbsize()).toBe(0)
    await subscriber.unsubscribe(channel)
    expect(await publisher.publish(channel, JSON.stringify(examples[0]))).toBe(0)
    expect(messages).toHaveLength(4)
  } finally {
    await http.stop(true)
    subscriber.disconnect()
    publisher.disconnect()
    process_handle.kill()
    await process_handle.exited
    await rm(socket, { force: true })
  }
}, 15000)
