// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/**
 * #23 gRPC: core.listCoins → { objects:[{ objectId, balance }], cursor } (was jsonRpc getCoins → { data, nextCursor }
 * with `coinObjectId`). Callers below already read `.balance`; `.coinObjectId` is remapped to `.objectId` here.
 * @return {Promise<Array<{ objectId: string, balance: string }>>}
 */
async function get_all_coins({
  grpc_client,
  type,
  address,
  cursor = null,
  result = [],
}) {
  const {
    objects,
    hasNextPage,
    cursor: next_cursor,
  } = await grpc_client.core.listCoins({
    owner: address,
    coinType: type,
    cursor,
  })
  result.push(objects)
  if (hasNextPage)
    return get_all_coins({
      grpc_client,
      type,
      address,
      result,
      cursor: next_cursor,
    })
  return result.flat(Infinity)
}

/**
 * @param {import("../../../types.js").Context & { supported_tokens: Record<string, { name: string, decimal: number, image_url: string }> }} context
 */
export function get_supported_tokens(context) {
  const { grpc_client } = context
  /** @type {(address: string) => Promise<import("../../../types.js").SuiToken[]>} */
  return async address =>
    Promise.all(
      Object.entries(context.supported_tokens).map(
        async ([token_type, token]) => {
          const coins = await get_all_coins({
            grpc_client,
            type: token_type,
            address,
          })

          if (!coins.length) return null

          return {
            id: token_type,
            ...token,
            amount: coins.reduce(
              (acc, { balance }) => acc + BigInt(balance),
              0n,
            ),
            // #23 gRPC: listCoins entries expose `objectId` (jsonRpc getCoins used `coinObjectId`)
            ids: coins.map(({ objectId }) => objectId),
            // Token-specific defaults for SuiToken interface
            item_category: 'token',
            item_set: '',
            item_type: 'token',
            is_token: true,
            level: 0,
          }
        },
      ),
    ).then(
      tokens =>
        /** @type {import("../../../types.js").SuiToken[]} */ (
          tokens.filter(Boolean)
        ),
    )
}
