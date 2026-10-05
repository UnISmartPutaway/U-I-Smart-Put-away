// ======================================================
// U&I SMART PUT-AWAY - WAREHOUSE 6
// Warehouse configuration - Floor 1
// ======================================================

import { ADMIN_UI_OCCUPIED_LOCATIONS } from './adminUiOccupiedLocations.js'

export const LEVELS = [1, 2, 3, 4, 5, 6]

export const POSITIONS = ['A', 'B', 'C']
export const FRAMES_PER_ROW = 87
const LEFT_FRAMES_PER_ROW = 29
const CENTER_FRAMES_PER_ROW = 32
const RIGHT_FRAMES_PER_ROW = 26

// 24 rows: 101 -> 124
export const ROWS = Array.from(
  { length: 24 },
  (_, index) => 101 + index
)

const REMOVED_FRAME_RANGES_BY_ROW = [
  { firstRow: 101, lastRow: 101, ranges: [[24, 63]] },
  { firstRow: 102, lastRow: 103, ranges: [[14, 14], [28, 63], [76, 76]] },
  { firstRow: 104, lastRow: 109, ranges: [[14, 14], [28, 62], [76, 76]] },
  { firstRow: 110, lastRow: 124, ranges: [[14, 14], [28, 28], [45, 45], [62, 62], [76, 76]] },
]

export function isFrameRemoved(row, frameNumber) {
  const rowRanges = REMOVED_FRAME_RANGES_BY_ROW.find(
    (range) => row >= range.firstRow && row <= range.lastRow
  )

  return rowRanges?.ranges.some(
    ([firstFrame, lastFrame]) => frameNumber >= firstFrame && frameNumber <= lastFrame
  ) || false
}

// ------------------------------------------------------
// Number of frames in each warehouse zone
// ------------------------------------------------------

export function getLeftFrames() {
  return LEFT_FRAMES_PER_ROW
}

export function getCenterFrames() {
  return CENTER_FRAMES_PER_ROW
}

export function getRightFrames() {
  return RIGHT_FRAMES_PER_ROW
}

// ------------------------------------------------------
// Generate frame information for one row
// Keep the existing frame count and layout, using real row-frame codes.
// ------------------------------------------------------

const IMPORTED_FRAMES_BY_ROW = new Map(
  ROWS.map((row) => [
    row,
    ADMIN_UI_OCCUPIED_LOCATIONS
      .filter((location) => location.row === row)
      .map((location) => location.frame),
  ])
)

function getFrameNumbering(row, fallbackStartFrame = 1) {
  const importedFrames = IMPORTED_FRAMES_BY_ROW.get(row) || []
  const maximumImportedFrame = importedFrames.length
    ? Math.max(...importedFrames)
    : fallbackStartFrame + FRAMES_PER_ROW - 1

  return {
    sourceFrameStart: maximumImportedFrame - FRAMES_PER_ROW + 1,
  }
}

export function getLocalFrameNumber(row, sourceFrame) {
  const { sourceFrameStart } = getFrameNumbering(row)
  return Number(sourceFrame) - sourceFrameStart + 1
}

export function generateFramesForRow(row, _fallbackStartFrame = 1) {
  const frames = []
  const rightCount = getRightFrames(row)
  const centerCount = getCenterFrames(row)
  const leftCount = getLeftFrames(row)
  let frameNumber = 1

  for (let index = 0; index < rightCount; index += 1) {
    frames.push({ row, frame: frameNumber++, zone: 'RIGHT' })
  }

  for (let index = 0; index < centerCount; index += 1) {
    frames.push({ row, frame: frameNumber++, zone: 'CENTER' })
  }

  for (let index = 0; index < leftCount; index += 1) {
    frames.push({ row, frame: frameNumber++, zone: 'LEFT' })
  }

  return frames
}

export const WAREHOUSE_FRAMES = ROWS.flatMap((row) => generateFramesForRow(row))
const ACTIVE_WAREHOUSE_FRAMES = WAREHOUSE_FRAMES.filter(
  (frame) => !isFrameRemoved(frame.row, frame.frame)
)

// ------------------------------------------------------
// Generate every storage location
//
// Example:
// 101-01-1A
// 101-01-1B
// 101-01-1C
// ...
// ------------------------------------------------------

const BASE_WAREHOUSE_LOCATIONS = ACTIVE_WAREHOUSE_FRAMES.flatMap(
  (frame) =>
    LEVELS.flatMap((level) =>
      POSITIONS.map((position) => {
        const frameCode = String(frame.frame).padStart(2, '0')

        return {
          id: `${frame.row}-${frameCode}-${level}${position}`,

          row: frame.row,
          frame: frame.frame,
          level,
          position,

          zone: frame.zone,

          status: 'AVAILABLE',

          customerId: null,
          lotId: null,
          palletNote: null,
          productName: null,
          quantity: null,
          packageCount: null,
          cbm: null,
          grossWeightKg: null,
          netWeightKg: null,
        }
      })
    )
)

const ADMIN_UI_OCCUPIED_MAP = new Map()

for (const item of ADMIN_UI_OCCUPIED_LOCATIONS) {
  const localFrame = getLocalFrameNumber(item.row, item.frame)
  if (isFrameRemoved(item.row, localFrame)) continue

  const frameCode = String(localFrame).padStart(2, '0')
  const locationId = `${item.row}-${frameCode}-${item.level}${item.position}`
  const batches = ADMIN_UI_OCCUPIED_MAP.get(locationId) || []
  batches.push(item)
  ADMIN_UI_OCCUPIED_MAP.set(locationId, batches)
}

export const WAREHOUSE_LOCATIONS_WITH_ADMIN_DATA = BASE_WAREHOUSE_LOCATIONS.map(
  (location) => {
    const importedBatches = ADMIN_UI_OCCUPIED_MAP.get(location.id)

    if (!importedBatches?.length) {
      return location
    }

    const inventoryItems = importedBatches.map((item) => ({
      ...item,
      batchId: `admin-ui-${item.sourceRow}-${item.position}`,
    }))
    const combine = (field) => [...new Set(
      inventoryItems.map((item) => String(item[field] || '').trim()).filter(Boolean)
    )].join(', ') || null
    const sum = (field) => {
      const values = inventoryItems
        .map((item) => item[field])
        .filter((value) => value !== null && value !== undefined && value !== '')
        .map(Number)
        .filter(Number.isFinite)

      return values.length ? values.reduce((total, value) => total + value, 0) : null
    }

    return {
      ...location,
      status: 'OCCUPIED',
      inventoryItems,
      customerId: combine('supplier'),
      lotId: combine('productCode'),
      palletNote: combine('palletNote'),
      productName: combine('productName'),
      quantity: combine('quantity'),
      packageCount: sum('packageCount'),
      cbm: sum('cbm'),
      grossWeightKg: sum('grossWeightKg'),
      netWeightKg: sum('netWeightKg'),
      rawLocation: combine('rawLocation'),
    }
  }
)

export { WAREHOUSE_LOCATIONS_WITH_ADMIN_DATA as WAREHOUSE_LOCATIONS }

// ------------------------------------------------------
// Warehouse statistics
// ------------------------------------------------------

export const WAREHOUSE_STATS = {
  rows: ROWS.length,

  frames: ACTIVE_WAREHOUSE_FRAMES.length,

  locations: WAREHOUSE_LOCATIONS_WITH_ADMIN_DATA.length,

  occupied: WAREHOUSE_LOCATIONS_WITH_ADMIN_DATA.filter(
    (location) => location.status !== 'AVAILABLE'
  ).length,

  available: WAREHOUSE_LOCATIONS_WITH_ADMIN_DATA.filter(
    (location) => location.status === 'AVAILABLE'
  ).length,

  levelsPerFrame: LEVELS.length,

  positionsPerLevel: POSITIONS.length,
}