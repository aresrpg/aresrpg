import { version } from '../settings.js'
import minecraftData from 'minecraft-data'

const mcData = minecraftData(version)

//TODO: rewards ?? not in the protocol, but test
//TODO: progress ?? for what it is?

export const FrameType = {
  TASK: 0,
  CHALLENGE: 1,
  GOAL: 2,
}

export function init_achievement({ client, events }) {
  events.once('state', () => {
    add_achievement(
      { client },
      {
        key: 'test',
        parentId: null,
        title: 'test',
        description: 'test',
        itemId: mcData.itemsByName.stone.id,
        frameType: FrameType.TASK,
        hasBackgroundTexture: 1,
        hidden: 0,
        showToast: 1,
        backgroundTexture:
          'minecraft:textures/gui/advancements/backgrounds/end.png',
        criterias: [],
      }
    )
    add_achievement(
      { client },
      {
        key: 'test2',
        parentId: null,
        title: 'test2',
        description: 'test2',
        itemId: mcData.itemsByName.end_stone.id,
        frameType: FrameType.TASK,
        hasBackgroundTexture: 1,
        hidden: 0,
        showToast: 1,
        backgroundTexture:
          'minecraft:textures/gui/advancements/backgrounds/stone.png',
        criterias: [],
      }
    )
    // add_achievement(
    //   { client },
    //   {
    //     key: 'test2',
    //     parentId: 'test',
    //     title: 'test2',
    //     description: 'test2',
    //     itemId: mcData.itemsByName.stone.id,
    //     frameType: FrameType.TASK,
    //     flags: 1,
    //     backgroundTexture: null,
    //     criterias: [
    //       {
    //         key: 'minecraft:enter_block',
    //         value: {
    //           // Packet doc indicate void here, but gamepedia indicate that we can put some condition
    //           block: mcData.blocksByName.stone.id,
    //         },
    //       },
    //     ],
    //   }
    // )
  })
}

/**
 * Add achievement to a client
 * You can look here https://minecraft.gamepedia.com/Advancement/JSON_format for criterias etc
 * Criterias define the criteria that can be used in the requirements
 * Requirements define the condition. Some example of requirements:
 * [['trigger1'], ['trigger2']] => trigger1 && trigger 2
 * [['trigger1', 'trigger2']] => trigger1 || trigger2
 * [['trigger1'], ['trigger2', 'trigger3']] => trigger1 && (trigger2 || trigger3)
 * @param {{client: any}} Context
 * @param {{key: string, parentId: string, title: chat, description: chat, itemId: string, frameType: number, hasBackgroundTexture: number, hidden: number, showToast: number , backgroundTexture: string, criterias: array, requirements: array, rewards: array}} Options
 */
export function add_achievement(
  { client },
  {
    key,
    parentId,
    title,
    description,
    itemId,
    frameType,
    hasBackgroundTexture,
    hidden,
    showToast,
    backgroundTexture,
    criterias = [],
    requirements = [],
    rewards = [],
  }
) {
  const obj = {
    reset: false,
    advancementMapping: [
      {
        key,
        value: {
          displayData: {
            parentId,
            title: JSON.stringify(title),
            description: JSON.stringify(description),
            icon: {
              present: true,
              itemId,
              itemCount: 1,
            },
            frameType,
            flags: {
              has_background_texture: hasBackgroundTexture,
              hidden,
              show_toast: showToast,
            },
            backgroundTexture,
            xCord: 0,
            yCord: 0,
          },
          criteria: criterias,
          requirements,
          rewards,
        },
      },
    ],
    identifiers: [],
    progressMapping: [],
  }

  client.write('advancements', obj)
}

export function add_progress_achievement({ client }) {}

/**
 * Remove achievements by key of a client
 * @param {{client: any}} Context
 * @param {{achievements: string[]}} Option
 */
export function remove_achievement({ client }, { achievements }) {
  const obj = {
    reset: false,
    advancementMapping: [],
    identifiers: achievements,
    progressMapping: [],
  }

  client.write('advancements', obj)
}

/**
 * Reset achievements of a client
 * @param {{client: any}} Context
 */
export function reset_achievement({ client }) {
  const obj = {
    reset: true,
    advancementMapping: [],
    identifiers: [],
    progressMapping: [],
  }

  client.write('advancements', obj)
}
