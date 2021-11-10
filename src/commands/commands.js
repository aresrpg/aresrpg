import { Position } from '../chat.js'

import gamemode from './gamemode.js'
import dislike from './dislike.js'
import fragile from './fragile.js'
import jerry from './jerry.js'
import like from './like.js'
import osef from './osef.js'
import ragequit from './ragequit.js'
import respect from './respect.js'
import rt from './rt.js'
import tg from './tg.js'
import thug from './thug.js'
import msg from './msg.js'
import enjin from './enjin.js'
import health from './health.js'

export function write_error({ sender }) {
  sender.write('chat', {
    message: JSON.stringify({
      translate: 'arguments.operation.invalid',
      color: 'red',
    }),
    position: Position.CHAT,
    sender: sender.uuid,
  })
}

export default function execute_command({
  world,
  message,
  sender,
  get_state,
  dispatch,
}) {
  const [name, ...args] = message.trimStart().split(/\s+/)
  const command = {
    name: name.slice(1),
    args,
    sender,
    world,
    get_state,
    dispatch,
  }
  switch (command.name) {
    case 'msg':
      msg(command)
      break
    case 'gm':
    case 'gamemode':
      gamemode(command)
      break
    case 'dislike':
      dislike(command)
      break
    case 'f':
      fragile(command)
      break
    case 'jerry':
      jerry(command)
      break
    case 'like':
      like(command)
      break
    case 'osef':
      osef(command)
      break
    case 'ragequit':
      ragequit(command)
      break
    case 'respect':
      respect(command)
      break
    case 'rt':
      rt(command)
      break
    case 'tg':
      tg(command)
      break
    case 'thug':
      thug(command)
      break
    case 'enjin':
      enjin(command)
      break
    case 'health':
      health(command)
      break

    default:
      sender.write('chat', {
        message: JSON.stringify({
          translate: 'commands.help.failed',
          color: 'red',
        }),
        position: Position.CHAT,
        sender: sender.uuid,
      })
      break
  }
}
