// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE clickable entity reference (ency deep-links): renders an entity name (a dungeon key, a
// world) as a router link to its encyclopedia page via the ONE link idiom (encyclopedia_path) — never a second
// link system. No resolvable id → the children render as plain text (an honest, non-clickable label, never a
// dead `/.../undefined` link), so every call site degrades gracefully. Works standalone AND as a react-i18next
// <Trans> component slot (Trans injects the interpolated name as children).

import { Link } from 'react-router-dom'

import { encyclopedia_path } from './links'

/**
 * @param {{ kind: import('./links').EncyclopediaEntity, id?: string | null, className?: string, title?: string,
 *   children?: import('react').ReactNode }} props
 * @returns {import('react').ReactElement}
 */
export function EncyclopediaLink({ kind, id, className = '', title, children }) {
  if (!id) return <>{children}</>
  return (
    <Link className={`ency-link ${className}`.trim()} to={encyclopedia_path(kind, id)} title={title}>
      {children}
    </Link>
  )
}
