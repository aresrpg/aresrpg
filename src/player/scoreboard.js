import { update_sidebar } from '../scoreboard/sidebar.js'
import {
  create_animation,
  AnimationDirection,
} from '../scoreboard/animations.js'
import { ChatColor } from '../scoreboard/enums.js'

export default {
  observe({ client, events }) {
    events.once('state', () => {
      const scoreboard = {
        title: { color: 'gold', text: 'Statistiques' },
        lines: [
          { text: '' },
          [
            { color: 'white', text: 'Classe ' },
            { color: 'gray', text: ': ' },
            { color: 'dark_blue', text: 'Barbare' },
          ],
          [
            { color: 'white', text: 'Spé ' },
            { color: 'gray', text: ': ' },
            { color: 'yellow', text: 'Aucune' },
          ],
          [
            { color: 'white', text: 'Lvl.' },
            { color: 'dark_green', text: '1 ' },
            { color: 'gray', text: '(' },
            { color: 'dark_aqua', text: '4%' },
            { color: 'gray', text: ')' },
          ],
          [
            { color: 'white', text: 'Ame ' },
            { color: 'gray', text: ': ' },
            { color: 'green', text: '100' },
            { color: 'gray', text: '%' },
          ],
          { text: '' },
          [
            { color: 'white', text: 'Crit ' },
            { color: 'gray', text: ': ' },
            { color: 'dark_red', text: 'Bientôt', italic: true },
          ],
          [
            { color: 'white', text: 'Chance ' },
            { color: 'gray', text: ': ' },
            { color: 'dark_red', text: 'Bientôt', italic: true },
          ],
          { text: '' },
          [
            { color: 'white', text: 'Métiers ' },
            { color: 'dark_red', text: 'Bientôt', italic: true },
          ],
          [
            { color: 'gray', text: '- ' },
            { color: 'green', text: 'Aucun' },
          ],
          { text: '' },
          [
            { color: 'white', text: 'Or ' },
            { color: 'gray', text: ': ' },
            { color: 'dark_red', text: 'Bientôt', italic: true },
          ],
          { text: '' },
          { text: 'www.aresrpg.fr' },
        ],
      }

      update_sidebar({ client }, { last: {}, next: scoreboard })

      const animation = create_animation(
        { client },
        {
          boardState: scoreboard,
          line: 'title',
          animations: [
            {
              effects: [ChatColor.DARK_RED, ChatColor.DARK_RED],
              delay: 75,
              transitionDelay: 0,
              direction: AnimationDirection.RIGHT,
              maxLoop: 2,
            },
            {
              effects: [ChatColor.DARK_RED],
              delay: 75,
              transitionDelay: 15000,
              direction: AnimationDirection.BLINK,
              maxLoop: 6,
            },
          ],
        }
      )

      const animation2 = create_animation(
        { client },
        {
          boardState: scoreboard,
          line: 1,
          animations: [
            {
              effect: [],
              delay: 150,
              transitionDelay: 10000,
              direction: AnimationDirection.WRITE,
              maxLoop: 1,
            },
          ],
        }
      )

      setTimeout(() => {
        animation.start()
        animation2.start()
      }, 3000)

      client.on('end', () => {
        animation.reset()
        animation2.reset()
      })
    })
  },
}
