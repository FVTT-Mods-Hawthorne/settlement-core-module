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
    assert.ok(C.COMPLEXITY[b.complexity], b.id);
  }
});
test("tile DCs: terrain, hills as tags, water, fully explored", () => {
  const { r, s } = setup(); const t = C.getTile(s, "S", "1,1");
  assert.deepEqual([C.tileDCs(t, r).travel, C.tileDCs(t, r).explore, C.tileDCs(t, r).forage], [17, 17, 12]);
  run(s, r, "tile.setTag", { sceneId: "S", key: "1,1", tag: "steep-hills", value: true });
  assert.deepEqual([C.tileDCs(t, r).travel, C.tileDCs(t, r).forage], [20, 15]);
  run(s, r, "tile.setTag", { sceneId: "S", key: "1,1", tag: "steep-hills", value: false });
  run(s, r, "tile.setTag", { sceneId: "S", key: "1,1", tag: "lifted", value: true }); assert.equal(C.tileDCs(t, r).travel, 17);
  const id = run(s, r, "discoverable.add", { sceneId: "S", key: "1,1", data: { type: "root-tuber-bed", tier: 2 } });
  assert.equal(C.isFullyExplored(t), false);
  run(s, r, "discoverable.update", { sceneId: "S", key: "1,1", id, patch: { found: true } });
  assert.equal(C.tileDCs(t, r).forage, 10);            // known food source -2
  run(s, r, "tile.save", { sceneId: "S", key: "1,1", patch: { unknownResolved: true } });
  const t2 = C.getTile(s, "S", "1,1");
  assert.equal(C.isFullyExplored(t2), true); assert.equal(C.tileDCs(t2, r).travel, 15); assert.equal(C.tileDCs(t2, r).forage, 8);
  run(s, r, "tile.save", { sceneId: "S", key: "2,2", patch: { terrain: "water", revealed: true } });
  const w = C.tileDCs(C.getTile(s, "S", "2,2"), r); assert.equal(w.travel, null); assert.match(w.impassable, /vehicle/);
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
test("discoverable slots are limited by tier and fit rules", () => {
  const { r, s } = setup();
  const id = run(s, r, "discoverable.add", { sceneId: "S", key: "1,1", data: { type: "pebble-hen-nest", tier: 1 } });
  const host = { kind: "discoverable", sceneId: "S", key: "1,1", id };
  assert.equal(C.canAttach(s, r, host, "quarry-1").ok, false);
  run(s, r, "building.attach", { host, building: "trapline-1", complete: true });
  assert.match(C.canAttach(s, r, host, "scaffolding-1").reason, /fit|slot/);
  assert.equal(C.canAttach(s, r, host, "trapline-2").ok, true);               // upgrade reuses the slot
  assert.ok(C.buildOptions(s, r, host).some(b => b.id === "trapline-2"));
});
test("security from tile buildings and a settlement at home", () => {
  const { r, s, tile } = setup();
  run(s, r, "building.attach", { host: { kind: "settlement", id: "main" }, building: "portal-hall", complete: true });
  run(s, r, "building.attach", { host: tile, building: "shelter-1", complete: true });
  assert.equal(C.tileSecurity(s, r, "S", "1,1"), 25);
  assert.equal(C.isSecure(25, 24), true); assert.equal(C.isSecure(25, 26), false);
  const slot = C.getTile(s, "S", "1,1").slots[0].id; run(s, r, "building.damage", { host: tile, slotId: slot });
  assert.equal(C.tileSecurity(s, r, "S", "1,1"), 20);
  assert.equal(C.tileDCs(C.getTile(s, "S", "1,1"), r).travel, 17);
  run(s, r, "building.attach", { host: tile, building: "path-1", complete: true }); assert.equal(C.tileDCs(C.getTile(s, "S", "1,1"), r).travel, 16);
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
