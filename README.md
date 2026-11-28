# Settlement Core — v0.3.0 (library)

The shared base for the settlement modules. It has **no windows**. It holds the common concepts (tiles, resources, buildings), applies every change through one GM-hosted pipeline, publishes a player-safe copy, and runs the week clock. Tiles, Settlement and Teams build their screens on top of it.

> **Untested in Foundry.** The data model, rules and the Foundry glue (against stubbed globals) pass Node tests: `node --test tests/core.test.mjs tests/glue.smoke.mjs`. Nothing has run in a live world. Back up first.

## Using it from another module

`module.json`:

```json
"relationships": { "requires": [{ "id": "settlement-core", "type": "module" }] }
```

```js
Hooks.once("settlementCore.register", core => {      // fires at setup: add definitions and actions here
  core.define("buildings", "smithy-3", { label: "Smithy", complexity: 3, hosts: ["settlement"] });
  core.registerAction("teams.move", { permission: "player", run(state, args, ctx) { /* change state.modules.teams */ } });
});
Hooks.once("settlementCore.ready", core => { /* data is loaded */ });
Hooks.on("settlementCore.changed", state => { /* re-render */ });
Hooks.on("settlementCore.phase", ({ phase, week, newWeek }) => { /* upkeep, reset weekly actions... */ });
const core = game.modules.get("settlement-core").api;
```

## Concepts

**Definitions** live in a registry with six kinds: `resources`, `terrains`, `tags`, `buildings`, `discoverables`, `activities`. The Liftland set loads by default (setting: *Load the Liftland content set*). Any entry can be replaced with `core.define(kind, id, def)`.

**Tile** — addressed by `sceneId` + `key` (`"row,col"`).
`{ key, name, terrain, adjust, tags: { id: true | "state" }, revealed, explores, discoverables: [...], slots: [...], notes, gmNotes, ext }`
- `terrain` is a terrain id. `adjust` is a per-tile Difficulty tweak.
- Hills are tags (`low-hills` +1/+1, `steep-hills` +3/+3), as are `lifted`, `coastal`, `crystal-growth` and `crystal-waters` (states `present` / `dense`). Tags can carry `difficulty` and `forage` modifiers and an `overlay` flag for the Tiles module to draw.
- `explores` counts successful Explore activities. Fully Explored = revealed and 6 of them (`activities.explore.successesNeeded`), whatever was found. Add one with `addExplore(sceneId, key)`.

**Discoverable** (on a tile): `{ id, type, name, tier 1-4, modifier, found, slots: [...], notes, gmNotes }`.

**Building** — a definition only. It does not know where it is.
`{ label, complexity (its level), level?, weeks?, dc?, materialsPerWeek?, hosts: ["settlement" | "tile" | "discoverable"], family?, requires?, needs?, skills?, terrain?, tileTags?, discoverableCategories?, discoverableTypes?, effects?, text? }`
- Each level is its own building; level II has `requires: "<level I id>"`.
- `effects` is what it does for whatever holds it: `security`, `houses`, `travelDC`, `yieldStep`, `bonusResources`, `workDie`, `produces`, `morale`...

**Slot** — lives on the host (a settlement, a tile, or a discoverable): `{ id, built, pending: { building, progress } | null, damaged }`.
- The host references the building; progress is tracked on the host's slot.
- An upgrade reuses the earlier level's slot, which keeps working until the upgrade finishes (and takes one week less).
- Limits: the improvement **levels** on a discoverable cannot total more than its tier; any host holds one building per `family`.

**Resource Improvements** are general, not per resource: `yield-1..4` (die one size larger per level), `difficulty-dc-1..4` (-1 Work DC per level) and `difficulty-check-1..4` (+1 to the Work check per level). A tier 2 resource can hold Yield L2, or Yield L1 plus a Difficulty L1. Quarry, Fishery, Lumber Camp, Farm and the rest are tile Infrastructure only. `workProfile(discoverableRef)` returns the resulting `{ die, dc, checkBonus, levels, tier }`.

**Base DCs** come from the activity definitions (`dc`): Travel, Explore, Forage, Work 25; Improve, Craft, Research 30; Aid, Recover 20. `improve.dcStep` (2) is added per building level above 1; a building can set its own `dc`. Override any of them with `core.define("activities", id, {...})`.

**Host reference:** `{ kind: "settlement", id }`, `{ kind: "tile", sceneId, key }` or `{ kind: "discoverable", sceneId, key, id }`.

**Settlement:** `{ id, name, home: { sceneId, key } | null, resources: { id: { amount, access } }, morale (-10..10), population, slots, notes, gmNotes, ext }`. Four resources: rations, materials, resources, supplies. Unique things are items, not a resource.

**Clock:** `phase` is one of `upkeep`, `assignment`, `resolution`, `weekEnd`; finishing `weekEnd` starts a new `week`.

**Module data:** `state.modules[yourId] = { public: {...}, gm: {...} }`. The `gm` half is never sent to players. The same `ext` shape exists on tiles and settlements.

## API

Reads return copies. A GM gets everything; a player gets only revealed tiles, found discoverables, and no GM notes.

| Read | |
|---|---|
| `getState()`, `getTile(sceneId, key)`, `getTiles(sceneId)`, `getSettlement(id)`, `getSettlements()`, `getClock()`, `getModuleData(id)` | Data |
| `get(kind, id)`, `all(kind)`, `registry` | Definitions |
| `tileDCs(sceneId, key, { familiar })` | `{ travel, explore, forage, impassable, fullyExplored, explores, exploresNeeded }`; `travel` is `null` when impassable |
| `workProfile(discoverableRef)`, `activityDC(id)`, `leaderSecurity([levels])` | Work die and DC on a resource; an activity's base DC; Security added by Leaders (half level each, rounded down) |
| `tileModifiers(sceneId, key)`, `tileSecurity(sceneId, key)`, `isSecure(security, population)`, `isFullyExplored(sceneId, key)` | Tile rules |
| `canAttach(host, buildingId)` → `{ ok, reason }`, `buildOptions(host)`, `builtOn(host)`, `buildDC(buildingId)` | Buildings |
| `degree(total, dc, { canCrit })` | PF2e degree of success |

Writes return a Promise and are applied by the hosting GM's client, so a GM must be online.

| Write | Action name |
|---|---|
| `saveTile(sceneId, key, patch)`, `revealTile`, `addExplore(sceneId, key, count?)`, `setTag(sceneId, key, tag, value)` | `tile.save`, `tile.reveal`, `tile.explore`, `tile.setTag`, `tile.delete` |
| `addDiscoverable(sceneId, key, data)`, `updateDiscoverable(sceneId, key, id, patch)` | `discoverable.add`, `.update`, `.remove` |
| `attach(host, buildingId, complete?)`, `addProgress(host, slotId, weeks)`, `cancelPending(host, slotId)`, `detach`, `setDamaged` | `building.attach`, `.progress`, `.cancel`, `.detach`, `.damage` |
| `createSettlement(name, home, id?)`, `patchSettlement(id, patch)` | `settlement.create`, `.patch`, `.delete` |
| `adjustResource(settlementId, resource, delta)`, `setAccess(settlementId, resource, bool)` | `resource.adjust`, `resource.setAccess` |
| `advancePhase()` | `clock.advance`, `clock.set` |
| `setModuleData(id, { public, gm })` | `module.set` |
| `request(actionName, args)` | Any action, including ones a module registered |

`registerAction("yourmodule.name", { permission: "gm" | "player", run(state, args, ctx) })` adds your own change to the pipeline. `run` edits `state` directly and may return a value; `ctx` is `{ reg, isGM, userId }`. Throw an `Error` to reject; nothing is saved.

## Several steps in one action: `ctx.core`

A registered action is all-or-nothing: if `run` throws, nothing is saved. Inside `run`, use `ctx.core` for core's own rules. It has the same names and arguments as the public API, acts on that run's state, and returns directly (no Promise).

```js
core.registerAction("yourmodule.applyAttempt", { run(state, a, ctx) {
  ctx.core.adjustResource(a.settlementId, "materials", -a.cost);   // throws "Not enough materials"
  const res = ctx.core.addProgress(a.host, a.slotId, 1);            // { complete, progress, needed }
  if (res.complete) { /* ... */ }
  return res;                                                        // anything thrown above rolls it all back
} });
```

`ctx.core` has: `getState`, `getTile`, `getSettlement`, `getClock`, `get`, `all`, `tileDCs`, `tileModifiers`, `tileSecurity`, `isFullyExplored`, `isSecure`, `degree`, `leaderSecurity`, `activityDC`, `buildDC`, `weeksFor`, `workProfile`, `canAttach`, `buildOptions`, `builtOn`, `attach`, `addProgress`, `cancelPending`, `detach`, `setDamaged`, `adjustResource`, `setAccess`, `addExplore`, `advancePhase`.

Rules for `run`:

- **Never call `core.request` or any API write from inside it.** It would wait on the write queue that is running it.
- **Keep it fast and free of side effects.** It holds the queue for every module. Roll dice and show dialogs first and pass the results in as args; post chat messages after the request resolves.
- **Permissions are yours.** `ctx.core` does not re-check GM permission, so a `permission: "player"` action can change anything it calls. Check `ctx.isGM` and `ctx.userId` where it matters.
- `ctx.core` is missing before 0.3.0; feature-detect it.

## Storage

- Full state: a GM-only journal entry, "Settlement Core — Private State".
- Player copy: the world setting `settlement-core.public`, rewritten after every change.

## Changes in v0.3.0

- `ctx.core` inside registered actions (see above).
- `weeksFor(buildingId, upgrading = false)` added to the public API.
- Nothing removed or renamed.

## Changes in v0.2.1

- `cancelPending(host, slotId)` (`building.cancel`): drops a pending build. An upgrade keeps the finished earlier level; a new build frees its slot. Use this, not detach-then-attach, which fails for any building with `requires`.
- Every discoverable definition has `produces`: a resource id, or `null` when Working it yields specific items.
- Access labels: `setAccess(settlementId, label, bool)` accepts any label ("lumber", "stone"), not only the four resource ids. Those entries sit in `settlement.resources` with amount 0.

## Changes in v0.2.0

- Base DCs raised and moved into the activity definitions.
- General Resource Improvements (Yield, Difficulty) replace the named ones; limit is total levels per tier.
- Fully Explored is 6 successful Explores; `unknownResolved` is gone (old data converts).
- `workProfile`, `activityDC`, `leaderSecurity`, `addExplore` added. `COMPLEXITY` removed.
- Provisional numbers, to be confirmed by the rules: improvement levels 3-4 (weeks = level, Materials per week = level) and the +2 DC per level.

## Not in this version

- Migration from the Tile Manager's old store (the group has raw notes to re-enter instead).
- Work yields, build material checks, upkeep and event rolls: the data and DCs are here, the procedures belong to the Settlement and Teams modules.
- Hex adjacency (for "population on this tile and its neighbours"); the Tiles module knows the grid and passes the population in.
