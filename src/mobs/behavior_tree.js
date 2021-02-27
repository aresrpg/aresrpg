import fs from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

import { DOMParser } from 'xmldom'

import run from '../behavior.js'

import { Types } from './types.js'

export const trees = Object.fromEntries(
  Object.keys(Types).map((id) => {
    const tree = new DOMParser().parseFromString(
      fs.readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), 'behavior', `${id}.xml`),
        'utf8'
      ),
      'text/xml'
    )

    return [id, tree]
  })
)

export default {
  async reduce_mob(state, action, context) {
    const tree = trees[context.mob]
    const { state: next_state } = await run(tree.documentElement, state, {
      path: 'tree',
      action,
      ...context,
    })

    return next_state
  },
}
