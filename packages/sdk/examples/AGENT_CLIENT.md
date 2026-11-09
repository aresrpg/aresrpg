# Agent SDK setup

The setup and Recall guide is [Connect an assistant to AresRPG](../../frontend/public/agents/client.txt).
Use the first-party Connect flow to create or select a hosted bot, verify its custody descriptor,
and authorize an MCP client for that exact bot and budget. The service holds a managed signer;
this is custodial threshold-1-of-2 access, with independent owner recovery.

The shared SDK remains available for explicitly authorized applications and observation diagnostics.
There is no local-key CLI bootstrap or automatic server pairing exchange. Hosted actors and browser
clients use the same SDK transaction executor; connectors do not introduce separate game logic.
The hosted prototype still requires the live validation and deployment gates listed in the bot package.

Hosted actors supply the awaited `TransactionJournal` exported by
`@aresrpg/sdk/transaction-execution` through `SDK({ transaction_journal })`. The private
[actor journal](../../bot/src/transaction_journal.ts) encrypts exact prepared/signed envelopes
and preserves receipts; the same SDK executor owns authorized, fenced recovery. Browser
`transaction_storage` remains a separate synchronous digest-only seam, not hosted durability.
Never expose signatures, envelopes, keys or signer adapters to MCP clients, chat or activity logs.
See the [bot operator README](../../bot/README.md) for recovery and deployment gates.

The SDK's broader action surface does not imply equivalent MCP coverage. Use `tools/list` for
the currently implemented catalog; live provider OAuth and gameplay validation remain required.
