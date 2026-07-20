import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import {
  LEADERBOARD_CATEGORIES,
  TIMEFRAMES,
  TIMEFRAME_KEYS,
  CATEGORY_KEYS,
  ALLTIME_ONLY_CATEGORIES,
  SCORE_HIDDEN_CATEGORIES,
  format_score,
} from '../constants/leaderboard'
import jobs_data from '../data/jobs.json'
import { use_template_t } from '../i18n/template_t'

const { JOB_MASTER_JOBS } = jobs_data

const CLASS_GRADIENTS: Record<string, [string, string]> = {
  SENSHI: ['#C0392B', '#E74C3C'],
  YAJIN: ['#1f5a9e', '#4a9eff'],
  IKARI: ['#96281B', '#C0392B'],
  MORI: ['#27AE60', '#2ECC71'],
  TOKEI: ['#2980B9', '#3498DB'],
  SHUGO: ['#F39C12', '#F1C40F'],
  YOGEN: ['#16A085', '#1ABC9C'],
  ROJIN: ['#D35400', '#E67E22'],
  SHUSEN: ['#7F8C8D', '#95A5A6'],
  TOMODA: ['#8b6914', '#c8963c'],
  ASOBI: ['#A04000', '#D35400'],
  IYASHI: ['#1A5276', '#2980B9'],
}

const JOB_GRADIENTS: Record<string, [string, string]> = {
  // Gathering
  FARMER: ['#27AE60', '#2ECC71'],
  HERBALIST: ['#16A085', '#1ABC9C'],
  MINER: ['#7F8C8D', '#95A5A6'],
  // Weapon Craft
  SWORD_SMITH: ['#C0392B', '#E74C3C'],
  AXE_SMITH: ['#D35400', '#E67E22'],
  BLUNT_SMITH: ['#96281B', '#C0392B'],
  STAFF_CARVER: ['#A04000', '#D35400'],
  BOWYER: ['#F39C12', '#F1C40F'],
  // Equipment Craft
  ARMORSMITH: ['#2980B9', '#3498DB'],
  TAILOR: ['#1f5a9e', '#4a9eff'],
  TANNER: ['#B9770E', '#F39C12'],
  JEWELER: ['#8b6914', '#c8963c'],
  // Consumable Craft
  ALCHEMIST: ['#1A5276', '#2980B9'],
  BAKER: ['#D4AC0D', '#F1C40F'],
  HANDYMAN: ['#2C3E50', '#34495E'],
}

function CharacterBadges({ data_json }: { data_json: string }) {
  if (!data_json) return null
  let characters: { name: string; class_type: string; level: number }[]
  try {
    characters = JSON.parse(data_json)
  } catch {
    return null
  }
  if (!characters?.length) return null

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {characters.map(({ name, class_type, level }, i) => {
        const key = class_type?.toUpperCase()
        const [dark, light] = CLASS_GRADIENTS[key] || ['#7F8C8D', '#95A5A6']
        return (
          <span
            key={`${class_type}-${name}-${i}`}
            className="inline-flex items-center px-1.5 py-0.5 text-[9px] tracking-wide uppercase"
            style={{
              background: `linear-gradient(135deg, ${dark}30, ${light}18)`,
              border: `1px solid ${light}40`,
              color: light,
            }}
            title={`${name}, ${class_type} Lv.${level}`}
          >
            <span className="opacity-70">{class_type}</span>
            <span className="mx-0.5 opacity-30">·</span>
            <span className="font-bold">{level}</span>
          </span>
        )
      })}
    </div>
  )
}

function JobBadges({ data_json }: { data_json: string }) {
  if (!data_json) return null
  let jobs: { job: string; level: number }[]
  try {
    jobs = JSON.parse(data_json)
  } catch {
    return null
  }
  if (!jobs?.length) return null

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {jobs
        .filter(({ job }) => job)
        .map(({ job, level }, i) => {
          const meta = JOB_MASTER_JOBS.find((j) => j.id === job)
          const label =
            meta?.label ||
            job
              .replace(/_/g, ' ')
              .toLowerCase()
              .replace(/\b\w/g, (c) => c.toUpperCase())
          const [dark, light] = JOB_GRADIENTS[job] || ['#7F8C8D', '#95A5A6']
          return (
            <span
              key={`${job}-${i}`}
              className="inline-flex items-center px-1.5 py-0.5 text-[9px] tracking-wide uppercase"
              style={{
                background: `linear-gradient(135deg, ${dark}30, ${light}18)`,
                border: `1px solid ${light}40`,
                color: light,
              }}
              title={`${label} Lv.${level}`}
            >
              <span className="opacity-70">{label}</span>
              <span className="mx-0.5 opacity-30">·</span>
              <span className="font-bold">{level}</span>
            </span>
          )
        })}
    </div>
  )
}

export function LeaderboardPage() {
  const { t } = useTranslation()
  const tt = use_template_t()
  const [category, set_category] = useState('XP')
  const [timeframe, set_timeframe] = useState('ALL TIME')
  const [dungeon_filter, set_dungeon_filter] = useState('')
  // The leaderboard was served entirely by the WS backend (rankings, dungeon templates, own-profile highlight),
  // now retired. There is no chain-direct leaderboard read yet, so the page renders its own "no data" empty state.
  // (Nav gate: `leaderboard` is already `disabled: true` in NAV_ITEMS, so this route is unreachable in the shipped
  // build; the collapse keeps the component compiling standalone. A real on-chain leaderboard is a separate ticket.)
  type LbEntry = {
    rank: number
    player_uuid: string
    player_name: string
    score: bigint
    sui_to_next: number
    data_json: string
  }
  type LbData = { entries: LbEntry[]; player_rank: number; player_score: bigint; sui_to_next_rank: number }
  const leaderboard = null as LbData | null
  const leaderboard_loading = false
  const player = null as { hytale_uuid: string; hytale_username: string } | null
  const templates: Record<string, any[]> = {}
  const fetch_leaderboard = (..._args: unknown[]) => {}
  const fetch_templates = (..._args: unknown[]) => {}
  const category_key = CATEGORY_KEYS[category] || 'xp'
  const is_alltime_only = ALLTIME_ONLY_CATEGORIES.has(category)
  const is_score_hidden = SCORE_HIDDEN_CATEGORIES.has(category)
  const timeframe_key = is_alltime_only ? 'alltime' : TIMEFRAME_KEYS[timeframe] || 'weekly'
  const dungeon_templates: any[] = templates.dungeon || []
  useEffect(() => {
    if (is_alltime_only) set_timeframe('ALL TIME')
  }, [category, is_alltime_only])
  useEffect(() => {
    if (category === 'DUNGEONS') fetch_templates('dungeon')
  }, [category])
  useEffect(() => {
    if (category !== 'DUNGEONS') set_dungeon_filter('')
  }, [category])
  useEffect(() => {
    fetch_leaderboard(category_key, timeframe_key, dungeon_filter || undefined)
  }, [category_key, timeframe_key, dungeon_filter])
  const entries = leaderboard?.entries || []
  const top3 = entries.slice(0, 3)
  // Podium layout: [2nd, 1st, 3rd] when 3 entries, [null, 1st, null] when 1, [2nd, 1st, null] when 2
  const podium_order =
    top3.length >= 3
      ? [top3[1], top3[0], top3[2]]
      : top3.length === 2
        ? [top3[1], top3[0], null]
        : top3.length === 1
          ? [null, top3[0], null]
          : []
  const podium_heights = [80, 100, 70]
  const podium_colors = ['#9ca3af', '#c8963c', '#cd7f32']
  return (
    <div className="app-page p-3 lg:p-6 flex flex-col gap-5">
      <div className="app-page-tabs flex items-center gap-1 border-b border-border pb-3 overflow-x-auto scrollbar-hide">
        {LEADERBOARD_CATEGORIES.map((cat) => (
          <button
            type="button"
            key={cat}
            className={`category-pill ${category === cat ? 'active' : ''}`}
            onClick={() => set_category(cat)}
          >
            {t(`leaderboard.${cat.toLowerCase()}`)}
          </button>
        ))}
      </div>
      {category === 'DUNGEONS' && dungeon_templates.length > 0 && (
        <div className="app-page-tabs flex items-center gap-1 overflow-x-auto scrollbar-hide">
          <button
            type="button"
            className={`time-tab ${!dungeon_filter ? 'active' : ''}`}
            onClick={() => set_dungeon_filter('')}
          >
            {t('leaderboard.all_dungeons')}
          </button>
          {dungeon_templates.map((d: any) => (
            <button
              type="button"
              key={d.id}
              className={`time-tab ${dungeon_filter === d.id ? 'active' : ''}`}
              onClick={() => set_dungeon_filter(d.id)}
            >
              {tt(d, 'name')}
            </button>
          ))}
        </div>
      )}
      {!is_alltime_only && (
        <div className="app-page-tabs flex items-center gap-1 overflow-x-auto scrollbar-hide">
          {TIMEFRAMES.map((tf) => (
            <button
              type="button"
              key={tf}
              className={`time-tab ${timeframe === tf ? 'active' : ''}`}
              onClick={() => set_timeframe(tf)}
            >
              {t(`leaderboard.${tf.toLowerCase().replace(' ', '_')}`)}
            </button>
          ))}
        </div>
      )}
      {leaderboard_loading && (
        <div className="text-muted text-[10px] tracking-[0.2em] uppercase animate-pulse">{t('common.loading')}</div>
      )}
      {top3.length > 0 && (
        <div className="flex items-end justify-center gap-2 w-full px-2">
          {podium_order.map((entry, i) =>
            entry ? (
              <div
                key={entry.player_uuid}
                className="leaderboard-podium flex-1 min-w-0 max-w-[120px] lg:max-w-[140px]"
                style={{
                  minHeight: podium_heights[i],
                  borderTopColor: podium_colors[i],
                  borderTopWidth: 3,
                  animationDelay: `${i * 60}ms`,
                }}
              >
                <div className="text-[9px] tracking-[0.2em] uppercase" style={{ color: podium_colors[i] }}>
                  #{entry.rank}
                </div>
                <span className="text-[11px] text-text font-semibold truncate max-w-full text-center mt-1">
                  {entry.player_name}
                </span>
                {!is_score_hidden && (
                  <div className="text-[12px] font-bold mt-1" style={{ color: podium_colors[i] }}>
                    {format_score(entry.score, category_key)}
                  </div>
                )}
                {is_score_hidden && entry.sui_to_next > 0 && (
                  <div className="inline-flex items-center gap-1 px-2 py-0.5 mt-1 border border-gold/20 bg-gold/5 text-[8px] tracking-[0.1em] uppercase">
                    <span className="text-gold text-[6px]">&#9650;</span>
                    <span className="text-text/70">{entry.sui_to_next} SUI</span>
                  </div>
                )}
              </div>
            ) : (
              <div
                key={`empty-${i}`}
                className="flex-1 min-w-0 max-w-[120px] lg:max-w-[140px]"
                style={{ minHeight: podium_heights[i] }}
              />
            )
          )}
        </div>
      )}
      {entries.length > 0 && (
        <div className="glass-panel flex flex-col divide-y divide-border/50">
          <div className="leaderboard-row text-[9px] tracking-[0.1em] uppercase text-muted border-b border-border">
            <span>{t('leaderboard.rank_header')}</span>
            <span>{t('leaderboard.player')}</span>
            {is_score_hidden ? (
              <span>{t('leaderboard.next_rank')}</span>
            ) : (
              <span>{category_key === 'jobs' ? t('leaderboard.total_unique_lvl') : t('leaderboard.score')}</span>
            )}
            <span className="text-right">{t('leaderboard.rank')}</span>
          </div>
          {entries.map((entry, i) => (
            <div
              key={entry.player_uuid}
              className={`leaderboard-row text-[11px] ${entry.player_uuid === player?.hytale_uuid ? 'leaderboard-row-self' : ''}`}
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <span className="text-muted text-[10px]">{entry.rank}</span>
              <div className="flex flex-col gap-1 min-w-0">
                <span className="text-text truncate">{entry.player_name}</span>
                {category_key === 'xp' && entry.data_json && <CharacterBadges data_json={entry.data_json} />}
                {category_key === 'jobs' && entry.data_json && <JobBadges data_json={entry.data_json} />}
              </div>
              {is_score_hidden ? (
                <span>
                  {entry.sui_to_next > 0 ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 border border-gold/20 bg-gold/5 text-[9px] tracking-[0.1em] uppercase">
                      <span className="text-gold text-[7px]">&#9650;</span>
                      <span className="text-text/70">{entry.sui_to_next} SUI</span>
                    </span>
                  ) : entry.rank === 1 ? (
                    <span className="text-gold/40 text-[9px] tracking-[0.1em] uppercase">#1</span>
                  ) : (
                    <span className="text-muted/40 text-[9px]">&mdash;</span>
                  )}
                </span>
              ) : (
                <span className="text-gold font-semibold">{format_score(entry.score, category_key)}</span>
              )}
              <span className="text-muted text-[9px] text-right">
                {entry.player_uuid === player?.hytale_uuid ? t('leaderboard.you') : '\u2014'}
              </span>
            </div>
          ))}
        </div>
      )}
      {leaderboard && leaderboard.player_rank > 0 && !entries.some((e) => e.player_uuid === player?.hytale_uuid) && (
        <div className="leaderboard-row leaderboard-row-self text-[11px] mt-2">
          <span className="text-gold text-[10px]">{leaderboard.player_rank}</span>
          <span className="text-gold">{player?.hytale_username || t('leaderboard.you')}</span>
          {is_score_hidden ? (
            <span>
              {leaderboard.sui_to_next_rank > 0 ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 border border-gold/20 bg-gold/5 text-[9px] tracking-[0.1em] uppercase">
                  <span className="text-gold text-[7px]">&#9650;</span>
                  <span className="text-text/70">{leaderboard.sui_to_next_rank} SUI</span>
                </span>
              ) : (
                <span />
              )}
            </span>
          ) : (
            <span className="text-gold font-semibold">{format_score(leaderboard.player_score, category_key)}</span>
          )}
          <span className="text-muted text-[9px] text-right">{t('leaderboard.you')}</span>
        </div>
      )}
      {entries.length === 0 && !leaderboard_loading && (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <div className="text-muted text-[10px] tracking-[0.2em] uppercase">{t('leaderboard.no_data')}</div>
          {is_score_hidden ? (
            <div className="inline-flex items-center gap-1 px-2 py-0.5 border border-gold/20 bg-gold/5 text-[9px] tracking-[0.1em] uppercase">
              <span className="text-gold text-[7px]">&#9650;</span>
              <span className="text-text/70">1 SUI</span>
            </div>
          ) : (
            <div className="text-muted/50 text-[9px]">{t('leaderboard.rankings_appear')}</div>
          )}
        </div>
      )}
    </div>
  )
}
