/** Default content: the Liftland campaign's numbers. Replace or extend any entry with api.define(kind, id, def). */
const B = (label, complexity, hosts, extra = {}) => ({ label, complexity, hosts, ...extra });
// `produces` is the resource a Work on it yields: a resource id, or null when it yields specific items rather than a stock.
const PRODUCES = {
  supplies: ["glow-moth-swarm-site", "herb-cluster", "shatter-pod-field", "dangerous-flora", "hot-spring", "thermal-vent", "crystal-waters-pool", "supply-cache"],
  materials: ["vein-leaf-stand", "stone-outcrop", "clay-deposit", "sand-deposit", "tool-cache", "stone-foundation", "workshop-remnant"],
  resources: ["shade-hopper-warren", "sharp-hawk-nest", "canopy-glider-colony", "coil-fern-bed", "torch-stalk-grove", "drift-moss-mat"],
  none: ["ridge-runner-territory", "sky-lance-hunting-range", "crest-stalker-territory", "crystal-bloom-formation", "spring", "crystal-growth-outcrop", "life-energy-deposit", "resonance-bloom", "hollow-root-network"]
};
const D = (label, category, extra = {}) => ({ label, category, renewable: category === "fauna" || category === "flora", skills: ["nature", "athletics"], ...extra });

export const LIFTLAND = {
  resources: {
    rations: { label: "Rations" }, materials: { label: "Materials" }, resources: { label: "Resources" }, supplies: { label: "Supplies" }
  },
  terrains: {
    grassland: { label: "Grassland", difficulty: 0, forage: -1 },
    woodland: { label: "Woodland", difficulty: 2, forage: -3 },
    wetland: { label: "Wetland", difficulty: 2, forage: 0 },
    mountain: { label: "Mountain", difficulty: 5, forage: 5 },
    water: { label: "Water", difficulty: 0, forage: 0, impassable: true, impassableUnless: "an appropriate vehicle" }
  },
  tags: {
    "low-hills": { label: "Low Hills", difficulty: 1, forage: 1, overlay: true, group: "hills" },
    "steep-hills": { label: "Steep Hills", difficulty: 3, forage: 3, overlay: true, group: "hills" },
    lifted: { label: "Lifted", overlay: true },
    coastal: { label: "Coastal" },
    "crystal-growth": { label: "Crystal Growth", states: ["present", "dense"] },
    "crystal-waters": { label: "Crystal Waters", states: ["present", "dense"] }
  },
  buildings: {
    // Resource Improvements: general, in levels, on any discovered resource. Total levels on a resource cannot exceed its tier.
    // Levels 3 and 4 follow the pattern of levels 1 and 2 (weeks = level, Materials per week = level); adjust when the rules fix them.
    ...Object.fromEntries([1, 2, 3, 4].flatMap(n => [
      [`yield-${n}`, B(`Yield L${n}`, n, ["discoverable"], { family: "yield", level: n, weeks: n, materialsPerWeek: n === 1 ? 0 : n, ...(n > 1 ? { requires: `yield-${n - 1}` } : {}), effects: { yieldStep: n }, text: "Work yield die one size larger per level." })],
      [`difficulty-dc-${n}`, B(`Difficulty (DC) L${n}`, n, ["discoverable"], { family: "difficulty-dc", level: n, weeks: n, materialsPerWeek: n === 1 ? 0 : n, ...(n > 1 ? { requires: `difficulty-dc-${n - 1}` } : {}), effects: { workDC: -n }, text: "-1 to the Work DC per level." })],
      [`difficulty-check-${n}`, B(`Difficulty (Check) L${n}`, n, ["discoverable"], { family: "difficulty-check", level: n, weeks: n, materialsPerWeek: n === 1 ? 0 : n, ...(n > 1 ? { requires: `difficulty-check-${n - 1}` } : {}), effects: { workBonus: n }, text: "+1 to the Work check per level." })]
    ])),
    // Resource infrastructure: makes a bare tile workable.
    "quarry-1": B("Quarry I", 1, ["tile"], { family: "quarry", skills: ["crafting", "athletics"], terrain: ["mountain"], tileTags: ["low-hills", "steep-hills"], effects: { workDie: "d4", produces: "materials" } }),
    "quarry-2": B("Quarry II", 2, ["tile"], { family: "quarry", requires: "quarry-1", needs: ["lumber"], skills: ["crafting", "athletics"], terrain: ["mountain"], tileTags: ["low-hills", "steep-hills"], effects: { workDie: "d6", produces: "materials" } }),
    "fishery-1": B("Fishery I", 1, ["tile"], { family: "fishery", skills: ["crafting", "nature", "survival"], terrain: ["wetland"], tileTags: ["coastal"], effects: { workDie: "d4", produces: "rations" } }),
    "fishery-2": B("Fishery II", 2, ["tile"], { family: "fishery", requires: "fishery-1", needs: ["lumber"], skills: ["crafting", "nature"], terrain: ["wetland"], tileTags: ["coastal"], effects: { workDie: "d6", produces: "rations" } }),
    "lumber-camp-1": B("Lumber Camp I", 1, ["tile"], { family: "lumber-camp", skills: ["crafting", "survival"], terrain: ["woodland"], effects: { workDie: "d4", produces: "materials" } }),
    "lumber-camp-2": B("Lumber Camp II", 2, ["tile"], { family: "lumber-camp", requires: "lumber-camp-1", needs: ["stone"], skills: ["crafting", "survival"], terrain: ["woodland"], effects: { workDie: "d6", produces: "materials" } }),
    // Structures (settlement)
    "portal-hall": B("Portal Hall", 2, ["settlement"], { effects: { security: 20, houses: 20 }, text: "Damaged starting Structure. Houses 20 at a Morale penalty." }),
    "workshop-1": B("Workshop I", 1, ["settlement"], { family: "workshop", skills: ["crafting"], text: "Craft rough items and simple tools." }),
    "workshop-2": B("Workshop II", 2, ["settlement"], { family: "workshop", requires: "workshop-1", needs: ["lumber", "stone"], skills: ["crafting"], text: "Craft basic items, standard tools, weapons, armor; restores worn Toolkits." }),
    "watchpost-1": B("Watchpost I", 1, ["settlement"], { family: "watchpost", skills: ["crafting", "survival"], effects: { travelExploreBonus: 1 } }),
    "watchpost-2": B("Watchpost II", 2, ["settlement"], { family: "watchpost", requires: "watchpost-1", needs: ["lumber", "stone"], skills: ["crafting"], effects: { travelExploreBonus: 2 }, text: "Advance warning of threats." }),
    "hearth-pit-1": B("Hearth-Pit I", 1, ["settlement"], { skills: ["crafting", "survival"], text: "Once a week, 3 Rations become a hot meal: +1 Morale for the week." }),
    "dug-well-1": B("Dug Well I", 1, ["settlement"], { skills: ["crafting", "athletics"], text: "Reliable water. Without water, Work at the Settlement is -1 yield." }),
    "infirmary-2": B("Infirmary II", 2, ["settlement"], { needs: ["lumber"], skills: ["crafting", "medicine"], text: "An NPC medic can Recover others. Affliction bonus +4 instead of +2." }),
    "granary-2": B("Granary II", 2, ["settlement"], { needs: ["lumber", "stone"], skills: ["crafting"], text: "Rations do not spoil. Without it, storage is capped at 2 weeks." }),
    "common-hall-2": B("Common Hall II", 2, ["settlement"], { needs: ["lumber", "stone"], skills: ["crafting"], effects: { morale: 1 } }),
    "shrine-2": B("Shrine II", 2, ["settlement"], { needs: ["stone"], skills: ["crafting", "religion"], effects: { morale: 1 }, text: "Once a week one PC gains +1 status to one check." }),
    // Infrastructure (tile)
    "shelter-1": B("Shelter I", 1, ["tile"], { family: "shelter", skills: ["crafting", "survival"], effects: { security: 5, houses: 4 } }),
    "shelter-2": B("Shelter II", 2, ["tile"], { family: "shelter", requires: "shelter-1", needs: ["lumber"], skills: ["crafting"], effects: { security: 8, houses: 5 } }),
    "longhouse-2": B("Longhouse II", 2, ["tile"], { needs: ["lumber", "stone"], skills: ["crafting"], effects: { security: 12, houses: 10 } }),
    "farm-1": B("Farm I", 1, ["tile"], { family: "farm", skills: ["crafting", "nature"], terrain: ["grassland"], effects: { workDie: "d4", produces: "rations" } }),
    "farm-2": B("Farm II", 2, ["tile"], { family: "farm", requires: "farm-1", needs: ["lumber"], skills: ["crafting", "nature"], terrain: ["grassland"], effects: { workDie: "d6", produces: "rations" } }),
    "plantation-2": B("Plantation II", 2, ["tile"], { needs: ["lumber"], skills: ["crafting", "nature"], terrain: ["grassland"], effects: { workDie: "d6", produces: "resources" } }),
    "pasture-2": B("Pasture II", 2, ["tile"], { needs: ["lumber"], skills: ["crafting", "nature"], terrain: ["grassland"], effects: { workDie: "d6", produces: "rations", bonusResources: 1 }, text: "Needs a domesticated species." }),
    "path-1": B("Path I", 1, ["tile"], { family: "path", skills: ["crafting", "athletics"], effects: { travelDC: -1 } }),
    "path-2": B("Path II", 2, ["tile"], { family: "path", requires: "path-1", needs: ["stone"], skills: ["crafting"], effects: { travelDC: -2 } }),
    "palisade-2": B("Palisade II", 2, ["tile"], { needs: ["lumber"], skills: ["crafting", "athletics"], effects: { eventSeverityStep: 1 } })
  },
  discoverables: {
    "pebble-hen-nest": D("Pebble Hen Nest", "fauna", { food: true }), "shade-hopper-warren": D("Shade Hopper Warren", "fauna", { skills: ["nature", "acrobatics"] }),
    "stoneback-grazer-herd": D("Stoneback Grazer Herd", "fauna", { food: true }), "spire-deer-range": D("Spire Deer Range", "fauna", { food: true, skills: ["nature", "stealth", "athletics"] }),
    "sharp-hawk-nest": D("Sharp Hawk Nest", "fauna"), "drift-grazer-float": D("Drift Grazer Float", "fauna", { food: true, skills: ["nature", "acrobatics"] }),
    "glass-trout-school": D("Glass Trout School", "fauna", { food: true }), "canopy-glider-colony": D("Canopy Glider Colony", "fauna", { skills: ["nature", "acrobatics"] }),
    "glow-moth-swarm-site": D("Glow Moth Swarm Site", "fauna", { skills: ["crafting"] }), "mud-lurker-bed": D("Mud Lurker Bed", "fauna", { food: true }),
    "current-serpent-pool": D("Current Serpent Pool", "fauna", { food: true }), "ridge-runner-territory": D("Ridge Runner Territory", "fauna", { skills: [], workable: false }),
    "sky-lance-hunting-range": D("Sky Lance Hunting Range", "fauna", { skills: [], workable: false }), "crest-stalker-territory": D("Crest Stalker Territory (wild)", "fauna", { skills: [], workable: false }),
    "root-tuber-bed": D("Root Tuber Bed", "flora", { food: true }), "grain-grass-stand": D("Grain Grass Stand", "flora", { food: true, skills: ["crafting", "athletics"] }),
    "berry-shrub-thicket": D("Berry Shrub Thicket", "flora", { food: true, skills: ["nature", "acrobatics"] }), "nut-tree-stand": D("Nut Tree Stand", "flora", { food: true }),
    "vine-fruit-bower": D("Vine Fruit Bower", "flora", { food: true }), "herb-cluster": D("Herb Cluster", "flora", { skills: ["medicine", "acrobatics"] }),
    "vein-leaf-stand": D("Vein-Leaf Tree Stand", "flora", { skills: ["crafting", "athletics"] }), "coil-fern-bed": D("Coil Fern Bed", "flora"),
    "torch-stalk-grove": D("Torch Stalk Grove", "flora", { skills: ["nature", "crafting"] }), "shatter-pod-field": D("Shatter Pod Field", "flora", { skills: ["crafting", "acrobatics"] }),
    "drift-moss-mat": D("Drift Moss Mat", "flora"), "crystal-bloom-formation": D("Crystal Bloom Formation", "flora", { skills: ["arcana", "nature", "crafting"] }),
    "dangerous-flora": D("Dangerous Flora patch", "flora", { skills: ["nature"] }),
    "spring": D("Spring / Water Source", "terrain"), "stone-outcrop": D("Stone Outcrop / Mineral Vein", "terrain", { skills: ["crafting", "athletics"] }),
    "clay-deposit": D("Clay Deposit", "terrain", { skills: ["crafting", "athletics"] }), "sand-deposit": D("Sand Deposit", "terrain", { skills: ["crafting", "athletics"] }),
    "hot-spring": D("Hot Spring", "terrain", { skills: ["nature", "crafting"] }), "thermal-vent": D("Thermal Vent", "terrain", { skills: ["crafting", "athletics"] }),
    "crystal-growth-outcrop": D("Crystal Growth Outcrop / Formation", "anomaly", { skills: ["arcana", "nature", "crafting"] }), "crystal-waters-pool": D("Crystal Waters Pool / Spring", "anomaly"),
    "life-energy-deposit": D("Crystallized Life-Energy Deposit", "anomaly", { skills: ["arcana"] }), "resonance-bloom": D("Resonance Bloom", "anomaly", { skills: ["arcana", "nature"] }),
    "hollow-root-network": D("Hollow Root Network", "anomaly", { skills: [], workable: false }),
    "tool-cache": D("Tool Cache", "remnant", { skills: ["crafting", "athletics"] }), "supply-cache": D("Supply Cache", "remnant", { skills: ["society", "athletics"] }),
    "stone-foundation": D("Stone Foundation / Collapsed Structure", "remnant", { skills: ["crafting", "athletics"] }), "workshop-remnant": D("Workshop Remnant", "remnant", { skills: ["crafting"] })
  },
  activities: {
    travel: { label: "Travel", cost: 1, teams: true, dc: 25 },
    explore: { label: "Explore", cost: 2, teams: true, dc: 25, successesNeeded: 6, targetFlatDC: 11 },
    forage: { label: "Forage", cost: 2, teams: true, dc: 25 },
    work: { label: "Work", cost: 2, teams: true, dc: 25 },
    improve: { label: "Improve", cost: 2, teams: true, dc: 30, dcStep: 2 },
    craft: { label: "Craft", cost: 1, teams: true, dc: 30 },
    research: { label: "Research", cost: 1, teams: true, dc: 30, dcStep: 2 },
    recover: { label: "Recover", cost: 3, teams: true, dc: 20 },
    aid: { label: "Aid", cost: 1, teams: false, dc: 20 }
  }
};

// Fill in what each discoverable produces: food sources give Rations, the rest come from the lists above.
for (const [id, d] of Object.entries(LIFTLAND.discoverables)) {
  if (d.produces !== undefined) continue;
  if (d.food) d.produces = "rations";
  else if (PRODUCES.none.includes(id)) d.produces = null;
  else d.produces = Object.keys(PRODUCES).find(k => PRODUCES[k].includes(id)) ?? null;
}
