import fs from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

import { DOMParser } from 'xmldom'

import run from '../behavior.js'
import Entities from '../../data/entities.json' assert { type: 'json' }

export const trees = Object.fromEntries(
  Object.keys(Entities).map(type => {
    const tree = new DOMParser().parseFromString(
      fs.readFileSync(
        join(
          dirname(fileURLToPath(import.meta.url)),
          'behavior',
          `${type}.xml`,
        ),
        'utf8',
      ),
      'text/xml',
    )

    return [type, tree]
  }),
)

export default {
  /** @type {import('../mobs').MobsReducer} */
  async reduce_mob(state, action, context) {
    if (state.health > 0) {
      const tree = trees[context.type /* ares mob type */]
      const { state: next_state } = await run(tree.documentElement, state, {
        path: 'tree',
        action,
        ...context,
      })

      return next_state
    } else return state
  },
}
