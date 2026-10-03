import { useState } from 'react'
import { LEVELS } from '../data/warehouseConfig'
function LocationModal({ frame, locations, onClose, onShipLocation }) {
    const [selectedLocation, setSelectedLocation] = useState(null)
  const [shipMessage, setShipMessage] = useState('')
  if (!frame) return null

  const frameNumber = frame.frame ? String(frame.frame).padStart(2, '0') : '00'

  const levels = [...LEVELS].reverse()
  const positions = ['C', 'B', 'A']
  const frameLocations = locations.filter(
  (location) =>
    location.row === frame.row &&
    location.frame === frame.frame
)

  const totalSlots = frameLocations.length || 18
  const availableCount = frameLocations.length
    ? frameLocations.filter((location) => location.status === 'AVAILABLE').length
    : 18

  const formatStatus = (status) => {
    const labels = {
      AVAILABLE: 'Trống',
      OCCUPIED: 'Có hàng',
      MAINTENANCE: 'Bảo trì',
      UNDER_MAINTENANCE: 'Bảo trì',
      RESERVED: 'Đã đặt chỗ',
    }

    return labels[status] || status || 'Chưa xác định'
  }

  const getStatusStyle = (status) => {
    if (status === 'OCCUPIED') return 'occupied-cell'
    if (status === 'MAINTENANCE' || status === 'UNDER_MAINTENANCE') return 'maintenance-cell'
    return 'available-cell'
  }

  const handleShipSelectedLocation = () => {
    if (selectedLocation?.status !== 'OCCUPIED') return

    const items = selectedLocation.inventoryItems || []
    const description = items.length > 1
      ? `${items.length} lô (${items.map((item) => item.productCode).filter(Boolean).join(', ')})`
      : selectedLocation.productName || selectedLocation.lotId || selectedLocation.id
    if (!window.confirm(`Xác nhận xuất toàn bộ hàng ${description} khỏi vị trí ${selectedLocation.id}?`)) return

    if (!onShipLocation(selectedLocation.id)) {
      setShipMessage('Không thể xuất hàng tại vị trí này. Hãy kiểm tra lại trạng thái ô.')
      return
    }

    setSelectedLocation((current) => ({
      ...current,
      status: 'AVAILABLE',
      inventoryItems: [],
      customerId: null,
      lotId: null,
      palletNote: null,
      productName: null,
      quantity: null,
      packageCount: null,
      cbm: null,
      grossWeightKg: null,
      netWeightKg: null,
    }))
    setShipMessage(`Đã xuất hàng khỏi vị trí ${selectedLocation.id}.`)
  }

  return (
    <div className="location-modal-overlay">

      <div className="location-modal">

        <div className="location-modal-header">
          <div>
            <p>KHUNG LƯU TRỮ</p>

            <h2>
              {frame.isPlaceholder ? `${frame.row}-CHỜ` : `${frame.row}-${frameNumber}`}
            </h2>

            <span>
              Khu vực: {frame.zone}
            </span>
          </div>

          <button
            className="modal-close-button"
            onClick={onClose}
          >
            ×
          </button>
        </div>


        <div className="rack-detail">

          {levels.map((level) => (
            <div
              className="rack-level"
              key={level}
            >

              <div className="level-name">
                Tầng {level}
              </div>

              <div className="level-locations">

                {positions.map((position) => {

                  const locationId =
                    `${frame.row}-${frameNumber}-${level}${position}`

                  const location =
                    frameLocations.find((item) => item.id === locationId) || {
                      id: locationId,
                      row: frame.row,
                      frame: frame.frame || 0,
                      level,
                      position,
                      zone: frame.zone,
                      status: 'AVAILABLE',
                      customerId: null,
                      lotId: null,
                      palletNote: null,
                    }

                  return (
                    <button
                      className={`location-cell ${getStatusStyle(location.status)}`}
                      key={locationId}
                      onClick={() => {
                        setSelectedLocation(location)
                        setShipMessage('')
                      }}
                    >
                      <strong>
                        {level}{position}
                      </strong>

                      <span>
                        {formatStatus(location.status)}
                      </span>
                    </button>
                  )
                })}

              </div>

            </div>
          ))}

        </div>

{selectedLocation && (
    <div className="selected-location-detail">
        <h3>Chi tiết vị trí</h3>

        <p>
            <strong>Mã vị trí:</strong> {selectedLocation.id}
        </p>

        <p>
          <strong>Trạng thái:</strong> {formatStatus(selectedLocation.status)}
        </p>

        {selectedLocation.inventoryItems?.length ? (
          <div className="selected-location-batches">
            <h4>Các lô trong ô ({selectedLocation.inventoryItems.length})</h4>
            {selectedLocation.inventoryItems.map((item) => (
              <article key={item.batchId || `${item.sourceRow}-${item.position}`}>
                <dl className="batch-info-grid">
                  <div><dt>Mã hàng</dt><dd>{item.productCode || '—'}</dd></div>
                  <div><dt>Tên hàng</dt><dd>{item.productName || '—'}</dd></div>
                  <div><dt>Số lượng</dt><dd>{item.quantity || '—'}</dd></div>
                  <div><dt>Số kiện</dt><dd>{item.packageCount ?? '—'}</dd></div>
                  <div><dt>Ghi chú pallet</dt><dd>{item.palletNote || '—'}</dd></div>
                  <div><dt>Nhà cung cấp</dt><dd>{item.supplier || '—'}</dd></div>
                  <div>
                    <dt>Ngày nhập kho</dt>
                    <dd>{item.receivedDate || (item.receivedAt ? new Date(item.receivedAt).toLocaleDateString('vi-VN') : '—')}</dd>
                  </div>
                  <div><dt>GW</dt><dd>{item.grossWeightKg ?? '—'}{item.grossWeightKg != null ? ' kg' : ''}</dd></div>
                  <div><dt>NW</dt><dd>{item.netWeightKg ?? '—'}{item.netWeightKg != null ? ' kg' : ''}</dd></div>
                </dl>
              </article>
            ))}
          </div>
        ) : (
          <>
            <p><strong>Sản phẩm:</strong> {selectedLocation.productName || 'Chưa có'}</p>
            <p><strong>Số lượng:</strong> {selectedLocation.quantity || 'Chưa có'}</p>
            <p><strong>Nhà cung cấp:</strong> {selectedLocation.customerId || 'Chưa có'}</p>
            <p><strong>Mã lô:</strong> {selectedLocation.lotId || 'Chưa có'}</p>
            <p><strong>Ghi chú pallet:</strong> {selectedLocation.palletNote || 'Chưa có'}</p>
          </>
        )}

        {selectedLocation.status === 'OCCUPIED' && (
          <button
            className="location-ship-button"
            type="button"
            onClick={handleShipSelectedLocation}
          >
            Xuất hàng khỏi ô này
          </button>
        )}

        {shipMessage && <p className="location-ship-message" role="status">{shipMessage}</p>}
    </div>
)}
        <div className="location-modal-footer">

          <div className="location-status">
            <span className="status-dot"></span>

            {availableCount} / {totalSlots} vị trí trống
          </div>

          <button
            className="close-detail-button"
            onClick={onClose}
          >
            Đóng
          </button>

        </div>

      </div>

    </div>
  )
}

export default LocationModal