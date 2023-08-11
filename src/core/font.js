function with_translate(font) {
  return translate => ({
    font,
    translate: `${font}:${translate}`,
  })
}

function with_text(font, base_options = {}) {
  return (text, color, options) => ({
    font,
    text,
    ...(color && { color }),
    ...base_options,
    ...options,
  })
}

function no_italic(component) {
  return {
    ...component,
    italic: false,
    color: '#ffffff',
  }
}

function tooltip_component(position) {
  return type =>
    no_italic(with_translate('aresrpg:item_tooltip')(`${position}:${type}`))
}

export const Font = {
  EMOTES: with_translate('aresrpg:emotes'),
  CHAT: {
    item_prefix: with_translate('aresrpg:chat')('item:prefix'),
  },
  ITEM: {
    tooltip_top: tooltip_component('top'),
    tooltip_middle: tooltip_component('middle'),
    tooltip_bottom: tooltip_component('bottom'),
    type_icon: type =>
      no_italic(with_translate('aresrpg:item_type_icon')(type)),
    stat_icon: stat =>
      no_italic(with_translate('aresrpg:item_stat_icon')(stat)),
  },
  ITEM_ASCII: with_text('aresrpg:item_ascii', { italic: false }),
  ITEM_LEVEL_ASCII: with_text('aresrpg:item_level_ascii'),
  GROUP: {
    header: with_translate('aresrpg:group_header')('background'),
    group: (index, value) => ({
      font: `aresrpg:group_${index}`,
      translate: `aresrpg:group:${value}`,
    }),
  },
  HOTBAR: {
    experience: (value, part) =>
      with_translate('aresrpg:hotbar')(`${value}:${part}`),
    spell_select: (value, part) =>
      with_translate('aresrpg:spell_selected')(`${value}:${part}`),
    spell_load: (index, value, part) => ({
      font: `aresrpg:spell_load_${index}`,
      translate: `aresrpg:spell_load:${value}:${part}`,
    }),
    spell_icon: (classe, value, part) => ({
      font: `aresrpg:spell_icon_${classe}`,
      translate: `aresrpg:spell_icon_${classe}:${value}:${part}`,
    }),
  },
  KITS: with_translate('aresrpg:kits'),
  PLAYER_HEALTH_ASCII: with_text('aresrpg:player_health_ascii'),
  PLAYER_HEALTH_PIXEL: with_translate('aresrpg:player_health_pixel'),
  PLAYER: {
    health: (value, part) =>
      with_translate('aresrpg:player_health')(`${value}:${part}`),
    soul: (value, part) =>
      with_translate('aresrpg:player_soul')(`${value}:${part}`),
  },
  PLAYER_SOUL_ASCII: with_text('aresrpg:player_soul_ascii'),
  HOTBAR_XP_ASCII: with_text('aresrpg:hotbar_xp_ascii'),
  SPACE: {
    cursor: offset => ({
      font: 'space:default',
      translate: `space.${Math.round(offset)}`,
    }),
    negative_max: {
      font: 'space:default',
      translate: `space.-max`,
    },
    center: (offset, component) => ({
      font: 'space:default',
      translate: `offset.${Math.round(offset)}`,
      with: [component],
    }),
  },
  DEFAULT: with_text('minecraft:default'),
}
