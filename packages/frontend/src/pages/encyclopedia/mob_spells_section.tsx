// MOB SPELLS — the bestiary detail's spell-kit section: displays the mob spells like the
// other sections, hover shows the exact details. Mob spells are anonymous authored kits (no name/icon
// on-chain), so each row leads with its effect LINES — the shared EffectLine + seed_effect_parts grammar
// every other spell surface renders (one wording home, zero drift) — plus the localized AP cost; hovering
// a row opens the house Tooltip with the full on-chain facts (AP / range / cooldown / crit / line of
// sight) in the classes-tab chip idiom. Data = mob_spells.ts views over the same authored rows the
// template was minted from (world_corpus.ts CorpusMobFacts).
import { useTranslation } from 'react-i18next'

import { SectionDivider, SectionTitle } from '../../components/entity_display'
import { EffectLine } from '../../game/screens/hud/EffectLine.jsx'
import { seed_effect_parts } from '../../game/screens/hud/seed-effect-line.js'
import { Tooltip } from '../../game/screens/hud/Tooltip.jsx'

import type { MobSpellView } from './mob_spells'

type Translate = (key: string, options?: Record<string, unknown>) => string

function SpellFact({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="flex flex-col gap-0.5 px-2 py-1.5 border border-border"
      style={{ background: 'rgba(255,255,255,0.02)' }}
    >
      <span className="text-[7px] tracking-[0.15em] uppercase text-muted">{label}</span>
      <span className="text-[10px] font-semibold text-text">{value}</span>
    </div>
  )
}

/** The hover card: every on-chain SpellLevel fact + the full effect list. */
function MobSpellCard({ spell, index }: { spell: MobSpellView; index: number }) {
  const { t } = useTranslation()
  const translate = t as Translate
  return (
    <div className="flex flex-col gap-2 p-1 min-w-[240px] max-w-[300px]">
      <span className="text-[9px] tracking-[0.2em] uppercase text-gold">
        {translate('encyclopedia.spell_n', { n: index + 1 })}
      </span>
      <div className="grid grid-cols-2 gap-1">
        <SpellFact label={translate('encyclopedia.ap_cost')} value={String(spell.ap)} />
        <SpellFact label={translate('encyclopedia.range')} value={`${spell.range[0]}–${spell.range[1]}`} />
        <SpellFact
          label={translate('encyclopedia.cooldown')}
          value={
            spell.cooldown > 0
              ? translate('encyclopedia.turns_value', { n: spell.cooldown })
              : translate('encyclopedia.cooldown_none')
          }
        />
        <SpellFact
          label={translate('encyclopedia.crit_chance')}
          value={
            spell.crit_rate > 0
              ? translate('encyclopedia.crit_chance_value', { n: spell.crit_rate })
              : translate('encyclopedia.cooldown_none')
          }
        />
        <SpellFact
          label={translate('encyclopedia.line_of_sight')}
          value={translate(spell.line_of_sight ? 'encyclopedia.los_required' : 'encyclopedia.los_not_required')}
        />
      </div>
      <span className="text-[7px] tracking-[0.2em] uppercase text-muted">{translate('encyclopedia.effects')}</span>
      <div className="flex flex-col gap-1 pl-1.5" style={{ borderLeft: '2px solid var(--color-border)' }}>
        {spell.effects.map((effect, i) => (
          <EffectLine key={i} view={seed_effect_parts(translate as never, effect)} />
        ))}
      </div>
    </div>
  )
}

export function MobSpellsSection({ spells }: { spells: MobSpellView[] }) {
  const { t } = useTranslation()
  const translate = t as Translate
  if (spells.length === 0) return null
  return (
    <>
      <SectionDivider />
      <div className="flex flex-col gap-2">
        <SectionTitle title={translate('encyclopedia.mob_spells')} />
        {/* Each spell is a REAL card with the name and effects, not just "1 earth
            damage". Mirrors the fight HUD's SpellHoverTip idiom — a named header + AP pill over the effect
            lines — but rendered in the shared EffectLine grammar (game/screens/hud, the ONE effect-line home
            every spell surface uses). Hover still opens MobSpellCard for the full on-chain facts grid. */}
        <div className="flex flex-col gap-1.5">
          {spells.map((spell, index) => (
            <Tooltip key={index} content={<MobSpellCard spell={spell} index={index} />}>
              <div
                className="flex flex-col gap-1.5 px-2.5 py-2 border border-border"
                data-spell-card={index + 1}
                style={{ background: 'rgba(255,255,255,0.02)' }}
                onMouseEnter={(event) => {
                  event.currentTarget.style.background = 'rgba(200,150,60,0.08)'
                }}
                onMouseLeave={(event) => {
                  event.currentTarget.style.background = 'rgba(255,255,255,0.02)'
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] tracking-[0.2em] uppercase font-semibold text-gold">
                    {translate('encyclopedia.spell_n', { n: index + 1 })}
                  </span>
                  <span
                    className="text-[9px] font-semibold shrink-0 px-1.5 py-0.5 text-gold border border-gold/30"
                    style={{ background: 'rgba(200,150,60,0.08)' }}
                  >
                    {spell.ap} {translate('stat.action')}
                  </span>
                </div>
                {spell.effects.length > 0 && (
                  <div className="flex flex-col gap-1">
                    {spell.effects.map((effect, i) => (
                      <EffectLine key={i} view={seed_effect_parts(translate as never, effect)} />
                    ))}
                  </div>
                )}
              </div>
            </Tooltip>
          ))}
        </div>
      </div>
    </>
  )
}
