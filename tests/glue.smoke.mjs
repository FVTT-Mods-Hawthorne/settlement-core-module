// Loads module.mjs against stubbed Foundry globals and drives the API as the hosting GM.
import assert from "node:assert/strict";
import { test } from "node:test";
const hooks = {}, fired = [], settings = new Map(), reg = new Map();
globalThis.Hooks = { once: (n, f) => (hooks[n] = f), on() {}, callAll: (n, ...a) => { fired.push(n); (listeners[n] || []).forEach(f => f(...a)); } };
const listeners = {};
globalThis.foundry = { utils: { deepClone: o => structuredClone(o) } };
const page = { name: "State JSON", text: { content: "" }, async update(d) { this.text.content = d["text.content"]; } };
let journal = null;
globalThis.JournalEntry = { async create(d) { journal = { ...d, getFlag: () => true, pages: { find: () => null }, async createEmbeddedDocuments(_t, [p]) { page.text.content = p.text.content; journal.pages = { find: f => [page].find(f) }; return [page]; } }; return journal; } };
const user = { id: "u1", isGM: true, active: true };
const mod = { version: "9.8.7" };
globalThis.game = {
  user, users: { filter: f => [user].filter(f), get: () => user }, journal: { find: f => (journal && f(journal) ? journal : undefined) },
  settings: { register: (m, k, d) => reg.set(k, d), get: (m, k) => settings.has(k) ? settings.get(k) : reg.get(k).default,
    set: async (m, k, v) => { settings.set(k, structuredClone(v)); reg.get(k).onChange?.(v); } },
  modules: { get: () => mod }, socket: { on() {}, emit() {} }
};
await import("../scripts/module.mjs");
test("init, register hook, ready, API round trip", async () => {
  hooks.init(); const api = mod.api;
  listeners["settlementCore.register"] = [a => { a.define("terrains", "lava", { label: "Lava", difficulty: 9 }); a.registerAction("teams.setNote", { permission: "player", run: (s, x) => { s.modules.teams = { public: { note: x.note }, gm: { hidden: 1 } }; } }); }];
  hooks.setup(); await hooks.ready();
  assert.ok(fired.includes("settlementCore.ready")); assert.equal(api.version, "9.8.7"); assert.equal(api.get("terrains", "lava").difficulty, 9);
  assert.equal(api.all("resources").length, 4);
  await api.saveTile("S", "3,4", { terrain: "grassland", revealed: true, gmNotes: "gm only" });
  await api.setTag("S", "3,4", "low-hills");
  assert.deepEqual([api.tileDCs("S", "3,4").travel, api.tileDCs("S", "3,4").forage], [26, 25]);
  assert.equal(await api.addExplore("S", "3,4"), 1); assert.equal(api.activityDC("research"), 30);
  await api.createSettlement("Home", { sceneId: "S", key: "3,4" }, "main");
  await api.attach({ kind: "settlement", id: "main" }, "portal-hall", true);
  const host = { kind: "tile", sceneId: "S", key: "3,4" };
  const slot = await api.attach(host, "farm-1"); assert.equal((await api.addProgress(host, slot)).complete, true);
  assert.equal(api.tileSecurity("S", "3,4"), 20); assert.ok(api.buildOptions(host).some(b => b.id === "farm-2"));
  await assert.rejects(api.attach(host, "lumber-camp-1"));
  await api.adjustResource("main", "rations", 7); assert.equal(api.getSettlement("main").resources.rations.amount, 7);
  fired.length = 0; for (let i = 0; i < 4; i++) await api.advancePhase();
  assert.equal(api.getClock().week, 1); assert.ok(fired.includes("settlementCore.phase"));
  await api.request("teams.setNote", { note: "hello" }); assert.equal(api.getModuleData("teams").public.note, "hello");
  assert.throws(() => api.registerAction("tile.save", { run() {} }));
  // ctx.core inside a registered action: all-or-nothing
  api.registerAction("teams.payAndBuild", { run(s, x, ctx) {
    ctx.core.adjustResource("main", "rations", -x.cost);
    const res = ctx.core.addProgress(x.host, x.slotId, 1);   // throws when nothing is pending
    return res.complete;
  } });
  const before = api.getSettlement("main").resources.rations.amount;
  await assert.rejects(api.request("teams.payAndBuild", { cost: 2, host, slotId: "nope" }));
  assert.equal(api.getSettlement("main").resources.rations.amount, before);        // the spend was rolled back
  const up = await api.attach(host, "farm-2");
  assert.equal(await api.request("teams.payAndBuild", { cost: 2, host, slotId: up }), true);
  assert.equal(api.getSettlement("main").resources.rations.amount, before - 2);
  assert.equal(api.weeksFor("farm-2", true), 1);
  // what players receive
  const pub = JSON.stringify(settings.get("public"));
  assert.ok(!pub.includes("gm only")); assert.ok(!pub.includes("hidden")); assert.ok(pub.includes("hello"));
  user.isGM = false; assert.equal(api.getTile("S", "3,4").gmNotes, ""); assert.equal(api.tileDCs("S", "3,4").travel, 26);
});
