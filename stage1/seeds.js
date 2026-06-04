const { buildWallDistanceMap } = require("../lib/terrain");
const { MAX_DISTANCE, SEED_DISTANCE, SEED_RANGE } = require("../constants");

function extractSeedsFromDistanceMap(distances) {
  /** @type {Seed[]} */
  const seeds = [];
  const usedAnchors = new Uint8Array(2500);
  let seedId = 1;

  for (let y = 0; y < 50; y += 1) {
    for (let x = 0; x < 50; x += 1) {
      const anchorIndex = y * 50 + x;
      if (
        distances[anchorIndex] !== SEED_DISTANCE ||
        usedAnchors[anchorIndex]
      ) {
        continue;
      }

      /** @type {RoomPoint[]} */
      const tiles = [];
      for (let dy = -SEED_RANGE; dy <= SEED_RANGE; dy += 1) {
        for (let dx = -SEED_RANGE; dx <= SEED_RANGE; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx > 49 || ny < 0 || ny > 49) {
            continue;
          }
          if (Math.max(Math.abs(dx), Math.abs(dy)) > SEED_RANGE) {
            continue;
          }

          const tileIndex = ny * 50 + nx;
          const distance = distances[tileIndex];
          if (distance === 0 || distance >= MAX_DISTANCE) {
            continue;
          }

          tiles.push({ x: nx, y: ny });
        }
      }

      if (tiles.length === 0) {
        continue;
      }

      usedAnchors[anchorIndex] = 1;
      const score = scoreSeedTiles(tiles, distances);

      seeds.push({
        id: seedId,
        anchor: { x, y },
        tiles,
        score,
      });
      seedId += 1;
    }
  }

  return seeds;
}

/**
 * @param {RoomPoint[]} tiles
 * @param {Uint8Array} distances
 * @returns {number}
 */

function scoreSeedTiles(tiles, distances) {
  let score = 0;
  for (let i = 0; i < tiles.length; i += 1) {
    const tile = tiles[i];
    score += distances[tile.y * 50 + tile.x];
  }
  return score;
}

/**
 * @param {Seed} candidate
 * @param {Seed} current
 * @returns {boolean}
 */

function isBetterSeed(candidate, current) {
  if (candidate.score !== current.score) {
    return candidate.score > current.score;
  }
  if (candidate.tiles.length !== current.tiles.length) {
    return candidate.tiles.length > current.tiles.length;
  }
  if (candidate.anchor.y !== current.anchor.y) {
    return candidate.anchor.y < current.anchor.y;
  }
  return candidate.anchor.x < current.anchor.x;
}

/**
 * @param {Seed[]} seeds
 * @param {string | null} roomName
 */

module.exports = {
  extractSeedsFromDistanceMap,
  scoreSeedTiles,
  isBetterSeed,
};
