import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { RotateCcw, Download, Clock, Droplets, Target } from 'lucide-react'
import { ASSET_BASE, item_icon_url, spell_icon_url, walrus_asset_url } from '@aresrpg/sdk/jobs'

import { use_template_t } from '../i18n/template_t'
import { use_mobile_mode, long_press_drift_exceeded } from '../game/screens/hud/mobile_layout.js'
import { ItemSlot, ItemTooltipContent } from '../components/items'
import { SearchPickerModal, type PickerItem } from '../components/search_picker_modal'
import {
  RARITY_COLORS,
  STAT_COLORS,
  ELEMENT_COLORS,
  STAT_LABEL_KEYS,
  format_stat_name,
  stat_color_key,
} from '../components/entity_display'
import {
  CLASSES,
  EQUIPMENT_SLOTS,
  SLOT_CATEGORIES,
  BASE_STATS,
  ELEMENT_STAT_MAP,
  max_stats_from_template,
  compute_total_stats,
  compute_max_health,
  compute_max_stamina,
  compute_damage,
  compute_speed,
  compute_health_regen,
  compute_stamina_regen,
  compute_crit_denom,
  compute_stat_points,
  interpolate_levels,
  type ClassDef,
  type BaseStats,
  type DamageOutput,
} from '../constants/simulator'

import { SEED_CLASSES, seed_spells_for_class, load_seed_items } from './simulator_content'

interface SpellDamageInfo {
  spell_name: string
  spell_id: string
  element: string
  level: number
  cooldown: number
  stamina_cost: number
  aoe: number
  damage_output: DamageOutput[]
  heal_output: { element: string; min: number; max: number }[]
  buff_output: { stat: string; amount: number; duration: number }[]
}

interface SelectedItem {
  id: string
  name: string
  category: string
  rarity: string
  level: number
  appearance: string
  stats: Record<string, number>
  damages: { element: string; from: number; to: number; damage_type?: string }[]
  weaponClass?: string
}

function to_item_info(item: SelectedItem, slot: string): any {
  return {
    id: `sim_${slot}`,
    template_id: item.id,
    name: item.name,
    category: item.category,
    rarity: item.rarity,
    level: item.level,
    appearance: item.appearance,
    slot,
    quantity: 1,
    stats_json: JSON.stringify(item.stats),
    damages_json: JSON.stringify(item.damages),
    description: '',
    location: 'equipped',
  }
}

function section_label(text: string) {
  return (
    <span className="text-[9px] tracking-[0.25em] uppercase font-semibold" style={{ color: '#6b7280' }}>
      {text}
    </span>
  )
}

function render_build_image(opts: {
  cls: ClassDef
  level: number
  max_health: number
  max_stamina: number
  speed: number
  crit_denom: number
  health_regen: number
  stamina_regen: number
  stat_entries: [string, number][]
  damage_output: DamageOutput[]
  resistances: { element: string; value: number }[]
  equipment: Record<string, SelectedItem | null>
  used_points: number
  total_points: number
  spell_infos: SpellDamageInfo[]
}) {
  const DPI = 2
  const W = 480
  const PAD = 20
  const LINE = 16
  const GAP = 6
  // fonts at logical size — ctx.scale(DPI) handles retina
  const F = '11px JetBrains Mono, monospace'
  const F_SM = '9px JetBrains Mono, monospace'
  const F_XS = '8px JetBrains Mono, monospace'
  const F_TITLE = 'bold 13px JetBrains Mono, monospace'
  const F_SEC = 'bold 9px JetBrains Mono, monospace'
  const F_VAL = 'bold 12px JetBrains Mono, monospace'

  const equipped_items = Object.entries(opts.equipment)
    .filter(([, v]) => v !== null)
    .map(([slot, item]) => ({ slot, name: item!.name, rarity: item!.rarity }))

  // pre-calculate height
  let h = PAD
  h += 20 // header
  h += 14 // subtitle
  h += 10 // separator
  h += 12 + 4 * 28 + GAP // vitals section label + 4 rows
  if (opts.stat_entries.length > 0) h += 14 + opts.stat_entries.length * LINE + 8
  if (opts.damage_output.length > 0) h += 14 + opts.damage_output.length * (LINE + 1) + 8
  for (const si of opts.spell_infos) {
    h += 14 // spell name header
    h += 12 // meta line (cooldown/stamina)
    h += si.damage_output.length * (LINE + 1)
    h += si.heal_output.length * (LINE + 1)
    h += si.buff_output.filter((b) => b.stat).length * (LINE + 1)
    h += 8 // gap
  }
  if (opts.resistances.length > 0) h += 14 + opts.resistances.length * LINE + 8
  if (equipped_items.length > 0) h += 14 + equipped_items.length * LINE + 8
  h += 20 // footer
  h += PAD

  const canvas = document.createElement('canvas')
  canvas.width = W * DPI
  canvas.height = h * DPI
  const ctx = canvas.getContext('2d')!
  ctx.scale(DPI, DPI)

  // background
  const bg = ctx.createLinearGradient(0, 0, 0, h)
  bg.addColorStop(0, '#0c0c14')
  bg.addColorStop(1, '#08080e')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, h)

  // border
  ctx.strokeStyle = '#c8963c25'
  ctx.lineWidth = 1
  ctx.strokeRect(0.5, 0.5, W - 1, h - 1)

  let y = PAD

  // — header
  ctx.fillStyle = '#c8963c'
  ctx.font = F_TITLE
  ctx.letterSpacing = '3px'
  ctx.fillText(opts.cls.display.toUpperCase(), PAD, y + 11)
  ctx.letterSpacing = '0px'
  ctx.font = F_SM
  ctx.fillStyle = '#c8963c70'
  ctx.textAlign = 'right'
  ctx.letterSpacing = '1px'
  ctx.fillText(`LV ${opts.level}`, W - PAD, y + 11)
  ctx.letterSpacing = '0px'
  ctx.textAlign = 'left'
  y += 20

  // — subtitle
  ctx.font = F_XS
  ctx.fillStyle = '#555'
  ctx.letterSpacing = '1px'
  ctx.fillText(
    `${opts.cls.title.toUpperCase()}  ·  ${opts.cls.weapon}  ·  ${opts.used_points}/${opts.total_points} PTS`,
    PAD,
    y + 8
  )
  ctx.letterSpacing = '0px'
  y += 14

  // — separator
  const sep = ctx.createLinearGradient(PAD, 0, W - PAD, 0)
  sep.addColorStop(0, '#c8963c30')
  sep.addColorStop(0.5, '#c8963c15')
  sep.addColorStop(1, '#c8963c30')
  ctx.fillStyle = sep
  ctx.fillRect(PAD, y, W - PAD * 2, 0.5)
  y += 10

  // section helper
  const section = (label: string) => {
    ctx.fillStyle = '#c8963c50'
    ctx.font = F_SEC
    ctx.letterSpacing = '2px'
    ctx.fillText(label, PAD, y + 8)
    ctx.letterSpacing = '0px'
    y += 12
  }

  // — vitals (2 col grid)
  section('VITALS')
  const vitals = [
    { l: 'HP', v: opts.max_health.toLocaleString(), c: '#ff66b2' },
    { l: 'STA', v: String(opts.max_stamina), c: '#ffcc00' },
    { l: 'SPD', v: String(opts.speed), c: '#00cccc' },
    { l: 'CRIT', v: `1/${opts.crit_denom}`, c: '#ffee00' },
    { l: 'HP/S', v: String(opts.health_regen), c: '#ff66b2' },
    { l: 'STA/S', v: String(opts.stamina_regen), c: '#ffcc00' },
  ]
  const cw = (W - PAD * 2 - GAP) / 2
  for (let i = 0; i < vitals.length; i += 2) {
    for (let j = 0; j < 2 && i + j < vitals.length; j++) {
      const v = vitals[i + j]
      const x = PAD + j * (cw + GAP)
      ctx.fillStyle = '#ffffff03'
      ctx.fillRect(x, y, cw, 22)
      ctx.strokeStyle = '#1e1e2e'
      ctx.lineWidth = 0.5
      ctx.strokeRect(x, y, cw, 22)
      ctx.font = F_XS
      ctx.fillStyle = '#555'
      ctx.letterSpacing = '1px'
      ctx.fillText(v.l, x + 6, y + 9)
      ctx.letterSpacing = '0px'
      ctx.fillStyle = v.c
      ctx.font = F_VAL
      ctx.textAlign = 'right'
      ctx.fillText(v.v, x + cw - 6, y + 16)
      ctx.textAlign = 'left'
    }
    y += 28
  }
  y += GAP

  // — stats
  if (opts.stat_entries.length > 0) {
    section('STATS')
    for (let i = 0; i < opts.stat_entries.length; i++) {
      const [key, val] = opts.stat_entries[i]
      const color = STAT_COLORS[stat_color_key(key)] || '#e8e4dc'
      if (i % 2 === 1) {
        ctx.fillStyle = '#ffffff03'
        ctx.fillRect(PAD, y, W - PAD * 2, LINE)
      }
      ctx.font = F_SM
      ctx.fillStyle = color
      ctx.fillText(format_stat_name(key), PAD + 6, y + 11)
      ctx.textAlign = 'right'
      ctx.fillStyle = val < 0 ? '#FF5555' : color
      ctx.fillText(`${val >= 0 ? '+' : ''}${val}`, W - PAD - 6, y + 11)
      ctx.textAlign = 'left'
      y += LINE
    }
    y += 8
  }

  // — damage
  if (opts.damage_output.length > 0) {
    section('DAMAGE')
    for (const d of opts.damage_output) {
      const ec = ELEMENT_COLORS[d.element] || '#fff'
      const lb = d.damage_type === 'life_steal' ? 'heal' : 'dmg'
      ctx.fillStyle = '#ffffff03'
      ctx.fillRect(PAD, y, W - PAD * 2, LINE + 1)
      ctx.font = F_SM
      ctx.fillStyle = ec
      ctx.fillText(d.element.toUpperCase(), PAD + 6, y + 11)
      ctx.fillStyle = '#e8e4dc'
      ctx.fillText(`${d.min_normal}-${d.max_normal} ${lb}`, PAD + 50, y + 11)
      ctx.textAlign = 'right'
      ctx.fillStyle = '#ffee00'
      ctx.fillText(`crit ${d.crit_damage}`, W - PAD - 40, y + 11)
      ctx.fillStyle = '#555'
      ctx.fillText(`1/${d.crit_denom}`, W - PAD - 6, y + 11)
      ctx.textAlign = 'left'
      y += LINE + 1
    }
    y += 8
  }

  // — spell damage
  for (const si of opts.spell_infos) {
    const si_color = ELEMENT_COLORS[si.element] || '#c8963c'
    // spell name
    ctx.fillStyle = si_color
    ctx.font = F_SEC
    ctx.letterSpacing = '2px'
    ctx.fillText(si.spell_name.toUpperCase(), PAD, y + 8)
    ctx.letterSpacing = '0px'
    ctx.fillStyle = '#555'
    ctx.font = F_XS
    ctx.textAlign = 'right'
    ctx.fillText(`LV ${si.level}`, W - PAD, y + 8)
    ctx.textAlign = 'left'
    y += 14
    // meta
    ctx.font = F_XS
    ctx.fillStyle = '#444'
    ctx.fillText(
      `${si.cooldown}s CD  ·  ${si.stamina_cost} STA${si.aoe > 0 ? `  ·  ${si.aoe}m AOE` : ''}`,
      PAD + 6,
      y + 8
    )
    y += 12
    // damage lines
    for (const d of si.damage_output) {
      const ec = ELEMENT_COLORS[d.element] || '#fff'
      const lb = d.damage_type === 'life_steal' ? 'heal' : 'dmg'
      ctx.fillStyle = '#ffffff03'
      ctx.fillRect(PAD, y, W - PAD * 2, LINE + 1)
      ctx.font = F_SM
      ctx.fillStyle = ec
      ctx.fillText(d.element.toUpperCase(), PAD + 6, y + 11)
      ctx.fillStyle = '#e8e4dc'
      ctx.fillText(`${d.min_normal}-${d.max_normal} ${lb}`, PAD + 50, y + 11)
      ctx.textAlign = 'right'
      ctx.fillStyle = '#ffee00'
      ctx.fillText(`crit ${d.crit_damage}`, W - PAD - 40, y + 11)
      ctx.fillStyle = '#555'
      ctx.fillText(`1/${d.crit_denom}`, W - PAD - 6, y + 11)
      ctx.textAlign = 'left'
      y += LINE + 1
    }
    // heal lines
    for (const h of si.heal_output) {
      ctx.fillStyle = '#ffffff03'
      ctx.fillRect(PAD, y, W - PAD * 2, LINE + 1)
      ctx.font = F_SM
      ctx.fillStyle = '#22c55e'
      ctx.fillText(h.element.toUpperCase(), PAD + 6, y + 11)
      ctx.fillText(`${h.min}-${h.max} heal`, PAD + 50, y + 11)
      y += LINE + 1
    }
    // buff lines
    for (const b of si.buff_output.filter((b) => b.stat)) {
      ctx.fillStyle = '#ffffff03'
      ctx.fillRect(PAD, y, W - PAD * 2, LINE + 1)
      ctx.font = F_SM
      ctx.fillStyle = '#a78bfa'
      ctx.fillText('BUFF', PAD + 6, y + 11)
      ctx.fillStyle = '#e8e4dc'
      ctx.fillText(`+${b.amount} ${b.stat}${b.duration > 0 ? ` (${b.duration}s)` : ''}`, PAD + 50, y + 11)
      y += LINE + 1
    }
    y += 8
  }

  // — resistances
  if (opts.resistances.length > 0) {
    section('RESISTANCES')
    for (const r of opts.resistances) {
      const ec = ELEMENT_COLORS[r.element] || '#6b7280'
      ctx.font = F_SM
      ctx.fillStyle = ec
      ctx.fillText(r.element.toUpperCase(), PAD + 6, y + 11)
      ctx.textAlign = 'right'
      ctx.fillStyle = r.value < 0 ? '#f87171' : ec
      ctx.fillText(`${r.value > 0 ? '+' : ''}${r.value}%`, W - PAD - 6, y + 11)
      ctx.textAlign = 'left'
      y += LINE
    }
    y += 8
  }

  // — equipment list
  if (equipped_items.length > 0) {
    section('EQUIPMENT')
    for (const item of equipped_items) {
      const rc = RARITY_COLORS[item.rarity] || RARITY_COLORS.common
      ctx.font = F_XS
      ctx.fillStyle = '#444'
      ctx.letterSpacing = '1px'
      ctx.fillText(item.slot.replace(/\d+$/, ''), PAD + 6, y + 11)
      ctx.letterSpacing = '0px'
      ctx.font = F_SM
      ctx.fillStyle = rc
      ctx.textAlign = 'right'
      ctx.fillText(item.name, W - PAD - 6, y + 11)
      ctx.textAlign = 'left'
      y += LINE
    }
    y += 8
  }

  // — footer
  const sep2 = ctx.createLinearGradient(PAD, 0, W - PAD, 0)
  sep2.addColorStop(0, 'transparent')
  sep2.addColorStop(0.5, '#c8963c15')
  sep2.addColorStop(1, 'transparent')
  ctx.fillStyle = sep2
  ctx.fillRect(PAD, y, W - PAD * 2, 0.5)
  y += 10
  ctx.font = F_XS
  ctx.fillStyle = '#333'
  ctx.letterSpacing = '2px'
  ctx.fillText('ARESRPG BUILD SIMULATOR', PAD, y + 7)
  ctx.letterSpacing = '0px'
  ctx.textAlign = 'right'
  ctx.fillText('aresrpg.world', W - PAD, y + 7)
  ctx.textAlign = 'left'

  const link = document.createElement('a')
  link.download = `aresrpg-build-${opts.cls.id.toLowerCase()}-lv${opts.level}.png`
  link.href = canvas.toDataURL('image/png')
  link.click()
}

export function SimulatorPage() {
  const { t } = useTranslation()
  const tt = use_template_t()
  const mobile = use_mobile_mode()

  // Classes + spells come straight from the seeded content (@aresrpg/sdk). Items are the heavy
  // cast, so they load in their own async chunk (mirrors the simulator's original async item fetch).
  const class_list: any[] = SEED_CLASSES

  const [item_templates, set_item_templates] = useState<any[]>([])
  const [selected_class, set_selected_class] = useState<string>(class_list[0]?.id ?? '')
  const [level, set_level] = useState(200)
  const [equipment, set_equipment] = useState<Record<string, SelectedItem | null>>({})
  const [base_stats, set_base_stats] = useState<BaseStats>({
    vitality: 0,
    wisdom: 0,
    strength: 0,
    intelligence: 0,
    chance: 0,
    agility: 0,
  })
  const [picker_slot, set_picker_slot] = useState<string | null>(null)
  const [selected_spells, set_selected_spells] = useState<Record<string, number>>({})

  useEffect(() => {
    load_seed_items().then(set_item_templates)
  }, [])

  const class_tpl = class_list.find((c: any) => c.id === selected_class) || null
  // Map content fields to the ClassDef shape used by compute functions
  const cls: ClassDef = class_tpl
    ? {
        id: class_tpl.id,
        display: class_tpl.displayName || class_tpl.id,
        title: class_tpl.title || '',
        weapon: class_tpl.weaponCategory || '',
        health: Number(class_tpl.health || 50),
        stamina: Number(class_tpl.stamina || 80),
      }
    : CLASSES[0]
  const class_spells: any[] = selected_class ? seed_spells_for_class(selected_class) : []
  const equipment_stats = useMemo(
    () =>
      Object.values(equipment)
        .filter(Boolean)
        .map((item) => item!.stats),
    [equipment]
  )

  const all_damages = useMemo(
    () =>
      Object.values(equipment)
        .filter(Boolean)
        .flatMap((item) => item!.damages),
    [equipment]
  )

  const total_stats = useMemo(() => compute_total_stats(base_stats, equipment_stats), [base_stats, equipment_stats])
  const max_health = useMemo(
    () => compute_max_health(cls.health, level, total_stats.vitality || 0),
    [cls, level, total_stats]
  )
  const max_stamina = useMemo(() => compute_max_stamina(cls.stamina, total_stats.stamina || 0), [cls, total_stats])
  const damage_output = useMemo(() => compute_damage(all_damages, total_stats), [all_damages, total_stats])
  const speed = useMemo(() => compute_speed(total_stats.agility || 0, total_stats.speed || 0), [total_stats])
  const health_regen = useMemo(() => compute_health_regen(level, total_stats.wisdom || 0), [level, total_stats])
  const stamina_regen = useMemo(() => compute_stamina_regen(level), [level])
  const crit_denom = useMemo(() => compute_crit_denom(total_stats.criticalHit || 0), [total_stats])

  const spell_damage_infos = useMemo((): SpellDamageInfo[] => {
    return Object.entries(selected_spells)
      .map(([spell_id, spell_level]) => {
        const spell = class_spells.find((s: any) => s.id === spell_id)
        if (!spell) return null

        const all_levels = interpolate_levels(spell.levelsJson || '{}')
        const level_data = all_levels[String(spell_level)]
        if (!level_data) return null

        const damage_effects = (level_data.effects || []).filter(
          (e: any) => e.type === 'damage' || e.type === 'life_steal'
        )
        const heal_effects = (level_data.effects || []).filter((e: any) => e.type === 'heal')
        const buff_effects = (level_data.effects || []).filter((e: any) => e.type === 'add' || e.type === 'buff')

        const damages = damage_effects.map((e: any) => ({
          element: (e.element || spell.element || 'earth').toLowerCase(),
          from: e.damageMin || 0,
          to: e.damageMax || 0,
          damage_type: e.type === 'life_steal' ? 'life_steal' : 'damage',
        }))

        const heal_output = heal_effects.map((e: any) => ({
          element: (e.element || spell.element || 'earth').toLowerCase(),
          min: e.damageMin || 0,
          max: e.damageMax || 0,
        }))

        const buff_output = buff_effects.map((e: any) => ({
          stat: e.stat || '',
          amount: e.amount || 0,
          duration: e.duration || 0,
        }))

        return {
          spell_name: tt(spell, 'name'),
          spell_id: spell.id,
          element: (spell.element || 'earth').toLowerCase(),
          level: spell_level,
          cooldown: level_data.cooldown || 0,
          stamina_cost: level_data.stamina_cost || 0,
          aoe: level_data.aoe || 0,
          damage_output: compute_damage(damages, total_stats),
          heal_output,
          buff_output,
        }
      })
      .filter(Boolean) as SpellDamageInfo[]
  }, [selected_spells, class_spells, total_stats])

  const handle_class_change = (class_id: string) => {
    const current_weapon = equipment.WEAPON
    if (current_weapon && current_weapon.weaponClass && current_weapon.weaponClass !== class_id) {
      set_equipment((prev) => ({ ...prev, WEAPON: null }))
    }
    set_selected_class(class_id)
    set_selected_spells({})
  }

  const handle_level_change = (value: string) => {
    const num = parseInt(value)
    if (isNaN(num)) set_level(1)
    else set_level(Math.max(1, Math.min(200, num)))
  }

  const total_stat_points = compute_stat_points(level)
  const used_stat_points = useMemo(() => Object.values(base_stats).reduce((a, b) => a + b, 0), [base_stats])
  const remaining_stat_points = total_stat_points - used_stat_points

  const handle_stat_change = (stat: keyof BaseStats, value: string) => {
    const num = parseInt(value)
    const clamped = isNaN(num) ? 0 : Math.max(0, num)
    set_base_stats((prev) => {
      const other_total = Object.entries(prev)
        .filter(([k]) => k !== stat)
        .reduce((a, [, v]) => a + v, 0)
      const max_for_stat = total_stat_points - other_total
      return { ...prev, [stat]: Math.min(clamped, max_for_stat) }
    })
  }

  const handle_equip = (template_id: string) => {
    if (!picker_slot) return
    const tpl = item_templates.find((t: any) => t.id === template_id)
    if (!tpl) return
    const base_stats_map = max_stats_from_template(tpl.stats || {})
    if (tpl.category === 'PET' && tpl.petStatsJson) {
      try {
        const pet_stats = JSON.parse(tpl.petStatsJson)
        for (const [k, v] of Object.entries(pet_stats)) {
          if (typeof v === 'number' && v !== 0) {
            base_stats_map[k] = (base_stats_map[k] || 0) + v
          }
        }
      } catch {
        /* malformed petStatsJson ⇒ template contributes no pet stats */
      }
    }
    const selected: SelectedItem = {
      id: tpl.id,
      name: tt(tpl, 'name'),
      category: tpl.category,
      rarity: tpl.rarity || 'common',
      level: tpl.level || 0,
      appearance: tpl.appearance || '',
      stats: base_stats_map,
      damages: tpl.damages || [],
    }
    set_equipment((prev) => ({ ...prev, [picker_slot!]: selected }))
    set_picker_slot(null)
  }

  const handle_clear_slot = (slot: string) => {
    set_equipment((prev) => ({ ...prev, [slot]: null }))
  }

  // Touch equivalent for "right-click to clear" (MOBFIX defect #4 — right-click doesn't exist on touch).
  // A held touch on a filled slot clears it after LONG_PRESS_MS, tolerating small drift (drag-click gate
  // law: a real press drifts a few px) via the shared long_press_drift_exceeded helper. `long_press_fired`
  // swallows the click ItemSlot's onClick would otherwise fire on release, so a successful clear doesn't
  // also pop the item picker back open.
  const LONG_PRESS_MS = 500
  const press_timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const press_origin = useRef<{ x: number; y: number } | null>(null)
  const long_press_fired = useRef(false)

  const clear_press_timer = () => {
    if (press_timer.current) clearTimeout(press_timer.current)
    press_timer.current = null
  }

  const handle_slot_pointer_down = (slot: string, has_item: boolean) => (e: React.PointerEvent) => {
    // Every new gesture starts clean — guards against a fired-then-dragged-away press (rare: hold past
    // the threshold, then drag off-slot before lifting) leaking a stale swallow into the NEXT unrelated tap.
    long_press_fired.current = false
    if (e.pointerType !== 'touch' || !has_item) return
    press_origin.current = { x: e.clientX, y: e.clientY }
    clear_press_timer()
    press_timer.current = setTimeout(() => {
      long_press_fired.current = true
      handle_clear_slot(slot)
    }, LONG_PRESS_MS)
  }

  const handle_slot_pointer_move = (e: React.PointerEvent) => {
    if (press_origin.current && long_press_drift_exceeded(press_origin.current, { x: e.clientX, y: e.clientY }))
      clear_press_timer()
  }

  const handle_slot_pointer_end = () => {
    clear_press_timer()
    press_origin.current = null
  }

  const handle_spell_toggle = (spell_id: string) => {
    set_selected_spells((prev) => {
      if (spell_id in prev) {
        const { [spell_id]: _, ...rest } = prev
        return rest
      }
      return { ...prev, [spell_id]: 1 }
    })
  }

  const handle_spell_level = (spell_id: string, level: number) => {
    set_selected_spells((prev) => ({ ...prev, [spell_id]: level }))
  }

  const reset = () => {
    set_selected_class(class_list[0]?.id || '')
    set_level(200)
    set_equipment({})
    set_base_stats({ vitality: 0, wisdom: 0, strength: 0, intelligence: 0, chance: 0, agility: 0 })
    set_selected_spells({})
  }

  // build picker items for the current slot
  const picker_items = useMemo((): PickerItem[] => {
    if (!picker_slot) return []
    let allowed_categories = SLOT_CATEGORIES[picker_slot] || []
    // for weapon slot, restrict to the class's weapon category
    if (picker_slot === 'WEAPON' && cls.weapon) {
      allowed_categories = [cls.weapon]
    }
    return item_templates
      .filter((t: any) => allowed_categories.includes(t.category))
      .map((t: any): PickerItem => {
        let sublabel = `Lv.${t.level || 0}`
        if (picker_slot === 'PET' && t.petStatsJson) {
          try {
            const pet_stats = JSON.parse(t.petStatsJson)
            const entries = Object.entries(pet_stats).filter(([, v]) => typeof v === 'number' && v !== 0)
            if (entries.length > 0) {
              const summary = entries
                .map(([k, v]) => `+${v} ${t(STAT_LABEL_KEYS[k] ?? '', { defaultValue: format_stat_name(k) })}`)
                .join(', ')
              sublabel += ` · ${summary}`
            }
          } catch {
            /* malformed petStatsJson ⇒ sublabel just omits the stat summary */
          }
        }
        return {
          id: t.id,
          label: tt(t, 'name'),
          category: t.category,
          sublabel,
          color: RARITY_COLORS[t.rarity] || RARITY_COLORS.common,
          icon: t.appearance
            ? (walrus_asset_url('vanilla', `${t.appearance}.png`) ?? `${ASSET_BASE}/vanilla/${t.appearance}.png`)
            : (item_icon_url(t.id) ?? undefined),
        }
      })
  }, [picker_slot, item_templates, cls])

  const render_item_tooltip = useCallback(
    (id: string) => {
      const tpl = item_templates.find((t: any) => t.id === id)
      if (!tpl) return null
      const item_info = {
        id: `tooltip_${id}`,
        template_id: tpl.id,
        name: tt(tpl, 'name'),
        category: tpl.category,
        rarity: tpl.rarity || 'common',
        level: tpl.level || 0,
        appearance: tpl.appearance || '',
        slot: '',
        quantity: 1,
        stats_json: JSON.stringify(tpl.stats || {}),
        damages_json: JSON.stringify(tpl.damages || []),
        description: tt(tpl, 'description') || '',
        location: 'equipped',
        weapon_class: tpl.weaponClass || '',
        consumable_json: '',
      }
      return <ItemTooltipContent item={item_info as any} />
    },
    [item_templates]
  )

  const stat_entries = useMemo(() => Object.entries(total_stats).filter(([, v]) => v !== 0), [total_stats])

  const resistances = useMemo(() => {
    const keys = ['earthResistance', 'fireResistance', 'waterResistance', 'airResistance'] as const
    const elements = ['earth', 'fire', 'water', 'air'] as const
    return elements
      .map((el, i) => ({
        element: el,
        value: total_stats[keys[i]] || 0,
      }))
      .filter((r) => r.value !== 0)
  }, [total_stats])

  // One equipment slot — the simulator's own ItemSlot look (icon + rarity-tinted bg), KEPT verbatim.
  // Left-click opens the item picker; right-click clears a filled slot. Used by the paper-doll below.
  const SLOT_PX = 54
  const render_slot = (slot: string) => {
    const item = equipment[slot]
    return (
      <div
        key={slot}
        style={{ width: SLOT_PX, height: SLOT_PX }}
        onContextMenu={(e) => {
          if (!item) return
          e.preventDefault()
          handle_clear_slot(slot)
        }}
        onPointerDown={handle_slot_pointer_down(slot, !!item)}
        onPointerMove={handle_slot_pointer_move}
        onPointerUp={handle_slot_pointer_end}
        onPointerCancel={handle_slot_pointer_end}
        onPointerLeave={handle_slot_pointer_end}
      >
        <ItemSlot
          item={item ? to_item_info(item, slot) : null}
          slot={slot}
          size={SLOT_PX}
          on_click={() => {
            if (long_press_fired.current) {
              long_press_fired.current = false
              return
            }
            set_picker_slot(slot)
          }}
        />
      </div>
    )
  }

  return (
    // Mobile (P0 #94): stack the CONFIG + RESULTS columns so the fixed-320px results panel no
    // longer overflows a 390px phone. Desktop keeps the side-by-side row (lg:flex-row + the 320px panel).
    <div className="flex flex-col lg:flex-row gap-4 p-3 pt-3 lg:p-4 lg:pt-14 min-h-full">
      {/* LEFT: CONFIG */}
      <div className="flex-1 min-w-0 flex flex-col gap-5">
        {/* CLASS SELECTOR */}
        <div className="flex flex-col gap-2">
          {section_label(t('simulator.class'))}
          <div className="grid grid-cols-3 lg:grid-cols-4 gap-1.5">
            {class_list.map((c: any) => {
              const is_active = c.id === selected_class
              return (
                <button
                  key={c.id}
                  className="px-3 py-2 text-left transition-all cursor-pointer"
                  style={{
                    border: is_active ? '1px solid #c8963c' : '1px solid rgba(255,255,255,0.06)',
                    background: is_active ? 'rgba(200,150,60,0.08)' : 'rgba(255,255,255,0.02)',
                    boxShadow: is_active ? '0 0 12px rgba(200,150,60,0.15)' : 'none',
                  }}
                  onClick={() => handle_class_change(c.id)}
                  onMouseEnter={(e) => {
                    if (!is_active) {
                      ;(e.currentTarget as HTMLElement).style.borderColor = 'rgba(200,150,60,0.3)'
                      ;(e.currentTarget as HTMLElement).style.boxShadow = '0 0 8px rgba(200,150,60,0.08)'
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!is_active) {
                      ;(e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.06)'
                      ;(e.currentTarget as HTMLElement).style.boxShadow = 'none'
                    }
                  }}
                >
                  <div
                    className="text-[10px] tracking-[0.15em] uppercase"
                    style={{ color: is_active ? '#c8963c' : '#e8e4dc' }}
                  >
                    {c.displayName || c.id}
                  </div>
                  <div className="text-[8px] tracking-wide text-muted">{c.title}</div>
                </button>
              )
            })}
          </div>
        </div>

        {/* LEVEL */}
        <div className="flex flex-col gap-2">
          {section_label(t('simulator.level'))}
          <input
            type="number"
            className="template-input w-24"
            value={level}
            min={1}
            max={200}
            onChange={(e) => handle_level_change(e.target.value)}
          />
        </div>

        {/* EQUIPMENT */}
        <div className="flex flex-col gap-3">
          {section_label(t('simulator.equipment'))}
          {item_templates.length === 0 && (
            <span className="text-[9px] tracking-[0.2em] uppercase text-muted animate-pulse">
              {t('simulator.loading_templates')}
            </span>
          )}
          {/* Paper-doll — MIRRORS the Character inventory tab layout (game/screens/hud/Inventory.jsx:
              a 6-relic left rail + the 3-col anatomical body grid: title/hat/amulet, gauntlets/chestplate/
              weapon, rings/belt, pet/pants/boots). The simulator has no title slot, so its cell is a gap so
              the rest land in the SAME anatomical positions. Slots keep the simulator's own ItemSlot style. */}
          <div
            // MOBFIX defect #4: w-max hugs content everywhere, but on a full-width mobile CONFIG column
            // that left the frame's right third dead (nothing else shares this row on mobile — RESULTS
            // already stacks below the whole column, see the P0 #94 note above). Mobile spans the frame
            // full width and centres the slots in it, matching its CLASS/LEVEL siblings; lg: reverts to
            // the original content-hugging box.
            className="flex gap-2 items-start p-3 w-full justify-center lg:w-max lg:justify-start"
            style={{ border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.18)' }}
          >
            {/* relics rail */}
            <div className="grid gap-1.5" style={{ gridTemplateColumns: `${SLOT_PX}px` }}>
              {['RELIC1', 'RELIC2', 'RELIC3', 'RELIC4', 'RELIC5', 'RELIC6'].map(render_slot)}
            </div>
            {/* anatomical body grid (chestplate dead-centre, weapon on the right) */}
            <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(3, ${SLOT_PX}px)` }}>
              <div style={{ width: SLOT_PX, height: SLOT_PX }} aria-hidden="true" />
              {render_slot('HEAD')}
              {render_slot('AMULET')}
              {render_slot('HANDS')}
              {render_slot('CHEST')}
              {render_slot('WEAPON')}
              {render_slot('RING1')}
              {render_slot('BELT')}
              {render_slot('RING2')}
              {render_slot('PET')}
              {render_slot('LEGS')}
              {render_slot('FEET')}
            </div>
          </div>
          <span className="text-[8px] tracking-[0.15em] uppercase text-muted" style={{ opacity: 0.4 }}>
            {mobile
              ? t('simulator.equip_hint_touch', { defaultValue: 'Tap a slot to equip · long-press to clear' })
              : t('simulator.equip_hint', { defaultValue: 'Click a slot to equip · right-click to clear' })}
          </span>
        </div>

        {/* SPELLS */}
        <div className="flex flex-col gap-2">
          {section_label(t('simulator.spells', { defaultValue: 'SPELLS' }))}
          {class_spells.length === 0 && (
            <span className="text-[9px] tracking-[0.2em] uppercase text-muted" style={{ opacity: 0.5 }}>
              {t('simulator.no_spells', { defaultValue: 'No spells for this class' })}
            </span>
          )}
          {/* Compact grid of BIG spell cards (not a full-width list). Each card =
              the spell art + name, element-tinted, with a selected ring + an inline level slider when armed. */}
          <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))' }}>
            {class_spells.map((spell: any) => {
              const is_selected = spell.id in selected_spells
              const el_color = ELEMENT_COLORS[spell.element?.toLowerCase()] || '#c8963c'
              return (
                <div
                  key={spell.id}
                  className="flex flex-col transition-all"
                  style={{
                    border: is_selected ? `1px solid ${el_color}` : '1px solid rgba(255,255,255,0.06)',
                    background: is_selected ? `${el_color}10` : 'rgba(255,255,255,0.02)',
                    boxShadow: is_selected ? `0 0 12px ${el_color}25` : 'none',
                  }}
                  onMouseEnter={(e) => {
                    if (!is_selected) {
                      ;(e.currentTarget as HTMLElement).style.borderColor = `${el_color}50`
                      ;(e.currentTarget as HTMLElement).style.boxShadow = `0 0 8px ${el_color}15`
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!is_selected) {
                      ;(e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.06)'
                      ;(e.currentTarget as HTMLElement).style.boxShadow = 'none'
                    }
                  }}
                >
                  <button
                    className="flex flex-col items-center gap-1.5 p-2.5 transition-all cursor-pointer"
                    onClick={() => handle_spell_toggle(spell.id)}
                  >
                    <img
                      // spell art lives on the Walrus `spell` quilt — resolve through the SDK builder (walrus-
                      // first, host-free /assets/spells fallback) rather than a bare relative path.
                      src={spell_icon_url(spell.id) ?? undefined}
                      alt=""
                      className="w-12 h-12 object-contain"
                      style={{ imageRendering: 'pixelated', opacity: is_selected ? 1 : 0.6 }}
                      onError={(e) => {
                        ;(e.target as HTMLImageElement).style.display = 'none'
                      }}
                    />
                    <span
                      className="text-[9px] tracking-[0.08em] uppercase text-center leading-tight w-full truncate"
                      style={{ color: is_selected ? el_color : '#e8e4dc' }}
                    >
                      {tt(spell, 'name')}
                    </span>
                    <span className="text-[7px] tracking-[0.15em] uppercase" style={{ color: el_color, opacity: 0.6 }}>
                      {spell.element}
                    </span>
                  </button>
                  {is_selected && (
                    <div
                      className="flex items-center gap-1.5 px-2 pb-2"
                      style={{ borderTop: `1px solid ${el_color}20` }}
                    >
                      <span className="text-[7px] tracking-[0.1em] uppercase text-muted">Lv</span>
                      <input
                        type="range"
                        min={1}
                        max={10}
                        value={selected_spells[spell.id] || 1}
                        onChange={(e) => handle_spell_level(spell.id, parseInt(e.target.value))}
                        className="flex-1 h-1 accent-gold cursor-pointer"
                        style={{ accentColor: el_color }}
                      />
                      <span className="text-[9px] font-semibold w-3 text-right" style={{ color: el_color }}>
                        {selected_spells[spell.id] || 1}
                      </span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* BASE STATS */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            {section_label(t('simulator.base_stats'))}
            <span
              className="text-[9px] tracking-[0.15em] uppercase"
              style={{
                color: remaining_stat_points < 0 ? '#ef4444' : remaining_stat_points === 0 ? '#6b7280' : '#c8963c',
              }}
            >
              {used_stat_points} / {total_stat_points} pts
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {BASE_STATS.map((stat) => {
              const color = STAT_COLORS[stat_color_key(stat)] || '#e8e4dc'
              return (
                <div key={stat} className="flex flex-col gap-1">
                  <label className="text-[8px] tracking-[0.2em] uppercase font-semibold" style={{ color }}>
                    {t(STAT_LABEL_KEYS[stat] ?? '', { defaultValue: format_stat_name(stat) })}
                  </label>
                  <input
                    type="number"
                    className="template-input w-full"
                    value={base_stats[stat] || ''}
                    min={0}
                    placeholder="0"
                    onChange={(e) => handle_stat_change(stat, e.target.value)}
                  />
                </div>
              )
            })}
          </div>
        </div>

        {/* ACTIONS */}
        <div className="pt-2 flex gap-2">
          <button onClick={reset} className="btn-outline px-4 py-2 text-[9px] flex items-center gap-2 cursor-pointer">
            <RotateCcw size={10} className="opacity-60" />
            {t('simulator.reset_build')}
          </button>
          <button
            onClick={() =>
              render_build_image({
                cls,
                level,
                max_health,
                max_stamina,
                speed,
                crit_denom,
                health_regen,
                stamina_regen,
                stat_entries: stat_entries as [string, number][],
                damage_output,
                resistances,
                equipment,
                used_points: used_stat_points,
                total_points: total_stat_points,
                spell_infos: spell_damage_infos,
              })
            }
            className="btn-outline px-4 py-2 text-[9px] flex items-center gap-2 cursor-pointer"
          >
            <Download size={10} className="opacity-60" />
            {t('simulator.save_image')}
          </button>
        </div>
      </div>

      {/* RIGHT: RESULTS — full width on mobile (stacked), fixed 320px beside the config on desktop. */}
      <div className="flex flex-col gap-4 w-full lg:w-[320px] lg:min-w-[320px] lg:shrink-0">
        {/* VITALS */}
        <div className="flex flex-col gap-2">
          {section_label(t('simulator.vitals'))}
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: t('simulator.health'), value: max_health.toLocaleString(), color: '#ff66b2' },
              { label: t('simulator.stamina'), value: String(max_stamina), color: '#ffcc00' },
              { label: t('simulator.speed'), value: String(speed), color: '#00cccc' },
              { label: t('simulator.crit_chance'), value: `1/${crit_denom}`, color: '#ffee00' },
              { label: t('simulator.hp_regen'), value: String(health_regen), color: '#ff66b2' },
              { label: t('simulator.sta_regen'), value: String(stamina_regen), color: '#ffcc00' },
            ].map(({ label, value, color }) => (
              <div
                key={label}
                className="border border-border p-2.5 flex flex-col items-center gap-0.5"
                style={{ background: 'rgba(255,255,255,0.02)' }}
              >
                <span className="text-[8px] tracking-[0.2em] uppercase text-muted">{label}</span>
                <span className="text-[14px] font-semibold" style={{ color }}>
                  {value}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* STATS */}
        {stat_entries.length > 0 && (
          <div className="flex flex-col gap-2">
            {section_label(t('simulator.stats'))}
            <div className="flex flex-col">
              {stat_entries.map(([key, val], idx) => {
                const color = STAT_COLORS[stat_color_key(key)] || '#e8e4dc'
                const is_negative = val < 0
                const loot_bonus = key === 'chance' && val > 0 ? Math.min(100, (val / 700) * 100) : null
                return (
                  <div
                    key={key}
                    className="flex items-center justify-between px-2 py-1 text-[10px]"
                    style={{ background: idx % 2 === 1 ? 'rgba(255,255,255,0.03)' : 'transparent' }}
                  >
                    <span className="tracking-[0.1em] uppercase" style={{ color }}>
                      {t(STAT_LABEL_KEYS[key] ?? '', { defaultValue: format_stat_name(key) })}
                    </span>
                    <span>
                      <span style={{ color: is_negative ? '#FF5555' : color }}>
                        {is_negative ? '' : '+'}
                        {val}
                      </span>
                      {loot_bonus !== null && (
                        <span className="text-[8px] text-muted ml-1">({loot_bonus.toFixed(1)}%/100%)</span>
                      )}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* DAMAGE */}
        {damage_output.length > 0 && (
          <div className="flex flex-col gap-2">
            {section_label(t('simulator.damage'))}
            <div className="flex flex-col gap-1">
              {damage_output.map((d, i) => {
                const el_color = ELEMENT_COLORS[d.element] || '#ffffff'
                const label = d.damage_type === 'life_steal' ? 'HEAL' : 'DMG'
                return (
                  <div
                    key={i}
                    className="flex items-center gap-3 px-2 py-1.5 text-[10px]"
                    style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}
                  >
                    <span
                      className="text-[8px] tracking-[0.15em] uppercase w-10 shrink-0 font-semibold"
                      style={{ color: el_color }}
                    >
                      {d.element}
                    </span>
                    <span style={{ color: el_color }}>
                      {d.min_normal} - {d.max_normal}
                    </span>
                    <span className="text-muted text-[8px]">{label}</span>
                    <span className="ml-auto flex items-center gap-2">
                      <span className="text-[9px]" style={{ color: '#ffee00' }}>
                        crit: {d.crit_damage}
                      </span>
                      <span className="text-[8px] text-muted">1/{d.crit_denom}</span>
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* SPELL DAMAGE */}
        {spell_damage_infos.length > 0 && (
          <div className="flex flex-col gap-2">
            {section_label(t('simulator.spell_damage', { defaultValue: 'SPELL DAMAGE' }))}
            <div className="flex flex-col gap-3">
              {spell_damage_infos.map((info) => {
                const el_color = ELEMENT_COLORS[info.element] || '#c8963c'
                return (
                  <div key={info.spell_id} className="flex flex-col gap-1">
                    {/* spell header */}
                    <div
                      className="flex items-center justify-between px-2 py-1"
                      style={{ borderLeft: `2px solid ${el_color}` }}
                    >
                      <span
                        className="text-[10px] tracking-[0.15em] uppercase font-semibold"
                        style={{ color: el_color }}
                      >
                        {info.spell_name}
                      </span>
                      <span className="text-[8px] tracking-[0.1em] uppercase text-muted">LV {info.level}</span>
                    </div>
                    {/* spell meta */}
                    <div className="flex items-center gap-3 px-2 text-[8px] tracking-[0.1em] uppercase text-muted">
                      <span className="flex items-center gap-1">
                        <Clock size={8} className="opacity-40" />
                        {info.cooldown}s
                      </span>
                      <span className="flex items-center gap-1">
                        <Droplets size={8} className="opacity-40" />
                        {info.stamina_cost} sta
                      </span>
                      {info.aoe > 0 && (
                        <span className="flex items-center gap-1">
                          <Target size={8} className="opacity-40" />
                          {info.aoe}m
                        </span>
                      )}
                    </div>
                    {/* damage lines */}
                    {info.damage_output.map((d, i) => {
                      const d_color = ELEMENT_COLORS[d.element] || '#ffffff'
                      const label = d.damage_type === 'life_steal' ? 'HEAL' : 'DMG'
                      return (
                        <div
                          key={i}
                          className="flex items-center gap-3 px-2 py-1.5 text-[10px]"
                          style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}
                        >
                          <span
                            className="text-[8px] tracking-[0.15em] uppercase w-10 shrink-0 font-semibold"
                            style={{ color: d_color }}
                          >
                            {d.element}
                          </span>
                          <span style={{ color: d_color }}>
                            {d.min_normal} - {d.max_normal}
                          </span>
                          <span className="text-muted text-[8px]">{label}</span>
                          <span className="ml-auto flex items-center gap-2">
                            <span className="text-[9px]" style={{ color: '#ffee00' }}>
                              crit: {d.crit_damage}
                            </span>
                            <span className="text-[8px] text-muted">1/{d.crit_denom}</span>
                          </span>
                        </div>
                      )
                    })}
                    {/* heal lines */}
                    {info.heal_output.map((h, i) => (
                      <div
                        key={`heal_${i}`}
                        className="flex items-center gap-3 px-2 py-1.5 text-[10px]"
                        style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}
                      >
                        <span
                          className="text-[8px] tracking-[0.15em] uppercase w-10 shrink-0 font-semibold"
                          style={{ color: '#22c55e' }}
                        >
                          {h.element}
                        </span>
                        <span style={{ color: '#22c55e' }}>
                          {h.min} - {h.max}
                        </span>
                        <span className="text-muted text-[8px]">HEAL</span>
                      </div>
                    ))}
                    {/* buff lines */}
                    {info.buff_output
                      .filter((b) => b.stat)
                      .map((b, i) => (
                        <div
                          key={`buff_${i}`}
                          className="flex items-center gap-3 px-2 py-1.5 text-[10px]"
                          style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}
                        >
                          <span
                            className="text-[8px] tracking-[0.15em] uppercase w-10 shrink-0 font-semibold"
                            style={{ color: '#a78bfa' }}
                          >
                            BUFF
                          </span>
                          <span style={{ color: '#a78bfa' }}>
                            +{b.amount} {t(STAT_LABEL_KEYS[b.stat] ?? '', { defaultValue: format_stat_name(b.stat) })}
                          </span>
                          {b.duration > 0 && <span className="text-muted text-[8px]">{b.duration}s</span>}
                        </div>
                      ))}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* RESISTANCES */}
        {resistances.length > 0 && (
          <div className="flex flex-col gap-2">
            {section_label(t('simulator.resistances'))}
            <div className="flex flex-col gap-1">
              {resistances.map(({ element, value }) => {
                const el_color = ELEMENT_COLORS[element] || '#6b7280'
                const display_color = value < 0 ? '#f87171' : el_color
                return (
                  <div key={element} className="flex items-center justify-between px-2 py-1 text-[10px]">
                    <span className="tracking-[0.1em] uppercase" style={{ color: el_color }}>
                      {element}
                    </span>
                    <span style={{ color: display_color }}>
                      {value > 0 ? '+' : ''}
                      {value}%
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* BUILD SUMMARY */}
        <div className="flex flex-col gap-1 mt-auto pt-4">
          <div className="w-full h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />
          <div className="flex items-center justify-between px-1 pt-2">
            <span className="text-[8px] tracking-[0.2em] uppercase text-muted">{t('simulator.class')}</span>
            <span className="text-[9px] tracking-[0.15em] uppercase text-gold">{cls.display}</span>
          </div>
          <div className="flex items-center justify-between px-1">
            <span className="text-[8px] tracking-[0.2em] uppercase text-muted">{t('simulator.level')}</span>
            <span className="text-[9px] tracking-[0.15em] uppercase text-text">{level}</span>
          </div>
          <div className="flex items-center justify-between px-1">
            <span className="text-[8px] tracking-[0.2em] uppercase text-muted">{t('simulator.items')}</span>
            <span className="text-[9px] tracking-[0.15em] uppercase text-text">
              {Object.values(equipment).filter(Boolean).length} / {EQUIPMENT_SLOTS.length}
            </span>
          </div>
          <div className="flex items-center justify-between px-1">
            <span className="text-[8px] tracking-[0.2em] uppercase text-muted">{t('simulator.weapon_type')}</span>
            <span className="text-[9px] tracking-[0.15em] uppercase text-text">{cls.weapon}</span>
          </div>
          <div className="flex items-center justify-between px-1">
            <span className="text-[8px] tracking-[0.2em] uppercase text-muted">
              {t('simulator.spells', { defaultValue: 'Spells' })}
            </span>
            <span className="text-[9px] tracking-[0.15em] uppercase text-text">
              {Object.keys(selected_spells).length}
            </span>
          </div>
        </div>
      </div>

      {/* PICKER MODAL */}
      {picker_slot && (
        <SearchPickerModal
          title={`${picker_slot.replace(/\d+$/, '')} EQUIPMENT`}
          items={picker_items}
          value={equipment[picker_slot]?.id}
          on_select={handle_equip}
          on_close={() => set_picker_slot(null)}
          render_tooltip={render_item_tooltip}
        />
      )}
    </div>
  )
}
