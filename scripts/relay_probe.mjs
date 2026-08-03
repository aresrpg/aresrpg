#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

if (typeof WebSocket !== 'function') {
  process.once('uncaughtException', (error) => {
    console.error(error.message)
    process.exitCode = 1
  })
  throw new Error('FAIL: runtime lacks global WebSocket (Node >=21 required)')
}

export const DEFAULT_RELAY_URL = 'wss://relay.aresrpg.world/mqtt'
export const PROBE_TIMEOUT_MS = 10_000

const MQTT_DISCONNECT = Uint8Array.of(0xe0, 0x00)
const PROBE_CLIENT_ID = 'aresrpg-relay-probe'

const hex_byte = (byte) => `0x${byte.toString(16).padStart(2, '0')}`

const utf8_field = (value) => {
  const bytes = new TextEncoder().encode(value)
  if (bytes.length > 0xffff) throw new Error('FAIL: MQTT UTF-8 field exceeds 65535 bytes')
  return Uint8Array.of(bytes.length >> 8, bytes.length & 0xff, ...bytes)
}

const remaining_length = (length) => {
  const bytes = []
  let remaining = length
  // MQTT-3.1.1 §2.2.3: Remaining Length is a base-128 continuation encoding.
  do {
    let encoded_byte = remaining % 128
    remaining = Math.floor(remaining / 128)
    if (remaining > 0) encoded_byte |= 0x80
    bytes.push(encoded_byte)
  } while (remaining > 0)
  return bytes
}

export const build_connect_packet = (client_id = PROBE_CLIENT_ID) => {
  // MQTT-3.1.1 §3.1.2: variable header = protocol name, level, flags, then keepalive.
  const variable_header = Uint8Array.of(
    ...utf8_field('MQTT'), // §3.1.2.1: the protocol name is the UTF-8 string "MQTT".
    0x04, // §3.1.2.2: protocol level 4 identifies MQTT 3.1.1.
    0x02, // §3.1.2.3: Clean Session is bit 1; all other CONNECT flags are clear.
    0x00,
    0x1e // §3.1.2.10: a 30-second keepalive, encoded MSB then LSB.
  )
  // MQTT-3.1.1 §3.1.3.1: Client Identifier is the first CONNECT payload field.
  const payload = utf8_field(client_id)
  const body_length = variable_header.length + payload.length
  // MQTT-3.1.1 §2.2 + §3.1.1: CONNECT has control type 1 and reserved flags 0000.
  return Uint8Array.of(0x10, ...remaining_length(body_length), ...variable_header, ...payload)
}

const packet_bytes = (packet) => {
  if (packet instanceof Uint8Array) return packet
  if (packet instanceof ArrayBuffer) return new Uint8Array(packet)
  if (ArrayBuffer.isView(packet)) return new Uint8Array(packet.buffer, packet.byteOffset, packet.byteLength)
  throw new Error('FAIL: relay returned a non-binary WebSocket message')
}

export const parse_connack = (packet) => {
  const bytes = packet_bytes(packet)
  if (bytes.length < 4) throw new Error('FAIL: malformed CONNACK (packet shorter than 4 bytes)')
  // MQTT-3.1.1 §3.2.1: CONNACK is type 2 with all four fixed-header flags clear.
  if (bytes[0] !== 0x20) throw new Error(`FAIL: first MQTT packet is not CONNACK (fixed header ${hex_byte(bytes[0])})`)
  // MQTT-3.1.1 §3.2.1: the CONNACK Remaining Length is exactly two bytes.
  if (bytes[1] !== 0x02)
    throw new Error(`FAIL: malformed CONNACK (remaining length ${hex_byte(bytes[1])}, expected 0x02)`)
  // MQTT-3.1.1 §3.2.2: reserved acknowledgement flag bits must be zero.
  if ((bytes[2] & 0xfe) !== 0) throw new Error(`FAIL: malformed CONNACK (acknowledge flags ${hex_byte(bytes[2])})`)
  // Clean Session was 1, so §3.2.2 requires Session Present to be zero on success.
  if ((bytes[2] & 0x01) !== 0) throw new Error('FAIL: malformed CONNACK (Session Present set for clean session)')
  // MQTT-3.1.1 §3.2.2.3: only return code 0x00 proves the relay accepted CONNECT.
  if (bytes[3] !== 0x00)
    throw new Error(`FAIL: relay rejected MQTT CONNECT (CONNACK return code ${hex_byte(bytes[3])})`)
  return { return_code: 0, session_present: false }
}

const message_bytes = async (data) => {
  if (typeof Blob === 'function' && data instanceof Blob) return new Uint8Array(await data.arrayBuffer())
  return packet_bytes(data)
}

const error_detail = (error) => {
  if (!(error instanceof Error) || !error.message) return ''
  return error.message.replace(/\s+/g, ' ').trim()
}

export const probe_relay = (relay_url, timeout_ms = PROBE_TIMEOUT_MS) =>
  new Promise((resolve, reject) => {
    let socket
    let settled = false

    const close_socket = () => {
      if (socket === undefined || socket.readyState >= WebSocket.CLOSING) return
      try {
        socket.close()
      } catch {
        // The primary thrown reason is already settled; close is best-effort cleanup only.
      }
    }
    const fail = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      close_socket()
      reject(error)
    }
    const pass = () => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve()
    }

    const timeout = setTimeout(
      () => fail(new Error(`FAIL: relay timed out waiting for CONNACK after ${timeout_ms}ms`)),
      timeout_ms
    )
    try {
      socket = new WebSocket(relay_url, 'mqtt')
    } catch (error) {
      const detail = error_detail(error)
      fail(new Error(`FAIL: could not open relay WebSocket${detail ? ` (${detail})` : ''}`))
      return
    }
    socket.binaryType = 'arraybuffer'

    socket.addEventListener(
      'open',
      () => {
        try {
          if (socket.protocol !== 'mqtt')
            throw new Error(`FAIL: relay negotiated wrong WebSocket subprotocol (${socket.protocol || 'none'})`)
          socket.send(build_connect_packet())
        } catch (error) {
          fail(error)
        }
      },
      { once: true }
    )
    socket.addEventListener(
      'message',
      async (event) => {
        try {
          parse_connack(await message_bytes(event.data))
          // MQTT-3.1.1 §3.14: a clean client shutdown sends DISCONNECT before WebSocket close.
          socket.send(MQTT_DISCONNECT)
          socket.close(1000, 'relay probe complete')
          pass()
        } catch (error) {
          fail(error)
        }
      },
      { once: true }
    )
    socket.addEventListener('error', (event) => {
      const detail = error_detail(event.error)
      fail(new Error(`FAIL: relay WebSocket/TLS/socket error${detail ? ` (${detail})` : ''}`))
    })
    socket.addEventListener('close', (event) => {
      if (!settled)
        fail(
          new Error(
            `FAIL: relay WebSocket closed before CONNACK (code ${event.code}, reason ${event.reason || 'none'})`
          )
        )
    })
  })

const is_main = process.argv[1] === new URL(import.meta.url).pathname

if (is_main) {
  const relay_url = process.argv[2] || process.env.RELAY_PROBE_URL || DEFAULT_RELAY_URL
  probe_relay(relay_url)
    .then(() => console.log(`PASS: relay accepted MQTT CONNECT at ${relay_url} (CONNACK return code 0x00)`))
    .catch((error) => {
      console.error(error_detail(error) || 'FAIL: relay probe failed without an Error reason')
      process.exitCode = 1
    })
}
