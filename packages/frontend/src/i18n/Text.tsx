// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useText } from './useText.ts'

export const Text = ({
  path,
  values,
}: Readonly<{ path: string; values?: Readonly<Record<string, string | number>> }>) => useText()(path, values)
