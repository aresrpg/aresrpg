import { Position } from '../player/chat.js'

import { write_error } from './commands.js'
import { CommandNodeTypes, ParserProperties } from './declare_options.js'

const GameMode = {
  SURVIVAL: 0,
  CREATIVE: 1,
  ADVENTURE: 2,
  SPECTATOR: 3,
}

export const gamemode_nodes = [
  {
    flags: {
      command_node_type: CommandNodeTypes.COMMAND,
    },
    extraNodeData: 'gm',
    children: [
      {
        flags: {
          command_node_type: CommandNodeTypes.ARGUMENT,
          has_command: true,
        },
        children: [],
        extraNodeData: {
          name: 'gamemode name or number (0-3)',
          parser: 'brigadier:string',
          properties: ParserProperties.string.SINGLE_WORD,
        },
      },
    ],
  },
  {
    flags: {
      command_node_type: CommandNodeTypes.COMMAND,
    },
    extraNodeData: 'gamemode',
    children: [
      {
        flags: {
          command_node_type: CommandNodeTypes.ARGUMENT,
          has_command: true,
        },
        children: [],
        extraNodeData: {
          name: 'gamemode name or number (0-3)',
          parser: 'brigadier:string',
          properties: ParserProperties.string.SINGLE_WORD,
        },
      },
    ],
  },
]

export default function gamemode({ args, sender }) {
  if (args.length !== 1) {
    write_error({ sender })
    return
  }
  const by_name = args[0].toUpperCase() in GameMode && args[0].toUpperCase()
  const [by_number] =
    Object.entries(GameMode).find(([, id]) => Number(args[0]) === id) ?? []
  const mode = by_name || by_number

  if (!mode) {
    write_error({ sender })
    return
  }

  const message = {
    translate: 'commands.gamemode.success.self',
    with: [{ translate: `gameMode.${mode.toLowerCase()}` }],
  }

  const gameMode = GameMode[mode]

  sender.write('game_state_change', {
    reason: 3, // game_state_change is not only for gamemode but for a lot of things. And 3 is for gamemode.
    gameMode,
  })

  sender.write('chat', {
    message: JSON.stringify(message),
    position: Position.CHAT,
    sender: '00000000000000000000000000000000',
  })
}
