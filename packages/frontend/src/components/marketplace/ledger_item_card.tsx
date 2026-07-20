import { ItemDetailView } from '../item_detail_view'

import type { MarketplaceDetailItem } from './marketplace_model'

export function LedgerItemCard({ item }: { item: MarketplaceDetailItem }) {
  return (
    <div
      data-marketplace-template-card
      className="relative border border-border overflow-hidden"
      style={{
        background: 'linear-gradient(160deg, rgba(251,191,36,0.045), transparent 55%), rgba(255,255,255,0.015)',
      }}
    >
      <span aria-hidden="true" className="absolute top-0 right-0 w-14 h-px bg-gold/70" />
      <span aria-hidden="true" className="absolute top-0 right-0 w-px h-14 bg-gold/30" />
      <div className="p-4 lg:p-5">
        <ItemDetailView item={item} />
      </div>
    </div>
  )
}
