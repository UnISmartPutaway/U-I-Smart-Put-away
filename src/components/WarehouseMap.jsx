
import { useState } from 'react'
import LocationModal from './LocationModal'
import {
  ROWS,
  generateFramesForRow,
  getLeftFrames,
  getCenterFrames,
  getRightFrames,
} from '../data/warehouseConfig'

const getStatusStyle = (status) => {
  if (status === 'OCCUPIED') return 'occupied'
  if (status === 'MAINTENANCE' || status === 'UNDER_MAINTENANCE') return 'maintenance'
  return 'available'
}

const getStatusLabel = (status) => {
  if (status === 'OCCUPIED') return 'Có hàng'
  if (status === 'MAINTENANCE' || status === 'UNDER_MAINTENANCE') return 'Bảo trì'
  return 'Trống'
}

function WarehouseMap({ locations, onShipLocation }) {
  const [selectedFrame, setSelectedFrame] = useState(null)
  const frameStatusById = locations.reduce((statuses, location) => {
    const frameId = `${location.row}-${location.frame}`
    const currentStatus = statuses.get(frameId)

    if (
      location.status === 'OCCUPIED' ||
      !currentStatus ||
      (location.status === 'MAINTENANCE' && currentStatus !== 'OCCUPIED')
    ) {
      statuses.set(frameId, location.status)
    }

    return statuses
  }, new Map())

  return (
    <div className="real-warehouse-map">

      <div className="map-heading">
        <div>
          <h2>U&I Warehouse 6</h2>
        </div>

        <div className="map-legend">
          <span>
            <i className="legend-box available"></i>
            Trống
          </span>

          <span>
            <i className="legend-box occupied"></i>
            Có hàng
          </span>

          <span>
            <i className="legend-box maintenance"></i>
            Bảo trì
          </span>
        </div>
      </div>

      <div className="map-scroll">

        <div className="warehouse-map-inner">

          {/* Hiển thị từ dãy 124 xuống dãy 101 */}
          {[...ROWS].reverse().map((row) => {
            const frames = generateFramesForRow(row)
            const leftCount = getLeftFrames(row)
            const centerCount = getCenterFrames(row)
            const rightCount = getRightFrames(row)
            const leftFrames = frames.filter((frame) => frame.zone === 'LEFT').reverse()
            const centerFrames = frames.filter((frame) => frame.zone === 'CENTER').reverse()
            const rightFrames = frames.filter((frame) => frame.zone === 'RIGHT').reverse()

            return (
              <div className="warehouse-row" key={row}>

                <div className="row-number">
                  {row}
                </div>

                <div className="zone-section left-section">
                  {leftFrames.map((frame) => {
                    const status = frameStatusById.get(`${row}-${frame.frame}`) || 'AVAILABLE'

                    return (
                      <button
                        key={`${row}-${frame.frame}`}
                        className={`frame-box frame-box--${getStatusStyle(status)}`}
                        onClick={() => setSelectedFrame(frame)}
                        title={`${row}-${String(frame.frame).padStart(2, '0')} · ${getStatusLabel(status)}`}
                      >
                        {String(frame.frame).padStart(2, '0')}
                      </button>
                    )
                  })}
                </div>

                <div className="zone-section center-section">
                  {centerFrames.map((frame) => {
                    const status = frameStatusById.get(`${row}-${frame.frame}`) || 'AVAILABLE'

                    return (
                      <button
                        key={`${row}-${frame.frame}`}
                        className={`frame-box frame-box--${getStatusStyle(status)}`}
                        onClick={() => setSelectedFrame(frame)}
                        title={`${row}-${String(frame.frame).padStart(2, '0')} · ${getStatusLabel(status)}`}
                      >
                        {String(frame.frame).padStart(2, '0')}
                      </button>
                    )
                  })}
                </div>

                <div className="zone-section right-section">
                  {rightFrames.map((frame) => {
                    const status = frameStatusById.get(`${row}-${frame.frame}`) || 'AVAILABLE'

                    return (
                      <button
                        key={`${row}-${frame.frame}`}
                        className={`frame-box frame-box--${getStatusStyle(status)}`}
                        onClick={() => setSelectedFrame(frame)}
                        title={`${row}-${String(frame.frame).padStart(2, '0')} · ${getStatusLabel(status)}`}
                      >
                        {String(frame.frame).padStart(2, '0')}
                      </button>
                    )
                  })}
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