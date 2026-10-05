
import { useLayoutEffect, useRef, useState } from 'react'
import LocationModal from './LocationModal'
import {
  LEVELS,
  POSITIONS,
  ROWS,
  generateFramesForRow,
  isFrameRemoved,
} from '../data/warehouseConfig'

const ROW_SPACING_AFTER = {
  102: 15,
  104: 15,
  106: 15,
  108: 15,
  110: 15,
  111: 10,
  112: 15,
  114: 15,
  116: 15,
  118: 15,
  120: 15,
  122: 15,
  124: 15,
}

const DOCK_DOOR_START_FRAME = 28
const DOCK_DOOR_END_FRAME = 61
const DOCK_DOOR_COUNT = 45
const SLOTS_PER_FRAME = LEVELS.length * POSITIONS.length
const DOCK_DOORS_BY_FRAME = Array.from({ length: DOCK_DOOR_COUNT }, (_, index) => {
    const idealOffset = index * (DOCK_DOOR_END_FRAME - DOCK_DOOR_START_FRAME) / (DOCK_DOOR_COUNT - 1)
    const frameOffset = Math.round(idealOffset)
    const frame = DOCK_DOOR_START_FRAME + frameOffset

    return {
      frame,
      number: index + 1,
      horizontalOffsetPx: (frameOffset - idealOffset) * 18,
      isStaffDoor: index === 0 || index === DOCK_DOOR_COUNT - 1,
    }
  })
  .reduce((doorsByFrame, door) => {
    const doorsAtFrame = doorsByFrame.get(door.frame) || []
    doorsAtFrame.push(door)
    doorsByFrame.set(door.frame, doorsAtFrame)
    return doorsByFrame
  }, new Map())

const HIGHLIGHT_ROUTE_ROWS = new Set([101, 104, 108, 112, 116, 120, 124])

function createWarehouseRoutes(mapInner) {
  const bounds = mapInner.getBoundingClientRect()
  const allFrameElements = [...mapInner.querySelectorAll('.frame-box, .frame-placeholder')]
  const framePointsByFrame = new Map()

  for (const element of allFrameElements) {
    const row = Number(element.dataset.row)
    const frame = Number(element.dataset.frame)
    if (!Number.isFinite(row) || !Number.isFinite(frame)) continue

    const rect = element.getBoundingClientRect()
    const point = {
      row,
      frame,
      x: rect.left + rect.width / 2 - bounds.left,
      y: rect.top + rect.height / 2 - bounds.top,
    }

    const framePoints = framePointsByFrame.get(frame) || []
    framePoints.push(point)
    framePointsByFrame.set(frame, framePoints)
  }

  const frame44Points = (framePointsByFrame.get(44) || []).filter(Boolean)
  const frame46Points = (framePointsByFrame.get(46) || []).filter(Boolean)
  const dockDoorSlot = [...mapInner.querySelectorAll('.dock-door-slot')].find(
    (element) => Number(element.dataset.frame) === 45 || Number(element.dataset.frame) === 46
  )

  if (frame44Points.length === 0 || frame46Points.length === 0 || !dockDoorSlot) {
    return { width: bounds.width, height: bounds.height, paths: [] }
  }

  const x44 = frame44Points.reduce((total, point) => total + point.x, 0) / frame44Points.length
  const x46 = frame46Points.reduce((total, point) => total + point.x, 0) / frame46Points.length
  const xCenter = (x44 + x46) / 2

  const topRowPoint = [...framePointsByFrame.values()]
    .flat()
    .sort((left, right) => left.y - right.y)[0]

  const dockRect = dockDoorSlot.getBoundingClientRect()
  const doorX = dockRect.left + dockRect.width / 2 - bounds.left
  const doorY = dockRect.top + dockRect.height / 2 - bounds.top

  const primaryRoute = {
    id: 'primary-aisle-path',
    d: `M ${xCenter} ${topRowPoint.y} L ${xCenter} ${doorY} L ${doorX} ${doorY}`,
  }

  return { width: bounds.width, height: bounds.height, paths: [primaryRoute] }
}

const getStatusStyle = (status) => {
  if (status === 'OCCUPIED') return 'occupied'
  if (status === 'PARTIAL') return 'partial'
  if (status === 'RESERVED') return 'reserved'
  if (status === 'BLOCKED') return 'blocked'
  if (status === 'MAINTENANCE' || status === 'UNDER_MAINTENANCE') return 'maintenance'
  return 'available'
}

const getStatusLabel = (status) => {
  if (status === 'OCCUPIED') return 'Đầy 18/18 vị trí'
  if (status === 'PARTIAL') return 'Có hàng, chưa đầy 18 vị trí'
  if (status === 'RESERVED') return 'Có lô đang chờ put-away'
  if (status === 'BLOCKED') return 'Có vị trí bị khóa do lỗi'
  if (status === 'MAINTENANCE' || status === 'UNDER_MAINTENANCE') return 'Bảo trì'
  return 'Trống'
}

function WarehouseMap({
  locations,
  onShipLocation,
  highlightFrameIds = [],
  compactMode = false,
  showLegend = true,
  disableFrameSelection = false,
}) {
  const [selectedFrame, setSelectedFrame] = useState(null)
  const [warehouseRoutes, setWarehouseRoutes] = useState(null)
  const mapInnerRef = useRef(null)
  const frameStatusById = locations.reduce((statuses, location) => {
    const frameId = `${location.row}-${location.frame}`
    const frameStatus = statuses.get(frameId) || {
      occupiedCount: 0,
      reservedCount: 0,
      blockedCount: 0,
      maintenanceStatus: null,
    }

    if (location.status === 'OCCUPIED') frameStatus.occupiedCount += 1
    if (location.status === 'RESERVED') frameStatus.reservedCount += 1
    if (location.isBlocked || location.status === 'BLOCKED') frameStatus.blockedCount += 1
    if (location.status === 'MAINTENANCE' || location.status === 'UNDER_MAINTENANCE') {
      frameStatus.maintenanceStatus = location.status
    }

    statuses.set(frameId, frameStatus)

    return statuses
  }, new Map())

  const getFrameStatus = (frameId) => {
    const frameStatus = frameStatusById.get(frameId)
    if (frameStatus?.blockedCount) return 'BLOCKED'
    if (frameStatus?.reservedCount) return 'RESERVED'
    if (!frameStatus?.occupiedCount) return frameStatus?.maintenanceStatus || 'AVAILABLE'
    if (frameStatus.occupiedCount >= SLOTS_PER_FRAME) return 'OCCUPIED'
    return 'PARTIAL'
  }

  useLayoutEffect(() => {
    const mapInner = mapInnerRef.current
    if (!mapInner) return undefined

    const updateRoutes = () => setWarehouseRoutes(createWarehouseRoutes(mapInner))
    const resizeObserver = new ResizeObserver(updateRoutes)
    updateRoutes()
    resizeObserver.observe(mapInner)

    return () => resizeObserver.disconnect()
  }, [])

  const renderFrame = (frame) => {
    const frameId = `${frame.row}-${frame.frame}`
    const isHighlighted = highlightFrameIds.includes(frameId)

    if (isFrameRemoved(frame.row, frame.frame)) {
      const dockDoors = frame.row === 104 ? DOCK_DOORS_BY_FRAME.get(frame.frame) : null

      if (dockDoors) {
        return (
          <span
            className="dock-door-slot"
            key={frameId}
            data-row={frame.row}
            data-frame={frame.frame}
          >
            {dockDoors.map((dockDoor) => (
              <span
                className={`dock-door ${dockDoor.isStaffDoor ? 'dock-door--staff' : ''}`}
                key={dockDoor.number}
                data-door-number={dockDoor.number}
                style={{ '--dock-offset': `${dockDoor.horizontalOffsetPx}px` }}
                title={`${dockDoor.isStaffDoor ? 'Cửa nhân viên' : 'Cửa xe'} ${dockDoor.number} · Khung ${frame.frame}`}
                role="img"
                aria-label={`${dockDoor.isStaffDoor ? 'Cửa nhân viên' : 'Cửa xe'} ${dockDoor.number}`}
              >
                {dockDoor.number % 3 === 2 && (
                  <span className="dock-door__arrow" aria-hidden="true" />
                )}
                {dockDoor.isStaffDoor && (
                  <span className="dock-door__person" aria-hidden="true" />
                )}
                <span className="dock-door__opening" aria-hidden="true" />
              </span>
            ))}
          </span>
        )
      }

      return (
        <span
          className="frame-placeholder"
          key={frameId}
          data-row={frame.row}
          data-frame={frame.frame}
          aria-hidden="true"
        />
      )
    }

    const status = getFrameStatus(frameId)

    return (
      <button
        key={frameId}
        type="button"
        className={`frame-box frame-box--${getStatusStyle(status)} ${isHighlighted ? 'frame-box--highlighted' : ''}`}
        onClick={disableFrameSelection ? undefined : () => setSelectedFrame(frame)}
        title={`${frame.row}-${String(frame.frame).padStart(2, '0')} · ${getStatusLabel(status)}`}
        disabled={disableFrameSelection}
      >
        {String(frame.frame).padStart(2, '0')}
      </button>
    )
  }

  return (
    <div className={`real-warehouse-map ${compactMode ? 'real-warehouse-map--compact' : ''}`}>

      <div className={`map-heading ${compactMode ? 'map-heading--compact' : ''}`}>
        <div>
          <h2>U&I Warehouse 6</h2>
        </div>

        {showLegend && (
          <div className="map-legend">
            <span>
              <i className="legend-box available"></i>
              Trống
            </span>

            <span>
              <i className="legend-box reserved"></i>
              Đã giữ chỗ · chờ put-away
            </span>

            <span>
              <i className="legend-box occupied"></i>
              Đầy 18/18
            </span>

            <span>
              <i className="legend-box partial"></i>
              Có hàng, chưa đầy
            </span>

            <span>
              <i className="legend-box maintenance"></i>
              Bảo trì
            </span>
            <span>
              <i className="legend-box blocked"></i>
              Ô lỗi / đã khóa
            </span>
          </div>
        )}
      </div>

      <div className="map-scroll">

        <div className="warehouse-map-inner" ref={mapInnerRef}>

          {warehouseRoutes && (
            <svg
              className="warehouse-route-overlay"
              viewBox={`0 0 ${warehouseRoutes.width} ${warehouseRoutes.height}`}
              role="img"
              aria-label="Hướng dẫn đường đi trong kho"
            >
              {warehouseRoutes.paths.map((route) => (
                <path
                  className="warehouse-route-path"
                  d={route.d}
                  key={route.id}
                />
              ))}
            </svg>
          )}

          {/* Hiển thị từ dãy 124 xuống dãy 101 */}
          {[...ROWS].reverse().map((row) => {
            const frames = generateFramesForRow(row)
            const rowSpacing = ROW_SPACING_AFTER[row] ?? 6
            const leftFrames = frames.filter((frame) => frame.zone === 'LEFT').reverse()
            const centerFrames = frames.filter((frame) => frame.zone === 'CENTER').reverse()
            const rightFrames = frames.filter((frame) => frame.zone === 'RIGHT').reverse()

            return (
              <div
                className={`warehouse-row ${centerFrames.length ? '' : 'warehouse-row--without-center'}`}
                key={row}
                style={{ marginBottom: `${rowSpacing}px` }}
              >

                <div className="row-number">
                  {row}
                </div>

                <div className="zone-section left-section">
                  {leftFrames.map(renderFrame)}
                </div>

                <div className="zone-section center-section">
                  {centerFrames.map(renderFrame)}
                </div>

                <div className="zone-section right-section">
                  {rightFrames.map(renderFrame)}
                </div>

              </div>
            )
          })}

          <div className="zone-labels" />

        </div>

      </div>

{selectedFrame && (
  <LocationModal
    frame={selectedFrame}
    locations={locations}
    onShipLocation={onShipLocation}
    onClose={() => setSelectedFrame(null)}
  />
)}
    </div>
  )
}

export default WarehouseMap