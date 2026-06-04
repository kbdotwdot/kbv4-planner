const { pointsToMask, isWithinRangeOfMask } = require("../lib/mask");

function buildWinnerNonBuildableMask(winner) {
  const nonBuildableMask = pointsToMask(winner.interiorTiles);
  for (let i = 0; i < winner.buildableTiles.length; i += 1) {
    const point = winner.buildableTiles[i];
    nonBuildableMask[point.y * 50 + point.x] = 0;
  }
  return nonBuildableMask;
}

/**
 * @param {SeedEvaluation} winner
 * @returns {Uint8Array}
 */

function buildRoutingNonBuildableMask(winner) {
  const mask = buildWinnerNonBuildableMask(winner);
  for (let i = 0; i < winner.mincutTiles.length; i += 1) {
    const point = winner.mincutTiles[i];
    mask[point.y * 50 + point.x] = 0;
  }
  return mask;
}

/**
 * @param {CorePlacement} placement
 * @param {string} token
 * @returns {RoomPoint | null}
 */

module.exports = {
  buildWinnerNonBuildableMask,
  buildRoutingNonBuildableMask,
};
