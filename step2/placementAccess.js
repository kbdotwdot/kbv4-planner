const { canPathToPlannedStructureRange } = require("./accessCost");
const {
  ACCESS_REPAIR_ROAD_COST,
  ACCESS_REPAIR_EXTENSION_COST,
  ACCESS_REPAIR_TERRAIN_COST,
} = require("../constants");

/**
 * @param {RoomPoint[]} plannedStructures
 * @param {RoomPoint} storagePoint
 * @param {PlannerInput & { type: number }} input
 * @param {Uint8Array} placementBlockedMask
 * @param {Uint8Array} roadMask
 * @param {Uint8Array} plannedStructureMask
 * @param {Uint8Array} nonBuildableMask
 * @returns {number}
 */
function findInaccessibleLabIndex(
  plannedStructures,
  storagePoint,
  input,
  placementBlockedMask,
  roadMask,
  plannedStructureMask,
  nonBuildableMask
) {
  for (let i = 0; i < plannedStructures.length; i += 1) {
    if (
      !canPathToPlannedStructureRange(
        plannedStructures[i],
        storagePoint,
        input,
        placementBlockedMask,
        roadMask,
        plannedStructureMask,
        nonBuildableMask
      )
    ) {
      return i;
    }
  }
  return -1;
}

/**
 * @param {RoomPoint} start
 * @param {RoomPoint} target
 * @param {PlannerInput & { type: number }} input
 * @param {Uint8Array} placementBlockedMask
 * @param {Uint8Array} roadMask
 * @param {Uint8Array} plannedStructureMask
 * @param {Uint8Array} nonBuildableMask
 * @returns {RoomPoint[]}
 */
function findLabAccessPath(
  start,
  target,
  input,
  placementBlockedMask,
  roadMask,
  plannedStructureMask,
  nonBuildableMask
) {
  const costMatrix = buildLabAccessCostMatrix(
    input,
    placementBlockedMask,
    roadMask,
    plannedStructureMask,
    nonBuildableMask,
    start
  );
  const result = PathFinder.search(
    new RoomPosition(start.x, start.y, input.roomName),
    { pos: new RoomPosition(target.x, target.y, input.roomName), range: 1 },
    {
      plainCost: 4,
      swampCost: 5,
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
 * @param {Uint8Array} placementBlockedMask
 * @param {Uint8Array} roadMask
 * @param {Uint8Array} plannedStructureMask
 * @param {Uint8Array} nonBuildableMask
 * @param {RoomPoint} start
 * @returns {CostMatrix}
 */
function buildLabAccessCostMatrix(
  input,
  placementBlockedMask,
  roadMask,
  plannedStructureMask,
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
      if (x === start.x && y === start.y) {
        costMatrix.set(x, y, 1);
        continue;
      }
      if (nonBuildableMask[index]) {
        costMatrix.set(x, y, 255);
        continue;
      }
      if (roadMask[index]) {
        costMatrix.set(x, y, ACCESS_REPAIR_ROAD_COST);
        continue;
      }
      if (plannedStructureMask[index]) {
        costMatrix.set(x, y, ACCESS_REPAIR_EXTENSION_COST);
        continue;
      }
      if (placementBlockedMask[index]) {
        costMatrix.set(x, y, 255);
        continue;
      }
      costMatrix.set(x, y, ACCESS_REPAIR_TERRAIN_COST);
    }
  }
  return costMatrix;
}

/**
 * @param {RoomPoint[]} path
 * @param {RoomPoint[]} plannedStructures
 * @returns {number}
 */
function findBlockingLabIndexInPath(path, plannedStructures) {
  let blockingLabIndex = -1;
  for (let i = 0; i < path.length; i += 1) {
    const pathPoint = path[i];
    for (let j = 0; j < plannedStructures.length; j += 1) {
      if (
        plannedStructures[j].x === pathPoint.x &&
        plannedStructures[j].y === pathPoint.y
      ) {
        blockingLabIndex = j;
      }
    }
  }
  return blockingLabIndex;
}

module.exports = {
  findInaccessibleLabIndex,
  findLabAccessPath,
  buildLabAccessCostMatrix,
  findBlockingLabIndexInPath,
};
