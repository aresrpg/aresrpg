// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED fixture — arch-fight-effect-free must flag EVERY effect shape below (7 findings):
// the await, the async function declaration, .then, .catch, .finally, new Promise, Promise.all.
export const load_snapshot = async (fetch_snapshot) => {
  const snapshot = await fetch_snapshot()
  return snapshot
}

export async function load_all(fetch_all) {
  return fetch_all()
}

export const wait_all = (ps) => Promise.all(ps)

export const chain = (p) =>
  p
    .then((x) => x)
    .catch(() => null)
    .finally(() => null)

export const defer = () => new Promise((resolve) => resolve(1))
