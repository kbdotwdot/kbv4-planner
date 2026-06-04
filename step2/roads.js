const { isInsideRoom, packMincutPosToVertex } = require("../lib/mask");
const { chebyshevDistance, indexToPoint } = require("../lib/geo");
const { getTerrainCost, isRoomExitTile } = require("../lib/terrain");
const { TERRAIN_BLOCKING_COST } = require("../constants");

function estimatePathCost(
  start,
  target,
  range,
  input,
  blockedMask,
  roadMask,
  extensionRoadMask,
  nonBuildableMask
) {
  const costMatrix = buildRoadRoutingCostMatrix(
    input,
    blockedMask,
    roadMask,
    start,
    extensionRoadMask,
    nonBuildableMask
  );
  const result = PathFinder.search(
    new RoomPosition(start.x, start.y, input.roomName),
    { pos: new RoomPosition(target.x, target.y, input.roomName), range },
    {
      plainCost: 4,
      swampCost: 5,
      maxRooms: 1,
      roomCallback() {
        return costMatrix;
      },
    }
  );
  return result.incomplete ? Infinity : result.cost;
}

/**
 * @param {RoomPoint} start
 * @param {RoomPoint} target
 * @param {number} range
 * @param {PlannerInput & { type: number }} input
 * @param {Uint8Array} blockedMask
 * @param {Uint8Array} roadMask
 * @param {Uint8Array | undefined} [extensionRoadMask]
 * @returns {RoomPoint[]}
 */

function findRoadPath(
  start,
  target,
  range,
  input,
  blockedMask,
  roadMask,
  extensionRoadMask,
  nonBuildableMask
) {
  const startIndex = start.y * 50 + start.x;
  const bestCost = new Int32Array(2500);
  const diagonalSteps = new Int16Array(2500);
  const previous = new Int16Array(2500);
  const closed = new Uint8Array(2500);
  const inOpen = new Uint8Array(2500);
  bestCost.fill(2147483647);
  diagonalSteps.fill(-32768);
  previous.fill(-1);

  /** @type {number[]} */
  const open = [startIndex];
  bestCost[startIndex] = 0;
  diagonalSteps[startIndex] = 0;
  inOpen[startIndex] = 1;
  let bestTargetIndex = -1;

  while (open.length > 0) {
    const openIndex = selectBestRoadOpenIndex(open, bestCost, diagonalSteps, target);
    const currentIndex = open[openIndex];
    const lastOpenIndex = /** @type {number} */ (open.pop());
    if (openIndex < open.length) {
      open[openIndex] = lastOpenIndex;
    }
    inOpen[currentIndex] = 0;

    if (bestTargetIndex !== -1 && bestCost[currentIndex] > bestCost[bestTargetIndex]) {
      break;
    }

    if (closed[currentIndex]) {
      continue;
    }
    closed[currentIndex] = 1;

    const current = indexToPoint(currentIndex);
    if (currentIndex !== startIndex && chebyshevDistance(current, target) <= range) {
      if (
        bestTargetIndex === -1 ||
        bestCost[currentIndex] < bestCost[bestTargetIndex] ||
        (bestCost[currentIndex] === bestCost[bestTargetIndex] &&
          diagonalSteps[currentIndex] > diagonalSteps[bestTargetIndex])
      ) {
        bestTargetIndex = currentIndex;
      }
      continue;
    }

    const neighbors = getDiagonalPreferredNeighbors(current, target);
    for (let i = 0; i < neighbors.length; i += 1) {
      const neighbor = neighbors[i];
      if (
        !isRoadBuildableForRouting(
          neighbor,
          input,
          blockedMask,
          roadMask,
          start,
          extensionRoadMask,
          nonBuildableMask
        )
      ) {
        continue;
      }

      const neighborIndex = neighbor.y * 50 + neighbor.x;
      if (closed[neighborIndex]) {
        continue;
      }

      const stepCost = getRoadRoutingTileCost(
        neighbor,
        input,
        blockedMask,
        roadMask,
        start,
        extensionRoadMask,
        nonBuildableMask
      );
      if (stepCost >= 255) {
        continue;
      }

      const isDiagonal =
        Math.abs(neighbor.x - current.x) === 1 &&
        Math.abs(neighbor.y - current.y) === 1;
      const nextCost = bestCost[currentIndex] + stepCost;
      const nextDiagonalSteps = diagonalSteps[currentIndex] + (isDiagonal ? 1 : 0);

      if (
        nextCost < bestCost[neighborIndex] ||
        (nextCost === bestCost[neighborIndex] &&
          nextDiagonalSteps > diagonalSteps[neighborIndex])
      ) {
        bestCost[neighborIndex] = nextCost;
        diagonalSteps[neighborIndex] = nextDiagonalSteps;
        previous[neighborIndex] = currentIndex;
        if (!inOpen[neighborIndex]) {
          open.push(neighborIndex);
          inOpen[neighborIndex] = 1;
        }
      }
    }
  }

  if (bestTargetIndex === -1) {
    return [];
  }

  return reconstructRoadPath(previous, bestTargetIndex, startIndex);
}

/**
 * @param {number[]} open
 * @param {Int32Array} bestCost
 * @param {Int16Array} diagonalSteps
 * @param {RoomPoint} target
 * @returns {number}
 */

function selectBestRoadOpenIndex(open, bestCost, diagonalSteps, target) {
  let bestOpenIndex = 0;
  for (let i = 1; i < open.length; i += 1) {
    const candidate = open[i];
    const current = open[bestOpenIndex];
    if (isBetterRoadOpenNode(candidate, current, bestCost, diagonalSteps, target)) {
      bestOpenIndex = i;
    }
  }
  return bestOpenIndex;
}

/**
 * @param {number} candidate
 * @param {number} current
 * @param {Int32Array} bestCost
 * @param {Int16Array} diagonalSteps
 * @param {RoomPoint} target
 * @returns {boolean}
 */

function isBetterRoadOpenNode(candidate, current, bestCost, diagonalSteps, target) {
  if (bestCost[candidate] !== bestCost[current]) {
    return bestCost[candidate] < bestCost[current];
  }

  const candidatePoint = indexToPoint(candidate);
  const currentPoint = indexToPoint(current);
  const candidateDistance = chebyshevDistance(candidatePoint, target);
  const currentDistance = chebyshevDistance(currentPoint, target);
  if (candidateDistance !== currentDistance) {
    return candidateDistance < currentDistance;
  }

  return diagonalSteps[candidate] > diagonalSteps[current];
}

/**
 * @param {RoomPoint} current
 * @param {RoomPoint} target
 * @returns {RoomPoint[]}
 */

function getDiagonalPreferredNeighbors(current, target) {
  /** @type {RoomPoint[]} */
  const neighbors = [];
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) {
        continue;
      }
      const x = current.x + dx;
      const y = current.y + dy;
      if (!isInsideRoom(x, y)) {
        continue;
      }
      neighbors.push({ x, y });
    }
  }

  neighbors.sort((left, right) => {
    const leftDiagonal = left.x !== current.x && left.y !== current.y ? 1 : 0;
    const rightDiagonal = right.x !== current.x && right.y !== current.y ? 1 : 0;
    if (leftDiagonal !== rightDiagonal) {
      return rightDiagonal - leftDiagonal;
    }

    return chebyshevDistance(left, target) - chebyshevDistance(right, target);
  });

  return neighbors;
}

/**
 * @param {Int16Array} previous
 * @param {number} targetIndex
 * @param {number} startIndex
 * @returns {RoomPoint[]}
 */

function reconstructRoadPath(previous, targetIndex, startIndex) {
  /** @type {RoomPoint[]} */
  const reversed = [];
  let current = targetIndex;
  while (current !== -1 && current !== startIndex) {
    reversed.push(indexToPoint(current));
    current = previous[current];
  }

  /** @type {RoomPoint[]} */
  const path = [];
  for (let i = reversed.length - 1; i >= 0; i -= 1) {
    path.push(reversed[i]);
  }
  return path;
}

/**
 * @param {number} index
 * @returns {RoomPoint}
 */

function preferDiagonalRoadPath(start, path, input, blockedMask, roadMask) {
  /** @type {RoomPoint[]} */
  const result = [];
  let previous = start;

  for (let i = 0; i < path.length; i += 1) {
    const current = path[i];
    const next = path[i + 1];
    if (
      next &&
      canSkipCardinalCorner(
        previous,
        current,
        next,
        input,
        blockedMask,
        roadMask,
        undefined
      )
    ) {
      previous = next;
      result.push(next);
      i += 1;
      continue;
    }

    result.push(current);
    previous = current;
  }

  return result;
}

/**
 * @param {RoomPoint} previous
 * @param {RoomPoint} current
 * @param {RoomPoint} next
 * @param {PlannerInput & { type: number }} input
 * @param {Uint8Array} blockedMask
 * @param {Uint8Array} roadMask
 * @returns {boolean}
 */

function canSkipCardinalCorner(
  previous,
  current,
  next,
  input,
  blockedMask,
  roadMask,
  nonBuildableMask
) {
  const firstDx = Math.abs(current.x - previous.x);
  const firstDy = Math.abs(current.y - previous.y);
  const secondDx = Math.abs(next.x - current.x);
  const secondDy = Math.abs(next.y - current.y);

  if (firstDx + firstDy !== 1 || secondDx + secondDy !== 1) {
    return false;
  }
  if (chebyshevDistance(previous, next) !== 1) {
    return false;
  }

  const currentIndex = current.y * 50 + current.x;
  const nextIndex = next.y * 50 + next.x;
  if (roadMask[currentIndex] && !roadMask[nextIndex]) {
    return false;
  }
  if (
    !isRoadBuildableForRouting(
      next,
      input,
      blockedMask,
      roadMask,
      previous,
      undefined,
      nonBuildableMask
    )
  ) {
    return false;
  }

  return (
    getRoadRoutingTileCost(
      next,
      input,
      blockedMask,
      roadMask,
      previous,
      undefined,
      nonBuildableMask
    ) <=
    getRoadRoutingTileCost(
      current,
      input,
      blockedMask,
      roadMask,
      previous,
      undefined,
      nonBuildableMask
    )
  );
}

/**
 * @param {RoomPoint} point
 * @param {PlannerInput & { type: number }} input
 * @param {Uint8Array} blockedMask
 * @param {Uint8Array} roadMask
 * @param {RoomPoint} start
 * @param {Uint8Array | undefined} [extensionRoadMask]
 * @returns {boolean}
 */

function isRoadBuildableForRouting(
  point,
  input,
  blockedMask,
  roadMask,
  start,
  extensionRoadMask,
  nonBuildableMask
) {
  if (!isInsideRoom(point.x, point.y)) {
    return false;
  }
  if (point.x === start.x && point.y === start.y) {
    return true;
  }
  if (isRoomExitTile(point.x, point.y, input.terrain)) {
    return false;
  }
  const index = point.y * 50 + point.x;
  if (nonBuildableMask && nonBuildableMask[index]) {
    return false;
  }
  if (roadMask[index]) {
    return !(input.terrain.get(point.x, point.y) & TERRAIN_MASK_WALL);
  }
  if (extensionRoadMask && extensionRoadMask[index]) {
    return !(input.terrain.get(point.x, point.y) & TERRAIN_MASK_WALL);
  }
  return !(input.terrain.get(point.x, point.y) & TERRAIN_MASK_WALL) && !blockedMask[index];
}

/**
 * @param {RoomPoint} point
 * @param {PlannerInput & { type: number }} input
 * @param {Uint8Array} blockedMask
 * @param {Uint8Array} roadMask
 * @param {RoomPoint} start
 * @param {Uint8Array | undefined} [extensionRoadMask]
 * @returns {number}
 */

function getRoadRoutingTileCost(
  point,
  input,
  blockedMask,
  roadMask,
  start,
  extensionRoadMask,
  nonBuildableMask
) {
  if (point.x === start.x && point.y === start.y) {
    return 1;
  }
  if (isRoomExitTile(point.x, point.y, input.terrain)) {
    return 255;
  }
  const index = point.y * 50 + point.x;
  if (nonBuildableMask && nonBuildableMask[index]) {
    return 255;
  }
  if (roadMask[index]) {
    return 1;
  }
  if (extensionRoadMask && extensionRoadMask[index]) {
    return input.terrain.get(point.x, point.y) & TERRAIN_MASK_WALL ? 255 : 5;
  }
  if (blockedMask[index] || input.terrain.get(point.x, point.y) & TERRAIN_MASK_WALL) {
    return 255;
  }
  return input.terrain.get(point.x, point.y) & TERRAIN_MASK_SWAMP ? 5 : 4;
}

/**
 * @param {PlannerInput & { type: number }} input
 * @param {Uint8Array} blockedMask
 * @param {Uint8Array} roadMask
 * @param {RoomPoint} start
 * @param {Uint8Array | undefined} [extensionRoadMask]
 * @returns {CostMatrix}
 */

function buildRoadRoutingCostMatrix(
  input,
  blockedMask,
  roadMask,
  start,
  extensionRoadMask,
  nonBuildableMask
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
      if (nonBuildableMask && nonBuildableMask[index]) {
        costMatrix.set(x, y, 255);
        continue;
      }
      if (roadMask[index]) {
        costMatrix.set(x, y, 1);
        continue;
      }
      if (extensionRoadMask && extensionRoadMask[index]) {
        costMatrix.set(x, y, 5);
        continue;
      }
      if (blockedMask[index]) {
        costMatrix.set(x, y, 255);
        continue;
      }
      costMatrix.set(x, y, terrain & TERRAIN_MASK_SWAMP ? 5 : 4);
    }
  }

  costMatrix.set(start.x, start.y, 1);
  return costMatrix;
}

/**
 * @param {RoomPoint[]} points
 * @returns {Uint8Array}
 */

function buildRoadMaskFromPoints(points) {
  const roadMask = new Uint8Array(2500);
  for (let i = 0; i < points.length; i += 1) {
    roadMask[points[i].y * 50 + points[i].x] = 1;
  }
  return roadMask;
}

/**
 * @param {{ token: string, type: string, index: number, point: RoomPoint }[]} structures
 * @param {Uint8Array} blockedMask
 * @param {string} token
 * @param {string} type
 * @param {number} index
 * @param {RoomPoint} point
 */

function appendRoadPath(roads, roadMask, path) {
  for (let i = 0; i < path.length; i += 1) {
    const point = path[i];
    const index = point.y * 50 + point.x;
    if (roadMask[index]) {
      continue;
    }
    roadMask[index] = 1;
    roads.push(point);
  }
}

/**
 * @param {Set<number>} blockedTileSet
 * @param {Uint8Array} placementBlockedMask
 * @param {RoomPoint[]} path
 */

function markRoadPathBlocked(blockedTileSet, placementBlockedMask, path) {
  for (let i = 0; i < path.length; i += 1) {
    const point = path[i];
    const packed = packMincutPosToVertex(point.x, point.y);
    blockedTileSet.add(packed);
    placementBlockedMask[point.y * 50 + point.x] = 1;
  }
}

/**
 * @param {PlannerInput & { type: number }} input
 * @returns {Uint8Array}
 */

module.exports = {
  estimatePathCost,
  findRoadPath,
  selectBestRoadOpenIndex,
  isBetterRoadOpenNode,
  getDiagonalPreferredNeighbors,
  reconstructRoadPath,
  preferDiagonalRoadPath,
  canSkipCardinalCorner,
  isRoadBuildableForRouting,
  getRoadRoutingTileCost,
  buildRoadRoutingCostMatrix,
  buildRoadMaskFromPoints,
  appendRoadPath,
  markRoadPathBlocked,
};
