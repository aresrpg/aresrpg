// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { chat_part_text, type PlayerSpeech } from '../modules/chat.ts'

export const SpeechBubble = ({ speech }: Readonly<{ speech: PlayerSpeech | undefined }>) => {
  const message = speech?.line.values.message
  const text = message?.parts ? message.parts.map(chat_part_text).join('') : message?.text
  if (!text) return null
  return (
    <div
      aria-hidden="true"
      className="relative mb-1 max-w-[240px] min-w-[60px] rounded-xl bg-white px-3 py-2 text-center font-sans text-[11px] leading-relaxed font-medium whitespace-pre-wrap text-[#171a24] shadow-[0_3px_14px_rgba(0,0,0,0.25)] [overflow-wrap:anywhere]"
      data-speech-bubble=""
    >
      {text}
      <span className="absolute -bottom-1 left-1/2 size-2 -translate-x-1/2 rotate-45 bg-white" />
    </div>
  )
}
