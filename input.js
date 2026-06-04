function normalizePlannerInput(input) {
  if (!input) {
    throw new Error("planner input is required");
  }

  const {
    source1_pos,
    source2_pos = null,
    controller_pos,
    mineral_pos,
    terrain,
    spawn1_pos = null,
    roomName = null,
    type = 1,
  } = input;

  assertPoint(source1_pos, "source1_pos");
  assertNullablePoint(source2_pos, "source2_pos");
  assertPoint(controller_pos, "controller_pos");
  assertPoint(mineral_pos, "mineral_pos");
  assertNullablePoint(spawn1_pos, "spawn1_pos");

  if (!terrain || typeof terrain.get !== "function") {
    throw new Error("terrain must be a Room.Terrain instance");
  }

  if (type == null || !Number.isFinite(type)) {
    throw new Error("type must be a finite number when provided");
  }

  if (roomName != null && typeof roomName !== "string") {
    throw new Error("roomName must be a string when provided");
  }

  return {
    source1_pos,
    source2_pos,
    controller_pos,
    mineral_pos,
    terrain,
    spawn1_pos,
    roomName,
    type: +type,
  };
}

/**
 * @param {RoomPoint} point
 * @param {string} label
 */

function assertPoint(point, label) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new Error(`${label} must be an object with numeric x and y`);
  }
}

/**
 * @param {RoomPoint | null} point
 * @param {string} label
 */

function assertNullablePoint(point, label) {
  if (point !== null) {
    assertPoint(point, label);
  }
}

/**
 * Step 1: distance transform from walls + exit buffer.
 *
 * @param {Room.Terrain} terrain
 * @returns {Uint8Array}
 */

module.exports = {
  normalizePlannerInput,
  assertPoint,
  assertNullablePoint,
};
