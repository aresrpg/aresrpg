// SSOT on-chain explorer link — a small house-styled link (external-link icon + uppercase label) that opens
// a Sui object's page on the block explorer in a NEW tab. ONE shared component reused across surfaces
// (characters today; items / dungeons later — D39). The explorer base lives in a SINGLE constant so a mainnet
// flip is one edit (network-keyed via VITE_NETWORK, matching handshake.js / sui_requests.js). Renders NOTHING
// for a template-only entry (no valid on-chain id) so it never shows a dead link.
import { useTranslation } from 'react-i18next'

const NETWORK = import.meta.env.VITE_NETWORK || 'testnet'
// SuiVision pattern: https://<network>.suivision.xyz/object/<id> (mainnet drops the subdomain →
// suivision.xyz). Network-keyed off VITE_NETWORK so a mainnet flip needs no code fork — just
// VITE_NETWORK=mainnet.
const SUIVISION_HOST = NETWORK === 'mainnet' ? 'suivision.xyz' : `${NETWORK}.suivision.xyz`

/**
 * The explorer object URL for an on-chain object id, or null when there is none (template-only / invalid).
 * A valid Sui object id is a 0x-prefixed hex string.
 * @param {string | null | undefined} object_id
 * @returns {string | null}
 */
export function explorer_object_url(object_id) {
  if (!object_id || !/^0x[0-9a-fA-F]+$/.test(object_id)) return null
  return `https://${SUIVISION_HOST}/object/${object_id}`
}

/** The one "external link" glyph shared by every explorer affordance (standalone link + menu rows). */
function ExplorerGlyph({ color = 'currentColor' }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  )
}

/**
 * @param {{ object_id?: string | null, className?: string }} props
 */
export function ExplorerLink({ object_id, className = '' }) {
  const { t } = useTranslation()
  const url = explorer_object_url(object_id)
  if (!url) return null
  return (
    <a
      className={`inline-flex items-center gap-1.5 w-fit font-mono text-[10px] tracking-[0.15em] uppercase text-muted no-underline hover:text-gold transition-colors ${className}`}
      href={url}
      target="_blank"
      rel="noreferrer noopener"
    >
      <ExplorerGlyph />
      {t('explorer.view')}
    </a>
  )
}

/**
 * The "See on explorer" row for a right-click item context menu (pet/box/crush popovers) — same `.hud-btn`
 * chrome as the sibling action buttons (Crush, Open, Feed), but a REAL anchor since it's pure navigation:
 * new tab, noopener, no tx, no confirm. `on_navigate` lets the caller dismiss its own popover on click
 * without blocking the default navigation (target="_blank" still opens even when the handler runs).
 * Renders nothing when the id doesn't resolve to a real on-chain object (mirrors ExplorerLink).
 * @param {{ object_id?: string | null, on_navigate?: () => void }} props
 */
export function ExplorerMenuRow({ object_id, on_navigate }) {
  const { t } = useTranslation()
  const url = explorer_object_url(object_id)
  if (!url) return null
  return (
    <a
      className="hud-btn"
      style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-start', textDecoration: 'none' }}
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      onClick={on_navigate}
    >
      <ExplorerGlyph color="var(--accent, #c8963c)" />
      {t('explorer.view')}
    </a>
  )
}
