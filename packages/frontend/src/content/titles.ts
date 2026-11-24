// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Content ids as words: no table, so any page can name a type without loading the catalogue.

/** The display words of a content id that has no authored name. */
export const titleize = (value: string): string =>
  value
    .replace(/^\d+_/, '')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())

/** The id form of a display name. */
export const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
