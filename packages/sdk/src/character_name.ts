// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The one client twin of character.move's normalized derived-name byte law.

export const CHARACTER_NAME_MIN_LENGTH = 4
export const CHARACTER_NAME_MAX_LENGTH = 19

export const is_valid_character_name = (value: string): boolean => {
  const name = value.trim()
  return (
    name.length >= CHARACTER_NAME_MIN_LENGTH &&
    name.length <= CHARACTER_NAME_MAX_LENGTH &&
    !/\s|[^\x21-\x7e]/.test(name)
  )
}

export const normalize_character_name = (value: string): string => {
  if (!is_valid_character_name(value)) throw new Error('Character names must be 4–19 non-whitespace ASCII characters.')
  return value.trim().toLowerCase()
}
