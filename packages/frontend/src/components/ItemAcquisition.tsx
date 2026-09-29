// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Button } from '@aresrpg/ui'

import { encyclopedia_catalog, titleize } from '../content/catalog.ts'
import { item_icon, mob_icon } from '../content/assets.ts'
import { useText } from '../i18n/useText.ts'
import { useNumbers } from '../i18n/useNumbers.ts'

export const ItemAcquisition = ({
  item_type,
  select_item,
  select_mob,
  select_world,
}: Readonly<{
  item_type: string
  select_item: (id: string) => void
  select_mob?: (id: string) => void
  select_world?: (id: string) => void
}>) => {
  const text = useText()
  const numbers = useNumbers()
  const detail = encyclopedia_catalog.item(item_type)
  if (!detail) return null
  return (
    <div className="aui-item-sources">
      {detail.rune && <p>{text('encyclopedia_page.rune_obtained_by_crushing')}</p>}
      {detail.dropped_by.length > 0 && (
        <section data-item-drops="">
          <h3>{text('encyclopedia_page.dropped_by')}</h3>
          <div className="aui-item-source-list">
            {detail.dropped_by.map(({ mob, drop }) => {
              const Row = select_mob ? Button : 'div'
              return (
                <Row
                  className="aui-item-source-row"
                  key={mob.mob_type}
                  onClick={select_mob ? () => select_mob(mob.mob_type) : undefined}
                >
                  <img src={mob_icon(mob.mob_type) ?? undefined} alt="" />
                  <span>
                    <b>{mob.name}</b>
                    <small>{text('encyclopedia_page.level_range', { min: mob.level_min, max: mob.level_max })}</small>
                  </span>
                  <strong>
                    ~{numbers.decimal(drop.chance_bp / 100)}%
                    <small>
                      ×{drop.min_qty}
                      {drop.max_qty !== drop.min_qty && `–${drop.max_qty}`}
                    </small>
                  </strong>
                </Row>
              )
            })}
          </div>
        </section>
      )}
      {detail.worlds.length > 0 && (
        <section data-item-worlds="">
          <h3>{text('encyclopedia_page.found_in')}</h3>
          <div className="aui-item-source-list">
            {detail.worlds.map(({ world }) =>
              select_world ? (
                <Button key={world} onClick={() => select_world(world)}>
                  {titleize(world)}
                </Button>
              ) : (
                <span key={world}>{titleize(world)}</span>
              )
            )}
          </div>
        </section>
      )}
      {detail.ingredient_of.length > 0 && (
        <section data-item-recipes="">
          <h3>{text('encyclopedia_page.ingredient_of')}</h3>
          <div className="aui-item-source-list">
            {detail.ingredient_of.map(({ recipe, output }) => (
              <Button
                className="aui-item-source-row"
                key={recipe.output_type}
                onClick={() => select_item(recipe.output_type)}
              >
                <img src={item_icon(recipe.output_type) ?? undefined} alt="" />
                <span>
                  <b>{output?.name ?? titleize(recipe.output_type)}</b>
                </span>
                <strong>×{recipe.inputs[item_type]}</strong>
              </Button>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
