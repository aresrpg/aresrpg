// i18n PARITY GUARD — party.invite_awaiting_toast / cancel_invite_cta / invite_cancel_notice: the pending-invite
// toast stays visible until the invitee accepts or declines, with a cancel affordance. The 6-locale law (CLAUDE.md): every
// user-facing string lands in ALL locales; a missing/empty locale would print the raw key on the pending-invite
// toast. This pins presence + non-emptiness across all six, mechanically. Every key was RED before the feature landed.
import { describe, expect, test } from 'bun:test'

const LOCALES = ['en', 'fr', 'de', 'es', 'ja', 'uk']
const KEYS = ['invite_awaiting_toast', 'cancel_invite_cta', 'invite_cancel_notice']

describe('i18n · party.* pending-invite toast keys present + non-empty in ALL 6 locales', () => {
  for (const key of KEYS) {
    test.each(LOCALES)(`%s.json carries a non-empty party.${key}`, async (lang) => {
      const json = await Bun.file(new URL(`./${lang}.json`, import.meta.url)).json()
      const value = json?.party?.[key]
      expect(typeof value).toBe('string')
      expect(value.trim().length).toBeGreaterThan(0)
    })
  }

  test.each(LOCALES)('%s.json keeps the {{name}} interpolation slot in invite_awaiting_toast', async (lang) => {
    const json = await Bun.file(new URL(`./${lang}.json`, import.meta.url)).json()
    expect(json?.party?.invite_awaiting_toast).toContain('{{name}}')
  })
})
