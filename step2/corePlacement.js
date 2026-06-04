const { pointsToMask, isInsideRoom, cloneMask } = require("../lib/mask");
const {
  rotateOffset,
  sortPointsByChebyshevDistance,
  chebyshevDistance,
  findInArray,
} = require("../lib/geo");
const { getTerrainCost } = require("../lib/terrain");
const { findAreaCandidates } = require("../stage1/coreAreas");
const { HUB_CORE_GRID, FASTFILLER_CORE_GRID } = require("../layouts");
const { storeStep2CorePlacements, markRangeBlocked } = require("./persist");
const { LARGE_AREA_RADIUS, LARGE_CORE_RADIUS, SMALL_AREA_RADIUS, SMALL_CORE_RADIUS, STEP2_TEMP_BLOCK_CONTROLLER_RANGE, STEP2_TEMP_BLOCK_RESOURCE_RANGE, TERRAIN_BLOCKING_COST } = require("../constants");

function planStep2Cores(input, winner, compact) {
  if (!winner) {
    return null;
  }

  const interiorMask = pointsToMask(winner.interiorTiles);
  const buildableMask = pointsToMask(winner.buildableTiles);
  const temporaryBlockedMask = buildStep2TemporaryBlockedMask(input);
  const step2BuildableMask = applyTemporaryBlockMask(
    buildableMask,
    temporaryBlockedMask
  );
  const hubPattern = buildCorePattern(HUB_CORE_GRID);
  const fastfillerPattern = buildCorePattern(FASTFILLER_CORE_GRID);
  const hubCenters = findAreaCandidates(
    interiorMask,
    step2BuildableMask,
    SMALL_AREA_RADIUS,
    SMALL_CORE_RADIUS
  ).map((candidate) => candidate.center);
  const fastfillerCenters = findAreaCandidates(
    interiorMask,
    step2BuildableMask,
    LARGE_AREA_RADIUS,
    LARGE_CORE_RADIUS
  ).map((candidate) => candidate.center);

  sortPointsByChebyshevDistance(hubCenters, input.controller_pos);

  /** @type {{ hubCenter: RoomPoint, fastfillerCenter: RoomPoint } | null} */
  let chosenCenters = null;
  for (let i = 0; i < hubCenters.length; i += 1) {
    const hubCenter = hubCenters[i];
    const hubFootprint = placeCorePatternAt(
      hubPattern,
      hubCenter,
      0,
      step2BuildableMask,
      input.terrain,
      null,
      null
    );
    if (!hubFootprint) {
      continue;
    }

    const hubOccupiedNonRoad = placementNonRoadMask(hubFootprint);
    const hubOccupiedAll = placementAllOccupiedMask(hubFootprint);
    const orderedFastfillerCenters = orderFastfillerCentersByStorage(
      fastfillerCenters,
      hubFootprint
    );
    const fastfillerCenter = findFirstFastfillerCenter(
      fastfillerPattern,
      orderedFastfillerCenters,
      step2BuildableMask,
      input.terrain,
      hubOccupiedNonRoad,
      hubOccupiedAll
    );
    if (!fastfillerCenter) {
      continue;
    }

    chosenCenters = { hubCenter, fastfillerCenter };
    break;
  }

  if (!chosenCenters) {
    return null;
  }

  const hub = chooseHubRotationByControllerDistance(
    hubPattern,
    chosenCenters.hubCenter,
    step2BuildableMask,
    input.terrain,
    input.controller_pos
  );
  if (!hub) {
    return null;
  }

  const hubOccupiedNonRoad = placementNonRoadMask(hub);
  const hubOccupiedAll = placementAllOccupiedMask(hub);
  const orderedFastfillerCenters = orderFastfillerCentersByStorage(
    fastfillerCenters,
    hub
  );
  const fastfillerCenter = findFirstFastfillerCenter(
    fastfillerPattern,
    orderedFastfillerCenters,
    step2BuildableMask,
    input.terrain,
    hubOccupiedNonRoad,
    hubOccupiedAll
  );
  if (!fastfillerCenter) {
    return null;
  }
  const fastfiller = placeCorePatternAt(
    fastfillerPattern,
    fastfillerCenter,
    0,
    step2BuildableMask,
    input.terrain,
    hubOccupiedNonRoad,
    hubOccupiedAll
  );
  if (!fastfiller) {
    return null;
  }

  if (compact) {
    storeStep2CorePlacements(compact, hub, fastfiller);
  }

  return { hub, fastfiller };
}

/**
 * @param {string[][]} grid
 * @returns {PlacedToken[]}
 */

function buildCorePattern(grid) {
  const centerY = Math.floor(grid.length / 2);
  const centerX = Math.floor(grid[0].length / 2);
  /** @type {PlacedToken[]} */
  const pattern = [];

  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      pattern.push({ token: grid[y][x], x: x - centerX, y: y - centerY });
    }
  }

  return pattern;
}

/**
 * @param {PlacedToken[]} pattern
 * @param {RoomPoint} center
 * @param {number} rotation
 * @param {Uint8Array} buildableMask
 * @param {Room.Terrain} terrain
 * @param {Uint8Array | null} occupiedNonRoadMask
 * @param {Uint8Array | null} occupiedAllMask
 * @returns {CorePlacement | null}
 */

function placeCorePatternAt(
  pattern,
  center,
  rotation,
  buildableMask,
  terrain,
  occupiedNonRoadMask,
  occupiedAllMask
) {
  /** @type {PlacedToken[]} */
  const tokens = [];
  /** @type {RoomPoint[]} */
  const roads = [];
  /** @type {RoomPoint[]} */
  const blocked = [];
  /** @type {{ token: string, type: string, index: number, point: RoomPoint }[]} */
  const structures = [];

  for (let i = 0; i < pattern.length; i += 1) {
    const entry = pattern[i];
    const rotatedOffset = rotateOffset(entry.x, entry.y, rotation);
    const x = center.x + rotatedOffset.x;
    const y = center.y + rotatedOffset.y;
    const token = entry.token;

    if (!isInsideRoom(x, y)) {
      return null;
    }

    const index = y * 50 + x;
    if (token === ".") {
      tokens.push({ token, x, y });
      continue;
    }

    if (token === "t") {
      if (getTerrainCost(terrain, x, y) > 50) {
        return null;
      }
      if (!buildableMask[index]) {
        return null;
      }
      if (occupiedNonRoadMask && occupiedNonRoadMask[index]) {
        return null;
      }
      roads.push({ x, y });
      tokens.push({ token, x, y });
      continue;
    }

    if (!buildableMask[index]) {
      return null;
    }
    if (occupiedAllMask && occupiedAllMask[index]) {
      return null;
    }

    tokens.push({ token, x, y });
    if (token === "0") {
      blocked.push({ x, y });
      continue;
    }

    const parsed = parseStructureToken(token);
    if (!parsed) {
      return null;
    }
    structures.push({
      token,
      type: parsed.type,
      index: parsed.index,
      point: { x, y },
    });
  }

  return { center, rotation, tokens, roads, blocked, structures };
}

/**
 * @param {RoomPoint[]} points
 * @param {RoomPoint} target
 */

function findFirstFastfillerCenter(
  pattern,
  candidateCenters,
  buildableMask,
  terrain,
  occupiedNonRoadMask,
  occupiedAllMask
) {
  for (let i = 0; i < candidateCenters.length; i += 1) {
    const center = candidateCenters[i];
    const placement = placeCorePatternAt(
      pattern,
      center,
      0,
      buildableMask,
      terrain,
      occupiedNonRoadMask,
      occupiedAllMask
    );
    if (placement) {
      return center;
    }
  }

  return null;
}

/**
 * @param {RoomPoint[]} candidateCenters
 * @param {CorePlacement} hub
 * @returns {RoomPoint[]}
 */

function orderFastfillerCentersByStorage(candidateCenters, hub) {
  const orderedCenters = candidateCenters.slice();
  const storageToken = findInArray(hub.structures, (entry) => entry.token === "l");
  if (!storageToken) {
    return orderedCenters;
  }

  sortPointsByChebyshevDistance(orderedCenters, storageToken.point);
  return orderedCenters;
}

/**
 * @param {PlacedToken[]} pattern
 * @param {RoomPoint} center
 * @param {Uint8Array} buildableMask
 * @param {Room.Terrain} terrain
 * @param {RoomPoint} controllerPos
 * @returns {CorePlacement | null}
 */

function chooseHubRotationByControllerDistance(
  pattern,
  center,
  buildableMask,
  terrain,
  controllerPos
) {
  /** @type {{ placement: CorePlacement, distance: number } | null} */
  let best = null;

  for (let rotation = 0; rotation < 4; rotation += 1) {
    const placement = placeCorePatternAt(
      pattern,
      center,
      rotation,
      buildableMask,
      terrain,
      null,
      null
    );
    if (!placement) {
      continue;
    }

    const m1Token = findInArray(placement.structures, (entry) => entry.token === "m1");
    const distance = m1Token
      ? chebyshevDistance(m1Token.point, controllerPos)
      : Number.POSITIVE_INFINITY;
    if (!best || distance < best.distance) {
      best = { placement, distance };
    }
  }

  return best ? best.placement : null;
}

/**
 * @param {number} x
 * @param {number} y
 * @param {number} rotation
 * @returns {RoomPoint}
 */

function parseStructureToken(token) {
  if (/^e\d+$/.test(token)) return { type: "extension", index: +token.slice(1) };
  if (/^f\d+$/.test(token)) return { type: "spawn", index: +token.slice(1) };
  if (/^k\d+$/.test(token)) return { type: "container", index: +token.slice(1) };
  if (/^m\d+$/.test(token)) return { type: "link", index: +token.slice(1) };
  if (/^s\d+$/.test(token)) return { type: "fastfiller_tile", index: +token.slice(1) };
  if (token === "g") return { type: "nuker", index: 1 };
  if (token === "h") return { type: "terminal", index: 1 };
  if (token === "i") return { type: "factory", index: 1 };
  if (token === "j") return { type: "powerSpawn", index: 1 };
  if (token === "l") return { type: "storage", index: 1 };
  if (token === "r") return { type: "manager_tile", index: 1 };
  return null;
}

/**
 * @param {Room.Terrain} terrain
 * @param {number} x
 * @param {number} y
 * @returns {number}
 */

function placementNonRoadMask(placement) {
  const mask = new Uint8Array(2500);
  for (let i = 0; i < placement.structures.length; i += 1) {
    const point = placement.structures[i].point;
    mask[point.y * 50 + point.x] = 1;
  }
  for (let i = 0; i < placement.blocked.length; i += 1) {
    const point = placement.blocked[i];
    mask[point.y * 50 + point.x] = 1;
  }
  return mask;
}

/**
 * @param {CorePlacement} placement
 * @returns {Uint8Array}
 */

function placementAllOccupiedMask(placement) {
  const mask = placementNonRoadMask(placement);
  for (let i = 0; i < placement.roads.length; i += 1) {
    const point = placement.roads[i];
    mask[point.y * 50 + point.x] = 1;
  }
  return mask;
}

/**
 * @param {RoomPoint} a
 * @param {RoomPoint} b
 * @returns {number}
 */

function buildStep2TemporaryBlockedMask(input) {
  const blockedMask = new Uint8Array(2500);
  markRangeBlocked(
    blockedMask,
    input.controller_pos,
    STEP2_TEMP_BLOCK_CONTROLLER_RANGE
  );
  markRangeBlocked(blockedMask, input.mineral_pos, STEP2_TEMP_BLOCK_RESOURCE_RANGE);
  markRangeBlocked(blockedMask, input.source1_pos, STEP2_TEMP_BLOCK_RESOURCE_RANGE);
  if (input.source2_pos) {
    markRangeBlocked(
      blockedMask,
      input.source2_pos,
      STEP2_TEMP_BLOCK_RESOURCE_RANGE
    );
  }
  return blockedMask;
}

/**
 * @param {Uint8Array} buildableMask
 * @param {Uint8Array} blockedMask
 * @returns {Uint8Array}
 */

function applyTemporaryBlockMask(buildableMask, blockedMask) {
  const masked = cloneMask(buildableMask);
  for (let i = 0; i < 2500; i += 1) {
    if (blockedMask[i]) {
      masked[i] = 0;
    }
  }
  return masked;
}

/**
 * @param {Uint8Array} blockedMask
 * @param {RoomPoint} point
 * @param {number} range
 */

module.exports = {
  planStep2Cores,
  buildCorePattern,
  placeCorePatternAt,
  findFirstFastfillerCenter,
  orderFastfillerCentersByStorage,
  chooseHubRotationByControllerDistance,
  parseStructureToken,
  placementNonRoadMask,
  placementAllOccupiedMask,
  buildStep2TemporaryBlockedMask,
  applyTemporaryBlockMask,
};
