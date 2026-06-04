/**
 * @typedef {{ x: number, y: number }} RoomPoint
 */

/**
 * @typedef {object} PlannerInput
 * @property {RoomPoint} source1_pos
 * @property {RoomPoint | null} source2_pos
 * @property {RoomPoint} controller_pos
 * @property {RoomPoint} mineral_pos
 * @property {Room.Terrain} terrain
 * @property {RoomPoint | null} spawn1_pos
 * @property {string | null | undefined} [roomName]
 * @property {number | null | undefined} [type]
 */

module.exports = {};
