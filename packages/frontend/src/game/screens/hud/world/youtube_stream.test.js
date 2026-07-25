// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The YouTube seam, exercised with an injected fake document — never the network. What matters here is the
// LAZINESS (nothing reaches youtube.com until a hack-mode mount asks), the memoization (one script per page,
// however often the widget remounts), the honest failure (reject + a retryable state, no silent hang), and
// the player options that keep playback behind the user's own gesture.
import { beforeEach, describe, expect, test } from 'bun:test'

import {
  HACK_PLAYLIST_ID,
  YOUTUBE_IFRAME_API_SRC,
  is_playing_state,
  load_youtube_iframe_api,
  reset_youtube_api_for_test,
  stream_player_options,
  video_title,
} from './youtube_stream.js'

/** A document just real enough for the loader: createElement + head.appendChild + a src querySelector. */
function fake_doc() {
  const scripts = []
  return {
    scripts,
    querySelector: (selector) => scripts.find((script) => selector.includes(script.src)) ?? null,
    createElement: () => ({ src: '', async: false, onerror: null }),
    head: {
      appendChild: (script) => {
        scripts.push(script)
        script.remove = () => scripts.splice(scripts.indexOf(script), 1)
      },
    },
  }
}

beforeEach(() => reset_youtube_api_for_test())

describe('the YouTube IFrame API loader', () => {
  test('injects exactly one script and memoizes the load across remounts', async () => {
    const doc = fake_doc()
    const global = {}
    const first = load_youtube_iframe_api({ doc, global })

    expect(doc.scripts).toHaveLength(1)
    expect(doc.scripts[0].src).toBe(YOUTUBE_IFRAME_API_SRC)
    expect(load_youtube_iframe_api({ doc, global })).toBe(first) // a remount rides the same load
    expect(doc.scripts).toHaveLength(1)

    global.YT = { Player: function Player() {} }
    global.onYouTubeIframeAPIReady()
    expect(await first).toBe(global.YT)
  })

  test('an already-loaded API resolves without touching the document at all', async () => {
    const doc = fake_doc()
    const YT = { Player: function Player() {} }
    expect(await load_youtube_iframe_api({ doc, global: { YT } })).toBe(YT)
    expect(doc.scripts).toHaveLength(0)
  })

  test('a prior onYouTubeIframeAPIReady owner is chained, never clobbered', async () => {
    const doc = fake_doc()
    let prior_called = false
    const global = { onYouTubeIframeAPIReady: () => (prior_called = true) }
    const loading = load_youtube_iframe_api({ doc, global })

    global.YT = { Player: function Player() {} }
    global.onYouTubeIframeAPIReady()
    await loading
    expect(prior_called).toBe(true)
  })

  test('a failed load rejects AND leaves the seam retryable (no swallowed retry, no hang)', async () => {
    const doc = fake_doc()
    const global = {}
    const failing = load_youtube_iframe_api({ doc, global })
    doc.scripts[0].onerror()

    await expect(failing).rejects.toThrow('the YouTube IFrame API failed to load')
    expect(doc.scripts).toHaveLength(0) // the dead tag is gone, so the in-flight guard can't swallow a retry

    const retry = load_youtube_iframe_api({ doc, global })
    expect(retry).not.toBe(failing)
    expect(doc.scripts).toHaveLength(1)
  })
})

describe('the player contract', () => {
  test('cues the owner playlist and never autoplays (the gesture is the button)', () => {
    const { playerVars } = stream_player_options()
    expect(playerVars.list).toBe(HACK_PLAYLIST_ID)
    expect(playerVars.listType).toBe('playlist')
    expect(playerVars.autoplay).toBe(0)
    expect(playerVars.disablekb).toBe(1) // the game owns WASD, not the iframe
    expect(playerVars.origin).toBeUndefined() // omitted rather than sent empty
    expect(stream_player_options(HACK_PLAYLIST_ID, 'https://aresrpg.world').playerVars.origin).toBe(
      'https://aresrpg.world'
    )
  })

  test('buffering already reads as playing, so the button flips on the click, not on the first frame', () => {
    expect(is_playing_state(1)).toBe(true) // PLAYING
    expect(is_playing_state(3)).toBe(true) // BUFFERING
    expect(is_playing_state(2)).toBe(false) // PAUSED
    expect(is_playing_state(-1)).toBe(false) // UNSTARTED
  })

  test('the track title degrades to an empty string before the API has one', () => {
    expect(video_title({ getVideoData: () => ({ title: 'Nightcall' }) })).toBe('Nightcall')
    expect(video_title({ getVideoData: () => ({}) })).toBe('')
    expect(video_title({})).toBe('')
    expect(video_title(null)).toBe('')
  })
})
