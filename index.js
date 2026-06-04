const { normalizePlannerInput } = require("./input");
const {
  DEBUG_VISUALIZE_DISTANCE_TRANSFORM,
  DEBUG_VISUALIZE_MINCUT_AND_INTERIOR,
  DEBUG_VISUALIZE_ALTERNATIVE_MINCUTS,
  DEBUG_VISUALIZE_SEEDS,
  DEBUG_VISUALIZE_PROGRESS,
  DEBUG_VISUALIZE_STEP2_CORES,
} = require("./constants");
const { ROOM_PLAN_LAYOUT_KEYS } = require("./layouts");
const {
  buildWallDistanceMap,
  buildPassableMask,
  buildExitRangeMask,
  buildMincutCostMatrix,
} = require("./lib/terrain");
const { extractSeedsFromDistanceMap } = require("./stage1/seeds");
const {
  evaluateSeed,
  hasConnectedInterior,
  hasControllerAdjacentProtected,
} = require("./stage1/evaluate");
const {
  MINCUT_EXIT_BLOCK_RANGE,
  MINCUT_SOURCE_EXIT_RANGE,
} = require("./constants");
const {
  readStoredRoomPlan,
  storeWinnerRoomPlan,
  restoreWinnerFromRoomPlan,
  isRoomPlanStep2Complete,
  markRoomPlanStep2Complete,
  readStage1Progress,
  storeStage1Progress,
  clearStage1Progress,
} = require("./stage1/roomPlan");
const { planStep2Cores } = require("./step2/corePlacement");
const { planStep2ServiceSites } = require("./step2/serviceSites");
const { removeStep2TilesFromBuildable } = require("./step2/persist");
const {
  visualizeDistanceMap,
  visualizeSeeds,
  visualizeMincutEvaluation,
  visualizeAlternativeMincuts,
  visualizeStep2Cores,
  visualizePlannerProgress,
} = require("./debug/visualize");

const STAGE1_CPU_BUDGET = 300;
const STAGE1_MIN_BUCKET = 500;

/**
 * @param {{ seedId: number, mincutTiles: number, controllerAdjacentProtected: boolean, interiorConnected: boolean }[]} seedStats
 * @returns {number}
 */
function pickBestSeedIdFromStats(seedStats) {
  const valid = seedStats.filter(
    (stat) => stat.mincutTiles > 0 && stat.interiorConnected === true
  );
  if (!valid.length) {
    return 0;
  }

  let leastMincut = valid[0].mincutTiles;
  for (let i = 1; i < valid.length; i += 1) {
    if (valid[i].mincutTiles < leastMincut) {
      leastMincut = valid[i].mincutTiles;
    }
  }

  const maxPreferredMincut = leastMincut + 10;
  const preferred = valid.filter(
    (stat) =>
      stat.controllerAdjacentProtected && stat.mincutTiles <= maxPreferredMincut
  );
  const candidates = preferred.length > 0 ? preferred : valid;

  let best = candidates[0];
  for (let i = 1; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    if (candidate.mincutTiles < best.mincutTiles) {
      best = candidate;
      continue;
    }
    if (candidate.mincutTiles === best.mincutTiles && candidate.seedId < best.seedId) {
      best = candidate;
    }
  }

  return best.seedId;
}

/**
 * @param {object} fields
 * @returns {object}
 */
/**
 * @param {string} roomName
 * @param {{
 *   phase: string,
 *   seedsDone?: number,
 *   seedsTotal?: number,
 *   processedThisTick?: number,
 * }} progress
 */
function maybeVisualizeProgress(roomName, progress) {
  if (!DEBUG_VISUALIZE_PROGRESS || !progress) {
    return;
  }
  visualizePlannerProgress(roomName, progress);
}

function buildPlannerResult(fields) {
  return {
    ok: false,
    input: null,
    distances: undefined,
    seeds: [],
    evaluations: [],
    winner: null,
    corePlan: null,
    servicePlan: null,
    cached: false,
    mincutDone: false,
    step2Done: false,
    step2CoreDone: false,
    stage1InProgress: false,
    stage1Processed: 0,
    ...fields,
  };
}

function planner(input) {
  const normalizedInput = normalizePlannerInput(input);
  const storedRoomPlan = readStoredRoomPlan(normalizedInput.roomName);

  if (isRoomPlanStep2Complete(storedRoomPlan)) {
    const cachedWinner = restoreWinnerFromRoomPlan(storedRoomPlan);
    maybeVisualizeProgress(normalizedInput.roomName, {
      phase: "complete",
    });
    return buildPlannerResult({
      ok: !!cachedWinner,
      input: normalizedInput,
      winner: cachedWinner,
      cached: true,
      mincutDone: !!cachedWinner,
      step2Done: true,
      step2CoreDone: true,
    });
  }

  let winner = restoreWinnerFromRoomPlan(storedRoomPlan);
  let cached = !!winner;
  /** @type {Uint8Array | undefined} */
  let distances;
  /** @type {Seed[] | undefined} */
  let seeds;
  /** @type {SeedEvaluation[] | undefined} */
  let evaluations;
  /** @type {SeedEvaluation[]} */
  let evaluationsThisTick = [];
  let stage1InProgress = false;
  let stage1Processed = 0;
  let stage1CompletedThisTick = false;
  let stage1TotalSeeds = 0;
  let stage1DoneSeeds = 0;

  if (Game.cpu.bucket < STAGE1_MIN_BUCKET) {
    const pausedProgress = readStage1Progress(storedRoomPlan);
    if (pausedProgress && pausedProgress.seeds.length > 0) {
      stage1TotalSeeds = pausedProgress.seeds.length;
      stage1DoneSeeds = pausedProgress.nextIndex;
    }
    maybeVisualizeProgress(normalizedInput.roomName, {
      phase: "bucket_wait",
      seedsDone: stage1DoneSeeds,
      seedsTotal: stage1TotalSeeds,
    });
    return buildPlannerResult({
      ok: !!winner,
      input: normalizedInput,
      winner,
      cached,
      mincutDone: !!winner,
    });
  }

  const savedProgress = readStage1Progress(storedRoomPlan);
  const stage1ResumePending =
    !!savedProgress &&
    savedProgress.seeds.length > 0 &&
    savedProgress.nextIndex < savedProgress.seeds.length;
  const shouldRunStage1 = !winner || stage1ResumePending;

  if (shouldRunStage1) {
    if (!winner) {
      cached = false;
    }

    distances = buildWallDistanceMap(
      normalizedInput.terrain,
      normalizedInput.controller_pos
    );

    const rawSeeds = stage1ResumePending
      ? savedProgress.seeds
      : extractSeedsFromDistanceMap(distances);
    stage1TotalSeeds = rawSeeds.length;

    const passableMask = buildPassableMask(normalizedInput.terrain);
    const mincutBlockedMask = buildExitRangeMask(
      normalizedInput.terrain,
      MINCUT_EXIT_BLOCK_RANGE
    );
    const sourceBlockedMask = buildExitRangeMask(
      normalizedInput.terrain,
      MINCUT_SOURCE_EXIT_RANGE
    );
    const costMatrix = buildMincutCostMatrix(passableMask, mincutBlockedMask);

    /** @type {{ seedId: number, mincutTiles: number, controllerAdjacentProtected: boolean, interiorConnected: boolean }[]} */
    const seedStats = stage1ResumePending ? savedProgress.seedStats.slice() : [];
    let nextSeedIndex = stage1ResumePending ? savedProgress.nextIndex : 0;
    const cpuStart = Game.cpu.getUsed();

    while (nextSeedIndex < rawSeeds.length) {
      if (Game.cpu.getUsed() - cpuStart >= STAGE1_CPU_BUDGET) {
        break;
      }
      const evaluation = evaluateSeed(
        normalizedInput.roomName,
        normalizedInput.terrain,
        rawSeeds[nextSeedIndex],
        passableMask,
        mincutBlockedMask,
        sourceBlockedMask,
        costMatrix
      );
      evaluationsThisTick.push(evaluation);
      seedStats.push({
        seedId: rawSeeds[nextSeedIndex].id,
        mincutTiles: evaluation.mincutTiles.length,
        controllerAdjacentProtected: hasControllerAdjacentProtected(
          evaluation,
          normalizedInput.terrain,
          normalizedInput.controller_pos
        ),
        interiorConnected: hasConnectedInterior(evaluation),
      });
      nextSeedIndex += 1;
      stage1Processed += 1;
    }
    stage1DoneSeeds = nextSeedIndex;

    if (nextSeedIndex < rawSeeds.length) {
      stage1InProgress = true;
      storeStage1Progress(normalizedInput.roomName, {
        seeds: rawSeeds,
        seedStats,
        nextIndex: nextSeedIndex,
      });
      evaluations = evaluationsThisTick;
      seeds = rawSeeds;
    } else {
      clearStage1Progress(normalizedInput.roomName);
      evaluations = evaluationsThisTick;
      seeds = rawSeeds;

      if (!winner) {
        const bestSeedId = pickBestSeedIdFromStats(seedStats);
        const bestSeed = rawSeeds.find((seed) => seed.id === bestSeedId);
        if (bestSeed) {
          winner = evaluateSeed(
            normalizedInput.roomName,
            normalizedInput.terrain,
            bestSeed,
            passableMask,
            mincutBlockedMask,
            sourceBlockedMask,
            costMatrix
          );
        }
        if (winner && winner.ok && hasConnectedInterior(winner)) {
          storeWinnerRoomPlan(normalizedInput.roomName, winner);
          stage1CompletedThisTick = true;
        } else if (winner) {
          winner = null;
        }
      }
    }
  }

  const seedsThisTick = evaluationsThisTick.map((evaluation) => evaluation.seed);

  if (stage1InProgress || stage1CompletedThisTick) {
    if (DEBUG_VISUALIZE_DISTANCE_TRANSFORM && distances) {
      visualizeDistanceMap(distances, normalizedInput.roomName);
    }
    if (DEBUG_VISUALIZE_SEEDS && seedsThisTick.length > 0) {
      visualizeSeeds(seedsThisTick, normalizedInput.roomName);
    }
    if (DEBUG_VISUALIZE_MINCUT_AND_INTERIOR) {
      visualizeMincutEvaluation(winner, normalizedInput.roomName);
    }
    if (DEBUG_VISUALIZE_ALTERNATIVE_MINCUTS && Array.isArray(evaluations)) {
      visualizeAlternativeMincuts(evaluations, null, normalizedInput.roomName);
    }
    if (stage1CompletedThisTick) {
      maybeVisualizeProgress(normalizedInput.roomName, {
        phase: "stage1_done",
        seedsDone: stage1TotalSeeds,
        seedsTotal: stage1TotalSeeds,
      });
    } else if (stage1InProgress) {
      maybeVisualizeProgress(normalizedInput.roomName, {
        phase: "stage1",
        seedsDone: stage1DoneSeeds,
        seedsTotal: stage1TotalSeeds,
        processedThisTick: stage1Processed,
      });
    }

    return buildPlannerResult({
      ok: !!winner,
      input: normalizedInput,
      distances,
      seeds: seeds || [],
      evaluations: evaluations || [],
      winner,
      cached,
      mincutDone: !!winner && !stage1InProgress,
      stage1InProgress,
      stage1Processed,
    });
  }

  let corePlan = null;
  let servicePlan = null;
  if (winner) {
    maybeVisualizeProgress(normalizedInput.roomName, {
      phase: "stage2",
    });
    const latestRoomPlan = readStoredRoomPlan(normalizedInput.roomName);
    corePlan = planStep2Cores(normalizedInput, winner, latestRoomPlan);
    servicePlan = planStep2ServiceSites(
      normalizedInput,
      winner,
      latestRoomPlan,
      corePlan
    );
    removeStep2TilesFromBuildable(winner, corePlan, servicePlan);

    if (corePlan && servicePlan) {
      markRoomPlanStep2Complete(normalizedInput.roomName);
    }
  }

  if (DEBUG_VISUALIZE_DISTANCE_TRANSFORM) {
    visualizeDistanceMap(
      distances ||
        buildWallDistanceMap(
          normalizedInput.terrain,
          normalizedInput.controller_pos
        ),
      normalizedInput.roomName
    );
  }

  if (DEBUG_VISUALIZE_SEEDS && seedsThisTick.length > 0) {
    visualizeSeeds(seedsThisTick, normalizedInput.roomName);
  }

  if (DEBUG_VISUALIZE_MINCUT_AND_INTERIOR && winner) {
    visualizeMincutEvaluation(winner, normalizedInput.roomName);
  }

  if (DEBUG_VISUALIZE_ALTERNATIVE_MINCUTS && Array.isArray(evaluations) && evaluations.length > 0) {
    visualizeAlternativeMincuts(evaluations, null, normalizedInput.roomName);
  }

  if (DEBUG_VISUALIZE_STEP2_CORES) {
    visualizeStep2Cores(corePlan, servicePlan, normalizedInput.roomName);
  }

  const step2Done = !!(corePlan && servicePlan);
  if (step2Done) {
    maybeVisualizeProgress(normalizedInput.roomName, {
      phase: "complete",
    });
  }

  return buildPlannerResult({
    ok: !!winner,
    input: normalizedInput,
    distances,
    seeds: seeds || [],
    evaluations: evaluations || [],
    winner,
    corePlan,
    servicePlan,
    cached,
    mincutDone: !!winner,
    step2Done,
    step2CoreDone: step2Done,
    stage1Processed,
  });
}

/**
 * @param {SeedEvaluation[]} evaluations
 * @returns {SeedEvaluation | null}
 */

module.exports = { planner, ROOM_PLAN_LAYOUT_KEYS };
