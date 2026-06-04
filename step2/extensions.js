const { pointsToMask, cloneMask, packMincutPosToVertex } = require("../lib/mask");
const { findRoadPath, appendRoadPath, markRoadPathBlocked, estimatePathCost } = require("./roads");
const {
  findInaccessibleLabIndex,
  findLabAccessPath,
  findBlockingLabIndexInPath,
} = require("./placementAccess");
const { addPlacedStructure, addRangeToBlockedSet } = require("./persist");
const { buildRoutingNonBuildableMask } = require("./routingMask");
const {
  STEP2_EXTENSION_START_INDEX,
  STEP2_EXTENSION_COUNT,
  ACCESS_REPAIR_ROAD_COST,
  ACCESS_REPAIR_EXTENSION_COST,
  ACCESS_REPAIR_TERRAIN_COST,
} = require("../constants");

const STORAGE_TRANSFER_RANGE = 1;

function planStep2Extensions(
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
  const remainingExtensionCount =
    STEP2_EXTENSION_COUNT - STEP2_EXTENSION_START_INDEX + 1;
  const nonBuildableMask = buildRoutingNonBuildableMask(winner);
  const candidates = buildExtensionCandidates(
    input,
    winner,
    walkableMask,
    placementBlockedMask,
    structureBlockedMask,
    roadMask,
    storagePoint,
    nonBuildableMask
  );
  if (candidates.length < remainingExtensionCount) {
    return false;
  }

  const extensions = candidates.slice(0, remainingExtensionCount);
  const initialExtensions = extensions.slice();
  const extensionMask = pointsToMask(extensions);
  const attemptRoadMask = cloneMask(roadMask);
  /** @type {RoomPoint[]} */
  let attemptRoads = [];
  let attemptBlockedTileSet = new Set(blockedTileSet);
  if (
    !repairInaccessibleExtensions(
      input,
      extensions,
      candidates,
      storagePoint,
      placementBlockedMask,
      attemptRoadMask,
      extensionMask,
      nonBuildableMask,
      attemptRoads,
      attemptBlockedTileSet
    )
  ) {
    // Keep extension placement even when early accessibility repair cannot resolve;
    // final post-processing will attempt to route roads.
    for (let i = 0; i < initialExtensions.length; i += 1) {
      extensions[i] = initialExtensions[i];
    }
    attemptRoads = [];
    attemptBlockedTileSet = new Set(blockedTileSet);
  }

  appendRoadPath(roads, roadMask, attemptRoads);
  for (const packed of attemptBlockedTileSet) {
    blockedTileSet.add(packed);
  }

  sortPointsByTransferDistanceToStorage(
    extensions,
    storagePoint,
    input,
    placementBlockedMask,
    roadMask,
    nonBuildableMask
  );

  for (let i = 0; i < extensions.length; i += 1) {
    const extensionIndex = STEP2_EXTENSION_START_INDEX + i;
    const extension = extensions[i];
    addPlacedStructure(
      structures,
      structureBlockedMask,
      `e${extensionIndex}`,
      "extension",
      extensionIndex,
      extension
    );
    placementBlockedMask[extension.y * 50 + extension.x] = 1;
  }

  return true;
}

/**
 * PathFinder transfer cost (plain 4 / swamp 5, roads via matrix) from tile to storage.
 *
 * @param {RoomPoint} point
 * @param {RoomPoint} storagePoint
 * @param {PlannerInput & { type: number }} input
 * @param {Uint8Array} blockedMask
 * @param {Uint8Array} roadMask
 * @param {Uint8Array} nonBuildableMask
 * @returns {number}
 */

function extensionTransferPathCost(
  point,
  storagePoint,
  input,
  blockedMask,
  roadMask,
  nonBuildableMask
) {
  return estimatePathCost(
    point,
    storagePoint,
    STORAGE_TRANSFER_RANGE,
    input,
    blockedMask,
    roadMask,
    undefined,
    nonBuildableMask
  );
}

/**
 * @param {RoomPoint[]} points
 * @param {RoomPoint} storagePoint
 * @param {PlannerInput & { type: number }} input
 * @param {Uint8Array} blockedMask
 * @param {Uint8Array} roadMask
 * @param {Uint8Array} nonBuildableMask
 */

function sortPointsByTransferDistanceToStorage(
  points,
  storagePoint,
  input,
  blockedMask,
  roadMask,
  nonBuildableMask
) {
  if (points.length <= 1) {
    return;
  }

  /** @type {{ point: RoomPoint, cost: number, packed: number }[]} */
  const ranked = [];
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    ranked.push({
      point,
      cost: extensionTransferPathCost(
        point,
        storagePoint,
        input,
        blockedMask,
        roadMask,
        nonBuildableMask
      ),
      packed: packMincutPosToVertex(point.x, point.y),
    });
  }

  ranked.sort((left, right) => {
    if (left.cost !== right.cost) {
      return left.cost - right.cost;
    }
    return left.packed - right.packed;
  });

  for (let i = 0; i < points.length; i += 1) {
    points[i] = ranked[i].point;
  }
}

/**
 * Renumber service extensions (compact array slots 16–59 / indices 17–60) by
 * transfer path cost to storage; fastfiller slots 0–15 (indices 1–16) unchanged.
 *
 * @param {{ token: string, type: string, index: number, point: RoomPoint }[]} structures
 * @param {RoomPoint} storagePoint
 * @param {PlannerInput & { type: number }} input
 * @param {Uint8Array} blockedMask
 * @param {Uint8Array} roadMask
 * @param {Uint8Array} nonBuildableMask
 */

function sortServiceExtensionsByStorageDistance(
  structures,
  storagePoint,
  input,
  blockedMask,
  roadMask,
  nonBuildableMask
) {
  /** @type {{ token: string, type: string, index: number, point: RoomPoint }[]} */
  const serviceExtensions = [];

  for (let i = 0; i < structures.length; i += 1) {
    const structure = structures[i];
    if (
      structure.type === "extension" &&
      structure.index >= STEP2_EXTENSION_START_INDEX
    ) {
      serviceExtensions.push(structure);
    }
  }

  /** @type {{ structure: { token: string, type: string, index: number, point: RoomPoint }, cost: number, packed: number }[]} */
  const ranked = [];
  for (let i = 0; i < serviceExtensions.length; i += 1) {
    const structure = serviceExtensions[i];
    const point = structure.point;
    ranked.push({
      structure,
      cost: extensionTransferPathCost(
        point,
        storagePoint,
        input,
        blockedMask,
        roadMask,
        nonBuildableMask
      ),
      packed: packMincutPosToVertex(point.x, point.y),
    });
  }

  ranked.sort((left, right) => {
    if (left.cost !== right.cost) {
      return left.cost - right.cost;
    }
    return left.packed - right.packed;
  });

  for (let i = 0; i < ranked.length; i += 1) {
    const index = STEP2_EXTENSION_START_INDEX + i;
    ranked[i].structure.index = index;
    ranked[i].structure.token = `e${index}`;
  }
}

/**
 * @param {PlannerInput & { type: number }} input
 * @param {SeedEvaluation} winner
 * @param {Uint8Array} walkableMask
 * @param {Uint8Array} placementBlockedMask
 * @param {Uint8Array} structureBlockedMask
 * @param {Uint8Array} roadMask
 * @param {RoomPoint} storagePoint
 * @param {Uint8Array} nonBuildableMask
 * @returns {RoomPoint[]}
 */

function buildExtensionCandidates(
  input,
  winner,
  walkableMask,
  placementBlockedMask,
  structureBlockedMask,
  roadMask,
  storagePoint,
  nonBuildableMask
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
  sortPointsByTransferDistanceToStorage(
    candidates,
    storagePoint,
    input,
    placementBlockedMask,
    roadMask,
    nonBuildableMask
  );
  return candidates;
}

/**
 * @param {PlannerInput & { type: number }} input
 * @param {RoomPoint[]} extensions
 * @param {RoomPoint[]} candidates
 * @param {RoomPoint} storagePoint
 * @param {Uint8Array} placementBlockedMask
 * @param {Uint8Array} roadMask
 * @param {Uint8Array} extensionMask
 * @param {Uint8Array} nonBuildableMask
 * @param {RoomPoint[]} roads
 * @param {Set<number>} blockedTileSet
 * @returns {boolean}
 */

function repairInaccessibleExtensions(
  input,
  extensions,
  candidates,
  storagePoint,
  placementBlockedMask,
  roadMask,
  extensionMask,
  nonBuildableMask,
  roads,
  blockedTileSet
) {
  for (let guard = 0; guard < 500; guard += 1) {
    const inaccessibleExtensionIndex = findInaccessibleLabIndex(
      extensions,
      storagePoint,
      input,
      placementBlockedMask,
      roadMask,
      extensionMask,
      nonBuildableMask
    );
    if (inaccessibleExtensionIndex === -1) {
      return true;
    }

    const path = findLabAccessPath(
      storagePoint,
      extensions[inaccessibleExtensionIndex],
      input,
      placementBlockedMask,
      roadMask,
      extensionMask,
      nonBuildableMask
    );
    const blockingExtensionIndex = findBlockingLabIndexInPath(path, extensions);
    if (blockingExtensionIndex === -1) {
      return false;
    }

    const blockingExtension = extensions[blockingExtensionIndex];
    const blockingIndex = blockingExtension.y * 50 + blockingExtension.x;
    extensionMask[blockingIndex] = 0;
    roadMask[blockingIndex] = 1;
    roads.push({ x: blockingExtension.x, y: blockingExtension.y });
    blockedTileSet.add(
      packMincutPosToVertex(blockingExtension.x, blockingExtension.y)
    );

    const replacement = selectReplacementExtensionTile(
      input,
      candidates,
      storagePoint,
      placementBlockedMask,
      roadMask,
      extensionMask,
      nonBuildableMask
    );
    if (!replacement) {
      return false;
    }

    extensions[blockingExtensionIndex] = replacement;
    extensionMask[replacement.y * 50 + replacement.x] = 1;
  }

  return false;
}

/**
 * @param {PlannerInput & { type: number }} input
 * @param {RoomPoint[]} candidates
 * @param {RoomPoint} storagePoint
 * @param {Uint8Array} placementBlockedMask
 * @param {Uint8Array} roadMask
 * @param {Uint8Array} extensionMask
 * @param {Uint8Array} nonBuildableMask
 * @returns {RoomPoint | null}
 */

function selectReplacementExtensionTile(
  input,
  candidates,
  storagePoint,
  placementBlockedMask,
  roadMask,
  extensionMask,
  nonBuildableMask
) {
  /** @type {RoomPoint | null} */
  let best = null;
  let bestCost = Infinity;
  let bestPacked = Infinity;
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    const index = candidate.y * 50 + candidate.x;
    if (placementBlockedMask[index] || roadMask[index] || extensionMask[index]) {
      continue;
    }
    const cost = extensionTransferPathCost(
      candidate,
      storagePoint,
      input,
      placementBlockedMask,
      roadMask,
      nonBuildableMask
    );
    const packed = packMincutPosToVertex(candidate.x, candidate.y);
    if (
      cost < bestCost ||
      (cost === bestCost && packed < bestPacked)
    ) {
      best = candidate;
      bestCost = cost;
      bestPacked = packed;
    }
  }
  return best;
}

module.exports = {
  planStep2Extensions,
  buildExtensionCandidates,
  repairInaccessibleExtensions,
  selectReplacementExtensionTile,
  sortServiceExtensionsByStorageDistance,
  sortPointsByTransferDistanceToStorage,
  extensionTransferPathCost,
};
