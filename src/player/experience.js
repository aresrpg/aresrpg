import { on } from 'events'

import { aiter } from 'iterator-helper'

const levels = [
  0, // levels starts at 1
  0,
  121,
  715,
  1650,
  3080,
  5280,
  8030,
  11550,
  15950,
  21120,
  27720,
  35860,
  45100,
  55550,
  67100,
  82500,
  100100,
  126500,
  156200,
  188100,
  222200,
  258500,
  297000,
  341000,
  388300,
  438350,
  492800,
  553300,
  617100,
  683760,
  755700,
  830500,
  911900,
  1001000,
  1100000,
  1219000,
  1358000,
  1517000,
  1696000,
  1895000,
  2114000,
  2353000,
  2612000,
  2891000,
  3190000,
  3509000,
  3848000,
  4207000,
  4586000,
  4985000,
  5404000,
  5843000,
  6302000,
  6781000,
  7280000,
  7799000,
  8338000,
  8897000,
  9476000,
  10075000,
  10694000,
  11333000,
  11992000,
  12671000,
  13370000,
  14089000,
  14828000,
  15587000,
  16366000,
  17165000,
  17984000,
  18823000,
  19682000,
  20561000,
  21460000,
  22379000,
  23318000,
  24277000,
  25256000,
  26255000,
  27274000,
  28313000,
  29372000,
  30451000,
  31550000,
  32669000,
  33808000,
  34967000,
  36146000,
  37345000,
  38564000,
  39803000,
  41062000,
  42341000,
  43640000,
  44959000,
  46298000,
  47657000,
  49036000,
  50435000,
]

const reversed_levels = [...levels.entries()].reverse()

/**
 * find the current level and the remaining
 * experience from the total experience
 * @param {number} total_experience
 * @returns {{level: number, remaining_experience: number}}
 */
export function experience_to_level(total_experience) {
  const [current_level, current_level_experience] = reversed_levels.find(
    ([level, level_experience]) => level_experience <= total_experience
  )
  return {
    level: current_level,
    remaining_experience: total_experience - current_level_experience,
  }
}

/**
 * calculate the level progression from the
 * current level and the remaining experience
 * @param {{level: number, remaining_experience: number}} level_data
 */
export function level_progress({ level, remaining_experience }) {
  const current_level_experience = levels[level]
  if (level + 1 >= levels.length) {
    return 0
  }
  const next_level_experience = levels[level + 1]
  return (
    remaining_experience / (next_level_experience - current_level_experience)
  )
}

export default {
  /** @type {import('../index.js').Observer} */
  observe({ client, events }) {
    aiter(on(events, 'state')).reduce(
      (last_total_experience, [{ experience: total_experience }]) => {
        if (last_total_experience !== total_experience) {
          const { level, remaining_experience } =
            experience_to_level(total_experience)
          const progress = level_progress({ level, remaining_experience })

          client.write('experience', {
            totalExperience: total_experience,
            level,
            experienceBar: progress,
          })
        }
        return total_experience
      },
      null
    )
  },
}
