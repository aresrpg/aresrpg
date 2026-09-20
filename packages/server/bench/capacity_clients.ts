// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { monitorEventLoopDelay } from 'node:perf_hooks'

import { character_checkpoint, POSITION_INTERVAL_MS, type CharacterRow, type ServerPacket } from '@aresrpg/protocol'

const [raw_port, raw_start, raw_count, raw_duration, raw_stagger, chat_mode = 'spread'] = process.argv.slice(2)
const port = Number(raw_port),
  start = Number(raw_start),
  count = Number(raw_count)
const duration = Number(raw_duration),
  stagger = Number(raw_stagger)
const sockets: WebSocket[] = []
const rosters = new Map<WebSocket, CharacterRow[]>()
const metrics = {
  ready: 0,
  frames: 0,
  samples: 0,
  appearances: 0,
  sent: 0,
  errors: [] as string[],
  pings: [] as number[],
}
const pending = new Map<number, number>()
let running = true
const connected_at = performance.now()
for (let index = 0; index < count; index++) {
  const address = `0x${(start + index + 1).toString(16).padStart(64, '0')}`
  const socket = new WebSocket(`ws://127.0.0.1:${port}/?address=${address}`)
  sockets.push(socket)
  socket.onmessage = ({ data }) => {
    metrics.frames++
    const packet = JSON.parse(String(data)) as ServerPacket
    if (packet.type === 'packet/characters') {
      if (!rosters.has(socket)) metrics.ready++
      rosters.set(socket, packet.characters)
    }
    if (packet.type === 'packet/players_moved') metrics.samples += packet.positions.length
    if (packet.type === 'packet/player_appeared') metrics.appearances++
    if (packet.type === 'packet/error') metrics.errors.push(packet.reason)
    if (packet.type === 'packet/pong' && pending.has(packet.id)) {
      metrics.pings.push(performance.now() - pending.get(packet.id)!)
      pending.delete(packet.id)
    }
  }
  socket.onclose = ({ code, reason }) => {
    if (running) metrics.errors.push(`${code}:${reason}`)
  }
  socket.onerror = () => metrics.errors.push('socket error')
  if (stagger) await Bun.sleep(stagger)
}
while (metrics.ready < count && performance.now() - connected_at < 60_000) await Bun.sleep(50)
const ready_ms = performance.now() - connected_at
const started = performance.now()
const cpu = process.cpuUsage()
const loop = monitorEventLoopDelay({ resolution: 10 })
loop.enable()
let tick = 0
const send = (socket: WebSocket, packet: unknown) => {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(packet))
    metrics.sent++
  }
}
while (performance.now() - started < duration) {
  const at = performance.now()
  tick++
  rosters.forEach((characters, socket) => {
    characters.forEach((character) =>
      send(socket, {
        type: 'packet/position',
        character_id: character.id,
        checkpoint: character_checkpoint(character),
        x: character.x! + Math.sin(tick / 40) * 3,
        y: Math.max(0, Math.sin(tick / 10)),
        z: character.z!,
        riding: false,
      })
    )
    if (tick % 20 === 0) {
      const id = tick * count + sockets.indexOf(socket)
      pending.set(id, performance.now())
      send(socket, { type: 'packet/ping', id })
    }
    if (
      chat_mode !== 'off' &&
      (tick + (chat_mode === 'burst' ? 0 : sockets.indexOf(socket))) % 100 === 0 &&
      characters[0]
    )
      send(socket, {
        type: 'packet/chat',
        character_id: characters[0].id,
        parts: [{ kind: 'text', text: 'Local crowd workload' }],
      })
  })
  await Bun.sleep(Math.max(0, POSITION_INTERVAL_MS - (performance.now() - at)))
}
running = false
const pings = [...metrics.pings].sort((a, b) => a - b)
console.log(
  JSON.stringify({
    ...metrics,
    pings: undefined,
    ping_count: pings.length,
    ping_p95_ms: pings[Math.floor(pings.length * 0.95)],
    ready_ms,
    cpu: process.cpuUsage(cpu),
    loop_p95_ms: loop.percentile(95) / 1e6,
    elapsed_ms: performance.now() - started,
    ticks: tick,
  })
)
sockets.forEach((socket) => socket.close())
