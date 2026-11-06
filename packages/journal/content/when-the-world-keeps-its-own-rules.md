**An onchain game** puts the rules that govern play into programs executed by a blockchain network. These programs, usually called smart contracts, maintain the game's accepted state: the record of what exists, who controls it, and what each player is allowed to change.

In a conventional online game, a studio's server usually keeps that record and decides which actions are valid. Players send requests; the server checks them and reports the result. An onchain game moves that responsibility into rules the network can execute and verify.

This changes a fundamental relationship. A player may use a different interface, or write their own software to interact with the world, while still being subject to the same game rules.

> Who decides what you’re allowed to do?

For an open world, answering that question creates a second challenge. Many players need to act at once, often in unrelated places. The world must respond without making every interaction wait on one central record, or turning every footstep into a transaction.

These are the problems we are working on with AresRPG. This journal follows our approach on Sui, starting with the distinction between putting assets onchain and putting the game itself there. From that distinction, we can explain Proof of Discovery and how it supports a world with many independently active parts.

## Onchain assets and onchain gameplay

A game can use a blockchain for its items while leaving its gameplay rules on a private server. In that arrangement, the network can check who holds an item and whether a transfer is allowed. It may know nothing about the fight that awarded it.

Suppose the server decides that a player won, then sends them a sword. The sword's ownership is recorded onchain, but the network has accepted the server's verdict about the fight.

An onchain fight asks more of the contracts. They must check the permitted actions and derive the outcome from the accepted game state. Recording a reward and verifying why that reward was earned are separate technical problems.

This is the boundary we care about. In AresRPG, contracts enforce progression, combat, item custody, gathering, and dungeon transitions. Rendering a tree or delivering a chat message serves a different purpose. Those tasks can remain outside the chain without deciding the game's authoritative outcomes.

## Why we are building this on Sui

A busy open world has many things happening at once. One player gathers in a forest while another enters a dungeon far away. They share a world, but their actions do not necessarily need to change the same object.

Sui's object model gives us a practical way to express that distinction. Characters, items, fights, and discovered zones can have identities of their own. The objects a transaction needs make its dependencies explicit.

That lets us ask a useful design question: which parts of an action really need coordination, and which parts can stay independent? We will return to that question when we look at how AresRPG separates its World and Zone objects.

Sui also gives us programmable transactions to compose permitted operations, a chain clock to check time-based conditions, and native randomness for the mechanics that need a draw. Together, these support a game where contracts check the requirements and apply the consequences in one accepted transaction.

These primitives give us a practical starting point, but the data model still matters. Two players changing the same zone have a shared dependency. Players changing unrelated zones need not share that particular write. Designing those boundaries is part of making an open world scale; it does not happen simply because a game uses Sui.

First, we need to explain what the game asks a player to prove.

## Proof of Discovery: check the requirements, then allow the action

**Proof of Discovery** is the gameplay pattern we use to connect an action with verifiable requirements. Before changing the world, the contract establishes that the conditions for that action hold. It then applies the permitted consequences.

Those requirements can concern position, custody, equipment, or progression. They need not be separate proof files supplied by the player. Much of the evidence already exists in the game's onchain objects and the network's clock.

The reason for checking is straightforward: a player's request is a claim, not an accepted fact. The game client—the software running on the player's device—can be modified. A caller can also submit transactions without using the original interface at all.

For example, a request might claim that a character can reach a place and has the item required to enter it. The contract must check those conditions against the accepted state. Drawing an entrance as open on the screen cannot make the request valid.

The name began with discovering places, but the pattern extends to many activities. A reachable location, a tool, a profession level, or a completed dungeon stage can each be a requirement for the next action. Several requirements can apply together.

“Discovery” does not grant ownership of land merely because someone looks at it. It gives the game a way to accept participation according to rules it can check.

## A familiar comparison: work, stake, and discovery

You may have heard of Proof of Work or Proof of Stake. Both names connect a permission to something that can be checked.

In a Proof-of-Work network such as Bitcoin, miners compete to find a valid solution to a computational puzzle. Other participants can check that solution. The work forms part of the network's rules for producing blocks and agreeing on its history.

In Proof-of-Stake systems, stake helps determine participation or weight in the process that agrees on the network's history. The exact rules depend on the network.

Proof of Discovery asks a different question, inside a game: **have you met the conditions for this action?**

| Idea                         | What is being checked?                                             | What is it for?                                          |
| ---------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------- |
| Proof of Work                | A valid result from computational work                             | Part of a network's block-production and consensus rules |
| Proof of Stake               | Stake and the protocol's validator rules                           | Participation or weight in a network's consensus         |
| AresRPG's Proof of Discovery | Game requirements: reachable position, custody, items, progression | Permission to perform a particular game action           |

The comparison is a way into the idea, not a claim that these mechanisms are interchangeable.

Proof of Discovery is **not a new consensus protocol**. It does not replace Sui's validators, secure Sui's network, or let players mine blocks by walking. Sui still provides consensus and execution. Our contracts use that foundation to check gameplay conditions.

It is also not a separate cryptographic proof attached to every click. Some evidence is already in the objects supplied to the transaction. Some comes from Sui's clock. The contracts check those facts together.

## First example: could you have reached this place?

A character in AresRPG has a saved position and a time associated with it. Think of it as the last place the game accepted as a checkpoint.

When you ask to act somewhere else, the rules compare that checkpoint with the requested position and the current chain time.

Here is a deliberately simplified example. Suppose a game allows movement at ten metres per second. A player asks to act one hundred metres away from their saved position.

After two seconds, that is too far. After ten seconds, the distance fits the allowance.

The real AresRPG calculation uses its own units and speed budget. It also accounts for conditions such as a movement companion and periods when a character is held in place. The important idea is smaller than the implementation: **distance must fit the time and movement allowance that the rules recognize.**

On success, the game saves the new checkpoint. The next action starts from that accepted state.

This avoids writing every footstep to the chain. Your client handles continuous movement and its presentation. The contract checks the movement condition when an action needs it.

There is an important limit here. This proves that the requested position is reachable under the contract's distance-and-time rule. It does not prove that a human walked every step, followed the terrain, or kept the game open. Waiting can satisfy the time allowance. A bot can submit requests too.

That is an intentional boundary of the model, not something the word “proof” should hide. A game that needs exact path verification would need additional rules.

## Then the discovery becomes shared state

Once a character satisfies the travel check, it can request the first discovery of a zone.

Sui gives us several useful pieces for that request. Objects hold the relevant state. A chain clock supplies time. Native randomness supplies a seed. A derived object address gives the zone a stable identity under its world and coordinates.

The contract creates that zone as a shared object. Its seed and the published world content determine the population. The client does not get to submit a favourite list of monsters and call it a discovery.

Other players encounter the same zone state. When resources or monster groups are consumed, the game records that consumption. An already-used opportunity cannot become fresh merely because another client still draws it on screen.

Zones can later refresh under the game's expiry rules. In the current implementation, a refresh becomes eligible after two hours. Refreshing updates the same zone; it does not invent another identity for the same place.

There is a useful engineering detail underneath this. The shared World object participates in first discovery to claim the zone's address. Later refresh, gathering, and engagement work with the Zone itself. Activity in unrelated zones therefore does not need to mutate the same World object every time. Other shared inputs can still create contention; this is a boundary that removes one bottleneck, not a promise of unlimited throughput.

## A dungeon asks for more than a position

Consider a dungeon entrance at the edge of a city.

Being able to reach it is not enough. The character must be in the appropriate world, must not already have an active dungeon run, and must supply the correct dungeon key through the game's custody rules.

The entry transaction checks those requirements, consumes one key, and creates the run's starting state. These changes belong to one transaction. If a required check fails, its game-state changes do not partially remain: you do not successfully burn the key while failing to enter. An executed failed transaction can still cost gas.

Inside the dungeon, progression adds another requirement. You cannot simply claim to be in the final room. The current run and its fight settlement determine when the next room becomes available.

Gathering follows the same idea with a different set of conditions: the character must be able to reach the resource, have the required tool and profession level, and consume an available node.

We have not added a private server's permission slip to each activity. We have given each activity requirements that its contracts can check.

## Why this lets us build more

Once an action depends on verifiable game state, other actions can build on the state it produces.

A discovery makes a zone available. A legal gathering action produces materials. Materials can feed a recipe. A key can admit a character to a dungeon. A proved fight outcome can advance a run or authorize a reward.

Each link has a question the game can answer. “Was the material available?” “Was the key consumed?” “Did this fight actually settle as a victory?”

This gives builders something more useful than a public list of assets. It gives them a world with enforceable relationships between actions.

It also changes what another client can do. A different interface can present the same objects and submit permitted transactions. It still has to obey the same contracts. Building that client takes work, and depends on the available interfaces, assets, and infrastructure, but it does not need the original website to become a new authority over game outcomes.

That is the core pattern we want to explore throughout this journal: turn a meaningful prerequisite into something the game can check, then make the consequence usable by the next action.

## What still runs outside the chain

An onchain game still needs software around the chain. AresRPG has a renderer, an indexer, and a realtime server for convenient reads, presence, chat, and presentation. Their availability affects the experience. They do not replace the contracts as the owner of game truth.

Public rules also do not automatically mean unchangeable rules. Upgrade authority and content administration matter. AresRPG's content and package controls include an explicit permanent-freeze mechanism; describing that mechanism is not a claim that every current control has already been surrendered.

And a verifiable action is not automatically a fun action. We still need good combat, pacing, art, and a reason to care about the world. No consensus mechanism can write those for us.

## What we will build from here

We will follow these ideas at the pace of a small game becoming a larger one.

We will look at items and ownership, build a simple gameplay loop, and explore why the shape of a Sui object can matter as much as the code around it. Then we will get into immediate-feeling combat, fair randomness, transactions that succeed while the screen falls behind, and economies whose promises are actually enforced.

Some chapters will include code. Others will begin with a sword, a door, or a player waiting for something to happen. The examples will come first. The terminology will follow when it becomes useful.

The starting point is a world whose important actions have requirements the network can check. The question for the rest of this journal is how much we can build on that foundation—and how to make it feel like a game worth playing.

## Follow the implementation

The implementation links below are pinned to the code inspected for this article. Later changes may differ.

- [Travel checkpoints and movement checks](https://github.com/aresrpg/aresrpg/blob/f7158a3603f16e9780c20701f152e73f6c0a0a31/packages/move/sources/world.move).
- [First discovery, zone refresh, and consumption](https://github.com/aresrpg/aresrpg/blob/f7158a3603f16e9780c20701f152e73f6c0a0a31/packages/move/sources/zone.move).
- [Dungeon entry and progression](https://github.com/aresrpg/aresrpg/blob/f7158a3603f16e9780c20701f152e73f6c0a0a31/packages/move/sources/dungeon.move).
- [Sui derived objects](https://docs.sui.io/develop/objects/derived-objects), [onchain time](https://docs.sui.io/sui-stack/on-chain-primitives/access-time), and [native randomness](https://docs.sui.io/sui-stack/on-chain-primitives/randomness-onchain).
- [Sui consensus](https://docs.sui.io/develop/sui-architecture/consensus). Proof of Discovery is the gameplay pattern described here, not a replacement for that protocol.
