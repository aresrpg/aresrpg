# Discord notification bot

One process subscribes to `evt:notifications:<PACKAGE_ORIGINAL>` on the existing indexer Redis.
For each received event, it filters, resolves verified SuiNS names, renders a PNG card and posts
it to Discord as a plain image attachment. Nothing is persisted or replayed. There is no polling, SQLite, cursor or persistent volume.
Messages missed while offline and failed sends are not replayed. Discord's explicit rate limits are
respected; other send errors are logged and the next received event proceeds.

The indexer publishes confirmed public sales, rare gathering, dungeon boss victories and newly
claimed fight gear. Gear posts only when average normalized variable-stat quality is strictly above
90%; fixed stats are excluded. Names must resolve back to the wallet, otherwise its address is shown.

Run `bun run --cwd packages/discord start` with:

| Variable             | Value                                          |
| -------------------- | ---------------------------------------------- |
| `DISCORD_BOT_TOKEN`  | Bot token; keep private                        |
| `DISCORD_CHANNEL_ID` | Destination channel ID                         |
| `PACKAGE_ORIGINAL`   | Original game package ID matching the indexer  |
| `SUI_NETWORK`        | `mainnet` or `testnet`                         |
| `SUI_RPC_URL`        | Network gRPC endpoint for optional SuiNS names |
| `GRAPH_URL`          | Existing indexer Redis URL                     |
| `DISCORD_LOCALE`     | App locale; defaults to `en`                   |

The bot needs View Channel, Send Messages and Attach Files. It needs no Gateway
connection or privileged intents. `/health` reports subscription-connection readiness; `/live`
reports process liveness.

Release CI publishes the dedicated bot image. The publishing indexer must support the notification contract before the bot consumes it.

For the visual gallery, run the frontend development server and open
`http://127.0.0.1:5173/e2e/fixtures/notifications.html`. Its events are illustrative; it sends nothing.

```bash
bun test packages/discord/test packages/server/test/suins.test.ts
bun run --cwd packages/discord typecheck
cargo test --manifest-path packages/indexer/Cargo.toml notification
```
