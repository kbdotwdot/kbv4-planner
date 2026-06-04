const { isInsideRoom } = require("./mask");
const {
  MAX_DISTANCE,
  EXIT_BLOCK_RANGE,
  EIGHT_NEIGHBOR_VECTORS,
  TERRAIN_BLOCKING_COST,
} = require("../constants");

function buildWallDistanceMap(terrain, controllerPos) {
  const blocked = buildBlockedMask(terrain, controllerPos);
  const distances = new Uint8Array(2500);
  distances.fill(MAX_DISTANCE);

  /** @type {number[]} */
  const queueX = [];
  /** @type {number[]} */
  const queueY = [];
  let head = 0;

  for (let y = 0; y < 50; y += 1) {
    for (let x = 0; x < 50; x += 1) {
      const index = y * 50 + x;
      if (!blocked[index]) {
        continue;
      }

      distances[index] = 0;
      queueX.push(x);
      queueY.push(y);
    }
  }

  while (head < queueX.length) {
    const x = queueX[head];
    const y = queueY[head];
    const index = y * 50 + x;
    const nextDistance = distances[index] + 1;
    head += 1;

    expandDistance(queueX, queueY, distances, x + 1, y, nextDistance);
    expandDistance(queueX, queueY, distances, x - 1, y, nextDistance);
    expandDistance(queueX, queueY, distances, x, y + 1, nextDistance);
    expandDistance(queueX, queueY, distances, x, y - 1, nextDistance);
    expandDistance(queueX, queueY, distances, x + 1, y + 1, nextDistance);
    expandDistance(queueX, queueY, distances, x - 1, y + 1, nextDistance);
    expandDistance(queueX, queueY, distances, x + 1, y - 1, nextDistance);
    expandDistance(queueX, queueY, distances, x - 1, y - 1, nextDistance);
  }

  return distances;
}

/**
 * @param {Room.Terrain} terrain
 * @returns {Uint8Array}
 */

function buildBlockedMask(terrain, controllerPos) {
  const blocked = new Uint8Array(2500);

  for (let y = 0; y < 50; y += 1) {
    for (let x = 0; x < 50; x += 1) {
      const tile = terrain.get(x, y);
      if (tile & TERRAIN_MASK_WALL) {
        blocked[y * 50 + x] = 1;
      }
    }
  }

  applyExitBufferMask(blocked, terrain);
  applyControllerBufferMask(blocked, controllerPos, 3);

  return blocked;
}

/**
 * @param {Uint8Array} blocked
 * @param {Room.Terrain} terrain
 */

function applyExitBufferMask(blocked, terrain) {
  for (let y = 0; y < 50; y += 1) {
    for (let x = 0; x < 50; x += 1) {
      if (x !== 0 && x !== 49 && y !== 0 && y !== 49) {
        continue;
      }

      const tile = terrain.get(x, y);
      if (tile & TERRAIN_MASK_WALL) {
        continue;
      }

      for (let dy = -EXIT_BLOCK_RANGE; dy <= EXIT_BLOCK_RANGE; dy += 1) {
        for (let dx = -EXIT_BLOCK_RANGE; dx <= EXIT_BLOCK_RANGE; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx > 49 || ny < 0 || ny > 49) {
            continue;
          }
          blocked[ny * 50 + nx] = 1;
        }
      }
    }
  }
}

/**
 * @param {Uint8Array} blocked
 * @param {RoomPoint | undefined} controllerPos
 * @param {number} range
 */
function applyControllerBufferMask(blocked, controllerPos, range) {
  if (
    !controllerPos ||
    !Number.isFinite(controllerPos.x) ||
    !Number.isFinite(controllerPos.y)
  ) {
    return;
  }

  for (let dy = -range; dy <= range; dy += 1) {
    for (let dx = -range; dx <= range; dx += 1) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) > range) {
        continue;
      }

      const x = controllerPos.x + dx;
      const y = controllerPos.y + dy;
      if (!isInsideRoom(x, y)) {
        continue;
      }

      blocked[y * 50 + x] = 1;
    }
  }
}

/**
 * @param {number[]} queueX
 * @param {number[]} queueY
 * @param {Uint8Array} distances
 * @param {number} x
 * @param {number} y
 * @param {number} nextDistance
 */

function expandDistance(queueX, queueY, distances, x, y, nextDistance) {
  if (x < 0 || x > 49 || y < 0 || y > 49) {
    return;
  }

  const index = y * 50 + x;
  if (distances[index] <= nextDistance) {
    return;
  }

  distances[index] = nextDistance;
  queueX.push(x);
  queueY.push(y);
}

/**
 * @param {PlannerInput & { type: number }} input
 * @returns {CostMatrix}
 */

function buildPassableMask(terrain) {
  const passableMask = new Uint8Array(2500);
  for (let y = 0; y < 50; y += 1) {
    for (let x = 0; x < 50; x += 1) {
      if (!(terrain.get(x, y) & TERRAIN_MASK_WALL)) {
        passableMask[y * 50 + x] = 1;
      }
    }
  }
  return passableMask;
}

/**
 * @param {number} x
 * @param {number} y
 * @param {Room.Terrain} terrain
 * @returns {boolean}
 */

function isRoomExitTile(x, y, terrain) {
  if (x !== 0 && x !== 49 && y !== 0 && y !== 49) {
    return false;
  }
  return !(terrain.get(x, y) & TERRAIN_MASK_WALL);
}

/**
 * @param {Room.Terrain} terrain
 * @param {number} range
 * @returns {Uint8Array}
 */

function buildExitRangeMask(terrain, range) {
  const blockedMask = new Uint8Array(2500);

  for (let y = 0; y < 50; y += 1) {
    for (let x = 0; x < 50; x += 1) {
      if (!isRoomExitTile(x, y, terrain)) {
        continue;
      }

      for (let dy = -range; dy <= range; dy += 1) {
        for (let dx = -range; dx <= range; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (!isInsideRoom(nx, ny)) {
            continue;
          }
          blockedMask[ny * 50 + nx] = 1;
        }
      }
    }
  }

  return blockedMask;
}

/**
 * @param {Uint8Array} passableMask
 * @param {Uint8Array} mincutBlockedMask
 * @returns {CostMatrix}
 */

function buildMincutCostMatrix(passableMask, mincutBlockedMask) {
  const costMatrix = new PathFinder.CostMatrix();

  for (let y = 0; y < 50; y += 1) {
    for (let x = 0; x < 50; x += 1) {
      const index = y * 50 + x;
      costMatrix.set(
        x,
        y,
        passableMask[index] && !mincutBlockedMask[index] ? 1 : 255
      );
    }
  }

  return costMatrix;
}

/**
 * Inline mincut implementation adapted from `utils.js` so the planner
 * remains self-contained.
 *
 * @param {string} roomName
 * @param {RoomPoint[]} sources
 * @param {CostMatrix} costMatrix
 * @returns {RoomPoint[] | number}
 */

function getTerrainCost(terrain, x, y) {
  const tile = terrain.get(x, y);
  if (tile & TERRAIN_MASK_WALL) return TERRAIN_BLOCKING_COST;
  if (tile & TERRAIN_MASK_SWAMP) return 5;
  return 1;
}

/**
 * @param {CorePlacement} placement
 * @returns {Uint8Array}
 */

function buildWalkableMaskForServicePlacement(input) {
  const walkableMask = buildPassableMask(input.terrain);
  walkableMask[input.controller_pos.y * 50 + input.controller_pos.x] = 0;
  walkableMask[input.mineral_pos.y * 50 + input.mineral_pos.x] = 0;
  walkableMask[input.source1_pos.y * 50 + input.source1_pos.x] = 0;
  if (input.source2_pos) {
    walkableMask[input.source2_pos.y * 50 + input.source2_pos.x] = 0;
  }
  return walkableMask;
}

/**
 * @param {SeedEvaluation} winner
 * @returns {Uint8Array}
 */

function buildExteriorMaskOutsideMincut(terrain, mincutMask) {
  const exteriorMask = new Uint8Array(2500);
  /** @type {number[]} */
  const queue = [];
  let head = 0;

  for (let x = 0; x < 50; x += 1) {
    enqueueExteriorTile(x, 0, terrain, mincutMask, exteriorMask, queue);
    enqueueExteriorTile(x, 49, terrain, mincutMask, exteriorMask, queue);
  }
  for (let y = 1; y < 49; y += 1) {
    enqueueExteriorTile(0, y, terrain, mincutMask, exteriorMask, queue);
    enqueueExteriorTile(49, y, terrain, mincutMask, exteriorMask, queue);
  }

  while (head < queue.length) {
    const current = queue[head];
    const x = current % 50;
    const y = (current - x) / 50;
    head += 1;

    for (let i = 0; i < EIGHT_NEIGHBOR_VECTORS.length; i += 1) {
      const vector = EIGHT_NEIGHBOR_VECTORS[i];
      enqueueExteriorTile(
        x + vector.x,
        y + vector.y,
        terrain,
        mincutMask,
        exteriorMask,
        queue
      );
    }
  }

  return exteriorMask;
}

/**
 * @param {number} x
 * @param {number} y
 * @param {Room.Terrain} terrain
 * @param {Uint8Array} mincutMask
 * @param {Uint8Array} exteriorMask
 * @param {number[]} queue
 */

function enqueueExteriorTile(x, y, terrain, mincutMask, exteriorMask, queue) {
  if (!isInsideRoom(x, y)) {
    return;
  }
  const index = y * 50 + x;
  if (
    exteriorMask[index] ||
    mincutMask[index] ||
    terrain.get(x, y) & TERRAIN_MASK_WALL
  ) {
    return;
  }

  exteriorMask[index] = 1;
  queue.push(index);
}

/**
 * @param {Uint8Array} roadMask
 * @param {Uint8Array} areaMask
 * @returns {Uint8Array}
 */

module.exports = {
  buildWallDistanceMap,
  buildBlockedMask,
  applyExitBufferMask,
  applyControllerBufferMask,
  expandDistance,
  buildPassableMask,
  isRoomExitTile,
  buildExitRangeMask,
  buildMincutCostMatrix,
  getTerrainCost,
  buildWalkableMaskForServicePlacement,
  buildExteriorMaskOutsideMincut,
  enqueueExteriorTile,
};
