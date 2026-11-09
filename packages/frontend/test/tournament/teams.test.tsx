// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { TournamentTeams } from '../../src/tournament/TournamentTeams.tsx'
import { initial_app_state } from '../../src/store.ts'
import { select_tournament_view } from '../../src/modules/tournament_selectors.ts'
import { copy_text, load_app_copy } from '../../src/i18n/copy.ts'
import { tournament_fixture } from '../helpers/tournament.ts'

for (const format of [1, 3] as const) {
  test(`an over-level viewer sees no repeated eligibility errors on ${format}-seat teams`, async () => {
    const fixture = tournament_fixture()
    const row = {
      ...fixture,
      status: 'open' as const,
      max_level: 20,
      format,
      teams: fixture.teams.map((team) => ({ ...team, seats: team.seats.slice(0, 1) })),
    }
    const base = initial_app_state({ quality: 'medium', music_enabled: false, render_distance: null })
    const tournament = { ...base.tournament, rows: [row], feed_status: 'loaded' as const }
    const wallet = { address: 'visitor' } as never
    const characters = [{ id: 'visitor', name: 'Visitor', level: 21, custody: 'kiosk' }] as never
    const state = {
      ...base,
      tournament,
      session: { ...base.session, wallet, characters, selected_character_id: 'visitor' },
      chain_clock: { chain_ms: 2000, observed_at: 0 },
    }
    const view = { ...select_tournament_view(state, null, 0), tournament, wallet, characters }
    const copy = await load_app_copy('en')
    const html = renderToStaticMarkup(
      <TournamentTeams row={row} view={view} create={() => undefined} t={copy_text(copy.tournament_page)} />
    )
    expect(html).not.toContain('The maximum level for this tournament is')
    expect(html).not.toContain('tourney-access')
    expect(html).not.toContain('Take seat')
    expect(view.team_creation_blocker).toBe('level')
  })
}

for (const selected of ['a', 'spare']) {
  test(`registration is not presented as a problem on opposing teams when selecting ${selected}`, async () => {
    const row = { ...tournament_fixture(), status: 'open' as const }
    const base = initial_app_state({ quality: 'medium', music_enabled: false, render_distance: null })
    const tournament = { ...base.tournament, rows: [row], feed_status: 'loaded' as const }
    const wallet = { address: 'owner' } as never
    const characters = ['a', 'spare'].map((id) => ({ id, name: id, custody: 'kiosk' })) as never
    const state = {
      ...base,
      tournament,
      session: { ...base.session, wallet, characters, selected_character_id: selected },
      chain_clock: { chain_ms: 2000, observed_at: 0 },
    }
    const view = { ...select_tournament_view(state, null, 0), tournament, wallet, characters }
    const copy = await load_app_copy('en')
    const html = renderToStaticMarkup(
      <TournamentTeams row={row} view={view} create={() => undefined} t={copy_text(copy.tournament_page)} />
    )
    expect(html).not.toContain('Already registered with another team')
    expect(html).toContain('tourney-seat is-own')
    expect(html).toContain('tourney-leave')
    // Other teams remain unavailable; hiding the warning grants no access.
    const opposing = html.split('<article').at(-1)!
    const buttons = [...opposing.matchAll(/<button\b[^>]*>/g)].map(([button]) => button)
    expect(buttons).toHaveLength(2)
    expect(buttons.every((button) => button.includes('disabled=""'))).toBe(true)
    expect(opposing).not.toContain('Take seat')
  })
}
