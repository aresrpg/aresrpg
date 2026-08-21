// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved.
// World-prop models that live bare in seed/models (not a family subfolder): today only the
// fight sword — the join-window marker planted at every nearby fight's anchor.

const modules = import.meta.glob('../../../../seed/models/*.glb', {
  import: 'default',
  query: '?url',
}) as Readonly<Record<string, () => Promise<string>>>

const loaders = Object.freeze(
  Object.fromEntries(
    Object.entries(modules).map(([path, load]) => [
      path
        .split('/')
        .at(-1)!
        .replace(/\.glb$/i, ''),
      load,
    ])
  )
) as Readonly<Record<string, () => Promise<string>>>

export const load_fight_sword_url = async (): Promise<string | null> => loaders['fight_sword']?.() ?? null
