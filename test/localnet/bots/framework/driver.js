// PTB DRIVERS — the wrappers over the @aresrpg/sdk write builders. Each: build the tx via the SDK builder
// (NEVER a hand-rolled PTB), record every entry-fn it calls (coverage), submit it signed by the bot key with
// the money-law retry policy, and return the wrapped effects + the created object ids the next step needs.
//
// One Driver is bound per bot: { context, client, signer, coverage, stats, submit_fn }. submit_fn is
// injectable so the offline self-test swaps a deterministic mock for the real framework/sui.js submit() — the
// SAME real PTBs are built & coverage-recorded either way. Every driver method hands submit a BUILD THUNK so a
// pre-execution retry rebuilds the tx with freshly-resolved object refs (submit owns the retry/classify law).

import * as B from './sdk.js'
import { submit as real_submit, simulate, get_fields } from './sui.js'

export class Driver {
  constructor({ bot, context, client, signer, coverage, stats, submit_fn = real_submit, budget }) {
    this.bot = bot // { name, address, keypair }
    this.context = context
    this.client = client
    this.signer = signer ?? bot.keypair
    this.address = bot.address
    this.coverage = coverage
    this.stats = stats
    this.submit_fn = submit_fn
    this.budget = budget
    this.selected_character = null
  }

  /** Select which of this wallet's characters supplies default identity ids for the next step. */
  select_character(character) {
    if (!character?.character_id) throw new Error('select_character needs character_id')
    this.selected_character = {
      character_id: character.character_id,
      kiosk_id: character.kiosk_id ?? null,
      personal_kiosk_cap_id: character.personal_kiosk_cap_id ?? null,
    }
    return this.selected_character
  }

  /** Explicit step args win; omitted character/kiosk ids come from the selected character. */
  selected_character_args(args = {}) {
    if (!this.selected_character) throw new Error('no character selected')
    return { ...this.selected_character, ...args }
  }

  /**
   * Build (once, for coverage + attempt 1), submit with retry, tally the outcome class.
   * @param {string} step
   * @param {() => import('@mysten/sui/transactions').Transaction} build  the SDK builder call (rebuilt on retry)
   */
  async _drive(step, build, options = {}) {
    const tx = build()
    const fns = this.coverage.record(tx, { bot: this.bot.name, step })
    const res = options.preflight_only
      ? await simulate({ client: this.client, tx, budget: this.budget, sender: this.address })
      : await this.submit_fn({
          client: this.client,
          signer: this.signer,
          tx,
          rebuild: build,
          budget: this.budget,
          sender: this.address,
          step,
          bot: this.bot.name,
        })
    this.stats?.record(res)
    return { step, res, fns }
  }

  // ── creation / onboarding ──────────────────────────────────────────────────────────────────────────────
  async create_character(args) {
    // The FREE door is zkLogin-gated ON-CHAIN (creation.move `check_zklogin_issuer` → ENotZkLoginAddress=109):
    // a plain Ed25519 bot key can NEVER mint through it, whatever address_seed it fabricates. LIVE bots go
    // through the PAID door at the gate's LIVE price — read off the shared Creation object every call (never a
    // hardcoded number; bots hold ~1000 faucet SUI vs the 10 SUI default). OFFLINE (MockChain — context.ids is
    // undefined, no live gate to read) keeps the free-door build: same self-test coverage as before.
    // `door: 'free'` FORCES the free door — the adversary's free-mint rejection probe drives the gate on purpose.
    const creation_id = this.context.ids?.aresrpg?.CREATION
    let price_mist = args.door === 'free' ? null : (args.price_mist ?? null)
    if (price_mist == null && args.door !== 'free' && creation_id) {
      const gate = await get_fields(this.client, creation_id).catch(() => null)
      if (gate?.price != null) price_mist = BigInt(gate.price)
    }
    const r = await this._drive('create_character', () =>
      price_mist != null
        ? B.create_character_paid_ptb(this.context)({ price_mist, ...args })
        : B.create_character_free_ptb(this.context)({
            address_seed: args.address_seed ?? BigInt('0x' + (this.address.slice(2, 18) || '1')),
            ...args,
          })
    )
    return {
      ...r,
      character_id: r.res.created('::character::Character'),
      kiosk_id: r.res.createdIncl('0x2::kiosk::Kiosk'),
      personal_kiosk_cap_id: r.res.createdIncl('::personal_kiosk::PersonalKioskCap', this.address),
    }
  }

  async onboard_kiosk() {
    const r = await this._drive('onboard_kiosk', () => B.onboard_kiosk_ptb(this.context)({}))
    return {
      ...r,
      kiosk_id: r.res.createdIncl('0x2::kiosk::Kiosk'),
      personal_kiosk_cap_id: r.res.createdIncl('::personal_kiosk::PersonalKioskCap', this.address),
    }
  }

  // ── world ──────────────────────────────────────────────────────────────────────────────────────────────
  enter_world(args) {
    const { __expect_abort, ...input } = args
    return this._drive('enter_world', () => B.join_world_ptb(this.context)(input), {
      preflight_only: __expect_abort === true,
    })
  }
  search(args) {
    return this._drive('search', () => B.search_zone_ptb(this.context)(args))
  }
  async gather(args) {
    const r = await this._drive('gather', () => B.gather_ptb(this.context)(args))
    return { ...r, item_id: item_of(r.res) }
  }

  // ── fight lifecycle ────────────────────────────────────────────────────────────────────────────────────
  async create_fight(args) {
    const r = await this._drive('create_fight', () => B.create_fight_ptb(this.context)(args))
    return { ...r, fight_id: r.res.created('::fight::Fight') ?? r.res.event('::fight::FightCreated')?.fight ?? null }
  }
  place(args) {
    return this._drive('place', () => B.place_ptb(this.context)(args))
  }
  commit_turn(args) {
    return this._drive('commit_turn', () => B.commit_turn_ptb(this.context)(args))
  }
  // Single in-turn actions (the tactical solver in framework/world_flow.js drives these individually so it can
  // read board state between strikes and stop the instant a mob dies — a batched commit_turn would revert the
  // whole turn on an over-strike of a just-killed cell). act_move/act_weapon are deterministic; act_pass is the
  // turn's one terminal `&Random` command (the mob wave draws).
  act_move(args) {
    return this._drive('act_move', () => B.act_move_ptb(this.context)(args))
  }
  act_weapon(args) {
    return this._drive('act_weapon', () => B.act_weapon_ptb(this.context)(args))
  }
  act_pass(args) {
    return this._drive('act_pass', () => B.act_pass_ptb(this.context)(args))
  }
  force_start(args) {
    return this._drive('force_start', () => B.force_start_ptb(this.context)(args))
  }
  crank(args) {
    return this._drive('crank', () => B.crank_ptb(this.context)(args))
  }
  async settle_open_world(args) {
    // settle_and_take -> open_taken in ONE PTB: mints FightOutcome, deletes Fight, mints FightResult + XP/HP writeback.
    const r = await this._drive('settle_open_world', () => B.settle_open_world_ptb(this.context)(args))
    return {
      ...r,
      result_id: r.res.created('::results::FightResult') ?? r.res.event('::results::ResultOpened')?.result ?? null,
    }
  }
  async mint_rolled(args) {
    const r = await this._drive('mint_rolled', () => B.mint_rolled_ptb(this.context)(args))
    return { ...r, item_id: item_of(r.res) }
  }

  // ── crafting / gear / forgemagie ───────────────────────────────────────────────────────────────────────
  async craft(args) {
    const r = await this._drive('craft', () => B.craft_ptb(this.context)(args))
    return { ...r, item_id: item_of(r.res) }
  }
  equip(args) {
    return this._drive('equip', () => B.equip_ptb(this.context)(args))
  }
  unequip(args) {
    return this._drive('unequip', () => B.unequip_ptb(this.context)(args))
  }
  /** CRUSH gear on the forgemagie board (terminal &Random). Needs the seed CrushBoard id + >=CRUSH_TEMPLATE_SLOTS
   *  distinct filler ItemTemplate ids; pass gas_budget_mist to skip the un-measured-constant refusal on localnet. */
  crush(args) {
    return this._drive('crush', () => B.crush_ptb(this.context)({ gas_budget_mist: this.budget, ...args }))
  }

  // ── shop / marketplace / pools ─────────────────────────────────────────────────────────────────────────
  async buy_from_shop(args) {
    const r = await this._drive('buy_from_shop', () => B.buy_ptb(this.context)(args))
    return { ...r, item_id: item_of(r.res) }
  }
  list(args) {
    return this._drive('list', () => B.list_ptb(this.context)(args))
  }
  list_stack(args) {
    return this._drive('list_stack', () => B.list_stack_ptb(this.context)(args))
  }
  delist(args) {
    return this._drive('delist', () => B.delist_ptb(this.context)(args))
  }
  async pool_buy(args) {
    const r = await this._drive('pool_buy', () => B.pool_buy_ptb(this.context)(args))
    return { ...r, item_id: item_of(r.res) }
  }
  pool_sell(args) {
    return this._drive('pool_sell', () => B.pool_sell_ptb(this.context)(args))
  }

  // ── dungeon ────────────────────────────────────────────────────────────────────────────────────────────
  async dungeon_activate(args) {
    const r = await this._drive('dungeon_activate', () => B.activate_ptb(this.context)(args))
    return { ...r, run_pass_id: r.res.created('::run::RunPass') ?? r.res.event('::dungeon::RunStarted')?.pass ?? null }
  }
  async dungeon_next_fight(args) {
    const r = await this._drive('dungeon_next_fight', () => B.next_fight_ptb(this.context)(args))
    return { ...r, fight_id: r.res.created('::fight::Fight') ?? r.res.event('::fight::FightCreated')?.fight ?? null }
  }
  dungeon_settle_run(args) {
    return this._drive('dungeon_settle_run', () => B.settle_run_ptb(this.context)(args))
  }
  dungeon_abandon(args) {
    return this._drive('dungeon_abandon', () => B.dungeon_abandon_ptb(this.context)(args))
  }

  // ── social ─────────────────────────────────────────────────────────────────────────────────────────────
  async create_party() {
    const r = await this._drive('create_party', () => B.create_party_ptb(this.context)({}))
    return { ...r, party_id: r.res.created('::party::Party') ?? r.res.event('::party::PartyJoined')?.party ?? null }
  }
  party_invite(args) {
    return this._drive('party_invite', () => B.party_invite_ptb(this.context)(args))
  }

  async marketplace_buy(args) {
    const { __expect_abort, ...input } = args
    const r = await this._drive('marketplace_buy', () => B.marketplace_buy_item_ptb(this.context)(input), {
      preflight_only: __expect_abort === true,
    })
    return {
      ...r,
      kiosk_id: input.kiosk_id ?? r.res.createdIncl?.('0x2::kiosk::Kiosk'),
      personal_kiosk_cap_id:
        input.personal_kiosk_cap_id ?? r.res.createdIncl?.('::personal_kiosk::PersonalKioskCap', this.address),
    }
  }
}

/** first minted Item id from a result (objectChanges, else the ItemMinted event). */
function item_of(res) {
  return res.created('::item::Item') ?? res.event('::item::ItemMinted')?.item ?? null
}
