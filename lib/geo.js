function rotateOffset(x, y, rotation) {
  const normalized = ((rotation % 4) + 4) % 4;
  if (normalized === 0) return { x, y };
  if (normalized === 1) return { x: -y, y: x };
  if (normalized === 2) return { x: -x, y: -y };
  return { x: y, y: -x };
}

/**
 * @param {string} token
 * @returns {{ type: string, index: number } | null}
 */

function sortPointsByChebyshevDistance(points, target) {
  points.sort((left, right) => {
    return chebyshevDistance(left, target) - chebyshevDistance(right, target);
  });
}

/**
 * @param {PlacedToken[]} pattern
 * @param {RoomPoint[]} candidateCenters
 * @param {Uint8Array} buildableMask
 * @param {Room.Terrain} terrain
 * @param {Uint8Array} occupiedNonRoadMask
 * @param {Uint8Array} occupiedAllMask
 * @returns {RoomPoint | null}
 */

function linearDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * @param {RoomPoint} a
 * @param {RoomPoint} b
 * @returns {number}
 */

function chebyshevDistance(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/**
 * @param {PlannerInput & { type: number }} input
 * @param {SeedEvaluation | null} winner
 * @param {RoomPlanCompact | null} compact
 * @param {{ hub: CorePlacement, fastfiller: CorePlacement } | null} corePlan
 * @returns {Step2ServicePlan | null}
 */

function indexToPoint(index) {
  const x = index % 50;
  return { x, y: (index - x) / 50 };
}

/**
 * @template T
 * @param {T[]} array
 * @param {(item: T, index: number, source: T[]) => boolean} predicate
 * @returns {T | undefined}
 */
function findInArray(array, predicate) {
  for (let i = 0; i < array.length; i += 1) {
    if (predicate(array[i], i, array)) {
      return array[i];
    }
  }
  return undefined;
}

/**
 * @template T
 * @param {T[]} array
 * @param {(item: T, index: number, source: T[]) => boolean} predicate
 * @returns {T[]}
 */
function filterArray(array, predicate) {
  /** @type {T[]} */
  const result = [];
  for (let i = 0; i < array.length; i += 1) {
    if (predicate(array[i], i, array)) {
      result.push(array[i]);
    }
  }
  return result;
}

/**
 * PathFinder may return cardinal corner pairs with the same terrain cost as a
 * diagonal step. Collapse those corners so new roads favor diagonal progress,
 * while preserving already-planned road tiles for reuse.
 *
 * @param {RoomPoint} start
 * @param {RoomPoint[]} path
 * @param {PlannerInput & { type: number }} input
 * @param {Uint8Array} blockedMask
 * @param {Uint8Array} roadMask
 * @returns {RoomPoint[]}
 */

module.exports = {
  rotateOffset,
  sortPointsByChebyshevDistance,
  linearDistance,
  chebyshevDistance,
  indexToPoint,
  findInArray,
  filterArray,
};
