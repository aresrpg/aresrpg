// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// HACK MODE'S RADIO — the YouTube IFrame Player API seam, kept out of the component so the widget stays
// markup and this file stays the ONE place that knows anything about YouTube.
//
// WHY A SCRIPT TAG AND NOT A DEPENDENCY: the IFrame API is a runtime script served by YouTube itself
// (`https://www.youtube.com/iframe_api`), the only supported way to read the playing track's title
// (`getVideoData().title`) and to drive play/pause from our own chrome. No npm package, no API key
// (playlist embeds need none). It is injected LAZILY, on the first hack-mode mount — a player who never
// arms hack mode never fetches a byte from youtube.com, and no external host is baked into the eager
// bundle. The promise is memoized so a remount reuses the already-loaded API.
//
// TOS: the player must stay VISIBLE. The widget renders a real, un-hidden 16:9 video region — our chrome
// replaces the CONTROLS (controls: 0), never the player itself; `autoplay: 0` keeps playback behind the
// user gesture the button provides (which is also what every browser's autoplay policy demands).

/** The owner's playlist — the one the hack grid streams instead of our own beds. */
export const HACK_PLAYLIST_ID = 'PLtK9N7tAZdclf4wJcLj7GU6zS7yMopx1w'

/** YouTube's own loader script; it defines `window.YT` and then calls `onYouTubeIframeAPIReady`. */
export const YOUTUBE_IFRAME_API_SRC = 'https://www.youtube.com/iframe_api'

/** YT.PlayerState values we care about (the API constant object is only available post-load). */
const PLAYING = 1
const BUFFERING = 3

/**
 * Is this `onStateChange` code a "sounding" state? BUFFERING counts: pressing play must flip the button to
 * PAUSE immediately, not after the first buffered frame. Pure.
 * @param {number} state the YT.PlayerState code @returns {boolean}
 */
export const is_playing_state = (state) => state === PLAYING || state === BUFFERING

/**
 * The currently loaded track's title, or '' when the API has not resolved one yet. Every accessor is
 * optional-chained: `getVideoData` is undefined until the player is ready, and a playlist transition
 * briefly reports an empty title.
 * @param {any} player a YT.Player instance @returns {string}
 */
export const video_title = (player) => player?.getVideoData?.()?.title ?? ''

/**
 * The YT.Player construction options for the house playlist. Pure — the widget passes the host element.
 * @param {string} [playlist_id] @param {string} [origin] `location.origin`, YouTube's recommended embed pin
 * @returns {object} the options object handed to `new YT.Player(el, options)`
 */
export function stream_player_options(playlist_id = HACK_PLAYLIST_ID, origin = '') {
  return {
    width: '100%',
    height: '100%',
    playerVars: {
      listType: 'playlist',
      list: playlist_id,
      autoplay: 0, // playback starts from OUR button — the user gesture browsers (and the ToS) require
      controls: 0, // our chrome is the control surface; the video region itself stays visible
      disablekb: 1, // the game owns the keyboard — never let the iframe eat WASD
      modestbranding: 1,
      rel: 0,
      playsinline: 1,
      ...(origin ? { origin } : {}),
    },
  }
}

/** @type {Promise<any> | null} the memoized API load — one fetch per page, however often the widget mounts */
let api_promise = null

/**
 * Load (once) YouTube's IFrame API and resolve the `YT` namespace. Injects the script on first call;
 * a second call while the first is in flight rides the same promise. A load failure clears the memo so a
 * later remount can retry, and REJECTS — the widget surfaces it instead of spinning forever (no silent
 * failures).
 * @param {{ doc?: Document, global?: any }} [deps] injectable so the loader is testable with no network
 * @returns {Promise<any>} the `YT` namespace object
 */
export function load_youtube_iframe_api({ doc = globalThis.document, global = globalThis } = {}) {
  if (api_promise) return api_promise
  api_promise = new Promise((resolve, reject) => {
    if (global.YT?.Player) {
      resolve(global.YT)
      return
    }
    // The API calls this ONE global when it finishes booting — chain any prior owner rather than clobber it.
    const prior = global.onYouTubeIframeAPIReady
    global.onYouTubeIframeAPIReady = () => {
      prior?.()
      resolve(global.YT)
    }
    if (doc.querySelector(`script[src="${YOUTUBE_IFRAME_API_SRC}"]`)) return // already in flight
    const script = doc.createElement('script')
    script.src = YOUTUBE_IFRAME_API_SRC
    script.async = true
    script.onerror = () => {
      // Drop BOTH the memo and the dead tag: leaving the failed <script> in head would make the
      // already-in-flight guard above swallow every retry, and the next mount would hang forever.
      api_promise = null
      script.remove?.()
      reject(new Error('the YouTube IFrame API failed to load'))
    }
    doc.head.appendChild(script)
  })
  return api_promise
}

/**
 * TEST-ONLY: drop the memoized API promise so a suite can exercise the injection path again (bun keeps this
 * module for the whole run). Never called by shipped code.
 * @returns {void}
 */
export function reset_youtube_api_for_test() {
  api_promise = null
}
