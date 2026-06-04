const {
  countMask,
  cloneMask,
  masksEqual,
  pointsToMask,
  maskToPoints,
  getConnectedMaskGroups,
  countAddedMaskTiles,
  isInsideRoom,
  isWithinRangeOfMask,
} = require("../lib/mask");
const { buildPassableMask, buildExitRangeMask, buildMincutCostMatrix } = require("../lib/terrain");
const { runMincut } = require("./mincut");
const { isBetterSeed } = require("./seeds");
const { findAreaCandidates, areaFitsInterior, coreFitsBuildable, createCoreMask, coreMasksOverlap } = require("./coreAreas");
const {
  MINCUT_EXIT_BLOCK_RANGE,
  MINCUT_SOURCE_EXIT_RANGE,
  MINCUT_SOURCE_EXPAND_RANGE,
  MINCUT_MAX_TRIES,
  MIN_BUILDABLE_TILES,
  EIGHT_NEIGHBOR_VECTORS,
  LARGE_AREA_RADIUS,
  LARGE_CORE_RADIUS,
  SMALL_AREA_RADIUS,
  SMALL_CORE_RADIUS,
} = require("../constants");

function evaluateSeeds(input, seeds) {
  if (typeof input.roomName !== "string" || input.roomName.length === 0) {
    return [];
  }

  const passableMask = buildPassableMask(input.terrain);
  const mincutBlockedMask = buildExitRangeMask(
    input.terrain,
    MINCUT_EXIT_BLOCK_RANGE
  );
  const sourceBlockedMask = buildExitRangeMask(
    input.terrain,
    MINCUT_SOURCE_EXIT_RANGE
  );
  const costMatrix = buildMincutCostMatrix(passableMask, mincutBlockedMask);

  /** @type {SeedEvaluation[]} */
  const evaluations = [];

  for (let i = 0; i < seeds.length; i += 1) {
    const evaluation = evaluateSeed(
      input.roomName,
      input.terrain,
      seeds[i],
      passableMask,
      mincutBlockedMask,
      sourceBlockedMask,
      costMatrix
    );
    evaluations.push(evaluation);
  }

  return evaluations;
}

/**
 * Keep one evaluation per distinct mincut tile set (all raw seeds evaluated first).
 *
 * @param {SeedEvaluation[]} evaluations
 * @returns {SeedEvaluation[]}
 */
function dedupeEvaluationsByMincut(evaluations) {
  /** @type {SeedEvaluation[]} */
  const deduped = [];
  /** @type {Uint8Array[]} */
  const seenMincutMasks = [];

  for (let i = 0; i < evaluations.length; i += 1) {
    const evaluation = evaluations[i];
    const mincutMask = pointsToMask(evaluation.mincutTiles);

    let matchIndex = -1;
    for (let j = 0; j < seenMincutMasks.length; j += 1) {
      if (masksEqual(mincutMask, seenMincutMasks[j])) {
        matchIndex = j;
        break;
      }
    }

    if (matchIndex === -1) {
      seenMincutMasks.push(mincutMask);
      deduped.push(evaluation);
      continue;
    }

    if (isBetterDuplicateMincutEvaluation(evaluation, deduped[matchIndex])) {
      deduped[matchIndex] = evaluation;
    }
  }

  for (let i = 0; i < deduped.length; i += 1) {
    deduped[i].seed.id = i + 1;
  }

  return deduped;
}

/**
 * @param {SeedEvaluation} candidate
 * @param {SeedEvaluation} current
 * @returns {boolean}
 */
function isBetterDuplicateMincutEvaluation(candidate, current) {
  if (candidate.ok !== current.ok) {
    return candidate.ok;
  }
  if (candidate.buildableTiles.length !== current.buildableTiles.length) {
    return candidate.buildableTiles.length > current.buildableTiles.length;
  }
  if (candidate.interiorTiles.length !== current.interiorTiles.length) {
    return candidate.interiorTiles.length > current.interiorTiles.length;
  }
  return isBetterSeed(candidate.seed, current.seed);
}

/**
 * @param {string} roomName
 * @param {Room.Terrain} terrain
 * @param {Seed} seed
 * @param {Uint8Array} passableMask
 * @param {Uint8Array} mincutBlockedMask
 * @param {Uint8Array} sourceBlockedMask
 * @param {CostMatrix} costMatrix
 * @returns {SeedEvaluation}
 */

function evaluateSeed(
  roomName,
  terrain,
  seed,
  passableMask,
  mincutBlockedMask,
  sourceBlockedMask,
  costMatrix
) {
  const initialProtectedMask = expandSeedProtectedMask(
    seed.tiles,
    MINCUT_SOURCE_EXPAND_RANGE,
    passableMask,
    sourceBlockedMask
  );
  if (countMask(initialProtectedMask) === 0) {
    return {
      ok: false,
      seed,
      tries: 0,
      protectedTiles: [],
      mincutTiles: [],
      interiorTiles: [],
      buildableTiles: [],
      placements: null,
    };
  }

  let protectedMask = cloneMask(initialProtectedMask);
  /** @type {SeedEvaluation | null} */
  let bestFailed = null;

  for (let tries = 1; tries <= MINCUT_MAX_TRIES; tries += 1) {
    const protectedTiles = maskToPoints(protectedMask);
    const mincutTiles = runMincut(terrain, roomName, protectedTiles, costMatrix);
    if (!Array.isArray(mincutTiles) || mincutTiles.length === 0) {
      break;
    }

    const mincutMask = pointsToMask(mincutTiles);
    const interiorMask = floodFillInterior(
      protectedMask,
      passableMask,
      mincutMask,
      mincutBlockedMask
    );
    const buildableMask = buildInteriorBuildableMask(interiorMask, mincutMask);
    const placements = findCorePlacements(interiorMask, buildableMask);
    const buildableCount = countMask(buildableMask);
    const attemptEvaluation = {
      ok: false,
      seed,
      tries,
      protectedTiles,
      mincutTiles: maskToPoints(mincutMask),
      interiorTiles: maskToPoints(interiorMask),
      buildableTiles: maskToPoints(buildableMask),
      placements,
    };

    if (
      buildableCount > MIN_BUILDABLE_TILES &&
      placements &&
      isConnectedInteriorMask(interiorMask)
    ) {
      return {
        ...attemptEvaluation,
        ok: true,
      };
    }

    if (!bestFailed || isBetterFailedEvaluation(attemptEvaluation, bestFailed)) {
      bestFailed = attemptEvaluation;
    }

    const nextProtectedMask = selectNextProtectedMaskByLeastMincutIncrement(
      terrain,
      roomName,
      initialProtectedMask,
      protectedMask,
      passableMask,
      sourceBlockedMask,
      interiorMask,
      mincutMask,
      mincutTiles.length,
      costMatrix
    );

    if (!nextProtectedMask || masksEqual(nextProtectedMask, protectedMask)) {
      break;
    }

    protectedMask = nextProtectedMask;
  }

  if (bestFailed) {
    return bestFailed;
  }

  return {
    ok: false,
    seed,
    tries: 0,
    protectedTiles: maskToPoints(initialProtectedMask),
    mincutTiles: [],
    interiorTiles: [],
    buildableTiles: [],
    placements: null,
  };
}

/**
 * @param {SeedEvaluation} candidate
 * @param {SeedEvaluation} current
 * @returns {boolean}
 */

function isBetterFailedEvaluation(candidate, current) {
  if (candidate.mincutTiles.length !== current.mincutTiles.length) {
    return candidate.mincutTiles.length < current.mincutTiles.length;
  }

  if (candidate.buildableTiles.length !== current.buildableTiles.length) {
    return candidate.buildableTiles.length > current.buildableTiles.length;
  }

  return candidate.tries < current.tries;
}

/**
 * @param {Room.Terrain} terrain
 * @returns {Uint8Array}
 */

function expandSeedProtectedMask(
  seedTiles,
  range,
  passableMask,
  sourceBlockedMask
) {
  const protectedMask = new Uint8Array(2500);

  for (let i = 0; i < seedTiles.length; i += 1) {
    const tile = seedTiles[i];
    for (let dy = -range; dy <= range; dy += 1) {
      for (let dx = -range; dx <= range; dx += 1) {
        const x = tile.x + dx;
        const y = tile.y + dy;
        if (!isInsideRoom(x, y)) {
          continue;
        }

        const index = y * 50 + x;
        if (!passableMask[index] || sourceBlockedMask[index]) {
          continue;
        }

        protectedMask[index] = 1;
      }
    }
  }

  return protectedMask;
}

/**
 * @param {Uint8Array} protectedMask
 * @param {Uint8Array} passableMask
 * @param {Uint8Array} mincutMask
 * @param {Uint8Array} mincutBlockedMask
 * @returns {Uint8Array}
 */

function floodFillInterior(
  protectedMask,
  passableMask,
  mincutMask,
  mincutBlockedMask
) {
  const interiorMask = new Uint8Array(2500);
  /** @type {number[]} */
  const queue = [];
  let head = 0;

  for (let index = 0; index < 2500; index += 1) {
    if (
      !protectedMask[index] ||
      !passableMask[index] ||
      mincutMask[index] ||
      mincutBlockedMask[index]
    ) {
      continue;
    }

    interiorMask[index] = 1;
    queue.push(index);
  }

  while (head < queue.length) {
    const index = queue[head];
    const x = index % 50;
    const y = (index - x) / 50;
    head += 1;

    for (let i = 0; i < EIGHT_NEIGHBOR_VECTORS.length; i += 1) {
      const vector = EIGHT_NEIGHBOR_VECTORS[i];
      const nx = x + vector.x;
      const ny = y + vector.y;
      if (!isInsideRoom(nx, ny)) {
        continue;
      }

      const nextIndex = ny * 50 + nx;
      if (
        interiorMask[nextIndex] ||
        !passableMask[nextIndex] ||
        mincutMask[nextIndex] ||
        mincutBlockedMask[nextIndex]
      ) {
        continue;
      }

      interiorMask[nextIndex] = 1;
      queue.push(nextIndex);
    }
  }

  return interiorMask;
}

/**
 * @param {Uint8Array} interiorMask
 * @returns {boolean}
 */
function isConnectedInteriorMask(interiorMask) {
  if (countMask(interiorMask) === 0) {
    return false;
  }
  return getConnectedMaskGroups(interiorMask).length === 1;
}

/**
 * @param {SeedEvaluation} evaluation
 * @returns {boolean}
 */
function hasConnectedInterior(evaluation) {
  if (!evaluation.interiorTiles.length) {
    return false;
  }
  return isConnectedInteriorMask(pointsToMask(evaluation.interiorTiles));
}

/**
 * @param {Uint8Array} interiorMask
 * @param {Uint8Array} mincutMask
 * @returns {Uint8Array}
 */

function buildInteriorBuildableMask(interiorMask, mincutMask) {
  const buildableMask = new Uint8Array(2500);

  for (let y = 0; y < 50; y += 1) {
    for (let x = 0; x < 50; x += 1) {
      const index = y * 50 + x;
      if (!interiorMask[index] || isWithinRangeOfMask(x, y, mincutMask, 2)) {
        continue;
      }

      buildableMask[index] = 1;
    }
  }

  return buildableMask;
}

/**
 * @param {Uint8Array} interiorMask
 * @param {Uint8Array} buildableMask
 * @returns {{ large: RoomPoint, small: RoomPoint } | null}
 */

function findCorePlacements(interiorMask, buildableMask) {
  const largeCandidates = findAreaCandidates(
    interiorMask,
    buildableMask,
    LARGE_AREA_RADIUS,
    LARGE_CORE_RADIUS
  );
  const smallCandidates = findAreaCandidates(
    interiorMask,
    buildableMask,
    SMALL_AREA_RADIUS,
    SMALL_CORE_RADIUS
  );

  for (let i = 0; i < largeCandidates.length; i += 1) {
    const large = largeCandidates[i];
    const largeCoreMask = createCoreMask(
      large.center,
      LARGE_CORE_RADIUS,
      buildableMask
    );

    for (let j = 0; j < smallCandidates.length; j += 1) {
      const small = smallCandidates[j];
      const smallCoreMask = createCoreMask(
        small.center,
        SMALL_CORE_RADIUS,
        buildableMask
      );

      if (coreMasksOverlap(largeCoreMask, smallCoreMask)) {
        continue;
      }

      return {
        large: large.center,
        small: small.center,
      };
    }
  }

  return null;
}

/**
 * @param {Uint8Array} interiorMask
 * @param {Uint8Array} buildableMask
 * @param {number} areaRadius
 * @param {number} coreRadius
 * @returns {{ center: RoomPoint }[]}
 */

function selectNextProtectedMaskByLeastMincutIncrement(
  terrain,
  roomName,
  initialProtectedMask,
  protectedMask,
  passableMask,
  sourceBlockedMask,
  interiorMask,
  mincutMask,
  currentMincutCount,
  costMatrix
) {
  const borderGroups = getConnectedMaskGroups(mincutMask);
  if (borderGroups.length === 0) {
    return null;
  }

  /** @type {{ protectedMask: Uint8Array, nextMincutCount: number, increment: number, addedTiles: number } | null} */
  let bestCandidate = null;

  for (let groupIndex = 0; groupIndex < borderGroups.length; groupIndex += 1) {
    const borderGroup = borderGroups[groupIndex];
    const nextProtectedMask = buildExpandedProtectedMaskForBorderGroup(
      initialProtectedMask,
      protectedMask,
      passableMask,
      sourceBlockedMask,
      interiorMask,
      borderGroup
    );

    if (masksEqual(nextProtectedMask, protectedMask)) {
      continue;
    }

    const nextMincutTiles = runMincut(
      terrain,
      roomName,
      maskToPoints(nextProtectedMask),
      costMatrix
    );
    if (!Array.isArray(nextMincutTiles) || nextMincutTiles.length === 0) {
      continue;
    }

    const nextMincutCount = nextMincutTiles.length;
    const increment = nextMincutCount - currentMincutCount;
    const addedTiles = countAddedMaskTiles(protectedMask, nextProtectedMask);

    if (
      !bestCandidate ||
      increment < bestCandidate.increment ||
      (increment === bestCandidate.increment &&
        nextMincutCount < bestCandidate.nextMincutCount) ||
      (increment === bestCandidate.increment &&
        nextMincutCount === bestCandidate.nextMincutCount &&
        addedTiles > bestCandidate.addedTiles)
    ) {
      bestCandidate = {
        protectedMask: nextProtectedMask,
        nextMincutCount,
        increment,
        addedTiles,
      };
    }
  }

  return bestCandidate ? bestCandidate.protectedMask : null;
}

/**
 * @param {Uint8Array} initialProtectedMask
 * @param {Uint8Array} protectedMask
 * @param {Uint8Array} passableMask
 * @param {Uint8Array} sourceBlockedMask
 * @param {Uint8Array} interiorMask
 * @param {number[]} borderGroup
 * @returns {Uint8Array}
 */

function buildExpandedProtectedMaskForBorderGroup(
  initialProtectedMask,
  protectedMask,
  passableMask,
  sourceBlockedMask,
  interiorMask,
  borderGroup
) {
  const pathMask = buildBorderPathMask(
    initialProtectedMask,
    interiorMask,
    borderGroup
  );
  const nextProtectedMask = cloneMask(protectedMask);

  for (let index = 0; index < 2500; index += 1) {
    if (!pathMask[index] || !passableMask[index] || sourceBlockedMask[index]) {
      continue;
    }
    nextProtectedMask[index] = 1;
  }

  for (let i = 0; i < borderGroup.length; i += 1) {
    const index = borderGroup[i];
    if (passableMask[index] && !sourceBlockedMask[index]) {
      nextProtectedMask[index] = 1;
    }
  }

  return nextProtectedMask;
}

/**
 * @param {Uint8Array} baseMask
 * @param {Uint8Array} nextMask
 * @returns {number}
 */

function buildBorderPathMask(initialProtectedMask, interiorMask, borderGroup) {
  const distanceMap = new Int16Array(2500);
  const parentMap = new Int16Array(2500);
  distanceMap.fill(-1);
  parentMap.fill(-1);

  /** @type {number[]} */
  const queue = [];
  let head = 0;

  for (let index = 0; index < 2500; index += 1) {
    if (!initialProtectedMask[index] || !interiorMask[index]) {
      continue;
    }
    distanceMap[index] = 0;
    queue.push(index);
  }

  while (head < queue.length) {
    const index = queue[head];
    const x = index % 50;
    const y = (index - x) / 50;
    head += 1;

    for (let i = 0; i < EIGHT_NEIGHBOR_VECTORS.length; i += 1) {
      const vector = EIGHT_NEIGHBOR_VECTORS[i];
      const nx = x + vector.x;
      const ny = y + vector.y;
      if (!isInsideRoom(nx, ny)) {
        continue;
      }

      const nextIndex = ny * 50 + nx;
      if (distanceMap[nextIndex] !== -1 || !interiorMask[nextIndex]) {
        continue;
      }

      distanceMap[nextIndex] = distanceMap[index] + 1;
      parentMap[nextIndex] = index;
      queue.push(nextIndex);
    }
  }

  const pathMask = cloneMask(initialProtectedMask);

  for (let i = 0; i < borderGroup.length; i += 1) {
    const borderIndex = borderGroup[i];
    let bestAdjacent = -1;
    let bestDistance = 32767;
    const x = borderIndex % 50;
    const y = (borderIndex - x) / 50;

    for (let j = 0; j < EIGHT_NEIGHBOR_VECTORS.length; j += 1) {
      const vector = EIGHT_NEIGHBOR_VECTORS[j];
      const nx = x + vector.x;
      const ny = y + vector.y;
      if (!isInsideRoom(nx, ny)) {
        continue;
      }

      const adjacentIndex = ny * 50 + nx;
      const distance = distanceMap[adjacentIndex];
      if (!interiorMask[adjacentIndex] || distance === -1 || distance >= bestDistance) {
        continue;
      }

      bestDistance = distance;
      bestAdjacent = adjacentIndex;
    }

    while (bestAdjacent !== -1 && !pathMask[bestAdjacent]) {
      pathMask[bestAdjacent] = 1;
      bestAdjacent = parentMap[bestAdjacent];
    }
  }

  return pathMask;
}

/**
 * @param {Uint8Array} mask
 * @returns {number[][]}
 */

function pickBestSeedEvaluation(evaluations, input) {
  const successful = evaluations.filter(
    (evaluation) => evaluation.ok && hasConnectedInterior(evaluation)
  );
  if (!successful.length) {
    return null;
  }

  const leastMincut = getLeastMincutCount(successful);
  const controllerPreferred = pickControllerExposedPreferredEvaluation(
    successful,
    leastMincut,
    input
  );
  if (controllerPreferred) {
    return controllerPreferred;
  }

  return pickBestByMincutBuildableAndSeed(successful);
}

/**
 * @param {SeedEvaluation[]} evaluations
 * @returns {number}
 */
function getLeastMincutCount(evaluations) {
  let least = evaluations[0].mincutTiles.length;
  for (let i = 1; i < evaluations.length; i += 1) {
    const mincutCount = evaluations[i].mincutTiles.length;
    if (mincutCount < least) {
      least = mincutCount;
    }
  }
  return least;
}

/**
 * @param {SeedEvaluation[]} evaluations
 * @returns {SeedEvaluation}
 */
function pickBestByMincutBuildableAndSeed(evaluations) {
  let best = evaluations[0];
  for (let i = 1; i < evaluations.length; i += 1) {
    const candidate = evaluations[i];
    if (candidate.mincutTiles.length !== best.mincutTiles.length) {
      if (candidate.mincutTiles.length < best.mincutTiles.length) {
        best = candidate;
      }
      continue;
    }

    if (candidate.buildableTiles.length !== best.buildableTiles.length) {
      if (candidate.buildableTiles.length > best.buildableTiles.length) {
        best = candidate;
      }
      continue;
    }

    if (candidate.seed.id < best.seed.id) {
      best = candidate;
    }
  }

  return best;
}

/**
 * Prefer candidates where every walkable tile directly adjacent to the
 * controller is outside the interior (same tiles as rampart_controller in
 * step 2), as long as mincut is within +10 of the least mincut candidate.
 *
 * @param {SeedEvaluation[]} evaluations
 * @param {number} leastMincut
 * @param {PlannerInput | undefined} input
 * @returns {SeedEvaluation | null}
 */
function pickControllerExposedPreferredEvaluation(evaluations, leastMincut, input) {
  if (
    !input ||
    !input.controller_pos ||
    !input.terrain ||
    !Number.isFinite(input.controller_pos.x) ||
    !Number.isFinite(input.controller_pos.y)
  ) {
    return null;
  }

  if (
    getControllerAdjacentWalkableIndices(input.terrain, input.controller_pos)
      .length === 0
  ) {
    return null;
  }

  const eligible = [];
  const maxAcceptedMincut = leastMincut + 10;
  for (let i = 0; i < evaluations.length; i += 1) {
    const evaluation = evaluations[i];
    if (evaluation.mincutTiles.length > maxAcceptedMincut) {
      continue;
    }
    if (
      hasControllerAdjacentProtected(
        evaluation,
        input.terrain,
        input.controller_pos
      )
    ) {
      eligible.push(evaluation);
    }
  }

  if (eligible.length === 0) {
    return null;
  }

  return pickBestByMincutBuildableAndSeed(eligible);
}

/**
 * Chebyshev-1 non-wall tiles around the controller (matches placeControllerRamparts).
 *
 * @param {Room.Terrain} terrain
 * @param {RoomPoint} controllerPos
 * @returns {number[]}
 */
function getControllerAdjacentWalkableIndices(terrain, controllerPos) {
  const indices = [];

  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) {
        continue;
      }

      const x = controllerPos.x + dx;
      const y = controllerPos.y + dy;
      if (!isInsideRoom(x, y)) {
        continue;
      }
      if (terrain.get(x, y) & TERRAIN_MASK_WALL) {
        continue;
      }

      indices.push(y * 50 + x);
    }
  }

  return indices;
}

/**
 * True when every adjacent walkable tile is outside the interior (rampart-eligible).
 *
 * @param {SeedEvaluation} evaluation
 * @param {Room.Terrain} terrain
 * @param {RoomPoint} controllerPos
 * @returns {boolean}
 */
function hasControllerAdjacentProtected(evaluation, terrain, controllerPos) {
  const indices = getControllerAdjacentWalkableIndices(terrain, controllerPos);
  if (indices.length === 0) {
    return true;
  }

  const interiorMask = pointsToMask(evaluation.interiorTiles);
  for (let i = 0; i < indices.length; i += 1) {
    if (interiorMask[indices[i]]) {
      return false;
    }
  }
  return true;
}


module.exports = {
  evaluateSeeds,
  dedupeEvaluationsByMincut,
  evaluateSeed,
  isBetterFailedEvaluation,
  expandSeedProtectedMask,
  floodFillInterior,
  buildInteriorBuildableMask,
  findCorePlacements,
  selectNextProtectedMaskByLeastMincutIncrement,
  buildExpandedProtectedMaskForBorderGroup,
  buildBorderPathMask,
  pickBestSeedEvaluation,
  isConnectedInteriorMask,
  hasConnectedInterior,
  hasControllerAdjacentProtected,
};
