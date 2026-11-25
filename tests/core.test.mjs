import assert from "node:assert/strict";
import { test } from "node:test";
import * as C from "../scripts/core.mjs";
import { LIFTLAND } from "../scripts/content-liftland.mjs";

const reg = () => C.createRegistry().defineAll(LIFTLAND);
const ctx = r => ({ reg: r, isGM: true, userId: "gm" });
const run = (s, r, name, args, c = ctx(r)) => C.runAction(C.ACTIONS, s, name, args, c);
const setup = () => {
  const r = reg(), s = C.blankState();
  run(s, r, "tile.save", { sceneId: "S", key: "1,1", patch: { terrain: "woodland", revealed: true, gmNotes: "secret" } });
  run(s, r, "settlement.create", { id: "main", name: "Home", home: { sceneId: "S", key: "1,1" } });
  return { r, s, tile: { kind: "tile", sceneId: "S", key: "1,1" } };
};

test("registry: define, override, content has no dangling references", () => {
  const r = reg();
  assert.equal(r.get("terrains", "woodland").difficulty, 2);
  r.define("terrains", "woodland", { label: "Woodland", difficulty: 3, forage: -3 }); assert.equal(r.get("terrains", "woodland").difficulty, 3);
  assert.equal(r.all("resources").length, 4); assert.ok(!r.has("resources", "uniques"));
  for (const b of r.all("buildings")) {
    if (b.requires) assert.ok(r.has("buildings", b.requires), b.id);
    for (const t of b.terrain || []) assert.ok(r.has("terrains", t), b.id);
    for (const t of b.tileTags || []) assert.ok(r.has("tags", t), b.id);
    for (const t of b.discoverableTypes || []) assert.ok(r.has("discoverables", t), `${b.id} -> ${t}`);
    assert.ok(C.buildDC(b, r) >= 30, b.id);
  }
});
test("tile DCs: base 25, hills as tags, water, six explores", () => {
  const { r, s } = setup(); const T = () => C.getTile(s, "S", "1,1");
  assert.deepEqual([C.tileDCs(T(), r).travel, C.tileDCs(T(), r).explore, C.tileDCs(T(), r).forage], [27, 27, 22]);
  run(s, r, "tile.setTag", { sceneId: "S", key: "1,1", tag: "steep-hills", value: true });
  assert.deepEqual([C.tileDCs(T(), r).travel, C.tileDCs(T(), r).forage], [30, 25]);
  run(s, r, "tile.setTag", { sceneId: "S", key: "1,1", tag: "steep-hills", value: false });
  run(s, r, "tile.setTag", { sceneId: "S", key: "1,1", tag: "lifted", value: true }); assert.equal(C.tileDCs(T(), r).travel, 27);
  const id = run(s, r, "discoverable.add", { sceneId: "S", key: "1,1", data: { type: "root-tuber-bed", tier: 2 } });
  run(s, r, "discoverable.update", { sceneId: "S", key: "1,1", id, patch: { found: true } });
  assert.equal(C.tileDCs(T(), r).forage, 20);            // known food source -2
  for (let i = 0; i < 5; i++) run(s, r, "tile.explore", { sceneId: "S", key: "1,1" });
  assert.equal(C.isFullyExplored(T()), false); assert.equal(C.tileDCs(T(), r).explores, 5);
  assert.equal(run(s, r, "tile.explore", { sceneId: "S", key: "1,1" }), 6);
  assert.equal(C.isFullyExplored(T()), true); assert.equal(C.tileDCs(T(), r).travel, 25); assert.equal(C.tileDCs(T(), r).forage, 18);
  run(s, r, "tile.save", { sceneId: "S", key: "2,2", patch: { terrain: "water", revealed: true } });
  const w = C.tileDCs(C.getTile(s, "S", "2,2"), r); assert.equal(w.travel, null); assert.match(w.impassable, /vehicle/);
  r.define("activities", "travel", { label: "Travel", cost: 1, dc: 15 }); assert.equal(C.tileDCs(T(), r).travel, 15);
  assert.equal(C.validateState({ tiles: { S: { "1,1": { unknownResolved: true } } } }).tiles.S["1,1"].explores, 6);
});
test("buildings attach to hosts, levels require the previous level, progress lives on the slot", () => {
  const { r, s, tile } = setup();
  assert.equal(C.canAttach(s, r, tile, "farm-1").ok, false);                 // woodland
  assert.equal(C.canAttach(s, r, tile, "lumber-camp-2").ok, false);          // needs level I
  const slot = run(s, r, "building.attach", { host: tile, building: "lumber-camp-1" });
  assert.equal(C.builtOn(C.getTile(s, "S", "1,1"), r).length, 0);
  assert.equal(run(s, r, "building.progress", { host: tile, slotId: slot }).complete, true);
  assert.throws(() => run(s, r, "building.attach", { host: tile, building: "lumber-camp-1" }));
  const up = run(s, r, "building.attach", { host: tile, building: "lumber-camp-2" }); assert.equal(up, slot);
  assert.equal(C.builtOn(C.getTile(s, "S", "1,1"), r)[0].id, "lumber-camp-1");  // old level works during the upgrade
  const p = run(s, r, "building.progress", { host: tile, slotId: slot });       // II is 2 weeks, minus 1 as an upgrade
  assert.equal(p.complete, true); assert.equal(C.getTile(s, "S", "1,1").slots[0].built, "lumber-camp-2");
  assert.equal(C.getTile(s, "S", "1,1").slots.length, 1);
});
test("general improvements: levels count against the resource's tier and change Work", () => {
  const { r, s } = setup();
  const id = run(s, r, "discoverable.add", { sceneId: "S", key: "1,1", data: { type: "pebble-hen-nest", tier: 2 } });
  const host = { kind: "discoverable", sceneId: "S", key: "1,1", id };
  assert.deepEqual(C.workProfile(s, r, host), { die: "d6", dc: 25, checkBonus: 0, bonusResources: 0, levels: 0, tier: 2 });
  assert.equal(C.canAttach(s, r, host, "quarry-1").ok, false);                 // infrastructure does not go on a resource
  assert.equal(C.canAttach(s, r, host, "yield-2").ok, false);                  // needs L1
  const y = run(s, r, "building.attach", { host, building: "yield-1" });
  assert.equal(run(s, r, "building.progress", { host, slotId: y }).complete, true);
  assert.equal(C.workProfile(s, r, host).die, "d8");
  run(s, r, "building.attach", { host, building: "difficulty-dc-1", complete: true });
  assert.equal(C.workProfile(s, r, host).dc, 24); assert.equal(C.workProfile(s, r, host).levels, 2);
  assert.match(C.canAttach(s, r, host, "yield-2").reason, /level/);            // tier 2 is full: Yield L1 + Difficulty L1
  assert.match(C.canAttach(s, r, host, "difficulty-check-1").reason, /level/);
  run(s, r, "discoverable.update", { sceneId: "S", key: "1,1", id, patch: { tier: 3 } });
  const up = run(s, r, "building.attach", { host, building: "yield-2" }); assert.equal(up, y);
  assert.equal(run(s, r, "building.progress", { host, slotId: y }).complete, false);   // L2 takes 2 weeks
  assert.equal(C.workProfile(s, r, host).die, "d10");                           // tier 3 d8, +1 step while L1 still works
  assert.equal(run(s, r, "building.progress", { host, slotId: y }).complete, true);
  assert.equal(C.workProfile(s, r, host).die, "d12");
  assert.equal(C.buildDC(r.get("buildings", "yield-1"), r), 30); assert.equal(C.buildDC(r.get("buildings", "yield-3"), r), 34);
});
test("cancel a pending build; every discoverable says what it produces", () => {
  const { r, s } = setup();
  const id = run(s, r, "discoverable.add", { sceneId: "S", key: "1,1", data: { type: "herb-cluster", tier: 3 } });
  const host = { kind: "discoverable", sceneId: "S", key: "1,1", id };
  const y = run(s, r, "building.attach", { host, building: "yield-1", complete: true });
  run(s, r, "building.attach", { host, building: "yield-2", complete: true });
  run(s, r, "building.attach", { host, building: "yield-3" });
  assert.equal(run(s, r, "building.cancel", { host, slotId: y }), "kept");
  assert.equal(C.resolveHost(s, host).target.slots[0].built, "yield-2"); assert.equal(C.resolveHost(s, host).target.slots[0].pending, null);
  const d = run(s, r, "building.attach", { host, building: "difficulty-dc-1" });
  assert.equal(run(s, r, "building.cancel", { host, slotId: d }), "removed"); assert.equal(C.resolveHost(s, host).target.slots.length, 1);
  assert.throws(() => run(s, r, "building.cancel", { host, slotId: y }));
  for (const x of r.all("discoverables")) assert.ok(x.produces === null || r.has("resources", x.produces), x.id);
  assert.equal(r.get("discoverables", "herb-cluster").produces, "supplies"); assert.equal(r.get("discoverables", "pebble-hen-nest").produces, "rations");
});
test("security from tile buildings and a settlement at home", () => {
  const { r, s, tile } = setup();
  run(s, r, "building.attach", { host: { kind: "settlement", id: "main" }, building: "portal-hall", complete: true });
  run(s, r, "building.attach", { host: tile, building: "shelter-1", complete: true });
  assert.equal(C.tileSecurity(s, r, "S", "1,1"), 25);
  assert.equal(C.isSecure(25, 24), true); assert.equal(C.isSecure(25, 26), false);
  const slot = C.getTile(s, "S", "1,1").slots[0].id; run(s, r, "building.damage", { host: tile, slotId: slot });
  assert.equal(C.tileSecurity(s, r, "S", "1,1"), 20);
  assert.equal(C.tileDCs(C.getTile(s, "S", "1,1"), r).travel, 27);
  run(s, r, "building.attach", { host: tile, building: "path-1", complete: true }); assert.equal(C.tileDCs(C.getTile(s, "S", "1,1"), r).travel, 26);
  assert.equal(C.leaderSecurity([2, 2, 3, 1, 0]), 3);
});
test("resources: amount plus access, never negative", () => {
  const { r, s } = setup();
  assert.equal(run(s, r, "resource.adjust", { settlementId: "main", resource: "rations", delta: 5 }), 5);
  assert.throws(() => run(s, r, "resource.adjust", { settlementId: "main", resource: "rations", delta: -6 }));
  run(s, r, "resource.setAccess", { settlementId: "main", resource: "materials", access: true });
  assert.deepEqual(s.settlements.main.resources.materials, { amount: 0, access: true });
});
test("clock cycles phases and counts weeks", () => {
  const { r, s } = setup(); const seen = [];
  for (let i = 0; i < 4; i++) seen.push(run(s, r, "clock.advance", {}));
  assert.deepEqual(seen.map(x => x.phase), ["assignment", "resolution", "weekEnd", "upkeep"]);
  assert.equal(s.week, 1); assert.equal(seen[3].newWeek, true);
});
test("public view hides GM notes, hidden discoverables and unrevealed tiles", () => {
  const { r, s } = setup();
  run(s, r, "discoverable.add", { sceneId: "S", key: "1,1", data: { type: "herb-cluster", name: "Hidden herbs" } });
  run(s, r, "tile.save", { sceneId: "S", key: "9,9", patch: { terrain: "mountain", name: "Unseen peak" } });
  s.modules.teams = { public: { a: 1 }, gm: { secret: 2 } };
  const text = JSON.stringify(C.publicState(C.validateState(s)));
  for (const bad of ["secret", "Hidden herbs", "Unseen peak"]) assert.ok(!text.includes(bad), bad);
  assert.ok(text.includes('"a":1'));
});
test("permissions and validation", () => {
  const { r, s } = setup();
  assert.throws(() => run(s, r, "tile.reveal", { sceneId: "S", key: "1,1" }, { reg: r, isGM: false }), /GM/);
  const actions = { ...C.ACTIONS, "teams.note": { permission: "player", run: (st, a) => { st.modules.teams = { public: { note: a.note }, gm: {} }; } } };
  C.runAction(actions, s, "teams.note", { note: "hi" }, { reg: r, isGM: false }); assert.equal(s.modules.teams.public.note, "hi");
  const v = C.validateState({ phase: "bogus", settlements: { x: { morale: 99 } }, tiles: { S: { "1,1": { discoverables: [{ tier: 9 }], slots: [{}] } } } });
  assert.equal(v.phase, "upkeep"); assert.equal(v.settlements.x.morale, 10);
  assert.equal(v.tiles.S["1,1"].discoverables[0].tier, 4); assert.equal(v.tiles.S["1,1"].slots.length, 0);
});
