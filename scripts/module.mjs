import * as C from "./core.mjs";
import { LIFTLAND } from "./content-liftland.mjs";

const ID = "settlement-core", CHANNEL = `module.${ID}`, VERSION = "0.3.0";
const STORE_NAME = "Settlement Core — Private State", PAGE_NAME = "State JSON";
const gm = () => !!game.user?.isGM;
const authority = () => game.users?.filter(u => u.active && u.isGM).sort((a, b) => a.id.localeCompare(b.id))[0]?.id;
const host = () => gm() && authority() === game.user.id;
const clone = o => foundry.utils.deepClone(o);

const registry = C.createRegistry();
const actions = { ...C.ACTIONS };
let queue = Promise.resolve(), cache = { text: null, state: null }, last = { phase: null, week: null };
const pending = new Map();

/* ---------------------------------------------------------------- storage
   Full state: a GM-only journal page. Player-safe copy: a world setting every client receives. */
function storePage() {
  const j = game.journal.find(e => e.getFlag(ID, "store"));
  return j?.pages.find(p => p.name === PAGE_NAME) || null;
}
async function ensureStore() {
  let j = game.journal.find(e => e.getFlag(ID, "store"));
  if (!j) j = await JournalEntry.create({ name: STORE_NAME, ownership: { default: 0 }, flags: { [ID]: { store: true } } });
  let p = j.pages.find(x => x.name === PAGE_NAME);
  if (!p) p = (await j.createEmbeddedDocuments("JournalEntryPage", [{ name: PAGE_NAME, type: "text", text: { content: JSON.stringify(C.blankState()) } }]))[0];
  return p;
}
/** GMs read the full state; players read the published copy. Always returns a validated copy that is safe to modify. */
function getState() {
  if (gm()) {
    const text = storePage()?.text?.content;
    if (text) {
      if (cache.text !== text) { try { cache = { text, state: C.validateState(JSON.parse(text)) }; } catch (e) { console.error(`${ID} | unreadable state`, e); cache = { text, state: C.blankState() }; } }
      return clone(cache.state);
    }
  }
  return C.validateState(clone(game.settings.get(ID, "public")));
}

/* ---------------------------------------------------------------- writes */
function mutate(name, args, sender) {
  const job = queue.then(async () => {
    if (!host()) throw Error("An active GM must be online to change settlement data");
    const page = await ensureStore();
    const state = getState();
    const ctx = { reg: registry, isGM: !!sender?.isGM, userId: sender?.id, core: C.bindRules(state, registry) };
    const result = await C.runAction(actions, state, name, args, ctx);
    state.revision++;
    const clean = C.validateState(state);
    await page.update({ "text.content": JSON.stringify(clean) });
    await game.settings.set(ID, "public", C.publicState(clean));
    return result;
  });
  queue = job.catch(() => {});
  return job;
}
function request(name, args = {}) {
  if (host()) return mutate(name, args, game.user);
  return new Promise((resolve, reject) => {
    const target = authority();
    if (!target) return reject(Error("A GM must be online to change settlement data"));
    const requestId = C.uid();
    const timer = setTimeout(() => { pending.delete(requestId); reject(Error("The GM's client did not answer")); }, 15000);
    pending.set(requestId, { resolve, reject, timer });
    game.socket.emit(CHANNEL, { type: "request", name, args, requestId, target, sender: game.user.id });
  });
}
function onSocket(m) {
  if (m?.type === "request" && host() && m.target === game.user.id) {
    const sender = game.users.get(m.sender); if (!sender) return;
    Promise.resolve().then(() => mutate(m.name, m.args || {}, sender)).then(
      value => game.socket.emit(CHANNEL, { type: "reply", to: sender.id, requestId: m.requestId, ok: true, value }),
      e => game.socket.emit(CHANNEL, { type: "reply", to: sender.id, requestId: m.requestId, ok: false, error: e.message }));
  } else if (m?.type === "reply" && m.to === game.user.id) {
    const p = pending.get(m.requestId); if (!p) return;
    clearTimeout(p.timer); pending.delete(m.requestId);
    m.ok ? p.resolve(m.value) : p.reject(Error(m.error));
  }
}
/** Runs on every client whenever the published copy changes. */
function onChanged() {
  const state = getState();
  Hooks.callAll("settlementCore.changed", state);
  if (last.phase !== null && (last.phase !== state.phase || last.week !== state.week)) {
    Hooks.callAll("settlementCore.phase", { phase: state.phase, week: state.week, newWeek: state.week !== last.week });
  }
  last = { phase: state.phase, week: state.week };
}

/* ---------------------------------------------------------------- public API */
const hostRef = h => h;
const api = {
  version: VERSION, PHASES: C.PHASES, HOST_KINDS: C.HOST_KINDS, DICE: C.DICE,
  // definitions
  registry,
  define: (kind, id, def) => registry.define(kind, id, def),
  defineAll: content => registry.defineAll(content),
  get: (kind, id) => registry.get(kind, id),
  all: kind => registry.all(kind),
  // reads (GM: full data; players: only what they may see)
  getState,
  getTile: (sceneId, key) => C.getTile(getState(), sceneId, key),
  getTiles: sceneId => Object.values(getState().tiles[sceneId] || {}),
  getSettlement: id => getState().settlements[id] || null,
  getSettlements: () => Object.values(getState().settlements),
  getClock: () => { const s = getState(); return { phase: s.phase, week: s.week }; },
  getModuleData: moduleId => getState().modules[moduleId] || { public: {}, gm: {} },
  // rules
  tileDCs: (sceneId, key, options) => { const t = C.getTile(getState(), sceneId, key); return t ? C.tileDCs(t, registry, options) : null; },
  tileModifiers: (sceneId, key) => { const t = C.getTile(getState(), sceneId, key); return t ? C.tileModifiers(t, registry) : null; },
  tileSecurity: (sceneId, key) => C.tileSecurity(getState(), registry, sceneId, key),
  isSecure: C.isSecure, isFullyExplored: (sceneId, key) => C.isFullyExplored(C.getTile(getState(), sceneId, key)),
  degree: C.degree, buildDC: id => C.buildDC(registry.get("buildings", id), registry),
  weeksFor: (buildingId, upgrading = false) => C.weeksFor(registry.get("buildings", buildingId), upgrading), activityDC: id => C.activityDC(registry, id),
  workProfile: ref => C.workProfile(getState(), registry, ref), leaderSecurity: C.leaderSecurity,
  builtOn: host => C.builtOn(C.resolveHost(getState(), hostRef(host)).target, registry),
  canAttach: (host, buildingId) => C.canAttach(getState(), registry, host, buildingId),
  buildOptions: host => C.buildOptions(getState(), registry, host),
  // writes: every one returns a Promise and is applied by the hosting GM's client
  request,
  registerAction(name, { permission = "gm", run }) {
    if (typeof run !== "function") throw Error("An action needs a run(state, args, ctx) function");
    if (!/^[a-z0-9-]+\.[A-Za-z0-9.-]+$/.test(name)) throw Error('Name actions "yourmodule.something"');
    if (C.ACTIONS[name]) throw Error(`"${name}" is a core action`);
    actions[name] = { permission: permission === "player" ? "player" : "gm", run };
  },
  saveTile: (sceneId, key, patch) => request("tile.save", { sceneId, key, patch }),
  revealTile: (sceneId, key, revealed = true) => request("tile.reveal", { sceneId, key, revealed }),
  addExplore: (sceneId, key, count = 1) => request("tile.explore", { sceneId, key, count }),
  setTag: (sceneId, key, tag, value = true) => request("tile.setTag", { sceneId, key, tag, value }),
  addDiscoverable: (sceneId, key, data) => request("discoverable.add", { sceneId, key, data }),
  updateDiscoverable: (sceneId, key, id, patch) => request("discoverable.update", { sceneId, key, id, patch }),
  attach: (host, building, complete = false) => request("building.attach", { host, building, complete }),
  addProgress: (host, slotId, weeks = 1) => request("building.progress", { host, slotId, weeks }),
  cancelPending: (host, slotId) => request("building.cancel", { host, slotId }),
  detach: (host, slotId) => request("building.detach", { host, slotId }),
  setDamaged: (host, slotId, damaged = true) => request("building.damage", { host, slotId, damaged }),
  createSettlement: (name, home, id) => request("settlement.create", { name, home, id }),
  patchSettlement: (id, patch) => request("settlement.patch", { id, patch }),
  adjustResource: (settlementId, resource, delta) => request("resource.adjust", { settlementId, resource, delta }),
  setAccess: (settlementId, resource, access) => request("resource.setAccess", { settlementId, resource, access }),
  advancePhase: () => request("clock.advance")
};
// A module's own data: { public: {...}, gm: {...} }. The gm half never reaches players.
actions["module.set"] = { permission: "gm", run(s, a) { const cur = s.modules[a.moduleId] || { public: {}, gm: {} }; s.modules[a.moduleId] = { public: a.public ?? cur.public, gm: a.gm ?? cur.gm }; } };
api.setModuleData = (moduleId, data) => request("module.set", { moduleId, ...data });

/* ---------------------------------------------------------------- hooks */
Hooks.once("init", () => {
  game.settings.register(ID, "public", { scope: "world", config: false, type: Object, default: C.publicState(C.blankState()), onChange: onChanged });
  game.settings.register(ID, "defaultContent", { name: "Load the Liftland content set", hint: "Terrain, tags, buildings, discoverables and activities for the Liftland campaign. Turn off to supply your own definitions. Needs a reload.", scope: "world", config: true, type: Boolean, default: true, requiresReload: true });
  if (game.settings.get(ID, "defaultContent")) registry.defineAll(LIFTLAND);
  game.modules.get(ID).api = api;
});
// Other modules add or override definitions and register their actions here.
Hooks.once("setup", () => Hooks.callAll("settlementCore.register", api));
Hooks.once("ready", async () => {
  game.socket.on(CHANNEL, onSocket);
  if (host()) {
    try { await ensureStore(); const s = getState(); await game.settings.set(ID, "public", C.publicState(s)); }
    catch (e) { console.error(`${ID} | could not prepare the store`, e); }
  }
  const s = getState(); last = { phase: s.phase, week: s.week };
  Hooks.callAll("settlementCore.ready", api);
});
