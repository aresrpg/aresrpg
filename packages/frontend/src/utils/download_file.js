// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// "Hand the player a file" — the Blob/object-URL/anchor dance, once. Both trace exporters (the game's
// fight_trace_export.js and the simulator's trace_export.js) shipped a verbatim copy of these nine lines; a
// leaked object URL or a missing `anchor.remove()` fixed in one would have silently stayed broken in the
// other. Effect edge by definition — the payload composition stays pure in each caller.

/**
 * Download `text` as a file named `filename`. Revokes the object URL and removes the anchor in every case, so
 * repeated exports never leak either.
 * @param {string} filename @param {string} text @param {string} [type] the blob MIME type
 * @returns {void}
 */
export function download_text_file(filename, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  try {
    anchor.click()
  } finally {
    anchor.remove()
    URL.revokeObjectURL(url)
  }
}
