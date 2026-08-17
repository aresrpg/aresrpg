// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// The 17-stat block — PURE DATA (storage and rolling live in item.move, the storage owner).
/// Every value is CENTERED at 32768: a malus is a value below center, no signed integers on
/// chain ever (the legacy convention, carried).
module aresrpg_math::item_stats;

const SHIFT: u16 = 32768; // the center — 32768 means "+0"

public struct ItemStatistics has copy, drop, store {
  vitality: u16,
  wisdom: u16,
  strength: u16,
  intelligence: u16,
  chance: u16,
  agility: u16,
  range: u16,
  movement: u16,
  action: u16,
  critical: u16,
  raw_damage: u16,
  earth_resistance: u16,
  fire_resistance: u16,
  water_resistance: u16,
  air_resistance: u16,
}

/// Seeding constructor — the PTB builds min/max blocks and hands them to
/// `item::set_template_stats`. Crit rate/damage are NOT stats (owner 2026-08-11): a weapon's
/// crit is static per family + agility, never gear-rolled or runed — so no crit fields here.
public fun new(
  vitality: u16,
  wisdom: u16,
  strength: u16,
  intelligence: u16,
  chance: u16,
  agility: u16,
  range: u16,
  movement: u16,
  action: u16,
  critical: u16,
  raw_damage: u16,
  earth_resistance: u16,
  fire_resistance: u16,
  water_resistance: u16,
  air_resistance: u16,
): ItemStatistics {
  ItemStatistics {
    vitality,
    wisdom,
    strength,
    intelligence,
    chance,
    agility,
    range,
    movement,
    action,
    critical,
    raw_damage,
    earth_resistance,
    fire_resistance,
    water_resistance,
    air_resistance,
  }
}

public fun shift(): u16 { SHIFT }

/// The neutral block — every stat at center (+0).
public fun zero(): ItemStatistics {
  from_vector(vector[
    SHIFT, SHIFT, SHIFT, SHIFT, SHIFT, SHIFT, SHIFT, SHIFT,
    SHIFT, SHIFT, SHIFT, SHIFT, SHIFT, SHIFT, SHIFT,
  ])
}

/// Fold blocks into one centered total: bonuses and maluses accumulate separately, the result
/// clamps to [0, 65535]. Pure math — the equipment cache and future fight folds ride this.
public fun fold(blocks: &vector<ItemStatistics>): ItemStatistics {
  let shift = SHIFT as u64;
  let mut totals = vector[];
  let mut stat = 0;
  while (stat < 15) {
    let mut plus = 0u64;
    let mut minus = 0u64;
    let mut i = 0;
    while (i < blocks.length()) {
      let value = blocks[i].to_vector()[stat] as u64;
      if (value >= shift) { plus = plus + (value - shift) } else { minus = minus + (shift - value) };
      i = i + 1;
    };
    let total = if (plus >= minus) {
      let up = shift + (plus - minus);
      if (up > 65535) 65535 else up
    } else {
      let down = minus - plus;
      if (down >= shift) 0 else shift - down
    };
    totals.push_back(total as u16);
    stat = stat + 1;
  };
  from_vector(totals)
}

/// Flatten to a vector (stable order = field order) — the range validator and the roll walk it.
public fun to_vector(self: &ItemStatistics): vector<u16> {
  vector[
    self.vitality,
    self.wisdom,
    self.strength,
    self.intelligence,
    self.chance,
    self.agility,
    self.range,
    self.movement,
    self.action,
    self.critical,
    self.raw_damage,
    self.earth_resistance,
    self.fire_resistance,
    self.water_resistance,
    self.air_resistance,
  ]
}

/// Rebuild from a vector (same stable order) — the roll's return path.
public fun from_vector(v: vector<u16>): ItemStatistics {
  ItemStatistics {
    vitality: v[0],
    wisdom: v[1],
    strength: v[2],
    intelligence: v[3],
    chance: v[4],
    agility: v[5],
    range: v[6],
    movement: v[7],
    action: v[8],
    critical: v[9],
    raw_damage: v[10],
    earth_resistance: v[11],
    fire_resistance: v[12],
    water_resistance: v[13],
    air_resistance: v[14],
  }
}

// ╔════════════════ [ Raw magnitudes (the forge lane) ] ══════════════════════ ]

/// The block as RAW magnitudes above centre — `v ≥ SHIFT ? v − SHIFT : 0`. A malus (below
/// centre) reads 0: the forge treats it as an absent stat and never touches it.
public fun to_raw(self: &ItemStatistics): vector<u64> {
  let v = self.to_vector();
  let shift = SHIFT as u64;
  let mut raw = vector[];
  let mut i = 0;
  while (i < v.length()) {
    let x = v[i] as u64;
    raw.push_back(if (x >= shift) x - shift else 0);
    i = i + 1;
  };
  raw
}

/// Re-centre a forge result: apply the per-field RAW delta (`new_raw − old_raw`) onto the
/// current centred block. Untouched fields (every malus, every stat the forge left alone) keep
/// their exact value — only the changed magnitudes move. Clamps to [0, 65535].
public fun apply_raw(self: &ItemStatistics, new_raw: &vector<u64>): ItemStatistics {
  let cur = self.to_vector();
  let old_raw = self.to_raw();
  let mut out = vector[];
  let mut i = 0;
  while (i < cur.length()) {
    let base = (cur[i] as u64) + new_raw[i];
    let centred = if (base >= old_raw[i]) base - old_raw[i] else 0;
    out.push_back((if (centred > 65535) 65535 else centred) as u16);
    i = i + 1;
  };
  from_vector(out)
}

/// Scale every signed magnitude away from neutral by `numerator / denominator`.
public fun scale_from_center(
  self: &ItemStatistics,
  numerator: u64,
  denominator: u64,
): ItemStatistics {
  let center = SHIFT;
  from_vector(self.to_vector().map!(|value| {
    if (value >= center) {
      center + ((((value - center) as u64) * numerator / denominator) as u16)
    } else {
      center - ((((center - value) as u64) * numerator / denominator) as u16)
    }
  }))
}

public fun apply_centered_to_base(base: u64, centered: u64): u64 {
  let center = SHIFT as u64;
  if (centered >= center) {
    base + (centered - center)
  } else {
    let penalty = center - centered;
    if (penalty >= base) 1 else base - penalty
  }
}

// ╔════════════════ [ Reads ] ════════════════════════════════════════════════ ]

public fun vitality(self: &ItemStatistics): u16 { self.vitality }

public fun wisdom(self: &ItemStatistics): u16 { self.wisdom }

public fun strength(self: &ItemStatistics): u16 { self.strength }

public fun intelligence(self: &ItemStatistics): u16 { self.intelligence }

public fun chance(self: &ItemStatistics): u16 { self.chance }

public fun agility(self: &ItemStatistics): u16 { self.agility }

public fun range(self: &ItemStatistics): u16 { self.range }

public fun movement(self: &ItemStatistics): u16 { self.movement }

public fun action(self: &ItemStatistics): u16 { self.action }

public fun critical(self: &ItemStatistics): u16 { self.critical }

public fun raw_damage(self: &ItemStatistics): u16 { self.raw_damage }

public fun earth_resistance(self: &ItemStatistics): u16 { self.earth_resistance }

public fun fire_resistance(self: &ItemStatistics): u16 { self.fire_resistance }

public fun water_resistance(self: &ItemStatistics): u16 { self.water_resistance }

public fun air_resistance(self: &ItemStatistics): u16 { self.air_resistance }
