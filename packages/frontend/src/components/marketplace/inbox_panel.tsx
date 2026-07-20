import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Inbox, Gift, ArrowDownToLine, Undo2 } from 'lucide-react'
import { slugs } from 'virtual:item_catalog'

import { use_auth } from '../../auth'
import { use_inbox } from '../../stores/inbox'
import type { RpcInboxGift } from '../../rpc/views'
import { truncate_address } from '../../utils/address'
import { cosmetic_icon_of } from '../../game/cosmetic_icons.js'
import { ItemImage } from '../items'

// INBOX — the escrow-recoverable item GIFT surface (an inbox in the inventory page). INCOMING gifts
// are claimed FREE (royalty prepaid by the sender); OUTGOING gifts you sent can be RECALLED (no
// return-to-sender, but the sender's recall stays). Polls the inbox store on an interval + on window focus (REQ/RES
// only — no streaming); a fresh incoming gift fires the store's one-shot toast. The /v1/inbox view is NOT live yet,
// so the honest EMPTY state is the default until the indexer route + a real send land (behavior key post-publish).

// One gift, rendered as a card — shared by the marketplace tab AND the external /inbox page.
export function GiftCard({
  gift,
  mode,
  busy,
  on_action,
}: {
  gift: RpcInboxGift
  mode: 'incoming' | 'outgoing'
  busy: boolean
  on_action: (gift: RpcInboxGift) => void
}) {
  const { t } = useTranslation()
  const counterparty = mode === 'incoming' ? gift.sender : gift.recipient
  return (
    <div className="flex flex-col gap-2.5 p-3 border border-border" style={{ background: 'rgba(255,255,255,0.02)' }}>
      <div className="flex items-center gap-2">
        <Gift size={13} className="text-gold opacity-70 shrink-0" />
        <span className="text-[9px] tracking-[0.15em] uppercase text-muted flex-1 truncate">
          {t(mode === 'incoming' ? 'gift.inbox.from' : 'gift.inbox.to')}{' '}
          <span className="text-text/80 font-mono normal-case">{truncate_address(counterparty)}</span>
        </span>
        <span className="text-[8px] tracking-[0.12em] uppercase text-muted/60 tabular-nums shrink-0">
          {t('gift.inbox.item_count', { count: gift.items.length })}
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {gift.items.map((it) => (
          <div key={it.item_id} title={it.name} className="flex items-center gap-1.5 border border-border px-1.5 py-1">
            <ItemImage
              id={cosmetic_icon_of({ slug: slugs[it.name], name: it.name }) ?? slugs[it.name] ?? ''}
              appearance={it.appearance}
              category={it.category}
              className="w-6 h-6 shrink-0"
            />
            <span className="text-[9px] tracking-[0.1em] uppercase text-text/70 truncate max-w-[110px]">{it.name}</span>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <span className="text-[8px] tracking-[0.12em] uppercase text-emerald-400/70 flex-1">
          {mode === 'incoming' ? t('gift.inbox.free_to_claim') : t('gift.inbox.recallable')}
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={() => on_action(gift)}
          className={`px-3 py-1.5 text-[9px] tracking-[0.15em] uppercase inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
            mode === 'incoming' ? 'btn-gold' : 'btn-outline'
          }`}
        >
          {busy ? (
            <Loader2 size={10} className="animate-spin" />
          ) : mode === 'incoming' ? (
            <ArrowDownToLine size={10} />
          ) : (
            <Undo2 size={10} />
          )}
          {t(mode === 'incoming' ? 'gift.inbox.claim' : 'gift.inbox.recall')}
        </button>
      </div>
    </div>
  )
}

/** Poll the connected address's inbox on an interval + on focus; first load is silent (seeds the seen set). */
export function use_inbox_polling() {
  const address = use_auth((s) => s.address)
  useEffect(() => {
    if (!address) return
    let alive = true
    const run = (silent: boolean) => {
      if (alive) void use_inbox.getState().load(address, { silent })
    }
    run(true)
    const iv = setInterval(() => run(false), 20000)
    const on_focus = () => run(false)
    window.addEventListener('focus', on_focus)
    return () => {
      alive = false
      clearInterval(iv)
      window.removeEventListener('focus', on_focus)
    }
  }, [address])
}

export function InboxPanel() {
  const { t } = useTranslation()
  const { incoming, outgoing, loading, loaded_once, busy_id, claim, recall } = use_inbox()
  use_inbox_polling()

  if (loading && !loaded_once) {
    return (
      <div className="flex items-center justify-center gap-2 py-16">
        <Loader2 size={14} className="animate-spin text-gold opacity-40" />
        <span className="text-muted text-[10px] tracking-[0.2em] uppercase animate-pulse">{t('common.loading')}</span>
      </div>
    )
  }

  const nothing = incoming.length === 0 && outgoing.length === 0

  return (
    <div className="flex flex-col flex-1 min-h-0 lg:overflow-y-auto px-6 py-4 gap-6">
      {nothing ? (
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-center text-muted">
          <Inbox size={26} style={{ opacity: 0.2 }} />
          <span className="text-[10px] tracking-[0.2em] uppercase">{t('gift.inbox.empty')}</span>
          <span className="text-[9px] tracking-[0.12em] text-muted/60 max-w-[280px] leading-relaxed">
            {t('gift.inbox.empty_hint')}
          </span>
        </div>
      ) : (
        <>
          <section className="flex flex-col gap-2.5">
            <div className="text-[10px] tracking-[0.25em] uppercase font-semibold text-gold">
              {t('gift.inbox.incoming')}
            </div>
            {incoming.length === 0 ? (
              <span className="text-[9px] tracking-[0.15em] uppercase text-muted/60 px-1">
                {t('gift.inbox.no_incoming')}
              </span>
            ) : (
              <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
                {incoming.map((g) => (
                  <GiftCard key={g.gift_id} gift={g} mode="incoming" busy={busy_id === g.gift_id} on_action={claim} />
                ))}
              </div>
            )}
          </section>

          {outgoing.length > 0 && (
            <section className="flex flex-col gap-2.5">
              <div className="text-[10px] tracking-[0.25em] uppercase font-semibold text-cyan">
                {t('gift.inbox.sent')}
              </div>
              <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
                {outgoing.map((g) => (
                  <GiftCard key={g.gift_id} gift={g} mode="outgoing" busy={busy_id === g.gift_id} on_action={recall} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
