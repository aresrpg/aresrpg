import { client_chat_msg, Formats } from '../chat.js'

import { literal } from './declare_options.js'

export const help_nodes = [literal({ value: 'help' }), literal({ value: 'h' })]

const GRAY = '#7F8C8D'
const LIGHT_GRAY = '#BDC3C7'

export default function help({ world, sender }) {
  client_chat_msg({
    client: sender,
    message: [
      { text: `List of`, ...Formats.BASE },
      { text: ' AresRPG', ...Formats.WARN },
      { text: `'s commands\n`, ...Formats.BASE },
      { text: ' ├─ ', color: GRAY },
      { text: 'misc\n', color: LIGHT_GRAY },
      { text: ' │  ├─ ', color: GRAY },
      { text: '/dislike\n', color: LIGHT_GRAY },
      { text: ' │  ├─ ', color: GRAY },
      { text: '/fragile\n', color: LIGHT_GRAY },
      { text: ' │  ├─ ', color: GRAY },
      { text: '...\n', color: LIGHT_GRAY },
      { text: ' │  └─ ', color: GRAY },
      { text: '/thug\n', color: LIGHT_GRAY },
      { text: ' ├─ ', color: GRAY },
      { text: 'game\n', color: LIGHT_GRAY },
      { text: ' │  └─ ', color: GRAY },
      { text: '/msg <player> <text>\n', color: LIGHT_GRAY },
      { text: ' └─ ', color: GRAY },
      { text: 'dev\n', color: LIGHT_GRAY },
      { text: '    ├─ ', color: GRAY },
      { text: '/attackspeed <value>\n', color: LIGHT_GRAY },
      { text: '    ├─ ', color: GRAY },
      { text: '/xp <amount>\n', color: LIGHT_GRAY },
      { text: '    ├─ ', color: GRAY },
      { text: '/gm <mode>\n', color: LIGHT_GRAY },
      { text: '    └─ ', color: GRAY },
      { text: '/health <amount>\n', color: LIGHT_GRAY },
    ],
  })
}
