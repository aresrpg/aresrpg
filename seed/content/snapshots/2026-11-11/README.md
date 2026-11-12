# Sui holder snapshots, 2026-11-11

Mainnet checkpoint **343987394**, **2026-11-11T06:52:14.040Z**.
Digest: `4qcBq2G7DQDv4CBKWDRv4Nkh8RLqYHznrp6YoHsfePiP`.
Source: https://graphql.mainnet.sui.io/graphql

## Canonical inputs

The nine collection JSONs are the inputs to holder gift preparation. `manifest.json`
records checkpoint provenance and classification context. `SHA256SUMS` seals every
retained file except itself; run `shasum -a 256 -c SHA256SUMS` in this directory.
These historical inputs stay outside runtime/frontend bundles. Reward allocations
are authored separately in `seed/content/airdrop.json`; no transaction is submitted
by snapshot preparation or cleanup.

Recipients require verified current control. Standard Kiosk ownership comes from
KioskOwnerCap or the nontransferable PersonalKiosk OwnerMarker, never the cosmetic
`Kiosk.owner` label. OriginByte custody requires its exact self-held capability.
The Ones excludes 946 burned tombstones. Puggies excludes one zero-address owner.
Rootlets, Puggies and Mystic Yetis omit 76, 18 and 59 pooled NFTs respectively;
the available-wallet subsets are approved. Administrators and original depositors
are not substituted for beneficiaries. Unresolved IDs remain evidence; only the four reviewed subset campaigns set
`exclude_unresolved: true`. Strict uncapped preparation remains the default.
Puggies also excludes one zero-address controller, separately from its 18 pooled NFTs.

Pawtato includes **823 verified wallets holding 3,305 NFTs**, at all levels. All
verified wallets fit below the 5,000-wallet maximum; no sampling or padding occurs.
The **26,695 game-bridge NFTs** retain their unresolved IDs and exclusion reason;
neither the bridge operator nor original depositors are credited as beneficiaries.
The nine collections total **32,037 eligible NFTs**, **7,400 distinct wallets** and
**8,971 wallet-collection entitlements**. Blast uses a separate sale allocation:
on 12 November, the owner replaced Crew card eligibility with the finalized sale
whitelist. All **164 distinct addresses** in the retained 31 October export were
verified against the current final awards. One Crew Member title per wallet is
prepared in the existing airdrop batches. This is not an NFT holder snapshot; the
export and recipient-set hashes are retained in `manifest.json`. The separate Crew
Helmet campaign is unchanged. No distribution transaction has been submitted.
Addresses are not unique people.

## Evidence outside the repository

Raw object inventories, pagination, disassemblies, intermediate investigations and
superseded verification reports are retained outside source control in a separate
audit bundle.

`manifest.json` identifies the portable full backup archive and its SHA-256.
Each collection retains its `inventory_sha256` and `inventory_archive_member`.
The original eight inventories remain inside that archive. The subsequent Pawtato
audit JSON and `pawtato-all-levels/objects.jsonl` are stored beside it, identified
by `manifest.json`'s `evidence_updates` hashes. They are not members of the historical archive. The external directory also
contains the original per-file checksums and a working `audit/` copy. No external
file is needed to consume the canonical holder lists.

Sources: [Sui GraphQL](https://graphql.mainnet.sui.io/graphql),
[Sui kiosk docs](https://docs.sui.io/onchain-finance/kiosk/kiosk-example),
[Pawtato guide](https://pawtato.gg/guide/heroes),
[Pawtato Hero documentation](https://docs.pawtato.gg/pawtato-land/gameplay/heroes),
[Blast.fun terms](https://www.blast.fun/terms).

## Bounded ownership-proof caveat

Three eligible The Ones NFTs use verified direct address ownership of kiosk
`0xe323c6597f9d022ae0cc74cb15f6c18d4014ef92251d2f7be55e6fba5bb2af1f`.
Its matching cap is absent from retained evidence. The other 32,034 eligible NFTs
have cap/marker corroboration. This does not alter the approved recipient set;
see `manifest.json` for the exact controller. No full cap-level proof is claimed.
