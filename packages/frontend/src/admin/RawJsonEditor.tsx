// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useEffect, useState } from 'react'

import type { JsonValue } from './seed_editor.ts'

const apply_button =
  'mt-2 h-7 cursor-pointer border border-white/12 bg-white/[0.035] px-2 text-[8px] tracking-[0.12em] text-[#9da1ab] uppercase hover:border-[#c8963c]/50 hover:text-[#efbd45]'

export const RawJsonEditor = ({
  value,
  validate,
  on_apply,
}: Readonly<{
  value: JsonValue
  validate?: (value: JsonValue) => string | null
  on_apply: (value: JsonValue) => void
}>) => {
  const [source, set_source] = useState(() => JSON.stringify(value, null, 2))
  const [error, set_error] = useState<string | null>(null)
  useEffect(() => {
    set_source(JSON.stringify(value, null, 2))
    set_error(null)
  }, [value])
  return (
    <div>
      <textarea
        className="min-h-72 w-full resize-y border border-white/12 bg-[#08080d] p-3 font-mono text-[10px] leading-5 text-[#d7dae1] outline-none focus:border-[#4a9eff]/70"
        onChange={(event) => set_source(event.target.value)}
        spellCheck={false}
        value={source}
      />
      {error && <p className="mt-2 border-l-2 border-[#ff5a8b]/60 pl-2 text-[9px] text-[#ff8caa]">{error}</p>}
      <button
        className={apply_button}
        onClick={() => {
          try {
            const parsed = JSON.parse(source) as JsonValue
            const validation_error = validate?.(parsed) ?? null
            if (validation_error) {
              set_error(validation_error)
              return
            }
            on_apply(parsed)
            set_error(null)
            // eslint-disable-next-line no-silent-failures/no-swallowed-failure -- The parse error is rendered beside the source.
          } catch (caught) {
            set_error(caught instanceof Error ? caught.message : String(caught))
          }
        }}
        type="button"
      >
        Apply JSON
      </button>
    </div>
  )
}
