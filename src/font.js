export const Font = {
  BOSSBAR: 'aresrpg:bossbar',
  BOSSBAR_HEALTH_ASCII: 'aresrpg:bossbar_health_ascii',
  BOSSBAR_XP_ASCII: 'aresrpg:bossbar_xp_ascii',
  SPACE: 'space:default',
  DEFAULT: 'minecraft:default',
  EMOTES: 'aresrpg:emotes',
  KITS: 'aresrpg:kits',
}

export const Texture = {
  top_health: index => `${Font.BOSSBAR}:health:${index}`,
  top_xp: index => `${Font.BOSSBAR}:xp:${index}`,
  top_head_slot: `${Font.BOSSBAR}:head_slot`,
  top_pixel: index => `${Font.BOSSBAR}:pixel:${index}`,
}

export function cursor(offset) {
  return {
    translate: `space.${offset}`,
    font: Font.SPACE,
  }
}

export function component(font) {
  return (offset, texture, color) => ({
    ...cursor(offset),
    with: [{ font, translate: texture, ...(color && { color }) }],
  })
}
