// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readable_transaction_error } from '../transaction_guard.ts'

const VERSION_RACE = /provided version doesn't match|object version[^\n]*mismatch/i

export const fight_result_error_text = (copy: Readonly<Record<string, string>>, error: string): string => {
  const readable = readable_transaction_error(error)
  return VERSION_RACE.test(readable) || /transaction needs to be rebuilt.*current version:/i.test(readable)
    ? (copy.result_version_changed ?? readable)
    : readable
}
