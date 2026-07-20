import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Plus, Swords } from 'lucide-react'

import { get_characters, get_kolizeums, get_config } from '../rpc/client'
import { use_rpc_view } from '../rpc/use_view'
import { use_address_names } from '../rpc/use_address_names'
import { RpcStale } from '../rpc/RpcStale'
import type { RpcKolizeum } from '../rpc/views'
import { use_auth } from '../auth'
import { use_toast } from '../toast'
import i18n from '../i18n'
import { ChipRow } from '../components/chip_row'
import { AddressName } from '../components/address_name'
import { class_color } from '../constants/class_colors'
import { format_mist_to_sui, parse_pledge_sui } from '../utils/sui_mist'
import { get_level } from '../experience'
import { get_sdk } from '../chain/sdk'
import { get_listable_characters } from '../chain/read_listings'
import { create_lobby, join_lobby, exit_lobby, cancel_lobby } from '../world-shell/kolizeum_actions'
import { app_mobile_classes, use_mobile_mode } from '../game/screens/hud/mobile_layout.js'

import { gate_cta_label } from './kolizeum_gate'

// KOLIZEUM — the "War Table": ONE dense operator screen — lobby table +
// selected roster + inline create + recent settlements; canon mock mockups_design/kolizeum_a_density.html).
// UI-DATA LAW (competitive surface): lobbies short-poll the RPC at the freshest cadence (4s) with the visible
// staleness chip — money figures are never silently stale. HONEST-DATA LIMITS (indexer HANDLERS.md): live
// fill counts + open-lobby rosters are DEFERRED (KolizeumJoined/Exited are object state) — the table shows
// seats + the FULL pot at capacity (labelled), never a fake fill bar; STARTED lobbies show the real side
// rosters (side_a/side_b from the start event), name-enriched via /v1/characters. Mob-turn law untouched —
// nothing here predicts a fight, the table only mirrors lifecycle events already emitted.

type Tab = 'open' | 'mine' | 'history'

const FORMATS = ['1V1', '3V3', '6V6'] as const
type FormatChip = (typeof FORMATS)[number]
const SLOTS_OF: Record<FormatChip, number> = { '1V1': 1, '3V3': 3, '6V6': 6 }
const format_of = (slots?: number) =>
  slots === 1 ? '1V1' : slots === 3 ? '3V3' : slots === 6 ? '6V6' : `${slots ?? '?'}`

/** Full pot at capacity = pledge × seats × 2 sides (the only pot derivable from the create event). */
const full_pot = (k: RpcKolizeum) => BigInt(k.pledge_mist ?? '0') * BigInt(k.format_slots ?? 0) * 2n

/** Pot-line display: a zero pot (0-pledge "free-for-glory" lobby) reads as the free label, else formatted SUI. */
const format_pot_or_free = (mist: bigint, free_label: string) =>
  mist === 0n ? free_label : `${format_mist_to_sui(mist, 2)} SUI`

const short_addr = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—')

type OwnedChar = { id: string; kiosk_id: string; name: string; classe: string; experience: number }

export function KolizeumPage() {
  const { t } = useTranslation()
  const classes = app_mobile_classes(use_mobile_mode())
  const address = use_auth((s) => s.address)
  const [tab, set_tab] = useState<Tab>('open')
  const [format, set_format] = useState<FormatChip | null>(null)
  const [selected_id, set_selected_id] = useState<string | null>(null)
  const [busy, set_busy] = useState(false)

  // Lobby lifecycle — the freshest RPC path (competitive figures law): 4s short-poll + stale chip.
  const view = use_rpc_view<{
    lobbies: RpcKolizeum[]
    names: Map<string, { name: string | null; class: string | null }>
  }>(
    async (signal) => {
      const lobbies = await get_kolizeums({}, signal)
      // Enrich STARTED rosters with character names/classes in the same atomic poll.
      const ids = [...new Set(lobbies.flatMap((k) => [...(k.side_a ?? []), ...(k.side_b ?? [])]))]
      const chars = ids.length ? await get_characters({ ids }, signal) : []
      return { lobbies, names: new Map(chars.map((c) => [c.id, { name: c.name, class: c.class }])) }
    },
    { interval_ms: 4000, deps: [] }
  )

  const lobbies = view.data?.lobbies ?? []
  const names = view.data?.names

  const rows = useMemo(() => {
    let out = lobbies
    if (tab === 'open') out = out.filter((k) => k.status === 'open' || k.status === 'started')
    if (tab === 'mine') out = out.filter((k) => !!address && k.creator === address)
    if (tab === 'history') out = out.filter((k) => ['settled', 'drawn', 'cancelled'].includes(k.status))
    if (format) out = out.filter((k) => k.format_slots === SLOTS_OF[format])
    return out
  }, [lobbies, tab, format, address])

  const selected = useMemo(() => lobbies.find((k) => k.kolizeum === selected_id) ?? null, [lobbies, selected_id])
  const settlements = useMemo(
    () => lobbies.filter((k) => ['settled', 'drawn'].includes(k.status)).slice(0, 5),
    [lobbies]
  )
  // D52 — one batched /v1/names round trip for every visible lobby creator (distinct from `names` above,
  // which is the character-name Map for the side_a/side_b roster — a different identity space).
  const creator_names = use_address_names(rows.map((k) => k.creator))

  // ── owned characters for create/join (kiosk-locked roster, one-shot load — kiosk id needed by the PTB) ──
  // S-87: /v1/characters?owner= replaces the chain-direct kiosk sweep (no sdk/package_id needed anymore).
  const [chars, set_chars] = useState<OwnedChar[]>([])
  const [char_id, set_char_id] = useState<string | null>(null)
  useEffect(() => {
    let dead = false
    if (!address) return
    ;(async () => {
      try {
        const list = (await get_listable_characters(address)) as OwnedChar[]
        if (!dead) {
          set_chars(list)
          set_char_id((cur) => cur ?? list[0]?.id ?? null)
        }
      } catch {
        /* character load is best-effort — create/join stays disabled without one */
      }
    })()
    return () => {
      dead = true
    }
  }, [address])
  const as_char = chars.find((c) => c.id === char_id) ?? null

  // personal kiosk cap id resolves in the seam (find via kiosk scan there is redundant — the builders need the
  // cap OBJECT id; the listable scan doesn't carry it, so the seam resolves it. Here we pass kiosk_id + char.)
  const [cap_by_kiosk, set_cap_by_kiosk] = useState<Record<string, string>>({})
  useEffect(() => {
    let dead = false
    if (!address) return
    ;(async () => {
      try {
        const sdk = await get_sdk()
        const { kioskOwnerCaps } = await sdk.kiosk_client.getOwnedKiosks({ address, pagination: { limit: 50 } })
        if (dead) return
        const map: Record<string, string> = {}
        for (const cap of (kioskOwnerCaps ?? []).filter((c: any) => c.isPersonal)) map[cap.kioskId] = cap.objectId
        set_cap_by_kiosk(map)
      } catch {
        /* cap resolution best-effort — txs refuse loudly without it */
      }
    })()
    return () => {
      dead = true
    }
  }, [address])

  // KOLIZEUM LEVEL HONESTY — affordance pre-check law: read the live kolizeum level
  // gate off /v1/config's generic dials map (config.move's DialChanged projection) so create/join can
  // refuse BEFORE a doomed tx fires. One-shot (the dial is an admin-tunable that practically never moves —
  // no 4s poll like the money-critical lobby table above). An UNKNOWN gate (fetch still in flight, or the
  // dial was never explicitly re-set since the last publish so no DialChanged ever fired) fails OPEN —
  // never blocks a legitimate action on missing data; the chain stays authoritative and the humanizer
  // (abort_copy.js's `kolizeum` arm) covers the abort if this optimistic read ever turns out wrong.
  const [kolizeum_gate, set_kolizeum_gate] = useState<number | null>(null)
  useEffect(() => {
    let dead = false
    ;(async () => {
      try {
        const config = await get_config()
        const gate = config.dials?.pvp_level_gate
        if (!dead && typeof gate === 'number') set_kolizeum_gate(gate)
      } catch {
        /* gate read best-effort — unknown gate never blocks create/join, see above */
      }
    })()
    return () => {
      dead = true
    }
  }, [])

  // join's ELevelTooLow actually gates on the LOBBY's frozen `gate_snapshot` (kolizeum.move join_internal),
  // not the live dial — but the indexer doesn't project a per-lobby gate_snapshot (KolizeumCreated carries
  // no such field), so the live current gate is the best available client-side approximation for both
  // create AND join; the chain enforces the real (possibly stricter/looser) frozen value regardless.
  const character_level = as_char ? get_level(as_char.experience) : null
  const below_gate = kolizeum_gate != null && character_level != null && character_level < kolizeum_gate

  // ── create form ──
  const [form_format, set_form_format] = useState<FormatChip>('3V3')
  const [pledge, set_pledge] = useState('1.00')
  const [max_diff, set_max_diff] = useState('10')

  const run = (label: string, p: Promise<unknown>) => {
    set_busy(true)
    use_toast
      .getState()
      .promise(p, {
        pending: i18n.t(`kolizeum.pending_${label}`),
        success: i18n.t(`kolizeum.toast_${label}`),
        // No static `error:` override (KOLIZEUM LEVEL HONESTY) — use_toast.promise()
        // falls back to the rejection's OWN `.message` when `error` is omitted, and run_tx already
        // humanizes that message (tx_error → abort_copy.js). A static string here silently discarded it:
        // that's the actual mechanism behind the reported generic "Lobby creation failed" toast.
      })
      .catch(() => {})
      .finally(() => set_busy(false))
  }

  function do_create() {
    if (!as_char || below_gate) return
    let pledge_mist: bigint
    try {
      pledge_mist = parse_pledge_sui(pledge.trim())
    } catch {
      use_toast.getState().add(i18n.t('kolizeum.pledge_invalid'), 'error')
      return
    }
    run(
      'create',
      create_lobby({
        format_slots: SLOTS_OF[form_format],
        pledge_mist,
        max_level_diff: Math.max(0, Number(max_diff) || 0),
        character_id: as_char.id,
        kiosk_id: as_char.kiosk_id,
        personal_kiosk_cap_id: cap_by_kiosk[as_char.kiosk_id],
      })
    )
  }

  function do_join(k: RpcKolizeum) {
    if (!as_char || below_gate) return
    run(
      'join',
      join_lobby({
        kolizeum_id: k.kolizeum,
        pledge_mist: BigInt(k.pledge_mist ?? '0'),
        character_id: as_char.id,
        kiosk_id: as_char.kiosk_id,
        personal_kiosk_cap_id: cap_by_kiosk[as_char.kiosk_id],
      })
    )
  }

  const status_color: Record<string, string> = {
    open: '#4a9eff',
    started: '#f59e0b',
    settled: '#34d399',
    drawn: '#6b7280',
    cancelled: '#6b7280',
  }

  const roster = (side?: string[]) =>
    (side ?? []).map((id) => {
      const info = names?.get(id)
      return (
        <div
          key={id}
          className="flex items-center gap-2 px-2 py-1.5 border border-border"
          style={{ background: 'rgba(255,255,255,0.02)' }}
        >
          <span
            className="w-5 h-5 flex items-center justify-center text-[7px] uppercase font-semibold border shrink-0"
            style={{
              color: class_color(info?.class),
              borderColor: `${class_color(info?.class)}55`,
              background: `${class_color(info?.class)}1a`,
            }}
          >
            {(info?.class ?? '?').slice(0, 2)}
          </span>
          <span className="text-[10px] text-text truncate">{info?.name ?? short_addr(id)}</span>
        </div>
      )
    })

  return (
    <div className={`${classes.page} glass-panel flex flex-col flex-1 min-h-0 m-4 p-0 overflow-hidden`}>
      {/* header */}
      <div className={`${classes.page_header} flex items-center gap-4 px-4 pt-3 pb-2 border-b border-border shrink-0`}>
        <Swords size={14} className="text-gold opacity-60" />
        <span
          className={`${classes.page_title} text-[11px] tracking-[0.4em] uppercase font-semibold text-gold gold-glow`}
        >
          {t('kolizeum.title')}
        </span>
        <span className={`${classes.page_subtitle} text-[8px] tracking-[0.2em] uppercase text-muted`}>
          {t('kolizeum.tagline')}
        </span>
        <span className={`${classes.page_status} ml-auto`}>
          <RpcStale stale={view.stale} offline={view.error != null && view.data == null} />
        </span>
      </div>

      <div className={classes.stack}>
        {/* ── LEFT: lobby table + selected lobby ── */}
        <div className="flex flex-col flex-1 min-h-0 border-r border-border">
          {/* tabs + format chips. MOBFIX defect #3: on mobile the format toggle wraps to its own line
              (kolizeum-tabbar override in mobile_app_shell.css) instead of sitting past the visible edge
              of a silently-scrollable row (the SAME "scrollable but zero affordance" bug as the bottom
              nav, defect #1). */}
          <div
            className={`${classes.page_tabs} kolizeum-tabbar flex items-center gap-1 border-b border-border px-2 shrink-0`}
          >
            {(['open', 'mine', 'history'] as Tab[]).map((tb) => (
              <button
                key={tb}
                type="button"
                className={`admin-tab ${tab === tb ? 'active' : ''}`}
                onClick={() => set_tab(tb)}
              >
                {t(`kolizeum.tab_${tb}`)}
              </button>
            ))}
            <span className="kolizeum-format-chips ml-auto pb-1">
              <ChipRow options={FORMATS} active={format} on_pick={set_format} />
            </span>
          </div>

          {/* table. MOBFIX defect #3: `kolizeum-row` scopes the mobile forced-min-width horizontal-scroll
              treatment (mobile_app_shell.css) to the header + real rows ONLY — the empty/loading message
              below is a plain sibling div so it stays centred in the visible viewport instead of
              inheriting that width and rendering off-screen. */}
          <div className="kolizeum-table-scroll flex flex-col overflow-y-auto flex-1 min-h-0">
            <div className="kolizeum-row flex items-center gap-3 px-4 py-1.5 border-b border-border text-[8px] tracking-[0.2em] uppercase text-muted shrink-0">
              <span className="w-10">{t('kolizeum.col_format')}</span>
              <span className="w-16">{t('kolizeum.col_access')}</span>
              <span className="w-16">{t('kolizeum.col_status')}</span>
              <span className="w-20 text-right">{t('kolizeum.col_pledge')}</span>
              <span className="w-24 text-right">{t('kolizeum.col_full_pot')}</span>
              <span className="flex-1 text-right">{t('kolizeum.col_creator')}</span>
              <span className="w-28" />
            </div>
            {rows.length === 0 ? (
              <div className="flex items-center justify-center py-12 text-muted">
                <span className="text-[9px] tracking-[0.2em] uppercase">
                  {view.loading ? t('common.loading') : t('kolizeum.empty')}
                </span>
              </div>
            ) : (
              rows.map((k, idx) => (
                <div
                  key={k.kolizeum}
                  onClick={() => set_selected_id(k.kolizeum)}
                  className="kolizeum-row flex items-center gap-3 px-4 py-2 border-b border-border cursor-pointer transition-all hover:shadow-[0_0_20px_rgba(200,150,60,0.08)]"
                  style={{
                    background:
                      selected_id === k.kolizeum
                        ? 'rgba(200,150,60,0.08)'
                        : idx % 2 === 0
                          ? 'rgba(255,255,255,0.02)'
                          : 'transparent',
                    borderLeft: selected_id === k.kolizeum ? '2px solid #c8963c' : '2px solid transparent',
                  }}
                >
                  <span className="w-10 text-[11px] font-semibold text-text">{format_of(k.format_slots)}</span>
                  <span
                    className="w-16 text-[8px] tracking-[0.12em] uppercase"
                    style={{ color: k.is_public === false ? '#4a9eff' : '#6b7280' }}
                  >
                    {k.is_public === false ? t('kolizeum.access_friends') : t('kolizeum.access_public')}
                  </span>
                  <span
                    className="w-16 text-[8px] tracking-[0.12em] uppercase"
                    style={{ color: status_color[k.status] }}
                  >
                    ● {t(`kolizeum.status_${k.status}`)}
                  </span>
                  <span className="w-20 text-right text-[10px] tabular-nums text-text">
                    {format_mist_to_sui(BigInt(k.pledge_mist ?? '0'), 2)} SUI
                  </span>
                  <span className="w-24 text-right text-[10px] tabular-nums text-gold">
                    {format_pot_or_free(
                      k.status === 'settled' && k.pot_mist ? BigInt(k.pot_mist) : full_pot(k),
                      t('kolizeum.free')
                    )}
                  </span>
                  <span className="flex-1 text-right text-[9px] text-muted tabular-nums truncate">
                    <AddressName address={k.creator} name={k.creator ? creator_names[k.creator] : undefined} />
                  </span>
                  <span className="w-28 flex justify-end">
                    {k.status === 'open' &&
                      (address && k.creator === address ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={(e) => {
                            e.stopPropagation()
                            run('cancel', cancel_lobby(k.kolizeum))
                          }}
                          className="btn-outline--danger px-2.5 py-1 text-[9px]"
                        >
                          {t('kolizeum.cancel_cta')}
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={busy || !as_char || below_gate}
                          onClick={(e) => {
                            e.stopPropagation()
                            do_join(k)
                          }}
                          className="btn-outline px-2.5 py-1 text-[9px] tabular-nums"
                        >
                          {gate_cta_label(
                            t,
                            below_gate,
                            kolizeum_gate,
                            t('kolizeum.pledge_cta', { amount: format_mist_to_sui(BigInt(k.pledge_mist ?? '0'), 2) })
                          )}
                        </button>
                      ))}
                    {k.status === 'started' && (
                      <span className="text-amber-400 text-[8px] tracking-[0.15em] uppercase animate-pulse">
                        ● {t('kolizeum.status_started')}
                      </span>
                    )}
                  </span>
                </div>
              ))
            )}
          </div>

          {/* selected lobby detail */}
          {selected && (
            <div className="border-t border-border px-4 py-3 shrink-0">
              <div className="flex items-center gap-3 mb-2">
                <span className="text-[9px] tracking-[0.25em] uppercase text-gold font-semibold">
                  {t('kolizeum.selected')}
                </span>
                <span className="text-[9px] text-muted uppercase tracking-[0.15em]">
                  {format_of(selected.format_slots)} ·{' '}
                  {selected.is_public === false ? t('kolizeum.access_friends') : t('kolizeum.access_public')}
                </span>
                {selected.status === 'open' && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run('exit', exit_lobby(selected.kolizeum))}
                    className="btn-outline ml-auto px-2.5 py-1 text-[9px]"
                    title={t('kolizeum.exit_hint') as string}
                  >
                    {t('kolizeum.exit_cta')}
                  </button>
                )}
              </div>
              {selected.status === 'started' || (selected.side_a?.length ?? 0) > 0 ? (
                <div className="flex gap-4">
                  <div className="flex-1 flex flex-col gap-1">
                    <span className="text-[8px] tracking-[0.2em] uppercase text-cyan">{t('kolizeum.side_a')}</span>
                    {roster(selected.side_a)}
                  </div>
                  {(() => {
                    const pot_mist = selected.pot_mist ? BigInt(selected.pot_mist) : full_pot(selected)
                    return (
                      <div className="flex flex-col items-center justify-center px-2">
                        <span className="text-[8px] tracking-[0.2em] uppercase text-muted">
                          {t('kolizeum.total_pot')}
                        </span>
                        <span className="text-[16px] text-gold gold-glow tabular-nums">
                          {pot_mist === 0n ? t('kolizeum.free') : format_mist_to_sui(pot_mist, 2)}
                        </span>
                        {pot_mist !== 0n && <span className="text-[8px] text-muted uppercase">SUI</span>}
                      </div>
                    )
                  })()}
                  <div className="flex-1 flex flex-col gap-1">
                    <span className="text-[8px] tracking-[0.2em] uppercase" style={{ color: '#e0533a' }}>
                      {t('kolizeum.side_b')}
                    </span>
                    {roster(selected.side_b)}
                  </div>
                </div>
              ) : (
                <span className="text-[9px] text-muted tracking-[0.12em] uppercase">
                  {t('kolizeum.roster_pending')}
                </span>
              )}
            </div>
          )}
        </div>

        {/* ── RIGHT: create + settlements ── */}
        <div className="app-mobile-stack__rail flex flex-col w-[300px] min-w-[300px] shrink-0 overflow-y-auto">
          <div className="px-4 pt-3 pb-2">
            <span className="text-[9px] tracking-[0.25em] uppercase text-gold font-semibold flex items-center gap-2">
              <Plus size={11} /> {t('kolizeum.create_title')}
            </span>
          </div>
          <div className="flex flex-col gap-2.5 px-4 pb-3">
            <div className="flex flex-col gap-1">
              <span className="text-[8px] tracking-[0.2em] uppercase text-muted">{t('kolizeum.form_format')}</span>
              <ChipRow options={FORMATS} active={form_format} on_pick={(v) => v && set_form_format(v)} required />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[8px] tracking-[0.2em] uppercase text-muted">{t('kolizeum.form_pledge')}</span>
              <input
                className="template-input"
                inputMode="decimal"
                value={pledge}
                onChange={(e) => set_pledge(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[8px] tracking-[0.2em] uppercase text-muted">{t('kolizeum.form_max_diff')}</span>
              <input
                className="template-input"
                inputMode="numeric"
                value={max_diff}
                onChange={(e) => set_max_diff(e.target.value.replace(/[^0-9]/g, ''))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[8px] tracking-[0.2em] uppercase text-muted">{t('kolizeum.form_character')}</span>
              {chars.length === 0 ? (
                <span className="text-[8px] text-amber-400/70 tracking-[0.12em] uppercase">
                  {t('kolizeum.no_character')}
                </span>
              ) : (
                <div className="flex flex-col gap-1">
                  {chars.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => set_char_id(c.id)}
                      className="flex items-center gap-2 px-2 py-1 border text-left cursor-pointer"
                      style={{
                        borderColor: char_id === c.id ? '#c8963c' : 'var(--color-border)',
                        background: char_id === c.id ? 'rgba(200,150,60,0.08)' : 'transparent',
                      }}
                    >
                      <span className="text-[8px] uppercase font-semibold" style={{ color: class_color(c.classe) }}>
                        {(c.classe || '?').slice(0, 2)}
                      </span>
                      <span className="text-[9px] text-text truncate flex-1">{c.name}</span>
                      <span className="text-[8px] text-muted tabular-nums">Lv.{get_level(c.experience)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {(() => {
              let p = 0n
              try {
                p = parse_pledge_sui(pledge.trim() || '0')
              } catch {
                /* live summary only — do_create re-validates with the honest toast */
              }
              const total = p * BigInt(SLOTS_OF[form_format]) * 2n
              return (
                <span className="text-[8px] text-muted tracking-[0.12em] uppercase">
                  {t('kolizeum.full_pot_summary', {
                    pot: format_mist_to_sui(total, 2),
                    format: form_format,
                  })}
                </span>
              )
            })()}
            <button
              type="button"
              disabled={busy || !as_char || below_gate}
              onClick={do_create}
              className="btn-gold py-2.5 px-4 text-[10px] tracking-[0.2em] uppercase flex items-center justify-center gap-2 disabled:cursor-not-allowed"
            >
              {busy ? <Loader2 size={11} className="animate-spin" /> : null}
              {gate_cta_label(t, below_gate, kolizeum_gate, t('kolizeum.create_cta'))}
            </button>
          </div>

          <div className="px-4 pt-2 pb-3 border-t border-border">
            <span className="text-[9px] tracking-[0.25em] uppercase text-gold font-semibold">
              {t('kolizeum.settlements')}
            </span>
            <div className="flex flex-col gap-1 mt-2">
              {settlements.length === 0 ? (
                <span className="text-[8px] text-muted tracking-[0.12em] uppercase">
                  {t('kolizeum.no_settlements')}
                </span>
              ) : (
                settlements.map((k) => (
                  <div key={k.kolizeum} className="flex items-center gap-2 text-[9px] border-b border-border py-1">
                    <span className="font-semibold text-text w-8">{format_of(k.format_slots)}</span>
                    {k.status === 'drawn' ? (
                      <>
                        <span className="text-muted uppercase tracking-[0.1em] flex-1">
                          {t('kolizeum.status_drawn')}
                        </span>
                        <span className="text-muted tabular-nums">
                          {t('kolizeum.refunded', { amount: format_mist_to_sui(BigInt(k.refunded_mist ?? '0'), 2) })}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="text-muted uppercase tracking-[0.1em] flex-1">
                          {t('kolizeum.pot_label', { amount: format_mist_to_sui(BigInt(k.pot_mist ?? '0'), 2) })}
                        </span>
                        <span className="tabular-nums" style={{ color: '#34d399' }}>
                          {t('kolizeum.winners', { count: Array.isArray(k.winners) ? k.winners.length : 0 })}
                        </span>
                      </>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
