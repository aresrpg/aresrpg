import { Actions, write_bossbar } from './boss_bar.js'
import { level_progression } from './experience.js'
import { Font } from './font.js'
import { map_range } from './math.js'
import { write_action_bar } from './title.js'

export const UI_PLAYER_UUID = '00000000-0bad-cafe-babe-000000000000'

const STEVE_HEAD = [
  [
    '#2f200d',
    '#2b1e0d',
    '#2f1f0f',
    '#281c0b',
    '#241808',
    '#261a0a',
    '#2b1e0d',
    '#2a1d0d',
  ],
  [
    '#2b1e0d',
    '#2b1e0d',
    '#2b1e0d',
    '#332411',
    '#422a12',
    '#3f2a15',
    '#2c1e0e',
    '#281c0b',
  ],
  [
    '#2b1e0d',
    '#b6896c',
    '#bd8e72',
    '#c69680',
    '#bd8b72',
    '#bd8e74',
    '#ac765a',
    '#342512',
  ],
  [
    '#aa7d67',
    '#b4846d',
    '#aa7d66',
    '#ad806d',
    '#9c725c',
    '#bb8972',
    '#9c694c',
    '#9c694c',
  ],
  [
    '#b4846d',
    '#ffffff',
    '#523d89',
    '#b57b67',
    '#bb8972',
    '#523d89',
    '#ffffff',
    '#aa7d66',
  ],
  [
    '#9c6346',
    '#b37b62',
    '#b78272',
    '#6a4030',
    '#6a4030',
    '#be886c',
    '#a26a47',
    '#805334',
  ],
  [
    '#905e43',
    '#965f40',
    '#40200a',
    '#874a3a',
    '#874a3a',
    '#40200a',
    '#8f5e3e',
    '#815339',
  ],
  [
    '#6f452c',
    '#6d432b',
    '#40200a',
    '#40200a',
    '#40200a',
    '#40200a',
    '#83553b',
    '#7a4e33',
  ],
]

const CHARS_LENGTH = [
  { regex: /[0-9]/g, length: 5 },
  { regex: /[a-zA-Z]/g, length: 5 },
  { regex: /\//g, length: 5 },
  { regex: /\./g, length: 1 },
  { regex: / /g, length: 4 },
  { regex: /-/g, length: 5 },
  { regex: /%/g, length: 5 },
  { regex: /[()]/g, length: 4 },
]

export function compute_string_length(str, factor = 1) {
  if (!str) return 0

  return Math.round(
    CHARS_LENGTH.reduce((count, { regex, length }) => {
      const matches = str.match(regex) || []
      return count + matches.length * length
    }, 0) * factor,
  )
}

function make_pixel_matrix({ head_texture }) {
  const { length } = head_texture
  const transposed = head_texture[0].map((_, i) =>
    head_texture.map(row => row[i]),
  )

  return Array.from({ length }, (_, x) => [
    Font.SPACE.cursor(-5),
    ...Array.from({ length }, (_, y) => [
      Font.SPACE.cursor(-6),
      {
        ...Font.PLAYER_HEALTH_PIXEL(y),
        color: transposed[x][y],
      },
    ]),
  ]).flat(Infinity)
}

const HOTBAR_PART_WIDTH = 1024 / 4 // 4 parts
const HOTBAR_HEIGHT = 100
const HOTBAR_FONT_HEIGHT = 55
const HOTBAR_REDUCTION_FACTOR = HOTBAR_HEIGHT / HOTBAR_FONT_HEIGHT
const HOTBAR_PART_FONT_WIDTH = HOTBAR_PART_WIDTH / HOTBAR_REDUCTION_FACTOR - 3 // 3 is the negative space to fill gaps

const BASE_ASCII_HEIGHT = 8
const XP_ASCII_HEIGHT = 7

const BEGINNING_OFFSET = -508

export default function UI(client) {
  return {
    // display the action bar UI with XP and spells
    display_hotbar({ experience, selected_spell, spells }) {
      const {
        experience_of_level,
        experience_of_next_level,
        experience_percent,
      } = level_progression(experience)

      const experience_perten = Math.round(experience_percent / 10)
      const experience_text = `${experience_of_level}/${experience_of_next_level} (${experience_percent}%)`

      const experience_ascii_reduction_factor =
        XP_ASCII_HEIGHT / BASE_ASCII_HEIGHT

      const experience_text_length = compute_string_length(
        experience_text,
        experience_ascii_reduction_factor,
      )

      // the hotbar textures need to be splitted in 4
      const hotbar_component = Array.from({ length: 4 }, (_, index) => [
        Font.HOTBAR.experience(experience_perten, index),
        Font.SPACE.cursor(-3),
      ]).flat()

      const select_spell_component = Array.from({ length: 4 }, (_, index) => [
        Font.HOTBAR.spell_select(selected_spell, index),
        Font.SPACE.cursor(-3),
      ]).flat()

      const get_reloading_index = ({ couldown = 0, cast_time = 0 } = {}) => {
        if (couldown) {
          const elapsed = Date.now() - cast_time
          const remaining = Math.min(couldown, Math.max(0, couldown - elapsed))
          return Math.round(
            map_range(
              remaining,
              {
                min: 0,
                max: couldown,
              },
              { min: 0, max: 4 /* highest reloading state texture */ },
            ),
          )
        }
        return 4 // return the last reloading state (spell will appear closed)
      }

      const spell_icon_component = spell_index => {
        return Array.from({ length: 4 }, (_, index) => [
          Font.HOTBAR.spell_icon('barbarian', spell_index, index),
          Font.SPACE.cursor(-3),
        ]).flat()
      }

      const spell_load_component = (spell, spell_index) => {
        const reloading_index = get_reloading_index(spell)
        return Array.from({ length: 4 }, (_, index) => [
          Font.HOTBAR.spell_load(spell_index, reloading_index, index),
          Font.SPACE.cursor(-3),
        ]).flat()
      }

      const initial_offset = [
        BEGINNING_OFFSET,
        experience_text_length * 1.1,
      ].reduce((a, b) => a + b, 0)

      write_action_bar({
        client,
        text: [
          Font.SPACE.cursor(initial_offset),
          ...hotbar_component,
          // adding spell icons by filtering out unexisting spells
          ...spells
            .filter(Boolean)
            .flatMap((spell, index) => [
              Font.SPACE.cursor(-HOTBAR_PART_FONT_WIDTH * 4 - 5),
              ...spell_icon_component(index),
            ]),
          // adding spell loading animation for all 8 slots
          ...spells.flatMap((spell, index) => [
            Font.SPACE.cursor(-HOTBAR_PART_FONT_WIDTH * 4 - 5),
            ...spell_load_component(spell, index + 1),
          ]),
          Font.SPACE.cursor(-HOTBAR_PART_FONT_WIDTH * 4 - 5),
          ...select_spell_component,
          Font.SPACE.cursor(-512),
          Font.HOTBAR_XP_ASCII(experience_text, '#BDC3C7'),
        ],
      })
    },
    // initialize the top left health bar
    create_health_profile() {
      write_bossbar({
        client,
        entityUUID: UI_PLAYER_UUID,
        title: 'loading..',
      })
    },
    // update the top left healthbar
    display_health_profile({
      top_left_ui_offset,
      health,
      max_health,
      soul,
      head_texture,
    }) {
      const health_percent = (100 * health) / max_health
      const health_perten = Math.round(health_percent / 10)
      const soul_perten = Math.round(soul / 10)
      const final_head_texture = head_texture ?? STEVE_HEAD

      const health_text = `${health}/${max_health}`
      const soul_text = `${soul}%`

      const health_text_length = compute_string_length(health_text)
      const soul_text_length = compute_string_length(soul_text)

      const health_bar_value = health === 0 ? 'dead' : health_perten
      const health_bar_component = [
        Font.PLAYER.health(health_bar_value, 0),
        Font.SPACE.cursor(-3),
        Font.PLAYER.health(health_bar_value, 1),
      ]
      const soul_component = [
        Font.PLAYER.soul(soul_perten, 0),
        Font.SPACE.cursor(-3),
        Font.PLAYER.soul(soul_perten, 1),
      ]

      write_bossbar({
        client,
        entityUUID: UI_PLAYER_UUID,
        action: Actions.UPDATE_TITLE,
        title: [
          Font.SPACE.cursor(
            top_left_ui_offset + (health_text_length + soul_text_length) / 2,
          ),
          ...make_pixel_matrix({ head_texture: final_head_texture }),
          Font.SPACE.cursor(-10),
          ...health_bar_component,
          Font.SPACE.cursor(-218),
          ...soul_component,
          Font.SPACE.cursor(-210),
          {
            ...Font.PLAYER_HEALTH_ASCII(health_text),
            color: '#BDC3C7',
          },
          Font.SPACE.cursor(-health_text_length - 6),
          {
            ...Font.PLAYER_SOUL_ASCII(soul_text),
            color: '#9B59B6',
          },
        ],
      })
    },

    remove_health_profile() {
      write_bossbar({
        client,
        entityUUID: UI_PLAYER_UUID,
        action: Actions.REMOVE,
      })
    },
  }
}
