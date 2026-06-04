const { pointsToMask, isInsideRoom } = require("../lib/mask");
const { chebyshevDistance } = require("../lib/geo");
const { findRoadPath, buildRoadRoutingCostMatrix, appendRoadPath, markRoadPathBlocked, buildRoadMaskFromPoints } = require("./roads");
const { ACCESS_REPAIR_ROAD_COST, ACCESS_REPAIR_EXTENSION_COST, ACCESS_REPAIR_TERRAIN_COST, TERRAIN_BLOCKING_COST } = require("../constants");
const {
  buildRoadOnlyAccessCostMatrix,
  buildStrictAccessCostMatrix,
  canPathToPlannedStructureRange,
} = require("./accessCost");

function finalizeServiceRoadAccessibility(
  input,
  winner,
  walkableMask,
  storagePoint,
  structures,
  roads,
  placementBlockedMask,
  structureBlockedMask,
  roadMask,
  blockedTileSet,
  nonBuildableMask
) {
  const { replaceExtensionsConsumedByRoadPath, buildStructureTypeMask } = require("./serviceSites");
  const { buildExtensionCandidates } = require("./extensions");
  const extensionReplacementCandidates = buildExtensionCandidates(
    input,
    winner,
    walkableMask,
    placementBlockedMask,
    structureBlockedMask,
    roadMask,
    storagePoint,
    nonBuildableMask
  );

  for (let guard = 0; guard < 2500; guard += 1) {
    const inaccessibleStructure = findFirstInaccessibleServiceStructure(
      structures,
      storagePoint,
      input,
      roadMask,
      nonBuildableMask
    );
    if (!inaccessibleStructure) {
      return true;
    }

    const extensionMask = buildStructureTypeMask(structures, "extension");
    const path = findServiceAccessibilityRoadPath(
      storagePoint,
      inaccessibleStructure.point,
      input,
      structureBlockedMask,
      roadMask,
      extensionMask,
      nonBuildableMask
    );
    if (path.length === 0) {
      return false;
    }
    if (
      !replaceExtensionsConsumedByRoadPath(
        input,
        path,
        extensionReplacementCandidates,
        storagePoint,
        structures,
        placementBlockedMask,
        structureBlockedMask,
        roadMask,
        extensionMask,
        nonBuildableMask
      )
    ) {
      return false;
    }

    appendRoadPath(roads, roadMask, path);
    markRoadPathBlocked(blockedTileSet, placementBlockedMask, path);
  }

  return false;
}

/**
 * @param {{ token: string, type: string, index: number, point: RoomPoint }[]} structures
 * @param {RoomPoint} storagePoint
 * @param {PlannerInput & { type: number }} input
 * @param {Uint8Array} roadMask
 * @returns {{ token: string, type: string, index: number, point: RoomPoint } | null}
 */

function findFirstInaccessibleServiceStructure(
  structures,
  storagePoint,
  input,
  roadMask,
  nonBuildableMask
) {
  for (let i = 0; i < structures.length; i += 1) {
    const structure = structures[i];
    if (structure.type !== "tower" && structure.type !== "lab") {
      continue;
    }
    if (
      !isStructureAccessibleThroughRoads(
        storagePoint,
        structure.point,
        input,
        roadMask,
        nonBuildableMask
      )
    ) {
      return structure;
    }
  }
  for (let i = 0; i < structures.length; i += 1) {
    const structure = structures[i];
    if (structure.type !== "extension") {
      continue;
    }
    if (
      !isStructureAccessibleThroughRoads(
        storagePoint,
        structure.point,
        input,
        roadMask,
        nonBuildableMask
      )
    ) {
      return structure;
    }
  }
  return null;
}

/**
 * @param {RoomPoint} start
 * @param {RoomPoint} target
 * @param {PlannerInput & { type: number }} input
 * @param {Uint8Array} roadMask
 * @returns {boolean}
 */

function isStructureAccessibleThroughRoads(
  start,
  target,
  input,
  roadMask,
  nonBuildableMask
) {
  const costMatrix = buildRoadOnlyAccessCostMatrix(input, roadMask, nonBuildableMask, start);
  const result = PathFinder.search(
    new RoomPosition(start.x, start.y, input.roomName),
    { pos: new RoomPosition(target.x, target.y, input.roomName), range: 1 },
    {
      plainCost: 1,
      swampCost: 1,
      maxRooms: 1,
      roomCallback() {
        return costMatrix;
      },
    }
  );
  return !result.incomplete;
}

/**
 * @param {PlannerInput & { type: number }} input
 * @param {Uint8Array} roadMask
 * @param {RoomPoint} start
 * @returns {CostMatrix}
 */

/**
 * @param {RoomPoint} start
 * @param {RoomPoint} target
 * @param {PlannerInput & { type: number }} input
 * @param {Uint8Array} structureBlockedMask
 * @param {Uint8Array} roadMask
 * @param {Uint8Array} extensionMask
 * @returns {RoomPoint[]}
 */

function findServiceAccessibilityRoadPath(
  start,
  target,
  input,
  structureBlockedMask,
  roadMask,
  extensionMask,
  nonBuildableMask
) {
  const costMatrix = buildServiceAccessibilityRoadCostMatrix(
    input,
    structureBlockedMask,
    roadMask,
    extensionMask,
    nonBuildableMask,
    start
  );
  const result = PathFinder.search(
    new RoomPosition(start.x, start.y, input.roomName),
    { pos: new RoomPosition(target.x, target.y, input.roomName), range: 1 },
    {
      plainCost: ACCESS_REPAIR_TERRAIN_COST,
      swampCost: ACCESS_REPAIR_TERRAIN_COST,
      maxRooms: 1,
      roomCallback() {
        return costMatrix;
      },
    }
  );
  return result.incomplete ? [] : result.path;
}

/**
 * @param {PlannerInput & { type: number }} input
 * @param {Uint8Array} structureBlockedMask
 * @param {Uint8Array} roadMask
 * @param {Uint8Array} extensionMask
 * @param {RoomPoint} start
 * @returns {CostMatrix}
 */

function buildServiceAccessibilityRoadCostMatrix(
  input,
  structureBlockedMask,
  roadMask,
  extensionMask,
  nonBuildableMask,
  start
) {
  const costMatrix = new PathFinder.CostMatrix();
  for (let y = 0; y < 50; y += 1) {
    for (let x = 0; x < 50; x += 1) {
      const index = y * 50 + x;
      const terrain = input.terrain.get(x, y);
      if (terrain & TERRAIN_MASK_WALL) {
        costMatrix.set(x, y, 255);
        continue;
      }
      if (nonBuildableMask[index]) {
        costMatrix.set(x, y, 255);
        continue;
      }
      if (x === start.x && y === start.y) {
        costMatrix.set(x, y, ACCESS_REPAIR_ROAD_COST);
        continue;
      }
      if (roadMask[index]) {
        costMatrix.set(x, y, ACCESS_REPAIR_ROAD_COST);
        continue;
      }
      if (structureBlockedMask[index] && !extensionMask[index]) {
        costMatrix.set(x, y, 255);
        continue;
      }
      if (extensionMask[index]) {
        costMatrix.set(x, y, ACCESS_REPAIR_EXTENSION_COST);
        continue;
      }
      costMatrix.set(x, y, ACCESS_REPAIR_TERRAIN_COST);
    }
  }
  return costMatrix;
}

module.exports = {
  finalizeServiceRoadAccessibility,
  findFirstInaccessibleServiceStructure,
  isStructureAccessibleThroughRoads,
  buildRoadOnlyAccessCostMatrix,
  findServiceAccessibilityRoadPath,
  buildServiceAccessibilityRoadCostMatrix,
  canPathToPlannedStructureRange,
  buildStrictAccessCostMatrix,
};
