export const dimensionCodec = {
  name: '',
  type: 'compound',
  value: {
    dimension: {
      type: 'list',
      value: {
        type: 'compound',
        value: [
          {
            name: {
              type: 'string',
              value: `minecraft:overworld`,
            },
            piglin_safe: {
              type: 'byte',
              value: 0,
            },
            natural: {
              type: 'byte',
              value: 1,
            },
            ambient_light: {
              type: 'float',
              value: 0,
            },
            infiniburn: {
              type: 'string',
              value: 'minecraft:infiniburn_overworld',
            },
            respawn_anchor_works: {
              type: 'byte',
              value: 0,
            },
            has_skylight: {
              type: 'byte',
              value: 1,
            },
            bed_works: {
              type: 'byte',
              value: 1,
            },
            has_raids: {
              type: 'byte',
              value: 1,
            },
            logical_height: {
              type: 'int',
              value: 256,
            },
            shrunk: {
              type: 'byte',
              value: 0,
            },
            ultrawarm: {
              type: 'byte',
              value: 0,
            },
            has_ceiling: {
              type: 'byte',
              value: 0,
            },
          },
        ],
      },
    },
  },
}
