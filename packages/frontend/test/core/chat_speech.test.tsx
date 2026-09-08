// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { create_app } from '../../src/store.ts'
import { SPEECH_DURATION_MS, type ChatLine } from '../../src/modules/chat.ts'
import { SpeechBubble } from '../../src/components/SpeechBubble.tsx'

const line = (id: string, character_id = '0xa'): ChatLine => ({
  id,
  channel: 'general',
  key: 'chat_line',
  values: { name: { text: 'Aiko', character_id }, message: { text: id } },
})

test('general speech lasts six seconds and old expiry cannot remove a replacement', () => {
  const app = create_app()
  app.dispatch({ type: 'chat/line', line: line('first'), at_ms: 1_000 })
  expect(app.store.getState().chat.speech['0xa']?.expires_at).toBe(7_000)
  app.dispatch({ type: 'chat/speech_expired', now_ms: 6_999 })
  expect(app.store.getState().chat.speech['0xa']?.line.id).toBe('first')
  app.dispatch({ type: 'chat/line', line: line('second'), at_ms: 6_500 })
  app.dispatch({ type: 'chat/speech_expired', now_ms: 7_000 })
  expect(app.store.getState().chat.speech['0xa']?.line.id).toBe('second')
  app.dispatch({ type: 'chat/speech_expired', now_ms: 12_500 })
  expect(app.store.getState().chat.speech).toEqual({})
})

test('party, whisper, and general system lines do not create or replace speech', () => {
  const app = create_app()
  app.dispatch({ type: 'chat/line', line: line('hello'), at_ms: 0 })
  const { speech } = app.store.getState().chat
  for (const other of [
    { ...line('party'), channel: 'party', party: '0xp' },
    { ...line('private'), channel: 'whisper' },
    { ...line('system'), values: { message: { text: 'system' } } },
  ] as ChatLine[])
    app.dispatch({ type: 'chat/line', line: other, at_ms: 1_000 })
  expect(app.store.getState().chat.speech).toBe(speech)
})

test('active speech survives chat scrolling and corrections retain the original deadline', () => {
  const app = create_app()
  app.dispatch({ type: 'chat/line', line: line('original'), at_ms: 0 })
  expect(app.store.getState().chat.speech['0xa']?.line).toBe(app.store.getState().chat.lines[0])
  app.dispatch({ type: 'chat/line', line: line('corrected'), replaces: 'original', at_ms: 1_000 })
  expect(app.store.getState().chat.speech['0xa']?.line).toBe(app.store.getState().chat.lines[0])
  expect(app.store.getState().chat.speech['0xa']).toMatchObject({
    expires_at: 6_000,
    line: { values: { message: { text: 'corrected' } } },
  })
  for (let index = 0; index < 101; index++) app.dispatch({ type: 'chat/line', line: line(`other-${index}`, '0xb') })
  expect(app.store.getState().chat.lines).toHaveLength(100)
  expect(app.store.getState().chat.speech['0xa']?.line.id).toBe('original')
})

test('incoming world chat uses the same speech state and expired speech is cleaned when observers rearm', async () => {
  const app = create_app()
  let stop = app.observe(['chat'])
  app.dispatch({
    type: 'server/packet',
    packet: {
      type: 'packet/chat_message',
      channel: 'world',
      scope: null,
      from: '0xowner',
      character_id: '0xa',
      character: 'Aiko',
      parts: [{ kind: 'text', text: 'hello' }],
    },
  })
  expect(app.store.getState().chat.speech['0xa']?.line.values.message?.parts).toEqual([{ kind: 'text', text: 'hello' }])
  stop()
  app.dispatch({ type: 'chat/line', line: line('expired'), at_ms: Date.now() - SPEECH_DURATION_MS })
  stop = app.observe(['chat'])
  try {
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(app.store.getState().chat.speech).toEqual({})
  } finally {
    stop()
  }
})

test('bubbles render structured chat as escaped plain text', () => {
  const speech_line = {
    ...line('safe'),
    values: {
      message: {
        text: '',
        parts: [
          { kind: 'text' as const, text: '<script> ' },
          { kind: 'item' as const, id: '0xi', name: 'Hat' },
          { kind: 'position' as const, world: 'nauvis', x: 50_000, z: 50_000 },
        ],
      },
    },
  }
  const html = renderToStaticMarkup(<SpeechBubble speech={{ line: speech_line, expires_at: 6_000 }} />)
  expect(html).toContain('&lt;script&gt; [Hat][nauvis · 0, 0]')
  expect(html).not.toContain('<script>')
  expect(renderToStaticMarkup(<SpeechBubble speech={undefined} />)).toBe('')
})
