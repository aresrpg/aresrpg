# AresRPG 2.5.13 — progression, crafting & quality of life

**🧭 A beginner journey**

A new optional quest journal guides your first tools, harvests, crafted equipment, food, and Gilded Lorito clear, with a bonus gathering challenge afterward.

- Track objectives from the world and open the journal for directions.
- Jump to relevant recipes, profession pages, and the marketplace.
- Existing items count toward ownership objectives; harvesting objectives require harvesting.
- Completion saves locally in your browser. Reopen or reset the journey from Settings.

---

# Crafting, loot & spell balance

**🔨 Updated recipes**

- Rebalanced early Forger, Carver, Tailor, Tanner, Handyman, and Alchemist recipes across wood, crops, minerals, mushrooms, and mob drops.
- Starter gathering tools now cost **3 branches + 2 of their other ingredient**, down from 5 + 5.
- Mushroom Lacquer now uses **1 resin**; Rootglass Token needs **1 lacquer**.
- Recall Potion now costs **1 resin + 5 green mushrooms + 1 water**.
- **Tangled Aftermath key:** 3 Aragne Fangs + 2 Aragne Carapaces + 1 Embertide Webbing.
- **Ivory Rampart key:** 1 Fuwa Horn + 1 Fuwa Eye + 1 Fuwa Fleece + 1 Nifuwa Fleece. Both keys now use crafted intermediates.
- Added **Wheat-Stitched Leather** and **Resin-Cured Leather**, with new icons and uses in later equipment recipes.

**🎒 More resources from fights**

- Nook: **3–5 scrap** per successful drop; Shiny Trinkets now have a **60% base drop chance**, yielding **2–3**.
- Bramble: **2–3 rabbit pelts** per successful drop.
- Tinker can drop up to **2 branches or resin**. Wild Boar now drops both resources too.
- White Fuwa can drop up to **2 wool**.
- Increased water quantities from several Aragne, Misui, and Lorito variants; Fukuo now drops water too.

**⚔️ Combat fixes & balance**

- Fixed the dark-screen crash when a starting cell becomes occupied as another character joins.
- Improved recovery after rejected placement and kept fight hover information consistent as fighters change.
- **Mass Trap:** larger area at spell levels 5 and 6.
- **Feline Movement:** level-3 critical casts now consistently grant 3 MP.
- **Shadowstep:** replaces invisibility with nearby air life steal. Spell level 6 also gains 6 range and a 3-turn cooldown.

---

# A more flexible interface

**🖥️ Screens, panels & chat**

- World overlays adapt to the available space: minimap, compass, chat, party panel, and action bar.
- Stats, spells, jobs, and Rune Forge fit smaller screens and browser zoom while retaining their familiar desktop layouts.
- The sidebar fits its full stack, with the server card pinned at the bottom. Equipment stays top-aligned beside the full-height inventory.
- Drag the subtle **top-right chat grip** to resize chat. It stays inside the world view and leaves room for the action bar.
- Improved narrow layouts and controls across the encyclopedia, marketplace, KARES staking, Airdrops, Kolizeum, and item/wallet pickers.
- Fixed KARES staking panels overflowing the desktop viewport while preserving their vertical spacing.
- Fixed marketplace tooltips intercepting clicks outside their intended area.

**💰 Rolling marketplace volume**

- Added **24h** and **30d** volume badges, refreshed automatically every 5 seconds.
- Both show rolling windows, rather than resetting at midnight or a Sui epoch boundary.
- Totals cover public item and character sales before fees; private trades are excluded.
- Each window shows **—** until complete history is available. A verified window with no sales shows **0**.

**🔎 Find what you need**

- Inventory resource filters: **Raw · Gatherable · Intermediary · Keys · Runes**.
- Admin and sidebar now show the same live online-player count.
- The demo content editor shows which mobs drop each item, with base drop rates and quantities.

Update preparation now runs checks in parallel, reuses installed browsers, and avoids repeating unrelated tests after browser-only changes. Existing test coverage and content validation remain enforced.
