const SCORE_WEIGHTS = {
  safety: 0.35,
  travel: 0.25,
  weightLevel: 0.2,
  group: 0.15,
  movementHistory: 0.05,
}

const INBOUND_ROW = 101
const SLOT_HEIGHT_CM = 90
const SLOT_WIDTH_CM = 80
const SLOT_DEPTH_CM = 80
const SLOT_MAX_GROSS_WEIGHT_KG = 1000
const SLOT_MAX_VOLUME_CBM = SLOT_HEIGHT_CM * SLOT_WIDTH_CM * SLOT_DEPTH_CM / 1_000_000

function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value))
}

function percentile(values, ratio) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right)
  if (!sorted.length) return 1
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))] || 1
}

function normalizeGroup(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function getBatchVolume(batch) {
  const reportedVolume = Number(batch.cbm)
  const measuredVolume = Number.isFinite(reportedVolume) && reportedVolume > 0
    ? reportedVolume
    : 0
  const boundingVolume = Number(batch.heightCm) * Number(batch.widthCm) * Number(batch.depthCm) / 1_000_000
  return Math.max(measuredVolume, boundingVolume)
}

export function fitsStorageSlot(batch = {}) {
  const weight = Number(batch.grossWeightKg)
  const height = Number(batch.heightCm)
  const width = Number(batch.widthCm)
  const depth = Number(batch.depthCm)
  const hasDimensions = [height, width, depth].every(
    (dimension) => Number.isFinite(dimension) && dimension > 0
  )

  if (!hasDimensions || !Number.isFinite(weight) || weight <= 0) return false
  if (weight > SLOT_MAX_GROSS_WEIGHT_KG) return false

  const packageDimensions = [height, width, depth].sort((left, right) => right - left)
  const slotDimensions = [SLOT_HEIGHT_CM, SLOT_WIDTH_CM, SLOT_DEPTH_CM].sort((left, right) => right - left)
  if (!packageDimensions.every((dimension, index) => dimension <= slotDimensions[index])) return false

  return getBatchVolume(batch) <= SLOT_MAX_VOLUME_CBM + 0.005
}

export function recommendStorageSlots(batch = {}, locations, limit = 5, excludedLocationIds = []) {
  if (!fitsStorageSlot(batch)) return []

  const weight = Number(batch.grossWeightKg)
  const height = Number(batch.heightCm)
  const volume = getBatchVolume(batch)

  const excludedLocations = new Set(excludedLocationIds)
  const available = locations.filter(
    (location) => location.status === 'AVAILABLE' && !location.isBlocked && !excludedLocations.has(location.id)
  )
  if (!available.length) return []

  const highestLevel = locations.reduce(
    (maxLevel, location) => Math.max(maxLevel, Number(location.level) || 0),
    1
  )
  const levelRange = Math.max(1, highestLevel - 1)
  const occupied = locations.filter((location) => location.status === 'OCCUPIED')
  const weightScale = percentile(occupied.map((location) => Number(location.grossWeightKg)), 0.9)
  const volumeScale = percentile(occupied.map((location) => Number(location.cbm)), 0.9)
  const rows = available.map((location) => location.row)
  const maxRowDistance = Math.max(1, Math.max(...rows) - INBOUND_ROW)
  const normalizedProduct = normalizeGroup(batch.productName)
  const nearbyGroups = new Map()

  if (normalizedProduct) {
    for (const location of occupied) {
      const productNames = location.inventoryItems?.length
        ? location.inventoryItems.map((item) => item.productName)
        : [location.productName]
      if (!productNames.some((name) => normalizeGroup(name) === normalizedProduct)) continue
      const key = `${location.row}-${location.zone}`
      nearbyGroups.set(key, (nearbyGroups.get(key) || 0) + 1)
    }
  }

  const weightRatio = clamp(weight / weightScale, 0, 1)
  const volumeRatio = clamp(volume / volumeScale, 0, 1)
  const heightRatio = clamp(height / SLOT_HEIGHT_CM, 0, 1)

  return available
    .map((location) => {
      const levelRatio = clamp((location.level - 1) / levelRange, 0, 1)
      const safety = clamp(100 - levelRatio * (18 + heightRatio * 32))
      const travel = clamp(100 - Math.max(0, location.row - INBOUND_ROW) / maxRowDistance * 100)
      const weightLevel = clamp(100 - levelRatio * (20 + weightRatio * 35 + volumeRatio * 15))
      const groupCount = nearbyGroups.get(`${location.row}-${location.zone}`) || 0
      const group = normalizedProduct ? 50 + 50 * groupCount / (groupCount + 3) : 50
      const movementHistory = 50
      const score =
        safety * SCORE_WEIGHTS.safety +
        travel * SCORE_WEIGHTS.travel +
        weightLevel * SCORE_WEIGHTS.weightLevel +
        group * SCORE_WEIGHTS.group +
        movementHistory * SCORE_WEIGHTS.movementHistory

      return {
        location,
        score: Math.round(score * 10) / 10,
        factors: {
          safety: Math.round(safety),
          travel: Math.round(travel),
          weightLevel: Math.round(weightLevel),
          group: Math.round(group),
          movementHistory,
        },
      }
    })
    .sort((left, right) => right.score - left.score || left.location.id.localeCompare(right.location.id))
    .slice(0, limit)
}

export { SCORE_WEIGHTS }