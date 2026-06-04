const { packMincutPosToVertex } = require("../lib/mask");
const { chebyshevDistance, filterArray } = require("../lib/geo");
const { addPlacedStructure } = require("./persist");
const { STEP2_TOWER_COUNT } = require("../constants");

function planStep2Towers(
  winner,
  walkableMask,
  placementBlockedMask,
  structureBlockedMask,
  structures
) {
  if (!Array.isArray(winner.mincutTiles) || winner.mincutTiles.length === 0) {
    return false;
  }

  const towerCandidates = filterArray(winner.buildableTiles, (point) => {
    const index = point.y * 50 + point.x;
    return walkableMask[index] && !placementBlockedMask[index] && !structureBlockedMask[index];
  });

  if (towerCandidates.length < STEP2_TOWER_COUNT) {
    return false;
  }

  const mincutCoverage = new Int32Array(winner.mincutTiles.length);

  for (let towerIndex = 1; towerIndex <= STEP2_TOWER_COUNT; towerIndex += 1) {
    const bestCandidateIndex = selectBestTowerCandidateIndex(
      towerCandidates,
      winner.mincutTiles,
      mincutCoverage,
      towerIndex === 1
    );
    if (bestCandidateIndex === -1) {
      return false;
    }

    const point = towerCandidates[bestCandidateIndex];
    towerCandidates.splice(bestCandidateIndex, 1);
    addPlacedStructure(
      structures,
      structureBlockedMask,
      `d${towerIndex}`,
      "tower",
      towerIndex,
      point
    );
    placementBlockedMask[point.y * 50 + point.x] = 1;
    applyTowerDamageCoverageToMincut(mincutCoverage, winner.mincutTiles, point);
  }

  return true;
}

/**
 * @param {PlannerInput & { type: number }} input
 * @param {SeedEvaluation} winner
 * @param {Uint8Array} walkableMask
 * @param {RoomPoint} storagePoint
 * @param {{ token: string, type: string, index: number, point: RoomPoint }[]} structures
 * @param {RoomPoint[]} roads
 * @param {Uint8Array} placementBlockedMask
 * @param {Uint8Array} structureBlockedMask
 * @param {Uint8Array} roadMask
 * @param {Set<number>} blockedTileSet
 * @returns {boolean}
 */

function selectBestTowerCandidateIndex(candidates, mincutTiles, mincutCoverage, firstTower) {
  if (firstTower) {
    let bestCandidateIndex = -1;
    let bestAverageDistance = Infinity;
    let bestPacked = Infinity;
    for (let i = 0; i < candidates.length; i += 1) {
      const point = candidates[i];
      const averageDistance = getAverageMincutDistance(point, mincutTiles);
      const packed = packMincutPosToVertex(point.x, point.y);
      if (
        averageDistance < bestAverageDistance ||
        (averageDistance === bestAverageDistance && packed < bestPacked)
      ) {
        bestCandidateIndex = i;
        bestAverageDistance = averageDistance;
        bestPacked = packed;
      }
    }
    return bestCandidateIndex;
  }

  const weakestMincutIndex = getWeakestMincutIndex(mincutCoverage, mincutTiles);
  if (weakestMincutIndex === -1) {
    return -1;
  }

  const weakestMincut = mincutTiles[weakestMincutIndex];
  let minRangeToWeakest = Infinity;
  for (let i = 0; i < candidates.length; i += 1) {
    const range = chebyshevDistance(candidates[i], weakestMincut);
    if (range < minRangeToWeakest) {
      minRangeToWeakest = range;
    }
  }
  if (minRangeToWeakest === Infinity) {
    return -1;
  }

  const maxAcceptedRange = minRangeToWeakest + 1;
  let bestCandidateIndex = -1;
  let bestAverageDistance = Infinity;
  let bestWeakestRange = Infinity;
  let bestPacked = Infinity;

  for (let i = 0; i < candidates.length; i += 1) {
    const point = candidates[i];
    const weakestRange = chebyshevDistance(point, weakestMincut);
    if (weakestRange > maxAcceptedRange) {
      continue;
    }

    const averageDistance = getAverageMincutDistance(point, mincutTiles);
    const packed = packMincutPosToVertex(point.x, point.y);
    if (
      averageDistance < bestAverageDistance ||
      (averageDistance === bestAverageDistance &&
        (weakestRange < bestWeakestRange ||
          (weakestRange === bestWeakestRange && packed < bestPacked)))
    ) {
      bestCandidateIndex = i;
      bestAverageDistance = averageDistance;
      bestWeakestRange = weakestRange;
      bestPacked = packed;
    }
  }

  return bestCandidateIndex;
}

/**
 * @param {Int32Array} mincutCoverage
 * @param {RoomPoint[]} mincutTiles
 * @returns {number}
 */

function getWeakestMincutIndex(mincutCoverage, mincutTiles) {
  let leastCoverage = Infinity;
  let bestMincutIndex = -1;
  let bestPacked = Infinity;
  for (let i = 0; i < mincutCoverage.length; i += 1) {
    const coverage = mincutCoverage[i];
    const mincutTile = mincutTiles[i];
    const packed = packMincutPosToVertex(mincutTile.x, mincutTile.y);
    if (
      coverage < leastCoverage ||
      (coverage === leastCoverage && packed < bestPacked)
    ) {
      leastCoverage = mincutCoverage[i];
      bestMincutIndex = i;
      bestPacked = packed;
    }
  }
  return bestMincutIndex;
}

/**
 * @param {RoomPoint} point
 * @param {RoomPoint[]} mincutTiles
 * @returns {number}
 */

function getAverageMincutDistance(point, mincutTiles) {
  if (!mincutTiles.length) {
    return Infinity;
  }
  let totalDistance = 0;
  for (let i = 0; i < mincutTiles.length; i += 1) {
    totalDistance += chebyshevDistance(point, mincutTiles[i]);
  }
  return totalDistance / mincutTiles.length;
}

/**
 * @param {number} range
 * @returns {number}
 */

function getTowerDamageAtRange(range) {
  if (range <= 5) {
    return 600;
  }
  if (range >= 20) {
    return 150;
  }
  return 600 - (range - 5) * 30;
}

/**
 * @param {Int32Array} mincutCoverage
 * @param {RoomPoint[]} mincutTiles
 * @param {RoomPoint} towerPoint
 */

function applyTowerDamageCoverageToMincut(mincutCoverage, mincutTiles, towerPoint) {
  for (let i = 0; i < mincutTiles.length; i += 1) {
    mincutCoverage[i] += getTowerDamageAtRange(
      chebyshevDistance(towerPoint, mincutTiles[i])
    );
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
 * @param {{ token: string, type: string, index: number, point: RoomPoint }[]} structures
 * @param {RoomPoint[]} roads
 * @param {Set<number>} blockedTileSet
 * @returns {boolean}
 */

module.exports = {
  planStep2Towers,
  selectBestTowerCandidateIndex,
  getWeakestMincutIndex,
  getAverageMincutDistance,
  getTowerDamageAtRange,
  applyTowerDamageCoverageToMincut,
};
