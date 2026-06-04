const { packMincutPosToVertex, isInsideRoom } = require("../lib/mask");
const { ROOM_PLAN_LAYOUT_KEYS } = require("../layouts");

function storeStep2CorePlacements(compact, hub, fastfiller) {
  const structureTypesToReset = [
    "extension",
    "spawn",
    "container",
    "link",
    "nuker",
    "terminal",
    "factory",
    "powerSpawn",
    "storage",
    "lab",
    "manager_tile",
    "fastfiller_tile",
    "road",
  ];
  for (let i = 0; i < structureTypesToReset.length; i += 1) {
    const layoutKey = ROOM_PLAN_LAYOUT_KEYS[structureTypesToReset[i]];
    delete compact[layoutKey];
  }

  const roadSet = new Set();
  const placements = [hub, fastfiller];
  for (let i = 0; i < placements.length; i += 1) {
    const placement = placements[i];
    for (let j = 0; j < placement.structures.length; j += 1) {
      const structure = placement.structures[j];
      setLayoutIndexedPoint(compact, structure.type, structure.index, structure.point);
    }
    for (let j = 0; j < placement.roads.length; j += 1) {
      const road = placement.roads[j];
      roadSet.add(packMincutPosToVertex(road.x, road.y));
    }
  }

  compact[ROOM_PLAN_LAYOUT_KEYS.road] = Array.from(roadSet);
}

/**
 * @param {RoomPlanCompact} compact
 * @param {Step2ServicePlan} servicePlan
 */

function storeStep2ServicePlacements(compact, servicePlan) {
  for (let i = 0; i < servicePlan.structures.length; i += 1) {
    const structure = servicePlan.structures[i];
    setLayoutIndexedPoint(compact, structure.type, structure.index, structure.point);
  }

  const roadSet = new Set(Array.isArray(compact[ROOM_PLAN_LAYOUT_KEYS.road]) ? compact[ROOM_PLAN_LAYOUT_KEYS.road] : []);
  for (let i = 0; i < servicePlan.roads.length; i += 1) {
    roadSet.add(packMincutPosToVertex(servicePlan.roads[i].x, servicePlan.roads[i].y));
  }
  compact[ROOM_PLAN_LAYOUT_KEYS.road] = Array.from(roadSet);
}

/**
 * @param {{ hub: CorePlacement, fastfiller: CorePlacement } | null} corePlan
 * @returns {Uint8Array}
 */

function buildStep2OccupiedMask(corePlan) {
  const occupiedMask = new Uint8Array(2500);
  if (!corePlan) {
    return occupiedMask;
  }

  const placements = [corePlan.hub, corePlan.fastfiller];
  for (let i = 0; i < placements.length; i += 1) {
    const placement = placements[i];
    for (let j = 0; j < placement.roads.length; j += 1) {
      const point = placement.roads[j];
      occupiedMask[point.y * 50 + point.x] = 1;
    }
    for (let j = 0; j < placement.blocked.length; j += 1) {
      const point = placement.blocked[j];
      occupiedMask[point.y * 50 + point.x] = 1;
    }
    for (let j = 0; j < placement.structures.length; j += 1) {
      const point = placement.structures[j].point;
      occupiedMask[point.y * 50 + point.x] = 1;
    }
  }

  return occupiedMask;
}

/**
 * @param {Step2ServicePlan | null} servicePlan
 * @returns {Uint8Array}
 */

function buildStep2ServiceOccupiedMask(servicePlan) {
  const occupiedMask = new Uint8Array(2500);
  if (!servicePlan) {
    return occupiedMask;
  }

  for (let i = 0; i < servicePlan.roads.length; i += 1) {
    const point = servicePlan.roads[i];
    occupiedMask[point.y * 50 + point.x] = 1;
  }
  for (let i = 0; i < servicePlan.blockedTiles.length; i += 1) {
    const point = servicePlan.blockedTiles[i];
    occupiedMask[point.y * 50 + point.x] = 1;
  }
  for (let i = 0; i < servicePlan.structures.length; i += 1) {
    const point = servicePlan.structures[i].point;
    occupiedMask[point.y * 50 + point.x] = 1;
  }

  return occupiedMask;
}

/**
 * @param {SeedEvaluation | null} winner
 * @param {{ hub: CorePlacement, fastfiller: CorePlacement } | null} corePlan
 * @param {Step2ServicePlan | null} servicePlan
 */

function removeStep2TilesFromBuildable(winner, corePlan, servicePlan) {
  if (!winner || (!corePlan && !servicePlan)) {
    return;
  }

  const occupiedMask = buildStep2OccupiedMask(corePlan);
  const serviceOccupiedMask = buildStep2ServiceOccupiedMask(servicePlan);
  /** @type {RoomPoint[]} */
  const remainingBuildableTiles = [];
  for (let i = 0; i < winner.buildableTiles.length; i += 1) {
    const point = winner.buildableTiles[i];
    if (
      occupiedMask[point.y * 50 + point.x] ||
      serviceOccupiedMask[point.y * 50 + point.x]
    ) {
      continue;
    }
    remainingBuildableTiles.push(point);
  }

  winner.buildableTiles = remainingBuildableTiles;
}

/**
 * @param {RoomPlanCompact} compact
 * @param {string} type
 * @param {number} index
 * @param {RoomPoint} point
 */

function setLayoutIndexedPoint(compact, type, index, point) {
  const compactKey = ROOM_PLAN_LAYOUT_KEYS[type];
  if (!compactKey) {
    return;
  }
  if (!Array.isArray(compact[compactKey])) {
    compact[compactKey] = [];
  }
  compact[compactKey][index - 1] = packMincutPosToVertex(point.x, point.y);
}

/**
 * @param {{ hub: CorePlacement, fastfiller: CorePlacement } | null} corePlan
 * @param {Step2ServicePlan | null} servicePlan
 * @param {string | null} roomName
 */

function addPlacedStructure(structures, blockedMask, token, type, index, point) {
  structures.push({ token, type, index, point });
  blockedMask[point.y * 50 + point.x] = 1;
}

/**
 * @param {Set<number>} blockedTileSet
 * @param {RoomPoint} point
 * @param {number} range
 */

function addRangeToBlockedSet(blockedTileSet, point, range) {
  for (let dy = -range; dy <= range; dy += 1) {
    for (let dx = -range; dx <= range; dx += 1) {
      const x = point.x + dx;
      const y = point.y + dy;
      if (!isInsideRoom(x, y)) {
        continue;
      }
      blockedTileSet.add(packMincutPosToVertex(x, y));
    }
  }
}

/**
 * @param {RoomPoint[]} roads
 * @param {Uint8Array} roadMask
 * @param {RoomPoint[]} path
 */

function markRangeBlocked(blockedMask, point, range) {
  for (let dy = -range; dy <= range; dy += 1) {
    for (let dx = -range; dx <= range; dx += 1) {
      const x = point.x + dx;
      const y = point.y + dy;
      if (!isInsideRoom(x, y)) {
        continue;
      }
      blockedMask[y * 50 + x] = 1;
    }
  }
}

/**
 * @param {RoomPlanCompact} compact
 * @param {CorePlacement} hub
 * @param {CorePlacement} fastfiller
 */

module.exports = {
  storeStep2CorePlacements,
  storeStep2ServicePlacements,
  buildStep2OccupiedMask,
  buildStep2ServiceOccupiedMask,
  removeStep2TilesFromBuildable,
  setLayoutIndexedPoint,
  addPlacedStructure,
  addRangeToBlockedSet,
  markRangeBlocked,
};
