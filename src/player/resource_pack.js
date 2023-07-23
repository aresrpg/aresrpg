import logger from '../logger.js'
import { RESOURCE_PACK_URI, RESOURCE_PACK_HASH } from '../settings.js'

const log = logger(import.meta)

const Status = {
  SUCCESS: 0,
  DECLINED: 1,
  FAILED: 2,
  ACCEPTED: 3,
}

export default {
  /** @type {import('../context.js').Observer} */
  observe({ client }) {
    client.write('resource_pack_send', {
      url: RESOURCE_PACK_URI,
      hash: RESOURCE_PACK_HASH,
    })

    // it seem we can receive this packet multiple times
    // first for the ACCEPTED/DECLINED, and then for the result of download
    client.on('resource_pack_receive', ({ result }) => {
      const [status] = Object.entries(Status).find(
        ([key, value]) => value === result,
      )
      log.info({ status }, 'Ressource pack status')
      switch (result) {
        case Status.ACCEPTED:
        case Status.SUCCESS:
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
            ]),
          )
          break
        case Status.FAILED:
          client.end(
            'Resource Pack Failed',
            JSON.stringify([
              { text: 'The resource pack is mandatory, ', color: 'yellow' },
              { text: 'But it failed to download :(', color: 'red' },
              { text: '\n' },
              {
                text: 'Please contact us if the problem persist ',
                color: 'yellow',
              },
              { text: 'discord.gg/aresrpg', color: 'dark_green' },
              { text: '.\n', color: 'yellow' },

              { text: '\n\n' },

              { text: 'Le ressource pack est obligatoire, ', color: 'yellow' },
              { text: 'Mais son téléchargement a échoué :(', color: 'red' },
              { text: '\n' },
              {
                text: 'Veuillez nous contacter si le problème persiste',
                color: 'yellow',
              },
              { text: 'discord.gg/aresrpg', color: 'dark_green' },
              { text: '.\n', color: 'yellow' },
            ]),
          )
          break
        default:
          throw new Error('Unknown resourcepack status result code', result)
      }
    })
  },
}
