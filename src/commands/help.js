import { client_chat_msg, Formats } from '../core/chat.js'

import { literal } from './declare_options.js'

export const help_nodes = [literal({ value: 'help' }), literal({ value: 'h' })]

const GRAY = '#7F8C8D'
const LIGHT_GRAY = '#BDC3C7'
const categories = {
  misc: [
    '/dislike',
    '/fragile',
    // ... other commands ...
    '/thug',
  ],
  game: ['/msg <player> <text>'],
  dev: [
    '/attack_speed <value>',
    '/xp <amount>',
    '/gm <mode>',
    '/speed <value>',
    '/soul <value>',
    '/health <amount>',
    '/game_state <state>',
  ],
}

const generate_command = (command, is_last) => [
  { text: is_last ? ' │  └─ ' : ' │  ├─ ', color: GRAY },
  { text: `${command}\n`, color: LIGHT_GRAY },
]

const generate_category = (category_name, commands) => [
  { text: ' ├─ ', color: GRAY },
  { text: `${category_name}\n`, color: LIGHT_GRAY },
  ...commands.flatMap((command, idx) =>
    generate_command(command, idx === commands.length - 1),
  ),
]

export default function help({ sender }) {
  const message = [
    { text: 'List of', ...Formats.BASE },
    { text: ' AresRPG', ...Formats.WARN },
    { text: `'s commands\n`, ...Formats.BASE },
    ...Object.entries(categories).flatMap(([category_name, commands]) =>
      generate_category(category_name, commands),
    ),
  ]

  client_chat_msg({
    client: sender,
    message,
  })
}
