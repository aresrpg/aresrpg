<p align=center>
  <img src="https://user-images.githubusercontent.com/11330271/208825167-77d7bc78-17d0-4f33-ad35-d108b6fac730.gif" height="237px" width="344"/>
</p>
<h1 align=center>AresRPG</h1>
<p align=center>
  <img src="https://img.shields.io/badge/Made%20with-Javascript-%23f7df1e?style=for-the-badge" alt="fully in javascript"/>
  <a href="https://discord.gg/aresrpg">
    <img src="https://img.shields.io/discord/265104803531587584.svg?logo=discord&style=for-the-badge&color=2ECC71" alt="Chat"/>
  </a>
</p>
<h3 align=center>A fully on-chain voxel MMORPG on Sui</h3>

<!-- DRAFT (repo-split scaffold 2026-07-20): becomes the public repo's README.md at cutover
     (git@github.com:aresrpg/aresrpg.git, fresh history). The monorepo README stays live until then. -->

AresRPG is a browser MMORPG where every character, item, fight and trade is a Sui object — the
client is a renderer of chain truth, with zkLogin onboarding and sponsored gameplay transactions.
This repository is the whole game: frontend, 3D voxel engine, deterministic combat sim + its
Move twin, SDK, test rig, the keyless `/v1` read layer, and the transaction sponsor. Game
content (items, mobs, spells, worlds) is published on-chain and served via the asset CDN — it
is not part of this repository.

## Install / run / test

```bash
bun install
bun run dev            # frontend at localhost:5173
bun run lint           # eslint + prettier
bun run test           # every package's unit tests — same command CI runs
```

## Contributing

Read `CLAUDE.md` (the house rules) and `DECISIONS.md` (the design truth) first. Contributions
build AresRPG — proposals that fight the spec argue the spec change first, as an issue. Need

## License — source-available, in plain words

This is **source-available** software, developed in the open — not open-source. See
[LICENSE](./LICENSE) for the binding text; the honest summary:

**You may:** read everything · build and run the game locally · modify it for yourself ·
contribute improvements back (a [CLA](./CLA.md) signature rides your first PR).
**You may not:** redistribute the software or your modified version · re-host the game ·
use it commercially. All commercial rights stay with the author. The AresRPG name and logo
are not licensed (see TRADEMARK.md).

something from the backend or content domains? Open an issue on that repo; this repo's backlog is
its own issues.
