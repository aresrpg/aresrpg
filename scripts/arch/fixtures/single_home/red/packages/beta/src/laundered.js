// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED fixture — a LOCAL re-declaration of a registry-owned fact. Nothing is exported, so only the
// registry-fact lane sees it: hiding a copy inside a function body is still a second home.
export const compute = (input) => {
  const K_TEST = 7
  return input * K_TEST
}
