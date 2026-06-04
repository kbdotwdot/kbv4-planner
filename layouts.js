const HUB_CORE_GRID = [
  [".", "t", "t", "t", "."],
  ["t", "m1", "h", "0", "t"],
  ["t", "g", "r", "i", "t"],
  ["t", "f3", "j", "l", "t"],
  [".", "t", "t", "t", "."],
];

const FASTFILLER_CORE_GRID = [
  [".", "t", "t", "t", "t", "t", "."],
  ["t", "e12", "e11", "e4", "e3", "e2", "t"],
  ["t", "e13", "s3", "e5", "s1", "e1", "t"],
  ["t", "k2", "f2", "m3", "f1", "k1", "t"],
  ["t", "e14", "s4", "e10", "s2", "e6", "t"],
  ["t", "e15", "e16", "e9", "e8", "e7", "t"],
  [".", "t", "t", "t", "t", "t", "."],
];

const STEP2_CORE_VISUAL_COLORS = Object.freeze({
  extension: "#4aa3ff",
  road: "#ffffff",
  container: "#f5d76e",
  spawn: "#ff9800",
  tower: "#ffd54f",
  link: "#b68cff",
  terminal: "#ff9ad5",
  nuker: "#ff4d4d",
  manager_tile: "#4caf50",
  factory: "#ff9ad5",
  powerSpawn: "#ff4d4d",
  storage: "#f5d76e",
  fastfiller_tile: "#ffd54f",
  lab: "#00e5ff",
  observer: "#7dd3fc",
  rampart_mincut: "#00ff66",
  rampart_controller: "#00ff66",
  rampart_glid: "#00ff66",
  rampart_road: "#00ff66",
  blocked: "#ff0000",
});

/**
 * Compact per-room planner memory object.
 * All coordinate arrays are packed as `(y << 6) | x`.
 *
 * a: plan stage — `1` mincut done, `2` step-2 layout done (stop replanning)
 * b: mincut tiles
 * c: interior tiles
 * d-x: step-2 planned layout arrays by structure/tile type
 *
 * @typedef {{
 *   a?: number,
 *   b?: number[],
 *   c?: number[],
 *   d?: number[], // tower[1-6]
 *   e?: number[], // extension[1-60]; slots 0-15 fastfiller, 16-59 by transfer path cost to storage
 *   f?: number[], // spawn[1-3]
 *   g?: number[], // nuker[1]
 *   h?: number[], // terminal[1]
 *   i?: number[], // factory[1]
 *   j?: number[], // powerSpawn[1]
 *   k?: number[], // container[1-6]
 *   l?: number[], // storage[1]
 *   m?: number[], // link[1-6]
 *   n?: number[], // lab[1-10]
 *   o?: number[], // extractor[1]
 *   p?: number[], // observer[1]
 *   q?: number[], // wall[0-2500]
 *   r?: number[], // manager_tile[1]
 *   s?: number[], // fastfiller_tile[1-4]
 *   t?: number[], // road[0-2500]
 *   u?: number[], // rampart_mincut[0-2500]
 *   v?: number[], // rampart_controller[0-2500]
 *   w?: number[], // rampart_glid[0-2500]
 *   x?: number[]  // rampart_road[0-2500]
 * }} RoomPlanCompact
 */

const ROOM_PLAN_LAYOUT_KEYS = Object.freeze({
  tower: "d",
  extension: "e",
  spawn: "f",
  nuker: "g",
  terminal: "h",
  factory: "i",
  powerSpawn: "j",
  container: "k",
  storage: "l",
  link: "m",
  lab: "n",
  extractor: "o",
  observer: "p",
  wall: "q",
  manager_tile: "r",
  fastfiller_tile: "s",
  road: "t",
  rampart_mincut: "u",
  rampart_controller: "v",
  rampart_glid: "w",
  rampart_gild: "w",
  rampart_road: "x",
});

module.exports = {
  HUB_CORE_GRID,
  FASTFILLER_CORE_GRID,
  STEP2_CORE_VISUAL_COLORS,
  ROOM_PLAN_LAYOUT_KEYS,
};
