const statuses = ['success', 'declined', 'failed', 'accepted']

export function send_resource_pack({ client }) {
  client.write('resource_pack_send', {
    url:
      'https://github.com/aresrpg/resourcepacks/releases/download/v1.0.1/addon.zip',
    hash: '428224b7fc5a20c0ce4f12a27862ecd60aed9bda',
  })

  client.on('resource_pack_receive', ({ result }) => {
    const status = statuses[result]
    // TODO: what do we do when failing ?
    console.log('Ressource pack status:', status)
  })
}
