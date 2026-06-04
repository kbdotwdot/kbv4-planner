const {
  cloneMask,
  packMincutPosToVertex,
  unpackPoints,
  isInsideRoom,
  pointsToMask,
  getConnectedMaskGroups,
} = require("../lib/mask");
const { chebyshevDistance, linearDistance, indexToPoint, findInArray } = require("../lib/geo");
const { buildWalkableMaskForServicePlacement, buildExteriorMaskOutsideMincut, enqueueExteriorTile } = require("../lib/terrain");
const {
  findRoadPath,
  buildRoadMaskFromPoints,
  appendRoadPath,
  markRoadPathBlocked,
  estimatePathCost,
  buildRoadRoutingCostMatrix,
  isRoadBuildableForRouting,
} = require("./roads");
const { buildStep2OccupiedMask, addPlacedStructure, addRangeToBlockedSet, storeStep2ServicePlacements, markRangeBlocked } = require("./persist");
const { planStep2Towers } = require("./towers");
const { planStep2Labs } = require("./labs");
const {
  planStep2Extensions,
  buildExtensionCandidates,
  selectReplacementExtensionTile,
  sortServiceExtensionsByStorageDistance,
} = require("./extensions");
const { finalizeServiceRoadAccessibility } = require("./accessibility");
const { buildRoutingNonBuildableMask } = require("./routingMask");
const { EIGHT_NEIGHBOR_VECTORS, ACCESS_REPAIR_TERRAIN_COST } = require("../constants");

function planStep2ServiceSites(input, winner, compact, corePlan) {
  if (!winner || !corePlan) {
    return null;
  }

  const storagePoint = getStructurePointByToken(corePlan.hub, "l");
  if (!storagePoint) {
    return null;
  }

  const walkableMask = buildWalkableMaskForServicePlacement(input);
  const nonBuildableRoutingMask = buildRoutingNonBuildableMask(winner);
  const structureBlockedMask = buildStep2OccupiedMask(corePlan);
  const placementBlockedMask = cloneMask(structureBlockedMask);
  const roadMask = buildRoadMaskFromPoints(corePlan.hub.roads.concat(corePlan.fastfiller.roads));
  /** @type {{ token: string, type: string, index: number, point: RoomPoint }[]} */
  const structures = [];
  const blockedTileSet = new Set();
  /** @type {RoomPoint[]} */
  const roads = [];

  const upgraderTile = selectUpgraderTile(
    input,
    walkableMask,
    placementBlockedMask,
    structureBlockedMask,
    roadMask,
    storagePoint,
    undefined
  );
  if (!upgraderTile) {
    return null;
  }
  addPlacedStructure(structures, structureBlockedMask, "m2", "link", 2, upgraderTile);
  addPlacedStructure(
    structures,
    structureBlockedMask,
    "k3",
    "container",
    3,
    upgraderTile
  );
  addRangeToBlockedSet(blockedTileSet, upgraderTile, 1);
  markRangeBlocked(placementBlockedMask, upgraderTile, 1);

  addPlacedStructure(
    structures,
    structureBlockedMask,
    "o",
    "extractor",
    1,
    input.mineral_pos
  );

  const mineralContainer = selectBestAdjacentTileByPath(
    input.mineral_pos,
    walkableMask,
    placementBlockedMask,
    structureBlockedMask,
    roadMask,
    storagePoint,
    input,
    undefined
  );
  if (!mineralContainer) {
    return null;
  }
  addPlacedStructure(
    structures,
    structureBlockedMask,
    "k4",
    "container",
    4,
    mineralContainer
  );
  placementBlockedMask[mineralContainer.y * 50 + mineralContainer.x] = 1;

  appendRoadPath(
    roads,
    roadMask,
    findRoadPath(
      storagePoint,
      upgraderTile,
      2,
      input,
      placementBlockedMask,
      roadMask,
      undefined,
      undefined
    )
  );
  appendRoadPath(
    roads,
    roadMask,
    findRoadPath(
      storagePoint,
      mineralContainer,
      1,
      input,
      placementBlockedMask,
      roadMask,
      undefined,
      undefined
    )
  );

  for (let i = 0; i < roads.length; i += 1) {
    blockedTileSet.add(packMincutPosToVertex(roads[i].x, roads[i].y));
    placementBlockedMask[roads[i].y * 50 + roads[i].x] = 1;
  }

  const source1Approach = selectSourceRoadApproach(
    input.source1_pos,
    walkableMask,
    placementBlockedMask,
    roadMask,
    storagePoint,
    input,
    undefined
  );
  if (!source1Approach) {
    return null;
  }
  const source1RoadPath = findRoadPath(
    storagePoint,
    source1Approach.roadEndpoint,
    0,
    input,
    placementBlockedMask,
    roadMask,
    undefined,
    undefined
  );
  appendRoadPath(roads, roadMask, source1RoadPath);
  markRoadPathBlocked(blockedTileSet, placementBlockedMask, source1RoadPath);

  const source1Container = source1Approach.container;
  addPlacedStructure(
    structures,
    structureBlockedMask,
    "k5",
    "container",
    5,
    source1Container
  );
  placementBlockedMask[source1Container.y * 50 + source1Container.x] = 1;

  const source1Link = selectLinkAdjacentToContainer(
    source1Container,
    walkableMask,
    placementBlockedMask,
    roadMask
  );
  if (!source1Link) {
    return null;
  }
  addPlacedStructure(structures, structureBlockedMask, "m4", "link", 4, source1Link);
  placementBlockedMask[source1Link.y * 50 + source1Link.x] = 1;

  if (input.source2_pos) {
    const source2Approach = selectSourceRoadApproach(
      input.source2_pos,
      walkableMask,
      placementBlockedMask,
      roadMask,
      storagePoint,
      input,
      undefined
    );
    if (!source2Approach) {
      return null;
    }
    const source2RoadPath = findRoadPath(
      storagePoint,
      source2Approach.roadEndpoint,
      0,
      input,
      placementBlockedMask,
      roadMask,
      undefined,
      undefined
    );
    appendRoadPath(roads, roadMask, source2RoadPath);
    markRoadPathBlocked(blockedTileSet, placementBlockedMask, source2RoadPath);

    const source2Container = source2Approach.container;
    addPlacedStructure(
      structures,
      structureBlockedMask,
      "k6",
      "container",
      6,
      source2Container
    );
    placementBlockedMask[source2Container.y * 50 + source2Container.x] = 1;

    const source2Link = selectLinkAdjacentToContainer(
      source2Container,
      walkableMask,
      placementBlockedMask,
      roadMask
    );
    if (!source2Link) {
      return null;
    }
    addPlacedStructure(
      structures,
      structureBlockedMask,
      "m5",
      "link",
      5,
      source2Link
    );
    placementBlockedMask[source2Link.y * 50 + source2Link.x] = 1;
  }

  if (
    !planStep2Towers(
      winner,
      walkableMask,
      placementBlockedMask,
      structureBlockedMask,
      structures
    )
  ) {
    return null;
  }

  addMincutRoads(
    input,
    winner.mincutTiles,
    roads,
    roadMask,
    placementBlockedMask,
    blockedTileSet
  );

  connectRoadGroupsToHub(
    input,
    winner,
    corePlan.hub.roads,
    walkableMask,
    structureBlockedMask,
    roads,
    roadMask,
    placementBlockedMask,
    blockedTileSet,
    structures,
    storagePoint,
    undefined
  );

  planStep2Labs(
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
  );

  planStep2Extensions(
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
  );
  finalizeServiceRoadAccessibility(
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
    nonBuildableRoutingMask
  );
  const observerPoint = selectObserverTile(
    input,
    winner,
    corePlan,
    structures,
    roads,
    storagePoint
  );
  if (!observerPoint) {
    return null;
  }
  addPlacedStructure(structures, structureBlockedMask, "p", "observer", 1, observerPoint);
  placementBlockedMask[observerPoint.y * 50 + observerPoint.x] = 1;
  placeStep2Ramparts(
    input,
    winner,
    corePlan,
    structures,
    roads,
    structureBlockedMask
  );

  sortServiceExtensionsByStorageDistance(
    structures,
    storagePoint,
    input,
    placementBlockedMask,
    roadMask,
    nonBuildableRoutingMask
  );

  const servicePlan = {
    structures,
    roads,
    blockedTiles: unpackPoints(Array.from(blockedTileSet)),
  };

  if (compact) {
    storeStep2ServicePlacements(compact, servicePlan);
  }

  return servicePlan;
}

/**
 * @param {SeedEvaluation} winner
 * @param {Uint8Array} walkableMask
 * @param {Uint8Array} placementBlockedMask
 * @param {Uint8Array} structureBlockedMask
 * @param {{ token: string, type: string, index: number, point: RoomPoint }[]} structures
 * @returns {boolean}
 */

function getStructurePointByToken(placement, token) {
  const match = findInArray(placement.structures, (entry) => entry.token === token);
  return match ? match.point : null;
}

/**
 * @param {PlannerInput & { type: number }} input
 * @param {Uint8Array} walkableMask
 * @param {Uint8Array} placementBlockedMask
 * @param {Uint8Array} structureBlockedMask
 * @param {Uint8Array} roadMask
 * @param {RoomPoint} storagePoint
 * @returns {RoomPoint | null}
 */

function selectUpgraderTile(
  input,
  walkableMask,
  placementBlockedMask,
  structureBlockedMask,
  roadMask,
  storagePoint,
  nonBuildableMask
) {
  /** @type {{ point: RoomPoint, adjacentCount: number, pathCost: number } | null} */
  let best = null;

  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      const x = input.controller_pos.x + dx;
      const y = input.controller_pos.y + dy;
      if (
        !isInsideRoom(x, y) ||
        chebyshevDistance({ x, y }, input.controller_pos) !== 2
      ) {
        continue;
      }
      const index = y * 50 + x;
      if (!walkableMask[index] || placementBlockedMask[index]) {
        continue;
      }

      const adjacentCount = countAdjacentWalkableTiles({ x, y }, walkableMask);
      const pathCost = estimatePathCost(
        storagePoint,
        { x, y },
        0,
        input,
        placementBlockedMask,
        roadMask,
        undefined,
        nonBuildableMask
      );
      const effectivePathCost =
        pathCost === Infinity
          ? chebyshevDistance(storagePoint, { x, y }) * ACCESS_REPAIR_TERRAIN_COST
          : pathCost;

      if (
        !best ||
        adjacentCount > best.adjacentCount ||
        (adjacentCount === best.adjacentCount && effectivePathCost < best.pathCost)
      ) {
        best = { point: { x, y }, adjacentCount, pathCost: effectivePathCost };
      }
    }
  }

  return best ? best.point : null;
}

/**
 * @param {RoomPoint} point
 * @param {Uint8Array} walkableMask
 * @returns {number}
 */

function countAdjacentWalkableTiles(point, walkableMask) {
  let count = 0;
  for (let i = 0; i < EIGHT_NEIGHBOR_VECTORS.length; i += 1) {
    const nx = point.x + EIGHT_NEIGHBOR_VECTORS[i].x;
    const ny = point.y + EIGHT_NEIGHBOR_VECTORS[i].y;
    if (!isInsideRoom(nx, ny)) {
      continue;
    }
    count += walkableMask[ny * 50 + nx];
  }
  return count;
}

/**
 * @param {RoomPoint} anchor
 * @param {Uint8Array} walkableMask
 * @param {Uint8Array} placementBlockedMask
 * @param {Uint8Array} structureBlockedMask
 * @param {Uint8Array} roadMask
 * @param {RoomPoint} storagePoint
 * @param {PlannerInput & { type: number }} input
 * @returns {RoomPoint | null}
 */

function selectBestAdjacentTileByPath(
  anchor,
  walkableMask,
  placementBlockedMask,
  structureBlockedMask,
  roadMask,
  storagePoint,
  input,
  nonBuildableMask
) {
  /** @type {{ point: RoomPoint, pathCost: number } | null} */
  let best = null;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const x = anchor.x + dx;
      const y = anchor.y + dy;
      if (
        !isInsideRoom(x, y) ||
        chebyshevDistance({ x, y }, anchor) !== 1
      ) {
        continue;
      }

      const index = y * 50 + x;
      if (!walkableMask[index] || placementBlockedMask[index]) {
        continue;
      }

      const pathCost = estimatePathCost(
        storagePoint,
        { x, y },
        0,
        input,
        placementBlockedMask,
        roadMask,
        undefined,
        nonBuildableMask
      );
      const effectivePathCost =
        pathCost === Infinity
          ? chebyshevDistance(storagePoint, { x, y }) * ACCESS_REPAIR_TERRAIN_COST
          : pathCost;

      if (!best || effectivePathCost < best.pathCost) {
        best = { point: { x, y }, pathCost: effectivePathCost };
      }
    }
  }
  return best ? best.point : null;
}

/**
 * @param {RoomPoint} sourcePos
 * @param {Uint8Array} walkableMask
 * @param {Uint8Array} placementBlockedMask
 * @param {Uint8Array} roadMask
 * @returns {RoomPoint | null}
 */

function selectSourceContainerByRoad(
  sourcePos,
  walkableMask,
  placementBlockedMask,
  roadMask
) {
  /** @type {{ point: RoomPoint, distance: number } | null} */
  let best = null;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const x = sourcePos.x + dx;
      const y = sourcePos.y + dy;
      if (
        !isInsideRoom(x, y) ||
        chebyshevDistance({ x, y }, sourcePos) !== 1
      ) {
        continue;
      }

      const index = y * 50 + x;
      if (!walkableMask[index] || placementBlockedMask[index]) {
        continue;
      }

      const distance = distanceToNearestRoad({ x, y }, roadMask);
      if (
        !best ||
        distance < best.distance ||
        (distance === best.distance &&
          chebyshevDistance({ x, y }, sourcePos) <
            chebyshevDistance(best.point, sourcePos))
      ) {
        best = { point: { x, y }, distance };
      }
    }
  }

  return best ? best.point : null;
}

/**
 * @param {RoomPoint} sourcePos
 * @param {Uint8Array} walkableMask
 * @param {Uint8Array} placementBlockedMask
 * @param {Uint8Array} roadMask
 * @param {RoomPoint} storagePoint
 * @param {PlannerInput & { type: number }} input
 * @returns {{ container: RoomPoint, roadEndpoint: RoomPoint } | null}
 */

function selectSourceRoadApproach(
  sourcePos,
  walkableMask,
  placementBlockedMask,
  roadMask,
  storagePoint,
  input,
  nonBuildableMask
) {
  /** @type {{ container: RoomPoint, roadEndpoint: RoomPoint, pathCost: number } | null} */
  let best = null;

  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const container = { x: sourcePos.x + dx, y: sourcePos.y + dy };
      if (
        !isInsideRoom(container.x, container.y) ||
        chebyshevDistance(container, sourcePos) !== 1
      ) {
        continue;
      }

      const containerIndex = container.y * 50 + container.x;
      if (!walkableMask[containerIndex] || placementBlockedMask[containerIndex]) {
        continue;
      }

      for (let ey = -1; ey <= 1; ey += 1) {
        for (let ex = -1; ex <= 1; ex += 1) {
          const roadEndpoint = { x: container.x + ex, y: container.y + ey };
          if (
            !isInsideRoom(roadEndpoint.x, roadEndpoint.y) ||
            chebyshevDistance(roadEndpoint, container) !== 1 ||
            chebyshevDistance(roadEndpoint, sourcePos) !== 2
          ) {
            continue;
          }

          if (
            !isRoadBuildableForRouting(
              roadEndpoint,
              input,
              placementBlockedMask,
              roadMask,
              storagePoint,
              undefined,
              nonBuildableMask
            )
          ) {
            continue;
          }

          const pathCost = estimatePathCost(
            storagePoint,
            roadEndpoint,
            0,
            input,
            placementBlockedMask,
            roadMask,
            undefined,
            nonBuildableMask
          );
          const effectivePathCost =
            pathCost === Infinity
              ? chebyshevDistance(storagePoint, roadEndpoint) * ACCESS_REPAIR_TERRAIN_COST
              : pathCost;

          if (!best || effectivePathCost < best.pathCost) {
            best = { container, roadEndpoint, pathCost: effectivePathCost };
          }
        }
      }
    }
  }

  return best
    ? { container: best.container, roadEndpoint: best.roadEndpoint }
    : null;
}

/**
 * @param {RoomPoint} containerPos
 * @param {Uint8Array} walkableMask
 * @param {Uint8Array} placementBlockedMask
 * @param {Uint8Array} roadMask
 * @returns {RoomPoint | null}
 */

function selectLinkAdjacentToContainer(
  containerPos,
  walkableMask,
  placementBlockedMask,
  roadMask
) {
  /** @type {{ point: RoomPoint, distance: number } | null} */
  let best = null;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const x = containerPos.x + dx;
      const y = containerPos.y + dy;
      if (
        !isInsideRoom(x, y) ||
        chebyshevDistance({ x, y }, containerPos) !== 1
      ) {
        continue;
      }

      const index = y * 50 + x;
      if (!walkableMask[index] || placementBlockedMask[index]) {
        continue;
      }

      const distance = distanceToNearestRoad({ x, y }, roadMask);
      if (!best || distance < best.distance) {
        best = { point: { x, y }, distance };
      }
    }
  }

  return best ? best.point : null;
}

/**
 * @param {RoomPoint} point
 * @param {Uint8Array} roadMask
 * @returns {number}
 */

function distanceToNearestRoad(point, roadMask) {
  let best = Infinity;
  for (let index = 0; index < 2500; index += 1) {
    if (!roadMask[index]) {
      continue;
    }
    const x = index % 50;
    const y = (index - x) / 50;
    const distance = chebyshevDistance(point, { x, y });
    if (distance < best) {
      best = distance;
    }
  }
  return best;
}

/**
 * @param {PlannerInput & { type: number }} input
 * @param {RoomPoint[]} mincutTiles
 * @param {RoomPoint[]} roads
 * @param {Uint8Array} roadMask
 * @param {Uint8Array} placementBlockedMask
 * @param {Set<number>} blockedTileSet
 */

function addMincutRoads(
  input,
  mincutTiles,
  roads,
  roadMask,
  placementBlockedMask,
  blockedTileSet
) {
  /** @type {RoomPoint[]} */
  const mincutRoads = [];
  for (let i = 0; i < mincutTiles.length; i += 1) {
    const point = mincutTiles[i];
    if (input.terrain.get(point.x, point.y) & TERRAIN_MASK_WALL) {
      continue;
    }
    mincutRoads.push(point);
  }

  appendRoadPath(roads, roadMask, mincutRoads);
  markRoadPathBlocked(blockedTileSet, placementBlockedMask, mincutRoads);
}

/**
 * @param {PlannerInput & { type: number }} input
 * @param {SeedEvaluation} winner
 * @param {RoomPoint[]} hubRoads
 * @param {Uint8Array} walkableMask
 * @param {Uint8Array} structureBlockedMask
 * @param {RoomPoint[]} roads
 * @param {Uint8Array} roadMask
 * @param {Uint8Array} placementBlockedMask
 * @param {Set<number>} blockedTileSet
 * @param {{ token: string, type: string, index: number, point: RoomPoint }[]} structures
 * @param {RoomPoint} storagePoint
 * @returns {boolean}
 */

function connectRoadGroupsToHub(
  input,
  winner,
  hubRoads,
  walkableMask,
  structureBlockedMask,
  roads,
  roadMask,
  placementBlockedMask,
  blockedTileSet,
  structures,
  storagePoint,
  nonBuildableMask
) {
  const hubRoad = selectHubRoadAnchor(hubRoads, roadMask);
  if (!hubRoad) {
    return false;
  }
  const extensionMask = buildStructureTypeMask(structures, "extension");
  const connectionAreaMask = buildFinalRoadConnectionAreaMask(input, winner);
  const connectionBlockedMask = buildFinalRoadConnectionBlockedMask(
    connectionAreaMask,
    structureBlockedMask,
    extensionMask
  );
  const connectionRoadMask = buildMaskedRoadMask(roadMask, connectionAreaMask);
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
    const groups = getConnectedMaskGroups(connectionRoadMask);
    if (groups.length <= 1) {
      return true;
    }

    const hubGroupIndex = findRoadGroupContainingPoint(groups, hubRoad);
    if (hubGroupIndex === -1) {
      return false;
    }

    const target = selectClosestDisconnectedRoadTile(
      hubRoad,
      groups,
      hubGroupIndex,
      input,
      connectionBlockedMask,
      connectionRoadMask,
      extensionMask,
      nonBuildableMask
    );
    if (!target) {
      return false;
    }

    const path = findRoadPath(
      hubRoad,
      target,
      0,
      input,
      connectionBlockedMask,
      connectionRoadMask,
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
    markRoadMask(connectionRoadMask, path);
    markRoadPathBlocked(blockedTileSet, placementBlockedMask, path);
  }

  return false;
}

/**
 * @param {RoomPoint[]} hubRoads
 * @param {Uint8Array} roadMask
 * @returns {RoomPoint | null}
 */

function selectHubRoadAnchor(hubRoads, roadMask) {
  for (let i = 0; i < hubRoads.length; i += 1) {
    const point = hubRoads[i];
    if (roadMask[point.y * 50 + point.x]) {
      return point;
    }
  }
  return null;
}

/**
 * @param {number[][]} groups
 * @param {RoomPoint} point
 * @returns {number}
 */

function findRoadGroupContainingPoint(groups, point) {
  const pointIndex = point.y * 50 + point.x;
  for (let i = 0; i < groups.length; i += 1) {
    const group = groups[i];
    for (let j = 0; j < group.length; j += 1) {
      if (group[j] === pointIndex) {
        return i;
      }
    }
  }
  return -1;
}

/**
 * @param {RoomPoint} hubRoad
 * @param {number[][]} groups
 * @param {number} hubGroupIndex
 * @param {PlannerInput & { type: number }} input
 * @param {Uint8Array} blockedMask
 * @param {Uint8Array} roadMask
 * @param {Uint8Array} extensionMask
 * @returns {RoomPoint | null}
 */

function selectClosestDisconnectedRoadTile(
  hubRoad,
  groups,
  hubGroupIndex,
  input,
  blockedMask,
  roadMask,
  extensionMask,
  nonBuildableMask
) {
  /** @type {RoomPoint | null} */
  let best = null;
  let bestCost = Infinity;
  let bestPacked = Infinity;

  for (let i = 0; i < groups.length; i += 1) {
    if (i === hubGroupIndex) {
      continue;
    }

    const group = groups[i];
    for (let j = 0; j < group.length; j += 1) {
      const point = indexToPoint(group[j]);
      const cost = estimatePathCost(
        hubRoad,
        point,
        0,
        input,
        blockedMask,
        roadMask,
        extensionMask,
        nonBuildableMask
      );
      if (cost === Infinity) {
        continue;
      }

      const packed = packMincutPosToVertex(point.x, point.y);
      if (cost < bestCost || (cost === bestCost && packed < bestPacked)) {
        best = point;
        bestCost = cost;
        bestPacked = packed;
      }
    }
  }

  return best;
}

/**
 * @param {PlannerInput & { type: number }} input
 * @param {SeedEvaluation} winner
 * @returns {Uint8Array}
 */

function buildFinalRoadConnectionAreaMask(input, winner) {
  const mincutMask = pointsToMask(winner.mincutTiles);
  const exteriorMask = buildExteriorMaskOutsideMincut(input.terrain, mincutMask);
  const areaMask = new Uint8Array(2500);
  for (let index = 0; index < 2500; index += 1) {
    const x = index % 50;
    const y = (index - x) / 50;
    if (!exteriorMask[index] && !(input.terrain.get(x, y) & TERRAIN_MASK_WALL)) {
      areaMask[index] = 1;
    }
  }
  for (let i = 0; i < winner.mincutTiles.length; i += 1) {
    const point = winner.mincutTiles[i];
    areaMask[point.y * 50 + point.x] = 1;
  }
  return areaMask;
}

/**
 * @param {Room.Terrain} terrain
 * @param {Uint8Array} mincutMask
 * @returns {Uint8Array}
 */

function buildMaskedRoadMask(roadMask, areaMask) {
  const maskedRoadMask = new Uint8Array(2500);
  for (let index = 0; index < 2500; index += 1) {
    if (roadMask[index] && areaMask[index]) {
      maskedRoadMask[index] = 1;
    }
  }
  return maskedRoadMask;
}

/**
 * @param {Uint8Array} roadMask
 * @param {RoomPoint[]} path
 */

function markRoadMask(roadMask, path) {
  for (let i = 0; i < path.length; i += 1) {
    const point = path[i];
    roadMask[point.y * 50 + point.x] = 1;
  }
}

/**
 * @param {Uint8Array} allowedMask
 * @param {Uint8Array} structureBlockedMask
 * @param {Uint8Array} extensionMask
 * @returns {Uint8Array}
 */

function buildFinalRoadConnectionBlockedMask(
  allowedMask,
  structureBlockedMask,
  extensionMask
) {
  const blockedMask = new Uint8Array(2500);
  for (let index = 0; index < 2500; index += 1) {
    if (!allowedMask[index]) {
      blockedMask[index] = 1;
      continue;
    }
    if (structureBlockedMask[index] && !extensionMask[index]) {
      blockedMask[index] = 1;
    }
  }
  return blockedMask;
}

/**
 * @param {{ token: string, type: string, index: number, point: RoomPoint }[]} structures
 * @param {string} type
 * @returns {Uint8Array}
 */

function buildStructureTypeMask(structures, type) {
  const mask = new Uint8Array(2500);
  for (let i = 0; i < structures.length; i += 1) {
    const structure = structures[i];
    if (structure.type !== type) {
      continue;
    }
    mask[structure.point.y * 50 + structure.point.x] = 1;
  }
  return mask;
}

/**
 * @param {RoomPoint[]} path
 * @param {RoomPoint[]} candidates
 * @param {RoomPoint} storagePoint
 * @param {{ token: string, type: string, index: number, point: RoomPoint }[]} structures
 * @param {Uint8Array} placementBlockedMask
 * @param {Uint8Array} structureBlockedMask
 * @param {Uint8Array} roadMask
 * @param {Uint8Array} extensionMask
 * @returns {boolean}
 */

function replaceExtensionsConsumedByRoadPath(
  input,
  path,
  candidates,
  storagePoint,
  structures,
  placementBlockedMask,
  structureBlockedMask,
  roadMask,
  extensionMask,
  nonBuildableMask
) {
  for (let i = 0; i < path.length; i += 1) {
    const point = path[i];
    const pathIndex = point.y * 50 + point.x;
    if (!extensionMask[pathIndex]) {
      continue;
    }

    const extension = findStructureAtPoint(structures, "extension", point);
    if (!extension) {
      return false;
    }

    extensionMask[pathIndex] = 0;
    structureBlockedMask[pathIndex] = 0;

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

    extension.point = replacement;
    const replacementIndex = replacement.y * 50 + replacement.x;
    extensionMask[replacementIndex] = 1;
    structureBlockedMask[replacementIndex] = 1;
    placementBlockedMask[replacementIndex] = 1;
  }

  return true;
}

/**
 * @param {{ token: string, type: string, index: number, point: RoomPoint }[]} structures
 * @param {string} type
 * @param {RoomPoint} point
 * @returns {{ token: string, type: string, index: number, point: RoomPoint } | null}
 */

function findStructureAtPoint(structures, type, point) {
  for (let i = 0; i < structures.length; i += 1) {
    const structure = structures[i];
    if (
      structure.type === type &&
      structure.point.x === point.x &&
      structure.point.y === point.y
    ) {
      return structure;
    }
  }
  return null;
}

/**
 * Observer must be placed on winner.buildableTiles, and:
 * - tile is not occupied by already placed structures/roads
 * - at least one adjacent tile is reachable from storage through terrain +
 *   impassible planned structures only
 *
 * @param {PlannerInput & { type: number }} input
 * @param {SeedEvaluation} winner
 * @param {{ hub: CorePlacement, fastfiller: CorePlacement }} corePlan
 * @param {{ token: string, type: string, index: number, point: RoomPoint }[]} serviceStructures
 * @param {RoomPoint[]} serviceRoads
 * @param {RoomPoint} storagePoint
 * @returns {RoomPoint | null}
 */
function selectObserverTile(
  input,
  winner,
  corePlan,
  serviceStructures,
  serviceRoads,
  storagePoint
) {
  const occupiedMask = buildPlacedOccupiedMask(corePlan, serviceStructures, serviceRoads);
  const impassibleMask = buildPlacedImpassibleMask(corePlan, serviceStructures);
  const reachableMask = buildReachableMaskFromStorage(input, impassibleMask, storagePoint);
  const buildableMask = pointsToMask(winner.buildableTiles);

  /** @type {{ point: RoomPoint, score: number, packed: number } | null} */
  let best = null;
  for (let y = 0; y < 50; y += 1) {
    for (let x = 0; x < 50; x += 1) {
      const index = y * 50 + x;
      if (!buildableMask[index]) {
        continue;
      }
      if (occupiedMask[index]) {
        continue;
      }
      if (!hasAdjacentReachableTile(x, y, reachableMask, storagePoint)) {
        continue;
      }

      const score = chebyshevDistance({ x, y }, storagePoint);
      const packed = packMincutPosToVertex(x, y);
      if (
        !best ||
        score > best.score ||
        (score === best.score && packed < best.packed)
      ) {
        best = { point: { x, y }, score, packed };
      }
    }
  }

  return best ? best.point : null;
}

/**
 * @param {{ hub: CorePlacement, fastfiller: CorePlacement }} corePlan
 * @param {{ token: string, type: string, index: number, point: RoomPoint }[]} serviceStructures
 * @param {RoomPoint[]} serviceRoads
 * @returns {Uint8Array}
 */
function buildPlacedOccupiedMask(corePlan, serviceStructures, serviceRoads) {
  const mask = new Uint8Array(2500);
  const corePlacements = [corePlan.hub, corePlan.fastfiller];
  for (let i = 0; i < corePlacements.length; i += 1) {
    const placement = corePlacements[i];
    for (let j = 0; j < placement.structures.length; j += 1) {
      const point = placement.structures[j].point;
      mask[point.y * 50 + point.x] = 1;
    }
    for (let j = 0; j < placement.roads.length; j += 1) {
      const point = placement.roads[j];
      mask[point.y * 50 + point.x] = 1;
    }
  }
  for (let i = 0; i < serviceStructures.length; i += 1) {
    const point = serviceStructures[i].point;
    mask[point.y * 50 + point.x] = 1;
  }
  for (let i = 0; i < serviceRoads.length; i += 1) {
    const point = serviceRoads[i];
    mask[point.y * 50 + point.x] = 1;
  }
  return mask;
}

/**
 * @param {{ hub: CorePlacement, fastfiller: CorePlacement }} corePlan
 * @param {{ token: string, type: string, index: number, point: RoomPoint }[]} serviceStructures
 * @returns {Uint8Array}
 */
function buildPlacedImpassibleMask(corePlan, serviceStructures) {
  const mask = new Uint8Array(2500);
  const corePlacements = [corePlan.hub, corePlan.fastfiller];
  for (let i = 0; i < corePlacements.length; i += 1) {
    const placement = corePlacements[i];
    for (let j = 0; j < placement.structures.length; j += 1) {
      const structure = placement.structures[j];
      if (!isPlannedStructureImpassible(structure.type)) {
        continue;
      }
      const point = structure.point;
      mask[point.y * 50 + point.x] = 1;
    }
  }
  for (let i = 0; i < serviceStructures.length; i += 1) {
    const structure = serviceStructures[i];
    if (!isPlannedStructureImpassible(structure.type)) {
      continue;
    }
    const point = structure.point;
    mask[point.y * 50 + point.x] = 1;
  }
  return mask;
}

/**
 * @param {string} type
 * @returns {boolean}
 */
function isPlannedStructureImpassible(type) {
  return (
    type !== "container" &&
    type !== "extractor" &&
    type !== "road" &&
    type !== "rampart" &&
    type !== "fastfiller_tile" &&
    type !== "manager_tile"
  );
}

/**
 * @param {PlannerInput & { type: number }} input
 * @param {Uint8Array} impassibleMask
 * @param {RoomPoint} storagePoint
 * @returns {Uint8Array}
 */
function buildReachableMaskFromStorage(input, impassibleMask, storagePoint) {
  const reachableMask = new Uint8Array(2500);
  /** @type {number[]} */
  const queue = [];
  let head = 0;

  queue.push(storagePoint.y * 50 + storagePoint.x);

  while (head < queue.length) {
    const index = queue[head];
    head += 1;
    const x = index % 50;
    const y = (index - x) / 50;

    for (let i = 0; i < EIGHT_NEIGHBOR_VECTORS.length; i += 1) {
      const nx = x + EIGHT_NEIGHBOR_VECTORS[i].x;
      const ny = y + EIGHT_NEIGHBOR_VECTORS[i].y;
      if (!isInsideRoom(nx, ny)) {
        continue;
      }
      const nextIndex = ny * 50 + nx;
      if (reachableMask[nextIndex]) {
        continue;
      }
      if (input.terrain.get(nx, ny) & TERRAIN_MASK_WALL) {
        continue;
      }
      if (impassibleMask[nextIndex]) {
        continue;
      }
      reachableMask[nextIndex] = 1;
      queue.push(nextIndex);
    }
  }

  return reachableMask;
}

/**
 * @param {number} x
 * @param {number} y
 * @param {Uint8Array} reachableMask
 * @param {RoomPoint} storagePoint
 * @returns {boolean}
 */
function hasAdjacentReachableTile(x, y, reachableMask, storagePoint) {
  for (let i = 0; i < EIGHT_NEIGHBOR_VECTORS.length; i += 1) {
    const nx = x + EIGHT_NEIGHBOR_VECTORS[i].x;
    const ny = y + EIGHT_NEIGHBOR_VECTORS[i].y;
    if (!isInsideRoom(nx, ny)) {
      continue;
    }
    if (nx === storagePoint.x && ny === storagePoint.y) {
      return true;
    }
    if (reachableMask[ny * 50 + nx]) {
      return true;
    }
  }
  return false;
}

/**
 * @param {PlannerInput & { type: number }} input
 * @param {SeedEvaluation} winner
 * @param {{ hub: CorePlacement, fastfiller: CorePlacement }} corePlan
 * @param {{ token: string, type: string, index: number, point: RoomPoint }[]} serviceStructures
 * @param {RoomPoint[]} serviceRoads
 * @param {Uint8Array} structureBlockedMask
 */
function placeStep2Ramparts(
  input,
  winner,
  corePlan,
  serviceStructures,
  serviceRoads,
  structureBlockedMask
) {
  const interiorMask = pointsToMask(winner.interiorTiles);
  const mincutMask = pointsToMask(winner.mincutTiles);
  const mincutRange2Mask = buildMincutRangeMask(winner.mincutTiles, 2);
  const allRoads = collectAllRoads(corePlan, serviceRoads);
  const allStructures = collectAllStructures(corePlan, serviceStructures);

  const state = {
    rampart_controller: { nextIndex: 1, seen: new Set(), tokenPrefix: "rc" },
    rampart_mincut: { nextIndex: 1, seen: new Set(), tokenPrefix: "rm" },
    rampart_glid: { nextIndex: 1, seen: new Set(), tokenPrefix: "rg" },
    rampart_road: { nextIndex: 1, seen: new Set(), tokenPrefix: "rr" },
  };

  placeControllerRamparts(
    input,
    interiorMask,
    serviceStructures,
    structureBlockedMask,
    state.rampart_controller
  );
  placeMincutRamparts(
    input,
    winner.mincutTiles,
    serviceStructures,
    structureBlockedMask,
    state.rampart_mincut
  );
  placeGlidRamparts(
    allStructures,
    serviceStructures,
    structureBlockedMask,
    state.rampart_glid
  );
  placeRoadProtectionRamparts(
    allRoads,
    interiorMask,
    mincutMask,
    mincutRange2Mask,
    serviceStructures,
    structureBlockedMask,
    state.rampart_road
  );
}

/**
 * @param {PlannerInput & { type: number }} input
 * @param {Uint8Array} interiorMask
 * @param {{ token: string, type: string, index: number, point: RoomPoint }[]} structures
 * @param {Uint8Array} structureBlockedMask
 * @param {{ nextIndex: number, seen: Set<number>, tokenPrefix: string }} state
 */
function placeControllerRamparts(
  input,
  interiorMask,
  structures,
  structureBlockedMask,
  state
) {
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) {
        continue;
      }
      const x = input.controller_pos.x + dx;
      const y = input.controller_pos.y + dy;
      if (!isInsideRoom(x, y)) {
        continue;
      }
      if (input.terrain.get(x, y) & TERRAIN_MASK_WALL) {
        continue;
      }
      const index = y * 50 + x;
      if (interiorMask[index]) {
        continue;
      }
      addRampartStructure(
        structures,
        structureBlockedMask,
        "rampart_controller",
        { x, y },
        state
      );
    }
  }
}

/**
 * @param {PlannerInput & { type: number }} input
 * @param {RoomPoint[]} mincutTiles
 * @param {{ token: string, type: string, index: number, point: RoomPoint }[]} structures
 * @param {Uint8Array} structureBlockedMask
 * @param {{ nextIndex: number, seen: Set<number>, tokenPrefix: string }} state
 */
function placeMincutRamparts(
  input,
  mincutTiles,
  structures,
  structureBlockedMask,
  state
) {
  for (let i = 0; i < mincutTiles.length; i += 1) {
    const point = mincutTiles[i];
    if (input.terrain.get(point.x, point.y) & TERRAIN_MASK_WALL) {
      continue;
    }
    addRampartStructure(
      structures,
      structureBlockedMask,
      "rampart_mincut",
      point,
      state
    );
  }
}

/**
 * @param {{ token: string, type: string, index: number, point: RoomPoint }[]} allStructures
 * @param {{ token: string, type: string, index: number, point: RoomPoint }[]} structures
 * @param {Uint8Array} structureBlockedMask
 * @param {{ nextIndex: number, seen: Set<number>, tokenPrefix: string }} state
 */
function placeGlidRamparts(
  allStructures,
  structures,
  structureBlockedMask,
  state
) {
  const protectedTypes = new Set([
    "spawn",
    "storage",
    "terminal",
    "factory",
    "tower",
    "nuker",
    "powerSpawn",
    "lab",
  ]);
  for (let i = 0; i < allStructures.length; i += 1) {
    const structure = allStructures[i];
    if (!protectedTypes.has(structure.type)) {
      continue;
    }
    addRampartStructure(
      structures,
      structureBlockedMask,
      "rampart_glid",
      structure.point,
      state
    );
  }
}

/**
 * @param {RoomPoint[]} roads
 * @param {Uint8Array} interiorMask
 * @param {Uint8Array} mincutMask
 * @param {Uint8Array} mincutRange2Mask
 * @param {{ token: string, type: string, index: number, point: RoomPoint }[]} structures
 * @param {Uint8Array} structureBlockedMask
 * @param {{ nextIndex: number, seen: Set<number>, tokenPrefix: string }} state
 */
function placeRoadProtectionRamparts(
  roads,
  interiorMask,
  mincutMask,
  mincutRange2Mask,
  structures,
  structureBlockedMask,
  state
) {
  for (let i = 0; i < roads.length; i += 1) {
    const point = roads[i];
    const index = point.y * 50 + point.x;
    if (!interiorMask[index]) {
      continue;
    }
    if (mincutMask[index]) {
      continue;
    }
    if (!mincutRange2Mask[index]) {
      continue;
    }
    addRampartStructure(
      structures,
      structureBlockedMask,
      "rampart_road",
      point,
      state
    );
  }
}

/**
 * @param {RoomPoint[]} mincutTiles
 * @param {number} range
 * @returns {Uint8Array}
 */
function buildMincutRangeMask(mincutTiles, range) {
  const mask = new Uint8Array(2500);
  for (let i = 0; i < mincutTiles.length; i += 1) {
    const point = mincutTiles[i];
    for (let dy = -range; dy <= range; dy += 1) {
      for (let dx = -range; dx <= range; dx += 1) {
        const x = point.x + dx;
        const y = point.y + dy;
        if (!isInsideRoom(x, y)) {
          continue;
        }
        mask[y * 50 + x] = 1;
      }
    }
  }
  return mask;
}

/**
 * @param {{ hub: CorePlacement, fastfiller: CorePlacement }} corePlan
 * @param {RoomPoint[]} serviceRoads
 * @returns {RoomPoint[]}
 */
function collectAllRoads(corePlan, serviceRoads) {
  const allRoads = [];
  const seen = new Set();
  const coreRoads = corePlan.hub.roads.concat(corePlan.fastfiller.roads);
  const sources = [coreRoads, serviceRoads];
  for (let i = 0; i < sources.length; i += 1) {
    const roads = sources[i];
    for (let j = 0; j < roads.length; j += 1) {
      const point = roads[j];
      const packed = packMincutPosToVertex(point.x, point.y);
      if (seen.has(packed)) {
        continue;
      }
      seen.add(packed);
      allRoads.push(point);
    }
  }
  return allRoads;
}

/**
 * @param {{ hub: CorePlacement, fastfiller: CorePlacement }} corePlan
 * @param {{ token: string, type: string, index: number, point: RoomPoint }[]} serviceStructures
 * @returns {{ token: string, type: string, index: number, point: RoomPoint }[]}
 */
function collectAllStructures(corePlan, serviceStructures) {
  return corePlan.hub.structures
    .concat(corePlan.fastfiller.structures)
    .concat(serviceStructures);
}

/**
 * @param {{ token: string, type: string, index: number, point: RoomPoint }[]} structures
 * @param {Uint8Array} structureBlockedMask
 * @param {"rampart_controller" | "rampart_mincut" | "rampart_glid" | "rampart_road"} type
 * @param {RoomPoint} point
 * @param {{ nextIndex: number, seen: Set<number>, tokenPrefix: string }} state
 */
function addRampartStructure(
  structures,
  structureBlockedMask,
  type,
  point,
  state
) {
  const packed = packMincutPosToVertex(point.x, point.y);
  if (state.seen.has(packed)) {
    return;
  }
  state.seen.add(packed);
  const index = state.nextIndex;
  state.nextIndex += 1;
  addPlacedStructure(
    structures,
    structureBlockedMask,
    `${state.tokenPrefix}${index}`,
    type,
    index,
    point
  );
}

/**
 * @param {RoomPoint} start
 * @param {RoomPoint} target
 * @param {number} range
 * @param {PlannerInput & { type: number }} input
 * @param {Uint8Array} blockedMask
 * @param {Uint8Array} roadMask
 * @param {Uint8Array | undefined} [extensionRoadMask]
 * @returns {number}
 */

module.exports = {
  planStep2ServiceSites,
  getStructurePointByToken,
  selectUpgraderTile,
  countAdjacentWalkableTiles,
  selectBestAdjacentTileByPath,
  selectSourceContainerByRoad,
  selectSourceRoadApproach,
  selectLinkAdjacentToContainer,
  distanceToNearestRoad,
  addMincutRoads,
  connectRoadGroupsToHub,
  selectHubRoadAnchor,
  findRoadGroupContainingPoint,
  selectClosestDisconnectedRoadTile,
  buildFinalRoadConnectionAreaMask,
  buildMaskedRoadMask,
  markRoadMask,
  buildFinalRoadConnectionBlockedMask,
  buildStructureTypeMask,
  replaceExtensionsConsumedByRoadPath,
  findStructureAtPoint,
  selectObserverTile,
  buildPlacedOccupiedMask,
  buildPlacedImpassibleMask,
  isPlannedStructureImpassible,
  buildReachableMaskFromStorage,
  hasAdjacentReachableTile,
  placeStep2Ramparts,
  placeControllerRamparts,
  placeMincutRamparts,
  placeGlidRamparts,
  placeRoadProtectionRamparts,
  buildMincutRangeMask,
  collectAllRoads,
  collectAllStructures,
  addRampartStructure,
};
