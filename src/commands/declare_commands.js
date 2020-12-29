export default function declare_commands({ client }) {
  // command gamemode
  const command = {
    nodes: [
      {
        flags: 0,
        children: [1],
      },
      {
        flags: 1,
        children: [2],
        extraNodeData: 'gm',
      },
      {
        flags: 2 | 0x04,
        children: [],
        extraNodeData: {
          name: 'a',
          parser: 'brigadier:string',
          properties: 0,
        },
      },
    ],
    rootIndex: 0,
  }
  console.log(client.uuid)
  client.write('declare_commands', command)
}
