import Animations from '../player/spells/animations.json' assert { type: 'json' }
import { Action } from '../events.js'
import { client_chat_msg, Formats } from '../chat.js'

import { write_error } from './commands.js'
import { literal} from './declare_options.js'


const CATEGORIES = {
  SWEEP: "sweep_attack"
}

export const nodes = [
  literal({
    value: 'cosmetic',
    children: [
      ...Object.keys(CATEGORIES).map(key =>
        literal({
          value: key.toLowerCase(),
          children: [
            ...Object.keys(Animations[CATEGORIES[key]]).map(key =>
              literal({
                value: key,
              }),
            )
          ],
        }),
      )
    ],
  }),
]

export default function cosmetic({ sender, dispatch, args }) {
  if (args.length === 2) {
    const [category, effect] = args
    if (category !== undefined && effect !== undefined) {
      dispatch(Action.COSMETIC, { category: CATEGORIES[category.toUpperCase()], effect })
      client_chat_msg({
        client: sender,
        message: [
          { text: 'cosmetic updated: ', ...Formats.BASE },
          { text: Animations[CATEGORIES[category.toUpperCase()]][effect].name, ...Formats.SUCCESS },
        ],
      })
      return
    }
  }
  write_error({ sender })
}
