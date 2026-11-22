/** Settlement Core: pure data model and rules. No Foundry dependency, so everything here is testable in Node. */
export const SCHEMA = 1;
export const PHASES = ["upkeep", "assignment", "resolution", "weekEnd"];
export const KINDS = ["resources", "terrains", "tags", "buildings", "discoverables", "activities"];
export const HOST_KINDS = ["settlement", "tile", "discoverable"];
export const COMPLEXITY = { 1: { dc: 12, weeks: 1 }, 2: { dc: 15, weeks: 2 }, 3: { dc: 18, weeks: 3 }, 4: { dc: 22, weeks: 4 }, 5: { dc: 30, weeks: 5 } };
export const BASE_DC = 15;

export const uid = () => globalThis.crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const clampInt = (v, min = 0, max = 999999999) => Math.max(min, Math.min(max, Math.trunc(Number(v) || 0)));
const text = (v, max = 200) => String(v ?? "").slice(0, max);
const obj = v => (v && typeof v === "object" && !Array.isArray(v) ? v : {});

/* ---------------------------------------------------------------- registries */
/** Definitions shared by every module: what a Quarry is, what Woodland does, and so on. */
export function createRegistry() {
  const data = Object.fromEntries(KINDS.map(k => [k, new Map()]));
  const need = kind => { if (!data[kind]) throw Error(`Unknown definition kind "${kind}"`); return data[kind]; };
  return {
    define(kind, id, def) { need(kind).set(String(id), Object.freeze({ ...def, id: String(id) })); return this; },
    defineAll(content) { for (const kind of KINDS) for (const [id, def] of Object.entries(obj(content?.[kind]))) this.define(kind, id, def); return this; },
    remove(kind, id) { need(kind).delete(id); return this; },
    get(kind, id) { return need(kind).get(id) || null; },
    has(kind, id) { return need(kind).has(id); },
    all(kind) { return [...need(kind).values()]; },
    toJSON() { return Object.fromEntries(KINDS.map(k => [k, Object.fromEntries(data[k])])); }
  };
}

/* ---------------------------------------------------------------- blank data */
export const blankState = () => ({ schema: SCHEMA, revision: 0, week: 0, phase: PHASES[0], settlements: {}, tiles: {}, modules: {} });
export const blankSlot = () => ({ id: uid(), built: "", pending: null, damaged: false });
export const blankTile = key => ({ key: String(key), name: "", terrain: "", adjust: 0, tags: {}, revealed: false, unknownResolved: false, discoverables: [], slots: [], notes: "", gmNotes: "", ext: {} });
export const blankDiscoverable = () => ({ id: uid(), type: "", name: "", tier: 1, modifier: "", found: false, slots: [], notes: "", gmNotes: "" });
export function blankSettlement(id, name, reg) {
  const resources = Object.fromEntries((reg?.all("resources") || []).map(r => [r.id, { amount: 0, access: false }]));
  return { id, name: text(name, 80) || "Settlement", home: null, resources, morale: 0, population: 0, slots: [], notes: "", gmNotes: "", ext: {} };
}

/* ---------------------------------------------------------------- validation */
function cleanSlot(s) {
  const pending = s?.pending && s.pending.building ? { building: text(s.pending.building, 80), progress: clampInt(s.pending.progress, 0, 999) } : null;
  return { id: text(s?.id || uid(), 60), built: text(s?.built, 80), pending, damaged: !!s?.damaged };
}
const cleanSlots = list => (Array.isArray(list) ? list : []).map(cleanSlot).filter(s => s.built || s.pending);
const cleanExt = ext => Object.fromEntries(Object.entries(obj(ext)).map(([k, v]) => [k, { public: obj(v?.public), gm: obj(v?.gm) }]));
export function cleanTile(key, raw) {
  const t = { ...blankTile(key), ...obj(raw), key: String(key) };
  t.name = text(t.name, 120); t.terrain = text(t.terrain, 60); t.adjust = clampInt(t.adjust, -20, 20);
  t.tags = Object.fromEntries(Object.entries(obj(t.tags)).filter(([, v]) => v).map(([k, v]) => [text(k, 60), v === true ? true : text(v, 40)]));
  t.revealed = !!t.revealed; t.unknownResolved = !!t.unknownResolved;
  t.discoverables = (Array.isArray(t.discoverables) ? t.discoverables : []).map(d => ({
    ...blankDiscoverable(), ...obj(d), id: text(d?.id || uid(), 60), type: text(d?.type, 80), name: text(d?.name, 120),
    tier: clampInt(d?.tier, 1, 4), modifier: text(d?.modifier, 60), found: !!d?.found, slots: cleanSlots(d?.slots),
    notes: text(d?.notes, 5000), gmNotes: text(d?.gmNotes, 5000)
  }));
  t.slots = cleanSlots(t.slots); t.notes = text(t.notes, 15000); t.gmNotes = text(t.gmNotes, 15000); t.ext = cleanExt(t.ext);
  return t;
}
export function validateState(raw) {
  const s = { ...blankState(), ...obj(raw) };
  s.schema = SCHEMA; s.revision = clampInt(s.revision); s.week = clampInt(s.week);
  if (!PHASES.includes(s.phase)) s.phase = PHASES[0];
  const settlements = {};
  for (const [id, v] of Object.entries(obj(s.settlements))) {
    const x = { ...blankSettlement(id, v?.name), ...obj(v), id };
    x.name = text(x.name, 80) || "Settlement";
    x.home = x.home?.sceneId && x.home?.key ? { sceneId: text(x.home.sceneId, 40), key: text(x.home.key, 40) } : null;
    x.resources = Object.fromEntries(Object.entries(obj(x.resources)).map(([r, q]) => [r, { amount: clampInt(q?.amount), access: !!q?.access }]));
    x.morale = clampInt(x.morale, -10, 10); x.population = clampInt(x.population);
    x.slots = cleanSlots(x.slots); x.notes = text(x.notes, 15000); x.gmNotes = text(x.gmNotes, 15000); x.ext = cleanExt(x.ext);
    settlements[id] = x;
  }
  s.settlements = settlements;
  const tiles = {};
  for (const [sceneId, map] of Object.entries(obj(s.tiles))) {
    tiles[sceneId] = Object.fromEntries(Object.entries(obj(map)).map(([key, t]) => [key, cleanTile(key, t)]));
  }
  s.tiles = tiles; s.modules = cleanExt(s.modules);
  return s;
}

/* ---------------------------------------------------------------- lookups */
export const getTile = (state, sceneId, key) => state.tiles?.[sceneId]?.[key] || null;
export function ensureTile(state, sceneId, key) {
  if (!sceneId || !key) throw Error("A tile needs a scene and a key");
  state.tiles[sceneId] ??= {}; return (state.tiles[sceneId][key] ??= blankTile(key));
}
/** A host is whatever a building is attached to: { kind:"settlement", id } | { kind:"tile", sceneId, key } | { kind:"discoverable", sceneId, key, id }. */
export function resolveHost(state, ref) {
  if (ref?.kind === "settlement") { const s = state.settlements[ref.id]; if (!s) throw Error("Unknown settlement"); return { kind: "settlement", target: s, tile: null }; }
  const tile = getTile(state, ref?.sceneId, ref?.key); if (!tile) throw Error("Unknown tile");
  if (ref.kind === "tile") return { kind: "tile", target: tile, tile };
  if (ref.kind === "discoverable") { const d = tile.discoverables.find(x => x.id === ref.id); if (!d) throw Error("Unknown discoverable"); return { kind: "discoverable", target: d, tile }; }
  throw Error("Unknown host kind");
}

/* ---------------------------------------------------------------- buildings on hosts */
export const weeksFor = (def, upgrading = false) => Math.max(1, (COMPLEXITY[def?.complexity]?.weeks || 1) - (upgrading ? 1 : 0));
export const buildDC = def => COMPLEXITY[def?.complexity]?.dc ?? null;
const family = def => def?.family || def?.id;
/** Buildings that are finished and working on a host. */
export const builtOn = (target, reg) => (target?.slots || []).filter(s => s.built && !s.damaged).map(s => reg.get("buildings", s.built)).filter(Boolean);

/** Can this building be attached to this host right now? Returns { ok, reason, upgradeSlot }. */
export function canAttach(state, reg, ref, buildingId) {
  const def = reg.get("buildings", buildingId); if (!def) return { ok: false, reason: "Unknown building" };
  let host; try { host = resolveHost(state, ref); } catch (e) { return { ok: false, reason: e.message }; }
  const { kind, target, tile } = host;
  if (!(def.hosts || []).includes(kind)) return { ok: false, reason: `${def.label} cannot be built on a ${kind}` };
  if (kind === "tile" && def.terrain?.length) {
    const tagOk = (def.tileTags || []).some(t => tile.tags[t]);
    if (!def.terrain.includes(tile.terrain) && !tagOk) return { ok: false, reason: `${def.label} needs ${def.terrain.join(" or ")} terrain` };
  }
  if (kind === "discoverable") {
    const dd = reg.get("discoverables", target.type);
    if (def.discoverableCategories?.length && !def.discoverableCategories.includes(dd?.category)) return { ok: false, reason: `${def.label} does not fit this resource` };
    if (def.discoverableTypes?.length && !def.discoverableTypes.includes(target.type)) return { ok: false, reason: `${def.label} does not fit this resource` };
  }
  const sameFamily = target.slots.find(s => [s.built, s.pending?.building].some(b => b && family(reg.get("buildings", b)) === family(def)));
  if (def.requires) {
    const prior = target.slots.find(s => s.built === def.requires);
    if (!prior) return { ok: false, reason: `Requires ${reg.get("buildings", def.requires)?.label || def.requires} first` };
    if (prior.pending) return { ok: false, reason: "That slot is already being upgraded" };
    return { ok: true, upgradeSlot: prior.id };
  }
  if (sameFamily) return { ok: false, reason: `${def.label} or a version of it is already here` };
  if (kind === "discoverable" && target.slots.length >= target.tier) return { ok: false, reason: `A tier ${target.tier} resource has only ${target.tier} improvement slot(s)` };
  return { ok: true, upgradeSlot: null };
}
/** Start a building on a host. An upgrade reuses the earlier level's slot, which keeps working until the upgrade completes. */
export function attach(state, reg, ref, buildingId, { complete = false } = {}) {
  const check = canAttach(state, reg, ref, buildingId); if (!check.ok) throw Error(check.reason);
  const { target } = resolveHost(state, ref);
  let slot = target.slots.find(s => s.id === check.upgradeSlot);
  if (!slot) { slot = blankSlot(); target.slots.push(slot); }
  if (complete) { slot.built = buildingId; slot.pending = null; } else slot.pending = { building: buildingId, progress: 0 };
  return slot.id;
}
/** Add weeks of progress to a pending build. Returns { complete, progress, needed }. */
export function addProgress(state, reg, ref, slotId, weeks = 1) {
  const { target } = resolveHost(state, ref);
  const slot = target.slots.find(s => s.id === slotId); if (!slot?.pending) throw Error("Nothing is being built in that slot");
  const def = reg.get("buildings", slot.pending.building); const needed = weeksFor(def, !!slot.built);
  slot.pending.progress = clampInt(slot.pending.progress + Number(weeks || 0), 0, 999);
  if (slot.pending.progress >= needed) { slot.built = slot.pending.building; slot.pending = null; slot.damaged = false; return { complete: true, progress: needed, needed }; }
  return { complete: false, progress: slot.pending.progress, needed };
}
export function detach(state, ref, slotId) {
  const { target } = resolveHost(state, ref); const n = target.slots.length;
  target.slots = target.slots.filter(s => s.id !== slotId); if (target.slots.length === n) throw Error("Unknown slot");
}
export function setDamaged(state, ref, slotId, damaged) {
  const { target } = resolveHost(state, ref); const slot = target.slots.find(s => s.id === slotId); if (!slot) throw Error("Unknown slot");
  slot.damaged = !!damaged;
}
/** Everything a GM could start on a host right now. */
export const buildOptions = (state, reg, ref) => reg.all("buildings").filter(b => canAttach(state, reg, ref, b.id).ok);

/* ---------------------------------------------------------------- tile rules */
export function isFullyExplored(tile) { return !!tile && tile.revealed && tile.unknownResolved && tile.discoverables.every(d => d.found); }
export function tileModifiers(tile, reg) {
  const terrain = reg.get("terrains", tile?.terrain) || {};
  let difficulty = Number(terrain.difficulty || 0) + Number(tile?.adjust || 0), forage = Number(terrain.forage || 0);
  let impassable = terrain.impassable ? (terrain.impassableUnless || "special means") : "";
  for (const [id] of Object.entries(tile?.tags || {})) {
    const tag = reg.get("tags", id); if (!tag) continue;
    difficulty += Number(tag.difficulty || 0); forage += Number(tag.forage || 0);
  }
  return { difficulty, forage, impassable };
}
const effectSum = (defs, key) => defs.reduce((n, d) => n + Number(d.effects?.[key] || 0), 0);
/** DCs for the three terrain-driven activities on a tile. travel is null when the tile is impassable. */
export function tileDCs(tile, reg, { familiar = false } = {}) {
  const m = tileModifiers(tile, reg), explored = isFullyExplored(tile) ? -2 : 0;
  const built = builtOn(tile, reg);
  const foodKnown = (tile?.discoverables || []).some(d => d.found && reg.get("discoverables", d.type)?.food) ? -2 : 0;
  return {
    travel: m.impassable ? null : BASE_DC + m.difficulty + explored + effectSum(built, "travelDC") + (familiar ? -2 : 0),
    explore: m.impassable ? null : BASE_DC + m.difficulty + explored,
    forage: m.impassable ? null : BASE_DC + m.forage + explored + foodKnown,
    impassable: m.impassable, fullyExplored: !!explored
  };
}
/** Security generated on a tile by finished buildings, including a settlement whose home is this tile. */
export function tileSecurity(state, reg, sceneId, key) {
  const tile = getTile(state, sceneId, key); let total = tile ? effectSum(builtOn(tile, reg), "security") : 0;
  for (const s of Object.values(state.settlements)) if (s.home?.sceneId === sceneId && s.home?.key === key) total += effectSum(builtOn(s, reg), "security");
  return total;
}
export const isSecure = (security, population) => security >= population && security > 0;
export function degree(total, dc, { canCrit = true } = {}) {
  if (total >= dc + 10) return canCrit ? "criticalSuccess" : "success";
  if (total >= dc) return "success";
  return total <= dc - 10 ? "criticalFailure" : "failure";
}

/* ---------------------------------------------------------------- resources and clock */
export function adjustResource(state, settlementId, resourceId, delta) {
  const s = state.settlements[settlementId]; if (!s) throw Error("Unknown settlement");
  const r = (s.resources[resourceId] ??= { amount: 0, access: false });
  if (r.amount + delta < 0) throw Error(`Not enough ${resourceId}`);
  r.amount = clampInt(r.amount + delta); return r.amount;
}
export function setAccess(state, settlementId, resourceId, access) {
  const s = state.settlements[settlementId]; if (!s) throw Error("Unknown settlement");
  (s.resources[resourceId] ??= { amount: 0, access: false }).access = !!access;
}
/** Move to the next phase. Finishing Week End starts a new week. Returns { phase, week, newWeek }. */
export function advancePhase(state) {
  const i = PHASES.indexOf(state.phase); const next = (i + 1) % PHASES.length;
  if (next === 0) state.week++;
  state.phase = PHASES[next]; return { phase: state.phase, week: state.week, newWeek: next === 0 };
}

/* ---------------------------------------------------------------- what players may see */
const pubExt = ext => Object.fromEntries(Object.entries(obj(ext)).map(([k, v]) => [k, { public: v.public, gm: {} }]));
const pubSlots = slots => slots.map(s => ({ ...s }));
export function publicTile(tile) {
  if (!tile?.revealed) return null;
  const { gmNotes, ...rest } = tile;
  return { ...rest, gmNotes: "", ext: pubExt(tile.ext), slots: pubSlots(tile.slots),
    discoverables: tile.discoverables.filter(d => d.found).map(d => ({ ...d, gmNotes: "", slots: pubSlots(d.slots) })),
    fullyExplored: isFullyExplored(tile) };
}
export function publicState(state) {
  const tiles = {};
  for (const [sceneId, map] of Object.entries(state.tiles)) {
    const out = Object.fromEntries(Object.entries(map).map(([k, t]) => [k, publicTile(t)]).filter(([, t]) => t));
    if (Object.keys(out).length) tiles[sceneId] = out;
  }
  const settlements = Object.fromEntries(Object.entries(state.settlements).map(([id, s]) => [id, { ...s, gmNotes: "", ext: pubExt(s.ext) }]));
  return { schema: state.schema, revision: state.revision, week: state.week, phase: state.phase, settlements, tiles, modules: pubExt(state.modules) };
}

/* ---------------------------------------------------------------- built-in actions */
/** Each action: { permission: "gm" | "player", run(state, args, ctx) }. ctx = { reg, userId, isGM }. */
export const ACTIONS = {
  "tile.save": { permission: "gm", run(s, a) { const t = ensureTile(s, a.sceneId, a.key); s.tiles[a.sceneId][a.key] = cleanTile(a.key, { ...t, ...obj(a.patch), discoverables: a.patch?.discoverables ?? t.discoverables, slots: t.slots }); } },
  "tile.delete": { permission: "gm", run(s, a) { if (s.tiles[a.sceneId]) delete s.tiles[a.sceneId][a.key]; } },
  "tile.setTag": { permission: "gm", run(s, a) { const t = ensureTile(s, a.sceneId, a.key); if (a.value) t.tags[a.tag] = a.value === true ? true : String(a.value); else delete t.tags[a.tag]; } },
  "tile.reveal": { permission: "gm", run(s, a) { ensureTile(s, a.sceneId, a.key).revealed = a.revealed !== false; } },
  "discoverable.add": { permission: "gm", run(s, a, c) {
    const t = ensureTile(s, a.sceneId, a.key); const def = c.reg.get("discoverables", a.data?.type);
    const d = { ...blankDiscoverable(), ...obj(a.data) }; d.id = uid(); d.name ||= def?.label || "Discoverable"; t.discoverables.push(d); return d.id; } },
  "discoverable.update": { permission: "gm", run(s, a) { const { target } = resolveHost(s, { kind: "discoverable", ...a }); const { id, slots, ...patch } = obj(a.patch); Object.assign(target, patch); } },
  "discoverable.remove": { permission: "gm", run(s, a) { const t = getTile(s, a.sceneId, a.key); if (!t) throw Error("Unknown tile"); t.discoverables = t.discoverables.filter(d => d.id !== a.id); } },
  "building.attach": { permission: "gm", run(s, a, c) { return attach(s, c.reg, a.host, a.building, { complete: !!a.complete }); } },
  "building.progress": { permission: "gm", run(s, a, c) { return addProgress(s, c.reg, a.host, a.slotId, a.weeks ?? 1); } },
  "building.detach": { permission: "gm", run(s, a) { detach(s, a.host, a.slotId); } },
  "building.damage": { permission: "gm", run(s, a) { setDamaged(s, a.host, a.slotId, a.damaged !== false); } },
  "settlement.create": { permission: "gm", run(s, a, c) { const id = a.id || uid(); if (s.settlements[id]) throw Error("That settlement already exists"); s.settlements[id] = blankSettlement(id, a.name, c.reg); if (a.home) s.settlements[id].home = a.home; return id; } },
  "settlement.patch": { permission: "gm", run(s, a) { const x = s.settlements[a.id]; if (!x) throw Error("Unknown settlement"); const { id, slots, resources, ext, ...patch } = obj(a.patch); Object.assign(x, patch); } },
  "settlement.delete": { permission: "gm", run(s, a) { delete s.settlements[a.id]; } },
  "resource.adjust": { permission: "gm", run(s, a) { return adjustResource(s, a.settlementId, a.resource, clampInt(a.delta, -999999999)); } },
  "resource.setAccess": { permission: "gm", run(s, a) { setAccess(s, a.settlementId, a.resource, a.access); } },
  "clock.advance": { permission: "gm", run(s) { return advancePhase(s); } },
  "clock.set": { permission: "gm", run(s, a) { if (PHASES.includes(a.phase)) s.phase = a.phase; if (a.week !== undefined) s.week = clampInt(a.week); } }
};
/** Run one action against a state. Throws on a permission or rule failure and leaves the caller's state untouched (work on a copy). */
export function runAction(actions, state, name, args, ctx) {
  const action = actions[name]; if (!action) throw Error(`Unknown action "${name}"`);
  if (action.permission !== "player" && !ctx?.isGM) throw Error("Only the GM can do that");
  return action.run(state, obj(args), ctx);
}
