const { packMincutPosToVertex, unpackMincutVertexToPos, isInsideRoom } = require("../lib/mask");
const { EIGHT_NEIGHBOR_VECTORS, MINCUT_OUT_NODE, MINCUT_MAX_NODE, MINCUT_NODE_MASK, MINCUT_INSIDE_EDGE, MINCUT_DIR_SHIFT, MINCUT_INF_CAPACITY, MINCUT_MAX_FLOW_ITERATIONS, MINCUT_POS_MASK } = require("../constants");

function runMincut(terrain, roomName, sources, costMatrix) {
  if (!terrain || typeof terrain.get !== "function") {
    throw new Error("runMincut requires a Room.Terrain instance");
  }

  let workingCostMatrix = costMatrix;

  if (workingCostMatrix === undefined) {
    workingCostMatrix = new PathFinder.CostMatrix();
    for (let x = 0; x < 50; x += 1) {
      for (let y = 0; y < 50; y += 1) {
        workingCostMatrix.set(
          x,
          y,
          terrain.get(x, y) === TERRAIN_MASK_WALL ? 255 : 1
        );
      }
    }
  }

  /** @type {RoomPoint[]} */
  const exitCoords = [];

  for (let x = 1; x < 49; x += 1) {
    for (let i = 0; i < 2; i += 1) {
      const y = i === 0 ? 0 : 49;
      if (terrain.get(x, y) !== TERRAIN_MASK_WALL) {
        exitCoords.push({ x, y });
      }
    }
  }

  for (let y = 1; y < 49; y += 1) {
    for (let i = 0; i < 2; i += 1) {
      const x = i === 0 ? 0 : 49;
      if (terrain.get(x, y) !== TERRAIN_MASK_WALL) {
        exitCoords.push({ x, y });
      }
    }
  }

  const exit = new Uint8Array(MINCUT_MAX_NODE);

  for (let i = 0; i < exitCoords.length; i += 1) {
    const exitCoord = exitCoords[i];
    const minX = Math.max(0, exitCoord.x - 2);
    const maxX = Math.min(49, exitCoord.x + 2);
    const minY = Math.max(0, exitCoord.y - 2);
    const maxY = Math.min(49, exitCoord.y + 2);

    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        if (workingCostMatrix.get(x, y) === 255) {
          continue;
        }
        exit[packMincutPosToVertex(x, y) | MINCUT_OUT_NODE] = 1;
      }
    }
  }

  const sourceVertices = new Set();

  for (let i = 0; i < sources.length; i += 1) {
    const coord = sources[i];
    const vertex = packMincutPosToVertex(coord.x, coord.y);

    if (exit[vertex]) {
      return ERR_NOT_FOUND;
    }

    if (workingCostMatrix.get(coord.x, coord.y) === 255) {
      continue;
    }

    sourceVertices.add(vertex);
  }

  const capacityMap = new Int32Array(1 << 17);
  capacityMap.fill(0);

  for (let y = 0; y < 50; y += 1) {
    for (let x = 0; x < 50; x += 1) {
      if (workingCostMatrix.get(x, y) === 255) {
        continue;
      }

      const vertex = packMincutPosToVertex(x, y);
      // Protected/source tiles must not be cut themselves, otherwise each
      // iteration can return the same border again instead of pushing outward.
      capacityMap[vertex | MINCUT_INSIDE_EDGE] = sourceVertices.has(vertex)
        ? MINCUT_INF_CAPACITY
        : workingCostMatrix.get(x, y);

      for (let direction = 0; direction < EIGHT_NEIGHBOR_VECTORS.length; direction += 1) {
        const nextPoint = addMincutPoint({ x, y }, EIGHT_NEIGHBOR_VECTORS[direction]);
        if (!isInsideRoom(nextPoint.x, nextPoint.y)) {
          continue;
        }

        if (workingCostMatrix.get(nextPoint.x, nextPoint.y) === 255) {
          continue;
        }

        capacityMap[vertex | MINCUT_OUT_NODE | (direction << MINCUT_DIR_SHIFT)] =
          MINCUT_INF_CAPACITY;
      }
    }
  }

  let levels = [];
  for (let iteration = 0; iteration < MINCUT_MAX_FLOW_ITERATIONS; iteration += 1) {
    const result = getMincutLevels(sourceVertices, exit, capacityMap, roomName);
    levels = result.levels;

    if (result.cuts.length) {
      return getMaxInteriorMincutCuts(
        sourceVertices,
        exit,
        capacityMap,
        roomName
      );
    }

    pushMincutBlockingFlow(sourceVertices, exit, capacityMap, levels);
  }

  return ERR_NOT_FOUND;
}

/**
 * @param {Set<number>} sourceVertices
 * @param {Uint8Array} exit
 * @param {Int32Array} capacityMap
 * @param {number[]} levels
 */

function pushMincutBlockingFlow(sourceVertices, exit, capacityMap, levels) {
  const checkIndex = new Uint8Array(MINCUT_MAX_NODE);
  checkIndex.fill(0);

  for (const sourceVertex of sourceVertices) {
    while (true) {
      const maxFlow = getMincutDfs(
        sourceVertex,
        exit,
        capacityMap,
        levels,
        MINCUT_INF_CAPACITY,
        checkIndex
      );
      if (maxFlow === 0) {
        break;
      }
    }
  }
}

/**
 * @param {number} nodeNow
 * @param {Uint8Array} exit
 * @param {Int32Array} capacityMap
 * @param {number[]} levels
 * @param {number} maxFlow
 * @param {Uint8Array} checkIndex
 * @returns {number}
 */

function getMincutDfs(nodeNow, exit, capacityMap, levels, maxFlow, checkIndex) {
  if (exit[nodeNow]) {
    return maxFlow;
  }

  const adjacentEdges = getMincutEdgesFrom(nodeNow);
  while (checkIndex[nodeNow] < adjacentEdges.length) {
    const edge = adjacentEdges[checkIndex[nodeNow]];
    const nextNode = getMincutEdgeEndNode(edge);

    if (capacityMap[edge] > 0 && levels[nextNode] - levels[nodeNow] === 1) {
      const newMaxFlow = getMincutDfs(
        nextNode,
        exit,
        capacityMap,
        levels,
        Math.min(maxFlow, capacityMap[edge]),
        checkIndex
      );

      if (newMaxFlow > 0) {
        capacityMap[edge] -= newMaxFlow;
        capacityMap[getMincutReverseEdge(edge)] += newMaxFlow;
        return newMaxFlow;
      }
    }

    checkIndex[nodeNow] += 1;
  }

  return 0;
}

/**
 * @param {Set<number>} sourceVertices
 * @param {Uint8Array} exit
 * @param {Int32Array} capacityMap
 * @param {string} roomName
 * @returns {{ levels: Int16Array, cuts: RoomPoint[] }}
 */

function getMincutLevels(sourceVertices, exit, capacityMap, roomName) {
  let connected = false;
  /** @type {RoomPoint[]} */
  const cuts = [];
  /** @type {number[]} */
  const queue = [];
  const levels = new Int16Array(MINCUT_MAX_NODE);
  levels.fill(-1);

  for (const sourceVertex of sourceVertices) {
    levels[sourceVertex] = 0;
    queue.push(sourceVertex);
  }

  while (queue.length > 0) {
    const nodeNow = /** @type {number} */ (queue.shift());

    const edges = getMincutEdgesFrom(nodeNow);
    for (let i = 0; i < edges.length; i += 1) {
      const edge = edges[i];
      const nextNode = getMincutEdgeEndNode(edge);
      if (capacityMap[edge] > 0 && levels[nextNode] === -1) {
        levels[nextNode] = levels[nodeNow] + 1;
        queue.push(nextNode);

        if (exit[nextNode]) {
          connected = true;
        }
      }
    }
  }

  if (!connected) {
    for (let y = 0; y < 50; y += 1) {
      for (let x = 0; x < 50; x += 1) {
        const node = packMincutPosToVertex(x, y);
        if (levels[node] !== -1 && levels[node | MINCUT_OUT_NODE] === -1) {
          cuts.push(new RoomPosition(x, y, roomName));
        }
      }
    }
  }

  return { levels, cuts };
}

/**
 * Prefer the max-interior source side among equal-size mincuts by rebuilding
 * the partition from the residual graph after max flow converges.
 *
 * @param {Set<number>} sourceVertices
 * @param {Uint8Array} exit
 * @param {Int32Array} capacityMap
 * @param {string} roomName
 * @returns {RoomPoint[]}
 */

function getMaxInteriorMincutCuts(sourceVertices, exit, capacityMap, roomName) {
  const canReachExit = new Uint8Array(MINCUT_MAX_NODE);
  /** @type {number[]} */
  const queue = [];

  for (let node = 0; node < MINCUT_MAX_NODE; node += 1) {
    if (!exit[node]) {
      continue;
    }

    canReachExit[node] = 1;
    queue.push(node);
  }

  let head = 0;
  while (head < queue.length) {
    const node = queue[head];
    head += 1;

    const edges = getMincutEdgesFrom(node);
    for (let i = 0; i < edges.length; i += 1) {
      const edge = edges[i];
      const previousNode = getMincutEdgeEndNode(edge);
      const incomingEdge = getMincutReverseEdge(edge);

      if (capacityMap[incomingEdge] <= 0 || canReachExit[previousNode]) {
        continue;
      }

      canReachExit[previousNode] = 1;
      queue.push(previousNode);
    }
  }

  const sourceSide = new Uint8Array(MINCUT_MAX_NODE);
  for (let node = 0; node < MINCUT_MAX_NODE; node += 1) {
    if (!canReachExit[node]) {
      sourceSide[node] = 1;
    }
  }

  for (const sourceVertex of sourceVertices) {
    sourceSide[sourceVertex] = 1;
  }

  /** @type {RoomPoint[]} */
  const cuts = [];
  for (let y = 0; y < 50; y += 1) {
    for (let x = 0; x < 50; x += 1) {
      const node = packMincutPosToVertex(x, y);
      if (sourceSide[node] && !sourceSide[node | MINCUT_OUT_NODE]) {
        cuts.push(new RoomPosition(x, y, roomName));
      }
    }
  }

  return cuts;
}

/**
 * @param {number} node
 * @returns {number[]}
 */

function getMincutEdgesFrom(node) {
  /** @type {number[]} */
  const result = [];
  for (let i = 0; i <= 8; i += 1) {
    result.push(node | (i << MINCUT_DIR_SHIFT));
  }
  return result;
}

/**
 * @param {number} edge
 * @returns {number}
 */

function getMincutEdgeEndNode(edge) {
  if (edge & MINCUT_INSIDE_EDGE) {
    return (edge ^ MINCUT_OUT_NODE) & MINCUT_NODE_MASK;
  }

  const fromVertex = edge & MINCUT_POS_MASK;
  const pos = unpackMincutVertexToPos(fromVertex);
  const direction = edge >> MINCUT_DIR_SHIFT;
  const newPoint = addMincutPoint(pos, EIGHT_NEIGHBOR_VECTORS[direction]);

  return (
    packMincutPosToVertex(newPoint.x, newPoint.y) |
    ((edge & MINCUT_OUT_NODE) ^ MINCUT_OUT_NODE)
  );
}

/**
 * @param {number} edge
 * @returns {number}
 */

function getMincutReverseEdge(edge) {
  if (edge & MINCUT_INSIDE_EDGE) {
    return edge ^ MINCUT_OUT_NODE;
  }

  const direction = ((edge >> MINCUT_DIR_SHIFT) + 4) % 8;
  return getMincutEdgeEndNode(edge) | (direction << MINCUT_DIR_SHIFT);
}

/**
 * @param {number} x
 * @param {number} y
 * @returns {number}
 */

function addMincutPoint(pos, vector) {
  return { x: pos.x + vector.x, y: pos.y + vector.y };
}

/**
 * @param {RoomPoint[]} seedTiles
 * @param {number} range
 * @param {Uint8Array} passableMask
 * @param {Uint8Array} sourceBlockedMask
 * @returns {Uint8Array}
 */

module.exports = {
  runMincut,
  pushMincutBlockingFlow,
  getMincutDfs,
  getMincutLevels,
  getMaxInteriorMincutCuts,
  getMincutEdgesFrom,
  getMincutEdgeEndNode,
  getMincutReverseEdge,
  addMincutPoint,
};
