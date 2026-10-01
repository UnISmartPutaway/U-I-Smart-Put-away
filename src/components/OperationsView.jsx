import { useState } from 'react'
import WarehouseMap from './WarehouseMap'
import { LEVELS } from '../data/warehouseConfig'

const PAGE_SIZE = 25

const formatStatus = (status) => {
  if (status === 'OCCUPIED') return 'Có hàng'
  if (status === 'AVAILABLE') return 'Trống'
  if (status === 'MAINTENANCE' || status === 'UNDER_MAINTENANCE') return 'Bảo trì'
  return status || 'Chưa xác định'
}

function LocationTable({ locations, allowShipment, onShipLocation }) {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [actionMessage, setActionMessage] = useState('')
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filteredLocations = locations.filter((location) => {
    const searchable = [
      location.id,
      location.lotId,
      location.productName,
      location.customerId,
    ].join(' ').toLocaleLowerCase()
    return searchable.includes(normalizedQuery)
  })
  const pageCount = Math.max(1, Math.ceil(filteredLocations.length / PAGE_SIZE))
  const visiblePage = Math.min(page, pageCount)
  const pageLocations = filteredLocations.slice(
    (visiblePage - 1) * PAGE_SIZE,
    visiblePage * PAGE_SIZE
  )

  const handleShip = (location) => {
    const description = location.productName || location.lotId || location.id
    if (!window.confirm(`Xác nhận xuất ${description} khỏi vị trí ${location.id}?`)) return

    setActionMessage(
      onShipLocation(location.id)
        ? `Đã xuất hàng khỏi vị trí ${location.id}.`
        : 'Không thể xuất hàng tại vị trí này.'
    )
  }

  return (
    <section className="operations-panel">
      <div className="operations-toolbar">
        <label htmlFor="location-search">Tìm mã vị trí, mã hàng, tên hàng hoặc nhà cung cấp</label>
        <input
          id="location-search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setPage(1)
          }}
          placeholder="Nhập từ khóa cần tìm"
        />
        <span>{filteredLocations.length.toLocaleString('vi-VN')} vị trí</span>
      </div>

      {actionMessage && <p className="operations-message" role="status">{actionMessage}</p>}

      {pageLocations.length ? (
        <div className="operations-table-wrap">
          <table className="operations-table">
            <thead>
              <tr>
                <th>Vị trí</th>
                <th>Trạng thái</th>
                <th>Mã hàng</th>
                <th>Sản phẩm</th>
                <th>Nhà cung cấp</th>
                <th>GW (kg)</th>
                {allowShipment && <th>Thao tác</th>}
              </tr>
            </thead>
            <tbody>
              {pageLocations.map((location) => (
                <tr key={location.id}>
                  <td><strong>{location.id}</strong></td>
                  <td>
                    <span className={`operations-status operations-status--${location.status.toLowerCase()}`}>
                      {formatStatus(location.status)}
                    </span>
                  </td>
                  <td>{location.lotId || '—'}</td>
                  <td>{location.productName || '—'}</td>
                  <td>{location.customerId || '—'}</td>
                  <td>{location.grossWeightKg || '—'}</td>
                  {allowShipment && (
                    <td>
                      {location.status === 'OCCUPIED' && (
                        <button
                          className="operations-button operations-button--danger"
                          type="button"
                          onClick={() => handleShip(location)}
                        >
                          Xuất hàng
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="operations-empty">Không tìm thấy vị trí phù hợp.</div>
      )}

      <div className="operations-pagination">
        <span>Trang {visiblePage} / {pageCount}</span>
        <div>
          <button type="button" disabled={visiblePage <= 1} onClick={() => setPage(visiblePage - 1)}>
            Trước
          </button>
          <button type="button" disabled={visiblePage >= pageCount} onClick={() => setPage(visiblePage + 1)}>
            Sau
          </button>
        </div>
      </div>
    </section>
  )
}

function OperationsView({
  view,
  locations,
  inboundPlacements,
  onOpenScanner,
  onShipLocation,
  onExportBackup,
  onResetInventory,
}) {
  const occupied = locations.filter((location) => location.status !== 'AVAILABLE')
  const availableCount = locations.filter((location) => location.status === 'AVAILABLE').length
  const occupiedCount = occupied.length

  if (view === 'map') {
    return <WarehouseMap locations={locations} onShipLocation={onShipLocation} />
  }

  if (view === 'inventory' || view === 'outbound') {
    const isOutbound = view === 'outbound'
    return (
      <>
        <section className="operations-heading">
          <h2>{isOutbound ? 'Xuất hàng' : 'Tồn kho'}</h2>
          <p>
            {isOutbound
              ? 'Tra cứu hàng đang lưu và xuất khỏi vị trí sau khi xác nhận.'
              : 'Tìm kiếm trạng thái và thông tin của các vị trí trong kho.'}
          </p>
        </section>
        <LocationTable
          locations={isOutbound ? occupied : locations}
          allowShipment={isOutbound}
          onShipLocation={onShipLocation}
        />
      </>
    )
  }

  if (view === 'inbound') {
    return (
      <>
        <section className="operations-heading">
          <div>
            <h2>Nhập kho</h2>
            <p>Chọn vị trí đề xuất hoặc nhập ô tùy chỉnh trong bước xác nhận cất hàng.</p>
          </div>
          <button className="operations-button" type="button" onClick={onOpenScanner}>
            Tạo phiếu nhập
          </button>
        </section>
        <section className="operations-panel">
          <div className="operations-panel-heading">
            <h3>Lần nhập trên thiết bị này</h3>
            <span>{inboundPlacements.length} lô</span>
          </div>
          {inboundPlacements.length ? (
            <div className="operations-table-wrap">
              <table className="operations-table">
                <thead>
                  <tr><th>Mã hàng</th><th>Sản phẩm</th><th>Vị trí</th><th>GW (kg)</th><th>Thời gian</th></tr>
                </thead>
                <tbody>
                  {[...inboundPlacements].reverse().map((placement) => (
                    <tr key={`${placement.locationId}-${placement.receivedAt}`}>
                      <td>{placement.productCode}</td>
                      <td>{placement.productName}</td>
                      <td><strong>{placement.locationId}</strong></td>
                      <td>{placement.grossWeightKg || '—'}</td>
                      <td>{placement.receivedAt ? new Date(placement.receivedAt).toLocaleString('vi-VN') : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="operations-empty">Chưa có lần nhập hàng mới trên thiết bị này.</div>
          )}
        </section>
      </>
    )
  }

  if (view === 'customers') {
    const customers = new Map()
    for (const location of occupied) {
      const customerId = location.customerId || 'Chưa xác định'
      const current = customers.get(customerId) || { customerId, slots: 0, products: new Set() }
      current.slots += 1
      if (location.productName) current.products.add(location.productName)
      customers.set(customerId, current)
    }
    const customerRows = [...customers.values()].sort((left, right) => right.slots - left.slots)

    return (
      <>
        <section className="operations-heading">
          <h2>Khách hàng / nhà cung cấp</h2>
          <p>Danh sách được tổng hợp từ thông tin nhà cung cấp trên các vị trí đang có hàng.</p>
        </section>
        <section className="operations-panel">
          <div className="operations-table-wrap">
            <table className="operations-table">
              <thead><tr><th>Nhà cung cấp</th><th>Vị trí đang sử dụng</th><th>Nhóm sản phẩm</th></tr></thead>
              <tbody>
                {customerRows.map((customer) => (
                  <tr key={customer.customerId}>
                    <td><strong>{customer.customerId}</strong></td>
                    <td>{customer.slots.toLocaleString('vi-VN')}</td>
                    <td>{[...customer.products].slice(0, 5).join(', ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </>
    )
  }

  if (view === 'reports') {
    const occupiedByLevel = LEVELS.map((level) => ({
      level,
      occupied: occupied.filter((location) => location.level === level).length,
      available: locations.filter((location) => location.level === level && location.status === 'AVAILABLE').length,
    }))

    return (
      <>
        <section className="operations-heading">
          <h2>Báo cáo kho</h2>
          <p>Số liệu được tính trực tiếp từ trạng thái vị trí hiện tại.</p>
        </section>
        <div className="operations-summary-grid">
          <div><span>Tổng vị trí</span><strong>{locations.length.toLocaleString('vi-VN')}</strong></div>
          <div><span>Đang sử dụng</span><strong>{occupiedCount.toLocaleString('vi-VN')}</strong></div>
          <div><span>Còn trống</span><strong>{availableCount.toLocaleString('vi-VN')}</strong></div>
          <div><span>Tỷ lệ lấp đầy</span><strong>{locations.length ? `${Math.round(occupiedCount / locations.length * 100)}%` : '0%'}</strong></div>
        </div>
        <section className="operations-panel">
          <div className="operations-panel-heading"><h3>Phân bổ theo tầng</h3></div>
          <div className="operations-table-wrap">
            <table className="operations-table">
              <thead><tr><th>Tầng</th><th>Đang sử dụng</th><th>Còn trống</th></tr></thead>
              <tbody>
                {occupiedByLevel.map((row) => (
                  <tr key={row.level}><td>Tầng {row.level}</td><td>{row.occupied.toLocaleString('vi-VN')}</td><td>{row.available.toLocaleString('vi-VN')}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </>
    )
  }

  if (view === 'settings') {
    return (
      <>
        <section className="operations-heading">
          <h2>Cài đặt dữ liệu</h2>
          <p>Quản lý các lượt nhập và xuất được lưu trong trình duyệt hiện tại.</p>
        </section>
        <section className="operations-panel operations-settings">
          <div>
            <h3>Sao lưu dữ liệu kho cục bộ</h3>
            <p>Tải xuống các lượt nhập mới và danh sách vị trí đã xuất trên thiết bị này.</p>
            <button className="operations-button" type="button" onClick={onExportBackup}>Tải bản sao lưu</button>
          </div>
          <div>
            <h3>Khôi phục trạng thái dữ liệu gốc</h3>
            <p>Xóa các điều chỉnh nhập/xuất cục bộ. Dữ liệu tồn kho ban đầu không bị thay đổi.</p>
            <button className="operations-button operations-button--danger" type="button" onClick={onResetInventory}>
              Khôi phục dữ liệu gốc
            </button>
          </div>
        </section>
      </>
    )
  }

  return (
    <section className="operations-smart">
      <div className="operations-smart-mark">AI</div>
      <h2>{view === 'scanner' ? 'Máy quét kho' : 'Đặt hàng thông minh'}</h2>
      <p>
        {view === 'scanner'
          ? 'Tra cứu mã hàng hoặc vị trí; từ kết quả có thể xuất hàng khỏi ô đang sử dụng.'
          : 'Nhập thông tin lô để xếp hạng vị trí phù hợp. Bạn vẫn có thể chọn một ô trống khác.'}
      </p>
      <button className="operations-button" type="button" onClick={onOpenScanner}>
        {view === 'scanner' ? 'Mở máy quét' : 'Quét lô và đề xuất vị trí'}
      </button>
    </section>
  )
}

export default OperationsView