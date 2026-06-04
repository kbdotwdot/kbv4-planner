const { STEP2_CORE_VISUAL_COLORS } = require("../layouts");
const { MAX_DISTANCE } = require("../constants");

function visualizeDistanceMap(distances, roomName) {
  if (typeof roomName !== "string" || roomName.length === 0) {
    return;
  }

  const visual = new RoomVisual(roomName);
  for (let y = 0; y < 50; y += 1) {
    for (let x = 0; x < 50; x += 1) {
      const distance = distances[y * 50 + x];
      if (distance >= MAX_DISTANCE) {
        continue;
      }

      const color = distance === 0 ? "#e74c3c" : "#ffffff";
      visual.text(String(distance), x, y, {
        color,
        font: 0.5,
        align: "center",
      });
    }
  }
}

/**
 * @typedef {{ id: number, anchor: RoomPoint, tiles: RoomPoint[], score: number }} Seed
 */

/**
 * Step 1.5: split walkable area into non-overlapping seeds.
 * A seed anchor must be a distance-4 tile and claims range-3 tiles.
 *
 * @param {Uint8Array} distances
 * @returns {Seed[]}
 */

function visualizeSeeds(seeds, roomName) {
  if (typeof roomName !== "string" || roomName.length === 0) {
    return;
  }

  const visual = new RoomVisual(roomName);
  for (let i = 0; i < seeds.length; i += 1) {
    const seed = seeds[i];

    for (let j = 0; j < seed.tiles.length; j += 1) {
      const tile = seed.tiles[j];
      visual.rect(tile.x - 0.5, tile.y - 0.5, 1, 1, {
        fill: "#2ecc71",
        opacity: 0.18,
        stroke: undefined,
      });
    }

    visual.text(String(seed.id), seed.anchor.x, seed.anchor.y, {
      color: "#00ff66",
      font: 0.6,
      align: "center",
    });
  }
}

/**
 * @typedef {{
 *   ok: boolean,
 *   seed: Seed,
 *   tries: number,
 *   protectedTiles: RoomPoint[],
 *   mincutTiles: RoomPoint[],
 *   interiorTiles: RoomPoint[],
 *   buildableTiles: RoomPoint[],
 *   placements: { large: RoomPoint, small: RoomPoint } | null
 * }} SeedEvaluation
 */

/**
 * @param {PlannerInput & { type: number }} input
 * @returns {SeedEvaluation[]}
 */

function visualizeMincutEvaluation(evaluation, roomName) {
  if (!evaluation || typeof roomName !== "string" || roomName.length === 0) {
    return;
  }

  const visual = new RoomVisual(roomName);

  for (let i = 0; i < evaluation.buildableTiles.length; i += 1) {
    const tile = evaluation.buildableTiles[i];
    visual.rect(tile.x - 0.5, tile.y - 0.5, 1, 1, {
      fill: "#ffffff",
      opacity: 0.15,
      stroke: undefined,
    });
  }

  for (let i = 0; i < evaluation.mincutTiles.length; i += 1) {
    const tile = evaluation.mincutTiles[i];
    visual.rect(tile.x - 0.5, tile.y - 0.5, 1, 1, {
      fill: "#00ff66",
      opacity: 0.7,
      stroke: undefined,
    });
  }
}

/**
 * @param {string | null} roomName
 * @returns {RoomPlanCompact | null}
 */

function visualizeAlternativeMincuts(evaluations, winner, roomName) {
  if (typeof roomName !== "string" || roomName.length === 0) {
    return;
  }

  const winnerSeedId = winner ? winner.seed.id : -1;
  const alternatives = evaluations.filter((evaluation) => {
    return evaluation.seed.id !== winnerSeedId && evaluation.mincutTiles.length > 0;
  });

  if (alternatives.length === 0) {
    return;
  }

  const visual = new RoomVisual(roomName);

  for (let altIndex = 0; altIndex < alternatives.length; altIndex += 1) {
    const evaluation = alternatives[altIndex];
    const color = pickAlternativeMincutColor(altIndex);

    for (let i = 0; i < evaluation.mincutTiles.length; i += 1) {
      const tile = evaluation.mincutTiles[i];
      visual.rect(tile.x - 0.5, tile.y - 0.5, 1, 1, {
        fill: color,
        opacity: 0.35,
        stroke: undefined,
      });
    }
  }
}

/**
 * @param {number} index
 * @returns {string}
 */

function pickAlternativeMincutColor(index) {
  const palette = [
    "#3498db",
    "#9b59b6",
    "#f39c12",
    "#e67e22",
    "#1abc9c",
    "#ff5ea8",
  ];

  return palette[index % palette.length];
}

/**
 * @typedef {{ token: string, x: number, y: number }} PlacedToken
 */

/**
 * @typedef {{
 *   center: RoomPoint,
 *   rotation: number,
 *   tokens: PlacedToken[],
 *   roads: RoomPoint[],
 *   blocked: RoomPoint[],
 *   structures: { token: string, type: string, index: number, point: RoomPoint }[]
 * }} CorePlacement
 */

/**
 * @typedef {{
 *   structures: { token: string, type: string, index: number, point: RoomPoint }[],
 *   roads: RoomPoint[],
 *   blockedTiles: RoomPoint[]
 * }} Step2ServicePlan
 */

/**
 * @param {PlannerInput & { type: number }} input
 * @param {SeedEvaluation | null} winner
 * @param {RoomPlanCompact | null} compact
 * @returns {{ hub: CorePlacement, fastfiller: CorePlacement } | null}
 */

function visualizeStep2Cores(corePlan, servicePlan, roomName) {
  if (
    (!corePlan && !servicePlan) ||
    typeof roomName !== "string" ||
    roomName.length === 0
  ) {
    return;
  }

  const visual = new RoomVisual(roomName);
  const roadMap = new Map();
  const placements = corePlan ? [corePlan.hub, corePlan.fastfiller] : [];

  for (let i = 0; i < placements.length; i += 1) {
    const placement = placements[i];
    for (let j = 0; j < placement.roads.length; j += 1) {
      const road = placement.roads[j];
      roadMap.set(`${road.x},${road.y}`, road);
    }
  }
  if (servicePlan) {
    for (let i = 0; i < servicePlan.roads.length; i += 1) {
      const road = servicePlan.roads[i];
      roadMap.set(`${road.x},${road.y}`, road);
    }
  }

  for (const road of roadMap.values()) {
    const neighbors = [
      { x: road.x + 1, y: road.y },
      { x: road.x - 1, y: road.y },
      { x: road.x, y: road.y + 1 },
      { x: road.x, y: road.y - 1 },
      { x: road.x + 1, y: road.y + 1 },
      { x: road.x + 1, y: road.y - 1 },
      { x: road.x - 1, y: road.y + 1 },
      { x: road.x - 1, y: road.y - 1 },
    ];
    for (let i = 0; i < neighbors.length; i += 1) {
      const neighbor = neighbors[i];
      if (roadMap.has(`${neighbor.x},${neighbor.y}`)) {
        visual.line(road.x, road.y, neighbor.x, neighbor.y, {
          color: STEP2_CORE_VISUAL_COLORS.road,
          width: 0.05,
          opacity: 0.25,
        });
      }
    }
  }

  for (let i = 0; i < placements.length; i += 1) {
    const placement = placements[i];
    for (let j = 0; j < placement.blocked.length; j += 1) {
      const point = placement.blocked[j];
      visual.rect(point.x - 0.5, point.y - 0.5, 1, 1, {
        fill: STEP2_CORE_VISUAL_COLORS.blocked,
        opacity: 0.25,
        stroke: "transparent",
      });
    }
    for (let j = 0; j < placement.structures.length; j += 1) {
      const structure = placement.structures[j];
      const color = STEP2_CORE_VISUAL_COLORS[structure.type] || "#ffffff";
      if (structure.type.indexOf("rampart_") === 0) {
        visual.rect(structure.point.x - 0.5, structure.point.y - 0.5, 1, 1, {
          fill: "#00ff66",
          opacity: 0.35,
          stroke: "transparent",
        });
        continue;
      }
      if (
        structure.type === "tower" ||
        structure.type === "lab" ||
        structure.type === "observer"
      ) {
        visual.circle(structure.point.x, structure.point.y, {
          radius: structure.type === "observer" ? 0.4 : 0.35,
          fill: color,
          opacity: structure.type === "observer" ? 0.4 : 0.25,
          stroke: color,
          strokeWidth: structure.type === "observer" ? 0.12 : 0.08,
        });
      }
      visual.text(structure.token, structure.point.x, structure.point.y, {
        color,
        font: "0.7 Arial",
        align: "center",
        opacity: 0.95,
      });
    }
  }

  if (servicePlan) {
    for (let i = 0; i < servicePlan.blockedTiles.length; i += 1) {
      const point = servicePlan.blockedTiles[i];
      visual.rect(point.x - 0.5, point.y - 0.5, 1, 1, {
        fill: STEP2_CORE_VISUAL_COLORS.blocked,
        opacity: 0.15,
        stroke: "transparent",
      });
    }
    for (let i = 0; i < servicePlan.structures.length; i += 1) {
      const structure = servicePlan.structures[i];
      const color = STEP2_CORE_VISUAL_COLORS[structure.type] || "#ffffff";
      if (structure.type.indexOf("rampart_") === 0) {
        visual.rect(structure.point.x - 0.5, structure.point.y - 0.5, 1, 1, {
          fill: "#00ff66",
          opacity: 0.35,
          stroke: "transparent",
        });
        continue;
      }
      if (
        structure.type === "tower" ||
        structure.type === "lab" ||
        structure.type === "observer"
      ) {
        visual.circle(structure.point.x, structure.point.y, {
          radius: structure.type === "observer" ? 0.4 : 0.35,
          fill: color,
          opacity: structure.type === "observer" ? 0.4 : 0.25,
          stroke: color,
          strokeWidth: structure.type === "observer" ? 0.12 : 0.08,
        });
      }
      visual.text(structure.token, structure.point.x, structure.point.y, {
        color,
        font: "0.7 Arial",
        align: "center",
        opacity: 0.95,
      });
    }
  }
}

/**
 * @param {string} roomName
 * @param {{
 *   phase: string,
 *   seedsDone?: number,
 *   seedsTotal?: number,
 *   processedThisTick?: number,
 * }} progress
 */
function visualizePlannerProgress(roomName, progress) {
  if (typeof roomName !== "string" || roomName.length === 0 || !progress) {
    return;
  }

  const visual = new RoomVisual(roomName);
  const lines = [];

  if (progress.phase === "bucket_wait") {
    lines.push("Planner: waiting (bucket < 500)");
    if (progress.seedsTotal > 0) {
      lines.push(
        `Stage 1 paused ${progress.seedsDone}/${progress.seedsTotal} (${formatProgressPercent(
          progress.seedsDone,
          progress.seedsTotal
        )})`
      );
    }
  } else if (progress.phase === "stage1") {
    lines.push(
      `Planner: Stage 1 ${progress.seedsDone}/${progress.seedsTotal} (${formatProgressPercent(
        progress.seedsDone,
        progress.seedsTotal
      )})`
    );
    if (progress.processedThisTick > 0) {
      lines.push(`+${progress.processedThisTick} seeds this tick`);
    }
  } else if (progress.phase === "stage1_done") {
    lines.push("Planner: Stage 1 complete");
    lines.push("Stage 2 starts next tick");
  } else if (progress.phase === "stage2") {
    lines.push("Planner: Stage 2");
  } else if (progress.phase === "complete") {
    lines.push("Planner: complete");
  }

  for (let i = 0; i < lines.length; i += 1) {
    visual.text(lines[i], 25, 0.8 + i * 0.9, {
      color: "#ffffff",
      font: 0.8,
      align: "center",
      opacity: 0.95,
    });
  }
}

/**
 * @param {number} done
 * @param {number} total
 * @returns {string}
 */
function formatProgressPercent(done, total) {
  if (!total) {
    return "0%";
  }
  const percent = Math.floor((done * 100) / total);
  return `${percent}%`;
}

module.exports = {
  visualizeDistanceMap,
  visualizeSeeds,
  visualizeMincutEvaluation,
  visualizeAlternativeMincuts,
  pickAlternativeMincutColor,
  visualizeStep2Cores,
  visualizePlannerProgress,
};
