const { isInsideRoom } = require("../lib/mask");
const { LARGE_AREA_RADIUS, LARGE_CORE_RADIUS, SMALL_AREA_RADIUS, SMALL_CORE_RADIUS } = require("../constants");

function findAreaCandidates(interiorMask, buildableMask, areaRadius, coreRadius) {
  /** @type {{ center: RoomPoint }[]} */
  const candidates = [];

  for (let y = areaRadius; y <= 49 - areaRadius; y += 1) {
    for (let x = areaRadius; x <= 49 - areaRadius; x += 1) {
      if (
        !areaFitsInterior(interiorMask, x, y, areaRadius) ||
        !coreFitsBuildable(buildableMask, x, y, coreRadius)
      ) {
        continue;
      }

      candidates.push({ center: { x, y } });
    }
  }

  return candidates;
}

/**
 * @param {Uint8Array} interiorMask
 * @param {number} centerX
 * @param {number} centerY
 * @param {number} radius
 * @returns {boolean}
 */

function areaFitsInterior(interiorMask, centerX, centerY, radius) {
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (Math.abs(dx) === radius && Math.abs(dy) === radius) {
        continue;
      }

      const x = centerX + dx;
      const y = centerY + dy;
      if (!interiorMask[y * 50 + x]) {
        return false;
      }
    }
  }

  return true;
}

/**
 * @param {Uint8Array} buildableMask
 * @param {number} centerX
 * @param {number} centerY
 * @param {number} radius
 * @returns {boolean}
 */

function coreFitsBuildable(buildableMask, centerX, centerY, radius) {
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const x = centerX + dx;
      const y = centerY + dy;
      if (!buildableMask[y * 50 + x]) {
        return false;
      }
    }
  }

  return true;
}

/**
 * @param {RoomPoint} center
 * @param {number} radius
 * @param {Uint8Array} buildableMask
 * @returns {Uint8Array}
 */

function createCoreMask(center, radius, buildableMask) {
  const coreMask = new Uint8Array(2500);

  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const x = center.x + dx;
      const y = center.y + dy;
      if (!isInsideRoom(x, y) || !buildableMask[y * 50 + x]) {
        continue;
      }
      coreMask[y * 50 + x] = 1;
    }
  }

  return coreMask;
}

/**
 * @param {Uint8Array} maskA
 * @param {Uint8Array} maskB
 * @returns {boolean}
 */

function coreMasksOverlap(maskA, maskB) {
  for (let index = 0; index < 2500; index += 1) {
    if (maskA[index] && maskB[index]) {
      return true;
    }
  }

  return false;
}

/**
 * @param {Uint8Array} initialProtectedMask
 * @param {Uint8Array} protectedMask
 * @param {Uint8Array} passableMask
 * @param {Uint8Array} sourceBlockedMask
 * @param {Uint8Array} interiorMask
 * @param {Uint8Array} mincutMask
 * @param {number} currentMincutCount
 * @param {CostMatrix} costMatrix
 * @returns {Uint8Array | null}
 */

module.exports = {
  findAreaCandidates,
  areaFitsInterior,
  coreFitsBuildable,
  createCoreMask,
  coreMasksOverlap,
};
