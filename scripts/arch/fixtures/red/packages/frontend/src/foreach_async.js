// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED fixture — L-D1/L-D2: forEach(async …) drops every promise it creates. Expected: 1 finding.
export const save_all = (items, save_item) => {
  items.forEach(async (item) => {
    await save_item(item)
  })
}
