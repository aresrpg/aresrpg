// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// PRE-FLIGHT "MUST SAY WHY" — a decoded refusal reason now rides as a second \n-separated
// line (abort_copy.js humanize_tx_error's `errors.tx_refusal_reason` template) into EVERY toast surface that
// shows a humanized tx error, including the in-game event-toast stack (GameWorldHud.jsx's local Toasts(),
// fed by world_spawns.js's `push_event_toast({ title: use_party.getState().error })` on a failed group-fight
// engage). Its `<span>{t.title}</span>` had no `white-space` rule, so a browser's default `normal` mode
// collapses an embedded newline to a single space — the reason text survives, but the intended visual line
// break silently vanishes. `white-space` is inherited, so a single declaration on the `.gw-toast` row (rather
// than a new class on the unclassed inner span) fixes every consumer at once.
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'bun:test'

const read_fixture = (relative_path) => readFileSync(new URL(relative_path, import.meta.url), 'utf8')

describe('game-world-hud.css · .gw-toast renders an embedded \\n reason line as an actual break', () => {
  test('.gw-toast sets white-space: pre-wrap (inherited onto the title/message span below it)', () => {
    const css = read_fixture('./game-world-hud.css')
    const toast_rule = css.match(/(?:^|\n)\.gw-toast\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(toast_rule).toMatch(/white-space:\s*pre-wrap/)
  })
})
