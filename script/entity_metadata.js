#!/usr/bin/env node

import fs from 'fs'

import cheerio from 'cheerio'
import fetch from 'node-fetch'

const Type = {
  Byte: 0,
  VarInt: 1,
  Integer: 1,
  Float: 2,
  String: 3,
  Chat: 4,
  OptChat: 5,
  Slot: 6,
  Boolean: 7,
  Rotation: 8,
  Position: 9,
  BlockPos: 9,
  OptPosition: 10,
  OptBlockPos: 10,
  Direction: 11,
  OptUUID: 12,
  'Opt BlockID': 13,
  NBT: 14,
  Particle: 15,
  'Villager Data': 16,
  OptVarInt: 17,
  Pose: 18,
}

const Renames = entity_name => ({
  0: `${entity_name}_flags`,
  'ignore_radius_and_show_effect_as_single_point,_not_area': 'ignore_radius',
  entity_id_of_entity_which_used_firework: 'owner_id',
  the_displayed_skin_parts_bit_mask_that_is_sent_in_client_settings:
    'skin_parts',
  'the_#particle': 'particle',
  'hooked_entity_id_+_1': 'hooked_entity_id',
})

function snake_case(e) {
  return e.replaceAll(' ', '_').toLowerCase()
}

const html = await fetch(
  'https://wiki.vg/index.php?title=Entity_metadata&oldid=16539'
).then(res => res.text())
const $ = cheerio.load(html)

function* flatten_bitflags(lines) {
  for (let i = 0; i < lines.length; i++) {
    const hasHeaders = $(lines[i]).children('th').length
    const hasHeadersAfter = $(lines[i + 1]).children('th').length
    const el = lines[i]
    if (hasHeaders) {
      const bitflags = []
      for (
        i += 1;
        i < lines.length && $(lines[i]).children().length === 2;
        i++
      ) {
        bitflags.push(lines[i])
      }
      i--
      yield { el, bitflags }
    } else if (hasHeadersAfter) {
      const bitflags = []
      for (
        i += 2;
        i < lines.length && $(lines[i]).children().length === 2;
        i++
      ) {
        bitflags.push(lines[i])
      }
      yield { el, bitflags }
    } else yield { el }
  }
}

const start = $('#Entity').parent()

const entities = Object.fromEntries(
  [start, ...start.nextAll('h3').toArray()].map(title => {
    const entity_name = snake_case($(title).text().trim())
    const desc = $(title).next('p').text().trim()
    const table1 = $(title).next('p').next('table')
    const table2 = $(title).next('p').next('p').next('table')
    const table = table1.length === 0 ? table2 : table1

    const parent = desc.startsWith('Extends')
      ? snake_case(desc.slice('Extends'.length + 1, -1))
      : undefined

    const values = Array.from(
      flatten_bitflags(table.find('tbody > tr').toArray().slice(1))
    )

    const metadata = Object.fromEntries(
      values.map(({ el, bitflags: raw_bitflags }) => {
        const values = $(el).children('td').toArray()
        const key = parseInt($(values[0]).text().trim(), 10)
        const type = $(values[1]).text().trim()
        const meaning = $(values[2]).text().trim()
        const meta_name = snake_case(meaning.split(/ \(|[.?:,]/, 1)[0])

        const bitflags =
          raw_bitflags &&
          Object.fromEntries(
            raw_bitflags
              .map(el =>
                $(el)
                  .children('td')
                  .toArray()
                  .map(td => $(td).text().trim())
              )
              .map(([value, name]) => [
                snake_case(name.split(/ \(|[.?:,]/, 1)[0]),
                Math.log2(parseInt(value, 16)),
              ])
          )

        const renames = Renames(entity_name)
        return [
          renames[meta_name] ?? meta_name,
          { key, type: Type[type], bitflags },
        ]
      })
    )

    return [entity_name, { parent, metadata }]
  })
)

fs.writeFileSync('src/entity_metadata.json', JSON.stringify(entities, null, 2))
