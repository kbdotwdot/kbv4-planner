const { EIGHT_NEIGHBOR_VECTORS } = require("../constants");

function isInsideRoom(x, y) {
  return x >= 0 && x <= 49 && y >= 0 && y <= 49;
}

/**
 * @param {RoomPoint[]} points
 * @returns {Uint8Array}
 */

function pointsToMask(points) {
  const mask = new Uint8Array(2500);
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    if (isInsideRoom(point.x, point.y)) {
      mask[point.y * 50 + point.x] = 1;
    }
  }
  return mask;
}

/**
 * @param {Uint8Array} mask
 * @returns {RoomPoint[]}
 */

function maskToPoints(mask) {
  /** @type {RoomPoint[]} */
  const points = [];
  for (let index = 0; index < 2500; index += 1) {
    if (!mask[index]) {
      continue;
    }
    const x = index % 50;
    const y = (index - x) / 50;
    points.push({ x, y });
  }
  return points;
}

/**
 * @param {Uint8Array} mask
 * @returns {number}
 */

function countMask(mask) {
  let count = 0;
  for (let i = 0; i < 2500; i += 1) {
    count += mask[i];
  }
  return count;
}

/**
 * @param {Uint8Array} mask
 * @returns {Uint8Array}
 */

function cloneMask(mask) {
  return new Uint8Array(mask);
}

/**
 * @param {Uint8Array} left
 * @param {Uint8Array} right
 * @returns {boolean}
 */

function masksEqual(left, right) {
  for (let i = 0; i < 2500; i += 1) {
    if (left[i] !== right[i]) {
      return false;
    }
  }
  return true;
}

/**
 * @param {SeedEvaluation | null} evaluation
 * @param {string | null} roomName
 */

function packPoints(points) {
  /** @type {number[]} */
  const packed = [];
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    packed.push(packMincutPosToVertex(point.x, point.y));
  }
  return packed;
}

/**
 * @param {number[]} packedPoints
 * @returns {RoomPoint[]}
 */

function unpackPoints(packedPoints) {
  /** @type {RoomPoint[]} */
  const points = [];
  for (let i = 0; i < packedPoints.length; i += 1) {
    const packedPoint = packedPoints[i];
    points.push(unpackMincutVertexToPos(packedPoint));
  }
  return points;
}

/**
 * @param {SeedEvaluation[]} evaluations
 * @param {SeedEvaluation | null} winner
 * @param {string | null} roomName
 */

function packMincutPosToVertex(x, y) {
  return (y << 6) | x;
}

/**
 * @param {number} vertex
 * @returns {RoomPoint}
 */

function unpackMincutVertexToPos(vertex) {
  return { x: vertex & 0x3f, y: vertex >> 6 };
}

/**
 * @param {RoomPoint} pos
 * @param {RoomPoint} vector
 * @returns {RoomPoint}
 */

function getConnectedMaskGroups(mask) {
  const seen = new Uint8Array(2500);
  /** @type {number[][]} */
  const groups = [];

  for (let index = 0; index < 2500; index += 1) {
    if (!mask[index] || seen[index]) {
      continue;
    }

    /** @type {number[]} */
    const group = [];
    /** @type {number[]} */
    const queue = [index];
    seen[index] = 1;
    let head = 0;

    while (head < queue.length) {
      const current = queue[head];
      const x = current % 50;
      const y = (current - x) / 50;
      head += 1;
      group.push(current);

      for (let i = 0; i < EIGHT_NEIGHBOR_VECTORS.length; i += 1) {
        const vector = EIGHT_NEIGHBOR_VECTORS[i];
        const nx = x + vector.x;
        const ny = y + vector.y;
        if (!isInsideRoom(nx, ny)) {
          continue;
        }

        const nextIndex = ny * 50 + nx;
        if (!mask[nextIndex] || seen[nextIndex]) {
          continue;
        }

        seen[nextIndex] = 1;
        queue.push(nextIndex);
      }
    }

    groups.push(group);
  }

  return groups;
}

/**
 * @param {number} x
 * @param {number} y
 * @param {Uint8Array} mask
 * @param {number} range
 * @returns {boolean}
 */

function isWithinRangeOfMask(x, y, mask, range) {
  for (let dy = -range; dy <= range; dy += 1) {
    for (let dx = -range; dx <= range; dx += 1) {
      const nx = x + dx;
      const ny = y + dy;
      if (!isInsideRoom(nx, ny)) {
        continue;
      }

      if (mask[ny * 50 + nx]) {
        return true;
      }
    }
  }

  return false;
}

/**
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */

function countAddedMaskTiles(baseMask, nextMask) {
  let added = 0;
  for (let index = 0; index < 2500; index += 1) {
    if (!baseMask[index] && nextMask[index]) {
      added += 1;
    }
  }
  return added;
}

/**
 * @param {Uint8Array} initialProtectedMask
 * @param {Uint8Array} interiorMask
 * @param {number[]} borderGroup
 * @returns {Uint8Array}
 */

module.exports = {
  isInsideRoom,
  pointsToMask,
  maskToPoints,
  countMask,
  cloneMask,
  masksEqual,
  packPoints,
  unpackPoints,
  packMincutPosToVertex,
  unpackMincutVertexToPos,
  getConnectedMaskGroups,
  isWithinRangeOfMask,
  countAddedMaskTiles,
};
