import bot from '../bot/bot.js'

import { CommandNodeTypes, ParserProperties } from './declare_options.js'

export const test_nodes = [
  {
    flags: {
      command_node_type: CommandNodeTypes.COMMAND,
    },
    extraNodeData: 'test',
    children: [
      {
        flags: {
          command_node_types: CommandNodeTypes.ARGUMENT,
          has_command: true,
          children: [],
          extraNodeData: {
            name: 'test name',
            parser: 'brigadier:string',
            properties: ParserProperties.string.SINGLE_WORD,
          },
        },
      },
    ],
  },
]

export default function test({ args, sender }) {
  console.log(args)
  bot.execute(args)
}
