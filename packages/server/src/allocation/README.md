# Allocation page operations

The public entry is `/allocation`. The same-origin endpoint is `/api/allocation`.
It uses the existing Google and Wallet Standard authentication. It does not publish
contracts, submit sale transactions, or write the game index.

The campaign is closed. The module only serves the published allocation list, the
account's verified wallets, their cards and public share previews.

## Configuration

Configure these private variables on the **game server**, never Vercel or `VITE_*`:

- `ALLOCATION_REDIS_URL`: the private persistent campaign store.
- `ALLOCATION_ORIGIN`: the exact frontend origin, normally `https://aresrpg.world`.

The game server connects lazily; a campaign store outage does not prevent game boot.

## Requests

Private requests use `packet/allocation_request` on the admitted game connection. The
server takes the owner from that connection, never from supplied JSON. The global
request budget applies, with one in-flight operation per connection.

An admitted wallet establishes the portfolio owner. Additional wallets sign a
five-minute one-use challenge binding their address, the campaign and that owner. The
server stores at most ten distinct verified wallets per account, including the login
wallet. Card reads never accept caller-selected unverified addresses.

Only a verified owner can issue a share link. The link is opaque and its preview shows
the tier and allocation without the wallet address.

## Operator commands

```bash
bun scripts/allocation_campaign.ts export blast.csv
BLAST_PARTNER_API_KEY=... bun scripts/allocation_campaign.ts proofs
```

`export` writes the published list in the Blast handoff format and refuses to overwrite
a different file.

Blast may add wallets of its own to the sale's allowlist, so only Blast holds the full list
and only Blast can issue a proof. `proofs` reads the pinned sale's root from the chain,
fetches each published wallet's proof from Blast's partner API, and stores them in the
campaign store. It stores nothing unless every proof reaches that root with the published
cap. Run it once after the sale is pinned; the page offers no purchase before it. The key
is an operator secret: the game server never holds it and never calls Blast.
