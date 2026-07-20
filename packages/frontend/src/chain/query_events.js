// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #23/D79 P2 — the SINGLE event-replay helper (GraphQL). The JSON-RPC event-query API is gone (testnet JSON-RPC
// endpoints die wk of Jul 6), so every "replay every event of this Move type to discover object ids" read now
// pages the Sui GraphQL `events(filter:{type}, after)` connection instead. Three consumers use it today —
// read_items_purchases (SaleBought), read_templates (Mob/ItemTemplateCreated), craft_actions (RecipeCreated).
// read_sales and read_listings have SINCE migrated to /v1.
//
// SHAPE CONTRACT (what the callers read): each returned row is `{ parsedJson, sender }` —
//   • parsedJson ← the event's `contents.json` (the decoded Move struct; == the old jsonRpc `ev.parsedJson`)
//   • sender     ← `sender.address` (the list-tx sender; read_listings used this for kiosk→seller pre-S-86 — no current consumer reads it)
// Pages the whole feed (GraphQL cursor is `pageInfo.endCursor`), so the helper returns the FULL row list — the
// callers no longer manage a cursor themselves (they used to loop jsonRpc pages; that loop moves in here).

// #23/D79 P2 — page size for this event-replay helper: matches the old JSON-RPC event-query page size (50),
// and the Sui GraphQL `events` connection caps `first` at 50, so this is also the max. Lives here (its only
// consumer) since the S-61 deployment.ts shrink.
const GRAPHQL_EVENTS_PAGE_MAX = 50

// One page of the events feed. `type` is the fully-qualified MoveEventType (e.g. `0x..::template_sale::SaleCreated`
// or `0x2::kiosk::ItemListed<0x..::item::Item>`) — GraphQL's EventFilter.type accepts the full generic type name.
// `contents.json` is the decoded struct; `sender.address` the emitting tx's sender.
const EVENTS_QUERY = /* GraphQL */ `
  query ReplayEvents($type: String!, $after: String) {
    events(filter: { type: $type }, first: ${GRAPHQL_EVENTS_PAGE_MAX}, after: $after) {
      nodes {
        contents { json }
        sender { address }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`

/**
 * Replay EVERY event of `event_type` via GraphQL, returning every row's `{ parsedJson, sender }`. Pages the whole
 * connection internally. Throws on a GraphQL/transport error so callers keep their existing try/catch "empty is
 * honest" fallback (a missing module → the type doesn't resolve → GraphQL errors → caller returns []).
 * @param {import('@mysten/sui/graphql').SuiGraphQLClient} graphql_client  the SDK's shared GraphQL client (sui.js)
 * @param {string} event_type  the fully-qualified MoveEventType filter
 * @returns {Promise<Array<{ parsedJson: any, sender: string }>>}
 */
export async function replay_events(graphql_client, event_type) {
  /** @type {Array<{ parsedJson: any, sender: string }>} */
  const rows = []
  let after = null
  for (;;) {
    const { data, errors } = await graphql_client.query({
      query: EVENTS_QUERY,
      variables: { type: event_type, after },
    })
    // A GraphQL error (e.g. an unresolvable type before its module is published) is surfaced — the callers'
    // try/catch turns it into an honest empty, same as the old jsonRpc throw path.
    if (errors?.length)
      throw new Error(`GraphQL events(${event_type}) failed: ${errors.map((e) => e.message).join('; ')}`)
    const conn = data?.events
    for (const node of conn?.nodes ?? []) {
      rows.push({ parsedJson: node?.contents?.json ?? null, sender: node?.sender?.address ?? '' })
    }
    if (!conn?.pageInfo?.hasNextPage || !conn?.pageInfo?.endCursor) break
    after = conn.pageInfo.endCursor
  }
  return rows
}
