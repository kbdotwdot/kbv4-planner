const { pointsToMask, packMincutPosToVertex, isInsideRoom, cloneMask } = require("../lib/mask");
const {
  chebyshevDistance,
  linearDistance,
  sortPointsByChebyshevDistance,
  filterArray,
} = require("../lib/geo");
const { findRoadPath, appendRoadPath, markRoadPathBlocked } = require("./roads");
const {
  findInaccessibleLabIndex,
  findLabAccessPath,
  findBlockingLabIndexInPath,
} = require("./placementAccess");
const { addPlacedStructure, addRangeToBlockedSet } = require("./persist");
const { buildRoutingNonBuildableMask } = require("./routingMask");
const {
  STEP2_LAB_COUNT,
  ACCESS_REPAIR_MAX_TRIES,
} = require("../constants");

function planStep2Labs(
  input,
  winner,
  walkableMask,
  placementBlockedMask,
  structureBlockedMask,
  roadMask,
  storagePoint,
  structures,
  roads,
  blockedTileSet
) {
  const candidates = buildLabCandidates(
    winner,
    walkableMask,
    placementBlockedMask,
    structureBlockedMask,
    roadMask
  );
  if (candidates.length < STEP2_LAB_COUNT) {
    return false;
  }
  const nonBuildableMask = buildRoutingNonBuildableMask(winner);

  const labAnchors = getOrderedLabAnchors(candidates, storagePoint, winner.mincutTiles);
  for (let i = 0; i < labAnchors.length; i += 1) {
    const labAnchor = labAnchors[i];
    const initialLabs = pickInitialLabCluster(candidates, labAnchor);
    if (initialLabs.length < STEP2_LAB_COUNT) {
      continue;
    }
    const labs = initialLabs.slice();
    if (labs.length < STEP2_LAB_COUNT) {
      continue;
    }

    const labMask = pointsToMask(labs);
    const attemptRoadMask = cloneMask(roadMask);
    /** @type {RoomPoint[]} */
    let attemptRoads = [];
    let attemptBlockedTileSet = new Set(blockedTileSet);
    repairInaccessibleLabs(
      input,
      labs,
      candidates,
      labAnchor,
      storagePoint,
      placementBlockedMask,
      attemptRoadMask,
      labMask,
      nonBuildableMask,
      attemptRoads,
      attemptBlockedTileSet
    );

    const orderedLabs = orderReactionLabs(labs);
    if (!orderedLabs) {
      continue;
    }

    appendRoadPath(roads, roadMask, attemptRoads);
    for (const packed of attemptBlockedTileSet) {
      blockedTileSet.add(packed);
    }

    for (let j = 0; j < orderedLabs.length; j += 1) {
      const lab = orderedLabs[j];
      addPlacedStructure(
        structures,
        structureBlockedMask,
        `n${j + 1}`,
        "lab",
        j + 1,
        lab
      );
      placementBlockedMask[lab.y * 50 + lab.x] = 1;
    }

    return true;
  }

  return false;
}

/**
 * @param {SeedEvaluation} winner
 * @param {Uint8Array} walkableMask
 * @param {Uint8Array} placementBlockedMask
 * @param {Uint8Array} structureBlockedMask
 * @param {Uint8Array} roadMask
 * @returns {RoomPoint[]}
 */

function buildLabCandidates(
  winner,
  walkableMask,
  placementBlockedMask,
  structureBlockedMask,
  roadMask
) {
  const candidates = [];
  for (let i = 0; i < winner.buildableTiles.length; i += 1) {
    const point = winner.buildableTiles[i];
    const index = point.y * 50 + point.x;
    if (
      walkableMask[index] &&
      !placementBlockedMask[index] &&
      !structureBlockedMask[index] &&
      !roadMask[index]
    ) {
      candidates.push(point);
    }
  }
  return candidates;
}

/**
 * @param {RoomPoint[]} candidates
 * @param {RoomPoint} storagePoint
 * @returns {RoomPoint[]}
 */

function getOrderedLabAnchors(candidates, storagePoint, mincutTiles) {
  const anchors = candidates.slice();
  anchors.sort((left, right) => {
    const leftStorageDistance = chebyshevDistance(left, storagePoint);
    const rightStorageDistance = chebyshevDistance(right, storagePoint);
    if (leftStorageDistance !== rightStorageDistance) {
      return leftStorageDistance - rightStorageDistance;
    }

    const leftMincutDistance = getMinMincutDistance(left, mincutTiles);
    const rightMincutDistance = getMinMincutDistance(right, mincutTiles);
    if (leftMincutDistance !== rightMincutDistance) {
      return rightMincutDistance - leftMincutDistance;
    }

    return packMincutPosToVertex(left.x, left.y) - packMincutPosToVertex(right.x, right.y);
  });
  return anchors;
}

/**
 * @param {RoomPoint[]} candidates
 * @param {RoomPoint} firstLab
 * @returns {RoomPoint[]}
 */

function pickInitialLabCluster(candidates, firstLab) {
  const reactionCapableCluster = pickReactionCapableLabCluster(firstLab, candidates);
  if (reactionCapableCluster) {
    return reactionCapableCluster;
  }

  const remaining = filterArray(candidates, (point) => {
    return point.x !== firstLab.x || point.y !== firstLab.y;
  });
  const labs = [firstLab];
  sortPointsByChebyshevDistance(remaining, firstLab);
  while (labs.length < STEP2_LAB_COUNT && remaining.length > 0) {
    labs.push(/** @type {RoomPoint} */ (remaining.shift()));
  }
  return labs;
}

/**
 * @param {RoomPoint} point
 * @param {RoomPoint[]} mincutTiles
 * @returns {number}
 */

function getMinMincutDistance(point, mincutTiles) {
  let bestDistance = Infinity;
  for (let i = 0; i < mincutTiles.length; i += 1) {
    const distance = chebyshevDistance(point, mincutTiles[i]);
    if (distance < bestDistance) {
      bestDistance = distance;
    }
  }
  return bestDistance;
}

/**
 * @param {RoomPoint} firstLab
 * @param {RoomPoint[]} candidates
 * @returns {RoomPoint[] | null}
 */

function pickReactionCapableLabCluster(firstLab, candidates) {
  const orderedCandidates = candidates.slice();
  sortPointsByChebyshevDistance(orderedCandidates, firstLab);

  /** @type {RoomPoint[] | null} */
  let bestCluster = null;
  let bestMaxDistance = Infinity;
  let bestDistanceSum = Infinity;
  const pairCandidateLimit = Math.min(orderedCandidates.length, 80);

  for (let i = 0; i < pairCandidateLimit; i += 1) {
    const inputLabA = orderedCandidates[i];
    for (let j = i + 1; j < pairCandidateLimit; j += 1) {
      const inputLabB = orderedCandidates[j];
      if (!isLabUsableInReactionCluster(firstLab, inputLabA, inputLabB)) {
        continue;
      }

      const cluster = [];
      for (let k = 0; k < orderedCandidates.length; k += 1) {
        const candidate = orderedCandidates[k];
        if (!isLabUsableInReactionCluster(candidate, inputLabA, inputLabB)) {
          continue;
        }
        cluster.push(candidate);
        if (cluster.length === STEP2_LAB_COUNT) {
          break;
        }
      }
      if (cluster.length < STEP2_LAB_COUNT) {
        continue;
      }

      const firstLabIndex = cluster.findIndex((point) => {
        return point.x === firstLab.x && point.y === firstLab.y;
      });
      if (firstLabIndex > 0) {
        cluster.splice(firstLabIndex, 1);
        cluster.unshift(firstLab);
      }

      const maxDistance = chebyshevDistance(
        cluster[cluster.length - 1],
        firstLab
      );
      const distanceSum = getLabClusterDistanceSum(cluster, firstLab);
      if (
        maxDistance < bestMaxDistance ||
        (maxDistance === bestMaxDistance && distanceSum < bestDistanceSum)
      ) {
        bestCluster = cluster;
        bestMaxDistance = maxDistance;
        bestDistanceSum = distanceSum;
      }
    }
  }

  return bestCluster;
}

/**
 * @param {RoomPoint} lab
 * @param {RoomPoint} inputLabA
 * @param {RoomPoint} inputLabB
 * @returns {boolean}
 */

function isLabUsableInReactionCluster(lab, inputLabA, inputLabB) {
  if (
    (lab.x === inputLabA.x && lab.y === inputLabA.y) ||
    (lab.x === inputLabB.x && lab.y === inputLabB.y)
  ) {
    return true;
  }
  return (
    chebyshevDistance(lab, inputLabA) <= 2 &&
    chebyshevDistance(lab, inputLabB) <= 2
  );
}

/**
 * @param {RoomPoint[]} cluster
 * @param {RoomPoint} firstLab
 * @returns {number}
 */

function getLabClusterDistanceSum(cluster, firstLab) {
  let sum = 0;
  for (let i = 0; i < cluster.length; i += 1) {
    sum += chebyshevDistance(cluster[i], firstLab);
  }
  return sum;
}

/**
 * @param {PlannerInput & { type: number }} input
 * @param {RoomPoint[]} labs
 * @param {RoomPoint[]} candidates
 * @param {RoomPoint} labAnchor
 * @param {RoomPoint} storagePoint
 * @param {Uint8Array} placementBlockedMask
 * @param {Uint8Array} roadMask
 * @param {Uint8Array} labMask
 * @param {Uint8Array} nonBuildableMask
 * @param {RoomPoint[]} roads
 * @param {Set<number>} blockedTileSet
 * @returns {boolean}
 */

function repairInaccessibleLabs(
  input,
  labs,
  candidates,
  labAnchor,
  storagePoint,
  placementBlockedMask,
  roadMask,
  labMask,
  nonBuildableMask,
  roads,
  blockedTileSet
) {
  for (let guard = 0; guard < ACCESS_REPAIR_MAX_TRIES; guard += 1) {
    const inaccessibleLabIndex = findInaccessibleLabIndex(
      labs,
      storagePoint,
      input,
      placementBlockedMask,
      roadMask,
      labMask,
      nonBuildableMask
    );
    if (inaccessibleLabIndex === -1) {
      return true;
    }

    const path = findLabAccessPath(
      storagePoint,
      labs[inaccessibleLabIndex],
      input,
      placementBlockedMask,
      roadMask,
      labMask,
      nonBuildableMask
    );
    const blockingLabIndex = findBlockingLabIndexInPath(path, labs);
    if (blockingLabIndex === -1) {
      return false;
    }

    const blockingLab = labs[blockingLabIndex];
    const blockingIndex = blockingLab.y * 50 + blockingLab.x;
    labMask[blockingIndex] = 0;
    roadMask[blockingIndex] = 1;
    roads.push({ x: blockingLab.x, y: blockingLab.y });
    blockedTileSet.add(packMincutPosToVertex(blockingLab.x, blockingLab.y));

    const replacement = selectReplacementLabTile(
      candidates,
      labAnchor,
      placementBlockedMask,
      roadMask,
      labMask
    );
    if (!replacement) {
      return false;
    }

    labs[blockingLabIndex] = replacement;
    labMask[replacement.y * 50 + replacement.x] = 1;
  }

  return false;
}

/**
 * @param {RoomPoint[]} labs
 * @param {RoomPoint} storagePoint
 * @param {PlannerInput & { type: number }} input
 * @param {Uint8Array} placementBlockedMask
 * @param {Uint8Array} roadMask
 * @param {Uint8Array} labMask
 * @param {Uint8Array} nonBuildableMask
 * @returns {number}
 */

function selectReplacementLabTile(
  candidates,
  labAnchor,
  placementBlockedMask,
  roadMask,
  labMask
) {
  /** @type {RoomPoint | null} */
  let best = null;
  let bestDistance = Infinity;
  let bestPacked = Infinity;
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    const index = candidate.y * 50 + candidate.x;
    if (placementBlockedMask[index] || roadMask[index] || labMask[index]) {
      continue;
    }
    const distance = chebyshevDistance(candidate, labAnchor);
    const packed = packMincutPosToVertex(candidate.x, candidate.y);
    if (
      distance < bestDistance ||
      (distance === bestDistance && packed < bestPacked)
    ) {
      best = candidate;
      bestDistance = distance;
      bestPacked = packed;
    }
  }
  return best;
}

/**
 * @param {RoomPoint[]} labs
 * @returns {RoomPoint[] | null}
 */

function orderReactionLabs(labs) {
  for (let i = 0; i < labs.length; i += 1) {
    for (let j = i + 1; j < labs.length; j += 1) {
      if (!areAllLabsInReactionRange(labs, labs[i], labs[j])) {
        continue;
      }
      const ordered = [labs[i], labs[j]];
      for (let k = 0; k < labs.length; k += 1) {
        if (k !== i && k !== j) {
          ordered.push(labs[k]);
        }
      }
      return ordered;
    }
  }
  return null;
}

/**
 * @param {RoomPoint[]} labs
 * @param {RoomPoint} inputLabA
 * @param {RoomPoint} inputLabB
 * @returns {boolean}
 */

function areAllLabsInReactionRange(labs, inputLabA, inputLabB) {
  for (let i = 0; i < labs.length; i += 1) {
    const lab = labs[i];
    if (!isLabUsableInReactionCluster(lab, inputLabA, inputLabB)) {
      return false;
    }
  }
  return true;
}

/**
 * @param {PlannerInput & { type: number }} input
 * @param {SeedEvaluation} winner
 * @param {Uint8Array} walkableMask
 * @param {Uint8Array} placementBlockedMask
 * @param {Uint8Array} structureBlockedMask
 * @param {Uint8Array} roadMask
 * @param {RoomPoint} storagePoint
 * @param {{ token: string, type: string, index: number, point: RoomPoint }[]} structures
 * @param {RoomPoint[]} roads
 * @param {Set<number>} blockedTileSet
 * @returns {boolean}
 */

module.exports = {
  planStep2Labs,
  buildLabCandidates,
  getOrderedLabAnchors,
  pickInitialLabCluster,
  getMinMincutDistance,
  pickReactionCapableLabCluster,
  isLabUsableInReactionCluster,
  getLabClusterDistanceSum,
  repairInaccessibleLabs,
  selectReplacementLabTile,
  orderReactionLabs,
  areAllLabsInReactionRange,
};
