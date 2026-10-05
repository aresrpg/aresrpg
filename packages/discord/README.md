# Discord notification bot

One process subscribes to `evt:notifications:<PACKAGE_ORIGINAL>` on the existing indexer Redis.
For each received event, it filters, resolves verified SuiNS names, renders a compact PNG and posts
to Discord. Nothing is persisted or replayed. There is no polling, SQLite, cursor or persistent volume.
Messages missed while offline and failed sends are not replayed. Discord's explicit rate limits are
respected; other send errors are logged and the next received event proceeds.

The indexer publishes confirmed public sales, rare gathering, dungeon boss victories and newly
claimed fight gear. Gear posts only when average normalized variable-stat quality is strictly above
90%; fixed stats are excluded. Names must resolve back to the wallet, otherwise its address is shown.

Run `bun run --cwd packages/discord start` with:

| Variable             | Value                                                   |
| -------------------- | ------------------------------------------------------- |
| `DISCORD_BOT_TOKEN`  | Existing bot token, injected from the Kubernetes Secret |
| `DISCORD_CHANNEL_ID` | Destination channel ID                                  |
| `PACKAGE_ORIGINAL`   | Original game package ID matching the indexer           |
| `SUI_NETWORK`        | `mainnet` or `testnet`                                  |
| `SUI_RPC_URL`        | Network gRPC endpoint for optional SuiNS names          |
| `GRAPH_URL`          | Existing indexer Redis URL                              |
| `DISCORD_LOCALE`     | App locale; defaults to `en`                            |

The bot needs View Channel, Send Messages, Embed Links and Attach Files. It needs no Gateway
connection or privileged intents. `/health` reports subscription-connection readiness; `/live`
reports process liveness.

Release CI publishes the dedicated `ghcr.io/aresrpg/discord` image. Its Helmfile release lives in
`~/dev/kubernetes/domains/aresrpg/helmfile.d/15-discord.yaml` and stays at one replica independently
of the realtime server. Deploy the publishing indexer first, then pin the bot's image digest and
activate its release through Helmfile. The prepared chart remains disabled until configured.

For the visual gallery, run the frontend development server and open
`http://127.0.0.1:5173/e2e/fixtures/notifications.html`. Its events are illustrative; it sends nothing.

```bash
bun test packages/discord/test packages/server/test/suins.test.ts
bun run --cwd packages/discord typecheck
cargo test --manifest-path packages/indexer/Cargo.toml notification
```
