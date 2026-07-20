import { useState } from 'react'
import { Shield } from 'lucide-react'

import { get_mob_icon_url } from '../game/data/mobs.js'

/**
 * A mob's rendered encyclopedia icon (thumb by default, `hd` for the detail header) — the mob-side sibling
 * of ItemImage/ItemIcon. Resolves via get_mob_icon_url (name → appearance → GLB slug → the rendered PNG
 * scripts/render_mob_icons.mjs shipped), same Walrus-then-local fallback order the GLB itself uses. No
 * catalog match / render 404 → a neutral shield glyph (never a broken-image box or a blank slot).
 */
export function MobImage({
  mob,
  hd,
  className,
  style,
}: {
  mob: { name?: string; variant?: string }
  hd?: boolean
  className?: string
  style?: React.CSSProperties
}) {
  const [failed, set_failed] = useState(false)
  const url = get_mob_icon_url(mob, { hd })
  if (!url || failed)
    return (
      <span
        className={`inline-flex items-center justify-center text-muted opacity-40 ${className ?? ''}`}
        style={style}
        aria-hidden="true"
      >
        <Shield size={hd ? 28 : 14} strokeWidth={1.6} />
      </span>
    )
  return (
    <img
      src={url}
      alt=""
      loading={hd ? 'eager' : 'lazy'}
      referrerPolicy="no-referrer"
      className={className}
      style={style}
      onError={() => set_failed(true)}
      onLoad={(e) => {
        if (!e.currentTarget.naturalWidth) set_failed(true)
      }}
    />
  )
}
