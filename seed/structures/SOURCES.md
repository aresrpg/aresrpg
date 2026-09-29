# Structure sources

- `types.json` was imported from the archived `aresrpg/aresrpg-dapp` tree and rock schematic pack at commit `07f8c7b`.
- `temperate_ruined_arch`, `desert_broken_columns`, `scorched_altar`, and `swamp_broken_wall` were generated during the original structure import.
- The ten `nauvis_*` colossal landmark types were generated during the original structure import.

The JSON catalog is the runtime geometry source. Original `.schem` files are migration inputs and do not ship.

- `workshop.recipe.json` authors the modular kit and demonstration street parcels. `townhouse.family.json` authors the facade pattern, dimensions and permitted architectural variants used by the offline compiler. Its banner is a pixel-geometry interpretation of the canonical AresRPG helmet in `packages/frontend/public/logo.png`.

- `thebes_arrival.recipe.json` authors the portal court, terrain-fitted ruins, leaf overgrowth, coastal paving, sandy cove, stone piers, benches and banner standards. Lanterns and banners reference the workshop’s canonical props. The city tree placements reuse `types.json`, including the swamp tree variants; no separate city tree generator is retained.

- `thebes_farmstead.recipe.json` composes the workshop’s shared `house_architecture`, fences and covered well. The original house wrapper owns its workshop planting; farm planting uses the world scenery recipe.

- `thebes_gate.recipe.json` authors two mirrored stone guardians and their stepped arch. `thebes_entry_street.recipe.json` owns the first curated entrance district: townhouse-family geometry adapted into authored modules, with two shared octagonal watchtowers. Their shader vines live in the world scenery recipe.

- `thebes_left_bank.recipe.json` authors attached market rows, individual hillside and ravine homes, a rock-roofed quarry court, the cathedral, cemetery, narrow supported paths and the enclosing curtain with six roofed bastions. Repeated wall columns are shared schematic parts, not new runtime geometry rules. The guardian recipe uses native integer voxel scaling and half-height burial.

- `thebes_castle.recipe.json` authors the full fortress: great keep, offset donjon, chapel and solar wings, octagonal towers, curtain walks, bridge gate, galleries, courts and stair flights. Repeated vertical runs share schematic assets; the previous native castle builders are removed.

- `thebes_castle_ward.recipe.json` replaces the former right-bank house grid with 25 varied hillside homes, the shared workshop manor, two roofed outposts and connected ramparts. Its castle-side passage and bridge approach use explicit-air carving and supported stone paths.

- `main_menu_houses.recipe.json` stores the harbor’s newer townhouse variants. Main-menu placements also reference the original workshop `house_architecture` directly. The menu compiler adds winter materials and supported slab snow caps; it does not retain the former wing-and-diagonal-beam house generator.
