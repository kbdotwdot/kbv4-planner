const {
  ACCESS_REPAIR_ROAD_COST,
  ACCESS_REPAIR_TERRAIN_COST,
} = require("../constants");

/**
 * @param {PlannerInput & { type: number }} input
 * @param {Uint8Array} roadMask
 * @param {Uint8Array} nonBuildableMask
 * @param {RoomPoint} start
 * @returns {CostMatrix}
 */
function buildRoadOnlyAccessCostMatrix(input, roadMask, nonBuildableMask, start) {
  const costMatrix = new PathFinder.CostMatrix();
  for (let y = 0; y < 50; y += 1) {
    for (let x = 0; x < 50; x += 1) {
      const index = y * 50 + x;
      if (input.terrain.get(x, y) & TERRAIN_MASK_WALL) {
        costMatrix.set(x, y, 255);
        continue;
      }
      if (nonBuildableMask[index]) {
        costMatrix.set(x, y, 255);
        continue;
      }
      if ((x === start.x && y === start.y) || roadMask[index]) {
        costMatrix.set(x, y, ACCESS_REPAIR_ROAD_COST);
      } else {
        costMatrix.set(x, y, 255);
      }
    }
  }
  return costMatrix;
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
function buildStrictAccessCostMatrix(
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
        costMatrix.set(x, y, 1);
        continue;
      }
      if (plannedStructureMask[index] || placementBlockedMask[index]) {
        costMatrix.set(x, y, 255);
        continue;
      }
      costMatrix.set(x, y, terrain & TERRAIN_MASK_SWAMP ? 5 : 4);
    }
  }
  return costMatrix;
}

/**
 * @param {RoomPoint} target
 * @param {RoomPoint} storagePoint
 * @param {PlannerInput & { type: number }} input
 * @param {Uint8Array} placementBlockedMask
 * @param {Uint8Array} roadMask
 * @param {Uint8Array} plannedStructureMask
 * @param {Uint8Array} nonBuildableMask
 * @returns {boolean}
 */
function canPathToPlannedStructureRange(
  target,
  storagePoint,
  input,
  placementBlockedMask,
  roadMask,
  plannedStructureMask,
  nonBuildableMask
) {
  const costMatrix = buildStrictAccessCostMatrix(
    input,
    placementBlockedMask,
    roadMask,
    plannedStructureMask,
    nonBuildableMask,
    storagePoint
  );
  const result = PathFinder.search(
    new RoomPosition(storagePoint.x, storagePoint.y, input.roomName),
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
  return !result.incomplete;
}

module.exports = {
  buildRoadOnlyAccessCostMatrix,
  buildStrictAccessCostMatrix,
  canPathToPlannedStructureRange,
};
