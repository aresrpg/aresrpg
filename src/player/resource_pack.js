import { once } from 'events'

import { PlayerEvent } from '../events.js'
import logger from '../logger.js'

const log = logger(import.meta)

export const Status = {
  SUCCESS: 0,
  DECLINED: 1,
  FAILED: 2,
  ACCEPTED: 3,
}

export default {
  /** @type {import('../context.js').Observer} */
  async observe({ client, events }) {
    client.write('resource_pack_send', {
      url: 'https://github.com/aresrpg/resourcepacks/releases/download/v1.0.4/ares-public.zip',
      hash: 'c57a27ac8dbde4f39dce0194b139dea18eb90021',
    })

    client.on('resource_pack_receive', ({ result }) => {
      const status = Object.entries(Status).find(
        ([key, value]) => value === result
      )
      events.emit(PlayerEvent.PACK_LOAD, result)
      log.info({ status }, 'Ressource pack status')
    })

    const [{ result }] = await once(client, 'resource_pack_receive')

    switch (result) {
      case Status.ACCEPTED:
        break
      case Status.DECLINED:
        client.end(
          'Resource Pack Declined',
          JSON.stringify([
            { text: 'The resource pack is mandatory, ', color: 'yellow' },
            { text: 'You refused it!', color: 'red' },
            { text: '\n' },
            {
              text: 'In your multiplayer menu, click on ',
              color: 'yellow',
            },
            { text: 'AresRPG', color: 'dark_green' },
            { text: ' then ', color: 'yellow' },
            { translate: 'selectServer.edit', color: 'dark_green' },
            { text: ' and finally ', color: 'yellow' },
            { translate: 'addServer.resourcePack', color: 'white' },
            { text: ': ', color: 'white' },
            { translate: 'addServer.resourcePack.enabled', color: 'white' },
            { text: '.\n', color: 'yellow' },

            { text: '\n\n' },

            { text: 'Le ressource pack est obligatoire, ', color: 'yellow' },
            { text: "Vous l'avez refusé !", color: 'red' },
            { text: '\n' },
            {
              text: 'Dans votre menu multijoueur, cliquez sur ',
              color: 'yellow',
            },
            { text: 'AresRPG', color: 'dark_green' },
            { text: ' puis ', color: 'yellow' },
            { translate: 'selectServer.edit', color: 'dark_green' },
            { text: ' et enfin ', color: 'yellow' },
            { translate: 'addServer.resourcePack', color: 'white' },
            { text: ': ', color: 'white' },
            { translate: 'addServer.resourcePack.enabled', color: 'white' },
            { text: '.\n', color: 'yellow' },
          ])
        )
        break
      default:
        client.end(`Invalid result ${result}`)
        break
    }
  },
}
