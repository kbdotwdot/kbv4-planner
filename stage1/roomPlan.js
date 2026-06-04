const { packPoints, unpackPoints, pointsToMask, maskToPoints } = require("../lib/mask");
const { buildInteriorBuildableMask, hasConnectedInterior } = require("./evaluate");
const { ROOM_PLAN_MINCUT_DONE, ROOM_PLAN_STEP2_DONE } = require("../constants");

function readStoredRoomPlan(roomName) {
  if (typeof roomName !== "string" || roomName.length === 0) {
    return null;
  }

  if (!Memory.roomPlan || !Memory.roomPlan[roomName]) {
    return null;
  }

  return Memory.roomPlan[roomName];
}

/**
 * @param {string | null} roomName
 * @param {SeedEvaluation} winner
 */

function storeWinnerRoomPlan(roomName, winner) {
  if (typeof roomName !== "string" || roomName.length === 0 || !winner) {
    return;
  }

  if (!Memory.roomPlan) {
    Memory.roomPlan = {};
  }

  const existingPlan =
    Memory.roomPlan[roomName] &&
    typeof Memory.roomPlan[roomName] === "object" &&
    !Array.isArray(Memory.roomPlan[roomName])
      ? Memory.roomPlan[roomName]
      : {};

  Memory.roomPlan[roomName] = {
    ...existingPlan,
    a: ROOM_PLAN_MINCUT_DONE,
    b: packPoints(winner.mincutTiles),
    c: packPoints(winner.interiorTiles),
  };

  delete Memory.roomPlan[roomName].stage1Progress;
}

/**
 * @param {RoomPlanCompact | null} compact
 * @returns {SeedEvaluation | null}
 */

function isRoomPlanStep2Complete(compact) {
  return !!compact && compact.a === ROOM_PLAN_STEP2_DONE;
}

/**
 * @param {string} roomName
 */

function markRoomPlanStep2Complete(roomName) {
  if (typeof roomName !== "string" || roomName.length === 0) {
    return;
  }

  if (!Memory.roomPlan || !Memory.roomPlan[roomName]) {
    return;
  }

  Memory.roomPlan[roomName].a = ROOM_PLAN_STEP2_DONE;
}

/**
 * @param {RoomPlanCompact | null} compact
 * @returns {SeedEvaluation | null}
 */

function restoreWinnerFromRoomPlan(compact) {
  if (
    !compact ||
    (compact.a !== ROOM_PLAN_MINCUT_DONE && compact.a !== ROOM_PLAN_STEP2_DONE) ||
    !Array.isArray(compact.b) ||
    !Array.isArray(compact.c)
  ) {
    return null;
  }

  const mincutTiles = unpackPoints(compact.b);
  const interiorTiles = unpackPoints(compact.c);
  const buildableMask = buildInteriorBuildableMask(
    pointsToMask(interiorTiles),
    pointsToMask(mincutTiles)
  );

  const winner = {
    ok: true,
    seed: { id: 0, anchor: { x: 0, y: 0 }, tiles: [], score: 0 },
    tries: 0,
    protectedTiles: [],
    mincutTiles,
    interiorTiles,
    buildableTiles: maskToPoints(buildableMask),
    placements: null,
  };

  if (!hasConnectedInterior(winner)) {
    return null;
  }

  return winner;
}

/**
 * @param {RoomPlanCompact | null} compact
 * @returns {Stage1Progress | null}
 */
function readStage1Progress(compact) {
  if (
    !compact ||
    typeof compact.stage1Progress !== "object" ||
    !compact.stage1Progress ||
    Array.isArray(compact.stage1Progress)
  ) {
    return null;
  }

  const progress = compact.stage1Progress;
  if (
    !Array.isArray(progress.seeds) ||
    (!Array.isArray(progress.seedStats) && !Array.isArray(progress.evaluations)) ||
    !Number.isFinite(progress.nextIndex)
  ) {
    return null;
  }

  const nextIndex = Math.max(
    0,
    Math.min(progress.seeds.length, Math.floor(progress.nextIndex))
  );

  return {
    seeds: progress.seeds,
    seedStats: Array.isArray(progress.seedStats)
      ? progress.seedStats
      : progress.evaluations.map((evaluation) => ({
          seedId: evaluation.seed.id,
          mincutTiles: Array.isArray(evaluation.mincutTiles) ? evaluation.mincutTiles.length : 0,
          controllerAdjacentProtected: false,
          interiorConnected: hasConnectedInterior(evaluation),
        })),
    nextIndex,
  };
}

/**
 * @param {string} roomName
 * @param {Stage1Progress} progress
 */
function storeStage1Progress(roomName, progress) {
  if (
    typeof roomName !== "string" ||
    roomName.length === 0 ||
    !progress ||
    !Array.isArray(progress.seeds) ||
    !Array.isArray(progress.seedStats) ||
    !Number.isFinite(progress.nextIndex)
  ) {
    return;
  }

  if (!Memory.roomPlan) {
    Memory.roomPlan = {};
  }

  const existingPlan =
    Memory.roomPlan[roomName] &&
    typeof Memory.roomPlan[roomName] === "object" &&
    !Array.isArray(Memory.roomPlan[roomName])
      ? Memory.roomPlan[roomName]
      : {};

  const nextIndex = Math.max(0, Math.min(progress.seeds.length, Math.floor(progress.nextIndex)));
  Memory.roomPlan[roomName] = {
    ...existingPlan,
    stage1Progress: {
      seeds: progress.seeds,
      seedStats: progress.seedStats,
      nextIndex,
    },
  };
}

/**
 * @param {string} roomName
 */
function clearStage1Progress(roomName) {
  if (
    typeof roomName !== "string" ||
    roomName.length === 0 ||
    !Memory.roomPlan ||
    !Memory.roomPlan[roomName]
  ) {
    return;
  }

  delete Memory.roomPlan[roomName].stage1Progress;
}

module.exports = {
  readStoredRoomPlan,
  storeWinnerRoomPlan,
  restoreWinnerFromRoomPlan,
  isRoomPlanStep2Complete,
  markRoomPlanStep2Complete,
  readStage1Progress,
  storeStage1Progress,
  clearStage1Progress,
};
