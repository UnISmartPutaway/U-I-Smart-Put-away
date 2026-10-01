// ======================================================
// SMART LOCATION - U&I WAREHOUSE 6
// Warehouse configuration - Floor 1
// ======================================================

import { ADMIN_UI_OCCUPIED_LOCATIONS } from './adminUiOccupiedLocations.js'

export const LEVELS = [1, 2, 3, 4, 5, 6]

export const POSITIONS = ['A', 'B', 'C']

// 24 rows: 101 -> 124
export const ROWS = Array.from(
  { length: 24 },
  (_, index) => 101 + index
)

// ------------------------------------------------------
// Number of frames in each warehouse zone
// ------------------------------------------------------

export function getLeftFrames(row) {
  if (row === 101) return 24
  if (row === 102 || row === 103) return 23
  return 24
}

export function getCenterFrames(row) {
  return row >= 111 && row <= 124 ? 32 : 0
}

export function getRightFrames(row) {
  return row === 101 ? 23 : 26
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
  const configuredFrameCount =
    getRightFrames(row) + getCenterFrames(row) + getLeftFrames(row)
  const importedFrames = IMPORTED_FRAMES_BY_ROW.get(row) || []
  const minimumImportedFrame = importedFrames.length
    ? Math.min(...importedFrames)
    : fallbackStartFrame
  const maximumImportedFrame = importedFrames.length
    ? Math.max(...importedFrames)
    : fallbackStartFrame + configuredFrameCount - 1
  const frameCount = Math.max(
    configuredFrameCount,
    maximumImportedFrame - minimumImportedFrame + 1
  )

  return {
    frameCount,
    sourceFrameStart: maximumImportedFrame - frameCount + 1,
  }
}

export function getLocalFrameNumber(row, sourceFrame) {
  const { sourceFrameStart } = getFrameNumbering(row)
  return Number(sourceFrame) - sourceFrameStart + 1
}

export function generateFramesForRow(row, fallbackStartFrame = 1) {
  const frames = []
  const rightCount = getRightFrames(row)
  const centerCount = getCenterFrames(row)
  const leftCount = getLeftFrames(row)
  const { frameCount } = getFrameNumbering(row, fallbackStartFrame)
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

  while (frames.length < frameCount) {
    frames.push({ row, frame: frameNumber++, zone: 'LEFT' })
  }

  return frames
}

export const WAREHOUSE_FRAMES = ROWS.flatMap((row) => generateFramesForRow(row))

// ------------------------------------------------------
// Generate every storage location
//
// Example:
// 101-01-1A
// 101-01-1B
// 101-01-1C
// ...
// ------------------------------------------------------

const BASE_WAREHOUSE_LOCATIONS = WAREHOUSE_FRAMES.flatMap(
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

const ADMIN_UI_OCCUPIED_MAP = new Map(
  ADMIN_UI_OCCUPIED_LOCATIONS.map((item) => {
    const frameCode = String(getLocalFrameNumber(item.row, item.frame)).padStart(2, '0')
    return [`${item.row}-${frameCode}-${item.level}${item.position}`, item]
  })
)

export const WAREHOUSE_LOCATIONS_WITH_ADMIN_DATA = BASE_WAREHOUSE_LOCATIONS.map(
  (location) => {
    const importedLocation = ADMIN_UI_OCCUPIED_MAP.get(location.id)

    if (!importedLocation) {
      return location
    }

    return {
      ...location,
      status: 'OCCUPIED',
      customerId: importedLocation.supplier || null,
      lotId: importedLocation.productCode || null,
      palletNote: importedLocation.palletNote || null,
      productName: importedLocation.productName || null,
      quantity: importedLocation.quantity || null,
      packageCount: importedLocation.packageCount,
      cbm: importedLocation.cbm,
      grossWeightKg: importedLocation.grossWeightKg,
      netWeightKg: importedLocation.netWeightKg,
      rawLocation: importedLocation.rawLocation || null,
    }
  }
)

export { WAREHOUSE_LOCATIONS_WITH_ADMIN_DATA as WAREHOUSE_LOCATIONS }

// ------------------------------------------------------
// Warehouse statistics
// ------------------------------------------------------

export const WAREHOUSE_STATS = {
  rows: ROWS.length,

  frames: WAREHOUSE_FRAMES.length,

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