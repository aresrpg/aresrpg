// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { build_connect_packet, parse_connack } from '../../scripts/relay_probe.mjs'

describe('relay probe MQTT 3.1.1 packets', () => {
  test('builds the exact CONNECT packet', () => {
    expect(Buffer.from(build_connect_packet()).toString('hex')).toBe(
      '101f00044d5154540402001e0013617265737270672d72656c61792d70726f6265'
    )
  })

  test('accepts a successful CONNACK', () => {
    expect(parse_connack(Uint8Array.from([0x20, 0x02, 0x00, 0x00]))).toEqual({
      return_code: 0,
      session_present: false,
    })
  })

  test('rejects a non-CONNACK first packet', () => {
    expect(() => parse_connack(Uint8Array.from([0x30, 0x02, 0x00, 0x00]))).toThrow(
      'FAIL: first MQTT packet is not CONNACK (fixed header 0x30)'
    )
  })

  test('rejects a non-zero CONNACK return code', () => {
    expect(() => parse_connack(Uint8Array.from([0x20, 0x02, 0x00, 0x05]))).toThrow(
      'FAIL: relay rejected MQTT CONNECT (CONNACK return code 0x05)'
    )
  })

  test('rejects a short CONNACK frame', () => {
    expect(() => parse_connack(Uint8Array.from([0x20, 0x02, 0x00]))).toThrow(
      'FAIL: malformed CONNACK (packet shorter than 4 bytes)'
    )
  })
})
