// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { sui_session } from '../wallet/external_session.ts'
import { character_icon } from '../content/assets.ts'
import { content_catalog } from '../content/catalog.ts'
import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { useBlastSale } from '../kares/useBlastSale.ts'
import { rolled_item_types } from '../modules/claims.ts'
import { useAppStore } from '../store.ts'

import { crew, crew_dialogue, crew_item_type } from './crew_campaign.ts'

export const CrewDialogue = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const t = copy_text(copy.airdrop_page)
  const distribution = useAppStore((state) => state.distribution)
  const holder = useAppStore((state) => sui_session(state.external_wallet.session))
  const session = useAppStore((state) => state.session)
  const sale = useBlastSale()
  const is_helmet = (template: string) => rolled_item_types().get(template) === crew_item_type
  const received = distribution.notice?.kind === 'received' ? distribution.notice.giftcards : []
  const dialogue = crew_dialogue({
    sale,
    connected: holder !== null,
    loaded: distribution.holder_giftcards !== null,
    ready: [...(distribution.holder_giftcards ?? []), ...session.giftcards].some((card) => is_helmet(card.template)),
    claimed: received.some((card) => is_helmet(card.template) && session.redeemed_giftcards.includes(card.id)),
    pending: distribution.pending,
    error: distribution.error,
  })
  return (
    <header
      className="grid shrink-0 grid-cols-[112px_1fr] items-end overflow-hidden border border-border bg-surface-low sm:grid-cols-[160px_1fr] [@media(max-height:500px)]:grid-cols-[96px_1fr]"
      data-crew-dialogue={dialogue}
    >
      <img
        src={character_icon(crew.npc.model, 'female') ?? undefined}
        alt=""
        className="mx-auto size-28 self-end object-contain object-bottom sm:size-40 [@media(max-height:500px)]:size-24"
      />
      <div className="m-3 border-l-2 border-pink-400 py-2 pl-3">
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-[9px] tracking-[0.12em] uppercase">
          <span className="text-pink-300">{crew.npc.name}</span>
          <span className="text-gold">{content_catalog.item(crew_item_type)?.item.name}</span>
        </p>
        <p className="mt-2 text-sm leading-5 text-text" role="status" aria-live="polite">
          {t(`crew_dialogue.${dialogue}`)}
        </p>
        {dialogue === 'intro' && (
          <a
            className="mt-2 inline-block text-xs text-pink-300 underline"
            href={sale.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('crew_view_sale')}
          </a>
        )}
      </div>
    </header>
  )
}
