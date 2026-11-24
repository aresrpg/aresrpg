// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { ExternalLink } from 'lucide-react'

import { env } from '../env.ts'
import { explorer_object_url } from '../explorer.ts'
import type { AppCopy } from '../i18n/copy.ts'

/** Templates and local-demo identities are not chain objects. */
export const ObjectExplorerLink = ({
  object_id,
  hidden,
  copy,
  menu,
  labelled,
  className = '',
  onClick,
}: Readonly<{
  object_id?: string
  hidden?: boolean
  copy: AppCopy
  menu?: boolean
  /** Shows the words beside the mark, where a row has the room. */
  labelled?: boolean
  className?: string
  onClick?: () => void
}>) => {
  if (hidden || !object_id || !/^0x[0-9a-f]{64}$/i.test(object_id)) return null
  const label = copy.ui.view_on_suivision
  return (
    <a
      aria-label={label}
      title={label}
      role={menu ? 'menuitem' : undefined}
      className={`${menu ? 'flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left' : labelled ? 'inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 text-xs whitespace-nowrap no-underline' : 'inline-flex size-11 shrink-0 items-center justify-center'} text-muted hover:text-gold focus-visible:outline-2 focus-visible:outline-gold ${className}`}
      href={explorer_object_url(env.network, object_id)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onClick}
    >
      <ExternalLink size={12} aria-hidden="true" />
      {menu && label}
      {/* A narrow row keeps the mark alone: the link's name stays its accessible label. */}
      {labelled && <span className="max-[760px]:hidden">{label}</span>}
    </a>
  )
}
