// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { AppCopy } from '../i18n/copy.ts'

export type EncyclopediaText = (key: string, values?: Readonly<Record<string, string | number>>) => string

export const encyclopedia_text =
  (copy: AppCopy): EncyclopediaText =>
  (key, values = {}) => {
    const value = key
      .split('.')
      .reduce<unknown>(
        (node, part) =>
          typeof node === 'object' && node !== null ? (node as Readonly<Record<string, unknown>>)[part] : null,
        copy.encyclopedia_page
      )
    if (typeof value !== 'string') return key
    return Object.entries(values).reduce(
      (rendered, [name, replacement]) => rendered.replaceAll(`{{${name}}}`, String(replacement)),
      value
    )
  }
