<h1 align=center>AresRPG</h1>
<p align=center>
  <img src="media/logo.png" />
</p>
<p align=center>
  <a href="https://hydre.io">
    <img src="https://raw.githubusercontent.com/HydreIO/artwork/master/badge/hydre.svg" alt="hydre.io"/>
  </a>
  <img src="https://img.shields.io/badge/Made%20with-Javascript-%23f7df1e?style=for-the-badge" alt="fully in javascript"/>
  <img src="https://img.shields.io/badge/Built%20With-%E2%99%A5-pink?style=for-the-badge" alt="built with muscles"/>
  <img src="https://img.shields.io/badge/Powered%20By-Black%20Magic-blueviolet?style=for-the-badge" alt="powered by lsd"/>
  <a href="CONTRIBUTING.md">
    <img src="https://img.shields.io/badge/contributions-welcome-blue.svg?style=for-the-badge" alt="Contributions welcome"/>
  </a>
  <a href="https://choosealicense.com/licenses/mit/">
    <img src="https://img.shields.io/badge/license-MIT-yellow.svg?style=for-the-badge" alt="License"/>
  </a>
  <a href="https://discord.gg/gaqrFT5">
    <img src="https://img.shields.io/discord/265104803531587584.svg?logo=discord&style=for-the-badge" alt="Chat"/>
  </a>
</p>
<h3 align=center>AresRPG is a non-modded MMORPG Minecraft Server for minecraft 1.16</h3>

- [A _bit_ of history](#a-bit-of-history)
  - [The `v1`](#the-v1)
  - [The `v2`](#the-v2)
- [Requirements](#requirements)
  - [Install](#install)
  - [Usage](#usage)
    - [Enable data persistence](#enable-data-persistence)
  - [Contributing](#contributing)
    - [where to start](#where-to-start)
  - [License](#license)

# A _bit_ of history

AresRPG first came up to the world in 2013 under the name EclozionMMORPG
from the idea of [@StoneBloodTV](https://github.com/jdathueyt) and [@Sceat](https://github.com/Sceat), later on the team splitted due to
an internal lack of organization and **AresRPG** as you know it flew on its own.

Fully written in Java by [@DarkPingoo](https://github.com/DarkPingoo) and [@Sceat](https://github.com/Sceat), the project released a test version
called [the tutorial](https://www.youtube.com/watch?v=29AIkBtScgQ), quite successful and enjoyed by the community it
kept going, the team grew bigger with [@DeltaEvo](https://github.com/DeltaEvo), [@unixfox](https://github.com/unixfox) and many more that you
can still find in the community these days.

## The `v1`

The [gameplay was quite simple](https://www.youtube.com/watch?v=g4xb67Z5dxY), find mobs and kill them, buy the stuff rince and repeat.

4 classes were available:

- Barbarian
- Archer
- Vampire
- Mage

There was duels, exchanges, spells, skill points, teleportation stone, boss fights
team loot, etc..

The world was working though a floor system,
when you complete a floor you go to the next one.
This version made AresRPG [quite famous](https://www.youtube.com/watch?v=dEELCqYUyEI)

## The `v2`

The V2 is (and will stay) [an unreleased version](https://www.youtube.com/watch?v=LkzGcEcBP1Q) of AresRPG,
the goal of this version was to have a procedural open-world instead
of a floor system and more classes than the v1, with an overall gameplay upgrade.

# Requirements

- NodeJS `>= 19`
- npm

## Install

```bash
$ git clone https://github.com/aresrpg/aresrpg
$ cd aresrpg
$ git submodule update --init
$ npm install
```

If you have access to AresRPG's proprietary data, you can run

```
git -C data remote add -f private git@github.com:aresrpg/data-closed.git
git -C data checkout private/master
```

For mac M1 users you may [have problems](https://github.com/Automattic/node-canvas/issues/1733) while installing `node-canvas`

```
arch -arm64 brew install pkg-config cairo pango libpng jpeg giflib librsvg
```

## Usage

```bash
$ npm start

# Start with packet logging
$ DEBUG="minecraft-protocol*" npm start
```

### Enable data persistence

Aresrpg is using redis with the rejson module to persist player's state

```bash
$ docker-compose up
$ USE_PERSISTENT_STORAGE="true" npm start
```

## Contributing

> AresRPG is an open-source project, which means that anyone is welcome to participate in the design of the server and in particular its code.

AresRPG is written entirely in JavaScript, and you will need a significant level of experience to really help the server. Although we welcome all contributions, it is important to know that the senior developers of the project will invest time in reviewing your code, make sure to come up with clean, readable, and functional code before submitting a Pull Request.

The commit history should also be clean in an understandable way.
Issues, code, documentations and any type of text should be written in English only

### where to start

- Read [CONTRIBUTING.md](CONTRIBUTING.md)
- We use the [Prismarine protocol library](https://github.com/PrismarineJS/node-minecraft-protocol)
- Find packets informations on [prismarine.js.org](https://minecraft-data.prismarine.js.org/?d=protocol&v=1.16.4)
- A more verbose description of the packets can be found on [wiki.vg](https://wiki.vg/Protocol)
- [Burger datas](https://pokechu22.github.io/Burger/1.16.5.html)
- More global informations (NBT, etc) can be found on [Minecraft fandom](https://minecraft.fandom.com/wiki/Java_Edition)

Start by forking the repo and run it locally, then try to modify or implement simple little things to learn about the state system and how to observe packets/actions.

Once you feel ready, go to the [issues](https://github.com/aresrpg/aresrpg/issues?q=is%3Aissue+is%3Aopen+sort%3Aupdated-desc) and open your first PR.

## License

[MIT](https://choosealicense.com/licenses/mit/)
