import { Actions, write_bossbar } from './boss_bar.js'
import { component, cursor, Font, Texture } from './font.js'

export const UI_BOSSBAR_UUID = '00000000-0bad-cafe-babe-000000000000'

export function display_top(client) {
  write_bossbar({
    client,
    entityUUID: UI_BOSSBAR_UUID,
    title: 'loading..',
  })
}

const CHARS_LENGTH = [
  { regex: /[0-9]/g, length: 5 },
  { regex: /[a-zA-Z]/g, length: 5 },
  { regex: /\//g, length: 5 },
  { regex: /\./g, length: 1 },
  { regex: / /g, length: 3 },
  { regex: /%/g, length: 5 },
  { regex: /[()]/g, length: 4 },
]

function compute_string_length(str) {
  return CHARS_LENGTH.reduce((count, { regex, length }) => {
    const matches = str.match(regex) || []
    return count + matches.length * length
  }, 0)
}

function make_pixel_matrix({ head_texture }) {
  const { length } = head_texture
  const transposed = head_texture[0].map((_, i) =>
    head_texture.map(row => row[i])
  )
  const texture = component(Font.BOSSBAR)

  return Array.from({ length }, (_, x) => [
    cursor(-5),
    ...Array.from({ length }, (_, y) =>
      texture(-6, Texture.top_pixel(y), transposed[x][y])
    ),
  ]).flat()
}

export function update_top(
  client,
  {
    top_left_ui_offset,
    health,
    max_health,
    health_perten,
    experience_of_level,
    experience_of_next_level,
    experience_percent,
    experience_perten,
    head_texture,
  }
) {
  const pixel_matrix = head_texture ? make_pixel_matrix({ head_texture }) : []
  const texture = component(Font.BOSSBAR)

  const health_text = `${health}/${max_health}`
  const experience_text = `${experience_of_level}/${experience_of_next_level} (${experience_percent}%)`

  const health_text_length = compute_string_length(health_text)
  const experience_text_length = compute_string_length(experience_text)

  write_bossbar({
    client,
    entityUUID: UI_BOSSBAR_UUID,
    action: Actions.UPDATE_TITLE,
    title: [
      texture(
        top_left_ui_offset + health_text_length + experience_text_length,
        Texture.top_health(health_perten)
      ),
      texture(-200, Texture.top_xp(experience_perten)),
      texture(-200, Texture.top_head_slot),
      cursor(-10),
      ...pixel_matrix,
      cursor(45),
      { font: Font.BOSSBAR_HEALTH_ASCII, text: health_text },
      cursor(-health_text_length - 7),
      {
        font: Font.BOSSBAR_XP_ASCII,
        text: experience_text,
      },
    ],
  })
}
