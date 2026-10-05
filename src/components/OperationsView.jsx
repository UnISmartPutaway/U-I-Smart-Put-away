import { useState } from 'react'
import WarehouseMap from './WarehouseMap'
import { LEVELS } from '../data/warehouseConfig'
import { fitsStorageSlot, SCORE_WEIGHTS, STORAGE_SLOT_LIMITS } from '../data/recommendationEngine'

const PAGE_SIZE = 25

const formatStatus = (status) => {
  if (status === 'OCCUPIED') return 'Có hàng'
  if (status === 'AVAILABLE') return 'Trống'
  if (status === 'RESERVED') return 'Đã giữ chỗ · chờ put-away'
  if (status === 'BLOCKED') return 'Ô lỗi / đã khóa'
  if (status === 'MAINTENANCE' || status === 'UNDER_MAINTENANCE') return 'Bảo trì'
  return status || 'Chưa xác định'
}

function LocationTable({ locations, allowShipment, onShipLocation, onToggleLocationBlock }) {
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
      ...(location.inventoryItems || []).flatMap((item) => [
        item.productCode,
        item.productName,
        item.supplier,
        item.palletNote,
      ]),
    ].join(' ').toLocaleLowerCase()
    return searchable.includes(normalizedQuery)
  }).sort((left, right) => {
    const leftAvailable = left.status === 'AVAILABLE'
    const rightAvailable = right.status === 'AVAILABLE'
    if (leftAvailable !== rightAvailable) return leftAvailable ? 1 : -1
    return left.id.localeCompare(right.id)
  })
  const occupiedCount = locations.filter((location) => location.status === 'OCCUPIED').length
  const countLabel = normalizedQuery
    ? `${filteredLocations.length.toLocaleString('vi-VN')} kết quả`
    : allowShipment
      ? `${filteredLocations.length.toLocaleString('vi-VN')} vị trí có hàng`
      : `${occupiedCount.toLocaleString('vi-VN')} có hàng`
  const pageCount = Math.max(1, Math.ceil(filteredLocations.length / PAGE_SIZE))
  const visiblePage = Math.min(page, pageCount)
  const pageLocations = filteredLocations.slice(
    (visiblePage - 1) * PAGE_SIZE,
    visiblePage * PAGE_SIZE
  )

  const handleShip = (location) => {
    const items = location.inventoryItems || []
    const description = items.length > 1
      ? `${items.length} lô (${items.map((item) => item.productCode).filter(Boolean).join(', ')})`
      : location.productName || location.lotId || location.id
    if (!window.confirm(`Xác nhận xuất toàn bộ hàng ${description} khỏi vị trí ${location.id}?`)) return

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
        <span>{countLabel}</span>
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
                {(allowShipment || onToggleLocationBlock) && <th>Thao tác</th>}
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
                  <td>{location.inventoryItems?.length
                    ? location.inventoryItems.map((item) => item.productCode).filter(Boolean).join(', ')
                    : location.lotId || '—'}</td>
                  <td>{location.inventoryItems?.length
                    ? location.inventoryItems.map((item) => item.productName).filter(Boolean).join(', ')
                    : location.productName || '—'}</td>
                  <td>{location.customerId || '—'}</td>
                  <td>{location.grossWeightKg || '—'}</td>
                  {(allowShipment || onToggleLocationBlock) && (
                    <td>
                      {(location.status === 'OCCUPIED' ||
                        (location.status === 'BLOCKED' && (location.inventoryItems?.length || location.lotId))) && (
                        <button
                          className="operations-button operations-button--danger"
                          type="button"
                          onClick={() => handleShip(location)}
                        >
                          Xuất hàng
                        </button>
                      )}
                      {onToggleLocationBlock && (
                        <button
                          className={`operations-button ${location.isBlocked ? 'operations-button--danger' : ''}`}
                          type="button"
                          onClick={() => {
                            const shouldBlock = !location.isBlocked
                            if (shouldBlock && location.reservedTask) {
                              setActionMessage(`Không thể khóa ${location.id} khi lô ${location.reservedTask.productCode} đang giữ chỗ trong luồng Put-away.`)
                              return
                            }
                            setActionMessage(
                              onToggleLocationBlock(location.id, shouldBlock)
                                ? shouldBlock
                                  ? `Đã đánh dấu ${location.id} là ô lỗi; vị trí sẽ bị loại khỏi đề xuất.`
                                  : `Đã mở khóa vị trí ${location.id}.`
                                : 'Không thể cập nhật trạng thái vị trí. Hãy thử lại.'
                            )
                          }}
                        >
                          {location.isBlocked ? 'Mở khóa ô' : 'Báo ô lỗi'}
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
  user,
  locations,
  inboundPlacements,
  putAwayLog,
  outboundLog,
  locationDiscrepancies,
  reportedMismatchLocationIds,
  onOpenScanner,
  onShipLocation,
  onToggleLocationBlock,
  onResolveLocationMismatch,
  onExportBackup,
  onResetInventory,
  onChangePassword,
  smartPutawayAnalysis,
  onSelectSmartRecommendation,
  onShowSmartLocation,
  onConfirmSmartPlacement,
  smartMapLocationId,
}) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordMessage, setPasswordMessage] = useState('')
  const [passwordError, setPasswordError] = useState(false)
  const [isChangingPassword, setIsChangingPassword] = useState(false)
  const occupied = locations.filter((location) => location.status === 'OCCUPIED' ||
    (location.status === 'BLOCKED' && (location.inventoryItems?.length || location.lotId)))
  const availableCount = locations.filter((location) => location.status === 'AVAILABLE').length
  const occupiedCount = occupied.length

  if (view === 'map') {
    const highlightedLocation = locations.find((location) => location.id === smartMapLocationId)
    return (
      <WarehouseMap
        locations={locations}
        onShipLocation={onShipLocation}
        highlightFrameIds={highlightedLocation ? [`${highlightedLocation.row}-${highlightedLocation.frame}`] : []}
      />
    )
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
          onToggleLocationBlock={!isOutbound ? onToggleLocationBlock : undefined}
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
            <p>Quét thông tin lô để xem vị trí đề xuất và xác nhận cất hàng.</p>
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
      const items = location.inventoryItems?.length
        ? location.inventoryItems
        : [{ supplier: location.customerId, productName: location.productName }]

      for (const item of items) {
        const customerId = item.supplier || 'Chưa xác định'
        const current = customers.get(customerId) || { customerId, slots: new Set(), products: new Set() }
        current.slots.add(location.id)
        if (item.productName) current.products.add(item.productName)
        customers.set(customerId, current)
      }
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
                    <td>{customer.slots.size.toLocaleString('vi-VN')}</td>
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

  if (view === 'putaway-log') {
    const openDiscrepancies = locationDiscrepancies.filter((report) => report.status === 'OPEN')
    return (
      <>
        <section className="operations-heading">
          <h2>Nhật ký Put-away</h2>
          <p>Lịch sử cất hàng, nhân viên thực hiện, vị trí AI đề xuất và vị trí thực tế được chọn.</p>
        </section>
        <div className="operations-summary-grid">
          <div><span>Tổng lượt cất</span><strong>{putAwayLog.length.toLocaleString('vi-VN')}</strong></div>
          <div><span>Theo vị trí AI tốt nhất</span><strong>{putAwayLog.filter((entry) => entry.followedSuggestion).length.toLocaleString('vi-VN')}</strong></div>
          <div><span>Chọn vị trí khác / nhập tay</span><strong>{putAwayLog.filter((entry) => !entry.followedSuggestion).length.toLocaleString('vi-VN')}</strong></div>
          <div><span>Sai lệch chờ kiểm kê</span><strong>{openDiscrepancies.length.toLocaleString('vi-VN')}</strong></div>
        </div>
        <section className="operations-panel">
          <div className="operations-panel-heading">
            <h3>Lịch sử cất hàng</h3>
            <span>{putAwayLog.length} lượt</span>
          </div>
          {putAwayLog.length ? (
            <div className="operations-table-wrap">
              <table className="operations-table">
                <thead>
                  <tr><th>Thời gian</th><th>Nhân viên</th><th>Mã hàng</th><th>Sản phẩm</th><th>AI đề xuất</th><th>Đã cất tại</th><th>Thực hiện</th></tr>
                </thead>
                <tbody>
                  {[...putAwayLog].reverse().map((entry) => (
                    <tr key={entry.id}>
                      <td>{entry.receivedAt ? new Date(entry.receivedAt).toLocaleString('vi-VN') : '—'}</td>
                      <td>{entry.employeeName || entry.employeeUsername || '—'}</td>
                      <td>{entry.productCode || '—'}</td>
                      <td>{entry.productName || '—'}</td>
                      <td>{entry.suggestedLocationId || '—'}</td>
                      <td><strong>{entry.selectedLocationId || '—'}</strong></td>
                      <td>{entry.selectionMethod === 'MANUAL' ? 'Nhập tay' : entry.followedSuggestion ? 'Theo AI' : 'Chọn vị trí khác'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="operations-empty">Chưa có lịch sử Put-away trên thiết bị này.</div>
          )}
        </section>
        <section className="operations-panel">
          <div className="operations-panel-heading">
            <h3>Lịch sử xuất hàng</h3>
            <span>{new Set(outboundLog.map((entry) => entry.shipmentId)).size} lượt xuất · {outboundLog.length} mặt hàng</span>
          </div>
          {outboundLog.length ? (
            <div className="operations-table-wrap">
              <table className="operations-table">
                <thead>
                  <tr><th>Thời gian xuất</th><th>Nhân viên</th><th>Vị trí</th><th>Mã hàng / lô</th><th>Sản phẩm</th><th>Số lượng</th><th>GW (kg)</th></tr>
                </thead>
                <tbody>
                  {[...outboundLog].reverse().map((entry) => (
                    <tr key={entry.id}>
                      <td>{entry.shippedAt ? new Date(entry.shippedAt).toLocaleString('vi-VN') : '—'}</td>
                      <td>{entry.employeeName || entry.employeeUsername || '—'}</td>
                      <td><strong>{entry.locationId || '—'}</strong></td>
                      <td>{entry.productCode || entry.palletCode || entry.lotCode || '—'}</td>
                      <td>{entry.productName || '—'}</td>
                      <td>{entry.quantity ?? '—'}</td>
                      <td>{entry.grossWeightKg ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="operations-empty">Chưa có lịch sử xuất hàng trên thiết bị này.</div>
          )}
        </section>
        <section className="operations-panel">
          <div className="operations-panel-heading">
            <h3>Sai lệch vị trí cần kiểm kê</h3>
            <span>{openDiscrepancies.length} chưa xử lý</span>
          </div>
          {locationDiscrepancies.length ? (
            <div className="operations-table-wrap">
              <table className="operations-table">
                <thead><tr><th>Thời gian báo</th><th>Nhân viên</th><th>Vị trí sai lệch</th><th>Mã hàng lô nhập</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
                <tbody>
                  {[...locationDiscrepancies].reverse().map((report) => (
                    <tr key={report.id}>
                      <td>{report.reportedAt ? new Date(report.reportedAt).toLocaleString('vi-VN') : '—'}</td>
                      <td>{report.employeeName || '—'}</td>
                      <td><strong>{report.locationId}</strong></td>
                      <td>{report.productCode || '—'}</td>
                      <td>{report.status === 'OPEN' ? 'Chờ kiểm kê' : 'Đã xử lý'}</td>
                      <td>{report.status === 'OPEN' && (
                        <button
                          className="operations-button"
                          type="button"
                          onClick={() => onResolveLocationMismatch(report.id)}
                        >
                          Đánh dấu đã kiểm kê
                        </button>
                      )}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="operations-empty">Chưa có báo cáo sai lệch vị trí.</div>
          )}
        </section>
        {reportedMismatchLocationIds.length > 0 && (
          <p className="operations-message" role="status">
            Vị trí đang chờ kiểm kê tạm thời bị loại khỏi danh sách đề xuất.
          </p>
        )}
      </>
    )
  }

  if (view === 'settings') {
    const handlePasswordChange = async (event) => {
      event.preventDefault()
      setPasswordMessage('')

      if (newPassword.length < 6) {
        setPasswordError(true)
        setPasswordMessage('Mật khẩu mới cần có ít nhất 6 ký tự.')
        return
      }
      if (newPassword !== confirmPassword) {
        setPasswordError(true)
        setPasswordMessage('Mật khẩu xác nhận chưa khớp.')
        return
      }
      if (newPassword === currentPassword) {
        setPasswordError(true)
        setPasswordMessage('Mật khẩu mới phải khác mật khẩu hiện tại.')
        return
      }

      setIsChangingPassword(true)
      const result = await onChangePassword(currentPassword, newPassword)
      setIsChangingPassword(false)
      setPasswordError(!result.success)
      setPasswordMessage(result.message)
      if (result.success) {
        setCurrentPassword('')
        setNewPassword('')
        setConfirmPassword('')
      }
    }

    return (
      <>
        <section className="operations-heading">
          <h2>{user?.role === 'ADMIN' ? 'Cài đặt tài khoản và dữ liệu' : 'Cài đặt tài khoản'}</h2>
          <p>{user?.role === 'ADMIN'
            ? 'Quản lý mật khẩu tài khoản và dữ liệu kho được lưu trong trình duyệt hiện tại.'
            : 'Quản lý mật khẩu tài khoản đang đăng nhập trên trình duyệt này.'}</p>
        </section>
        <section className="operations-panel password-settings">
          <div className="operations-panel-heading">
            <h3>Đổi mật khẩu</h3>
            <span>Tài khoản: {user?.username || '—'}</span>
          </div>
          <form className="password-change-form" onSubmit={handlePasswordChange}>
            <label>
              Mật khẩu hiện tại
              <input
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                required
              />
            </label>
            <label>
              Mật khẩu mới
              <input
                type="password"
                autoComplete="new-password"
                minLength={6}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                required
              />
            </label>
            <label>
              Xác nhận mật khẩu mới
              <input
                type="password"
                autoComplete="new-password"
                minLength={6}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
              />
            </label>
            <p className="password-form-hint">Mật khẩu phải có ít nhất 6 ký tự. Lưu ý: mật khẩu demo được lưu riêng trên trình duyệt hiện tại.</p>
            <button className="operations-button" type="submit" disabled={isChangingPassword}>
              {isChangingPassword ? 'Đang cập nhật...' : 'Cập nhật mật khẩu'}
            </button>
            {passwordMessage && (
              <p className={`operations-message ${passwordError ? 'operations-message--error' : ''}`} role={passwordError ? 'alert' : 'status'}>
                {passwordMessage}
              </p>
            )}
          </form>
        </section>
        {user?.role === 'ADMIN' && (
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
        )}
      </>
    )
  }

  if (view === 'smart') {
    const analysis = smartPutawayAnalysis || { status: 'idle', batch: null, recommendations: [] }
    const batch = analysis.batch
    const recommendations = analysis.recommendations || []
    const selectedRecommendation = recommendations.find(
      (recommendation) => recommendation.location.id === analysis.selectedLocationId
    ) || recommendations[0]
    const selectedIsBest = selectedRecommendation?.location.id === recommendations[0]?.location.id
    const availableLocationCount = locations.filter((location) => location.status === 'AVAILABLE').length
    const waitingPlacementCount = locations.filter((location) => location.status === 'RESERVED').length
    const fits = batch ? fitsStorageSlot(batch) : null
    const scoreFactors = selectedRecommendation
      ? [
          { key: 'safety', label: 'Không gian / Chiều cao & An toàn', weight: SCORE_WEIGHTS.safety },
          { key: 'travel', label: 'Quãng đường di chuyển', weight: SCORE_WEIGHTS.travel },
          { key: 'weightLevel', label: 'Trọng lượng & Tầng', weight: SCORE_WEIGHTS.weightLevel },
          { key: 'group', label: 'Phù hợp nhóm hàng', weight: SCORE_WEIGHTS.group },
          { key: 'movementHistory', label: 'Lịch sử di chuyển', weight: SCORE_WEIGHTS.movementHistory },
        ].map((factor) => ({
          ...factor,
          value: selectedRecommendation.factors[factor.key],
          points: selectedRecommendation.factors[factor.key] * factor.weight,
        }))
      : []
    const completedSteps = analysis.status === 'confirmed'
      ? 7
      : analysis.status === 'ready'
        ? 6
        : analysis.status === 'analyzing'
          ? 2
          : analysis.status === 'reading'
            ? 1
            : 0
    const processSteps = [
      'Quét pallet',
      'Đọc dữ liệu',
      'Kiểm tra ràng buộc',
      'Chấm điểm vị trí',
      'Xếp hạng',
      'Đề xuất vị trí',
      'Xác nhận Put-away',
    ]
    const scanCode = (event) => {
      event.preventDefault()
      onOpenScanner(event.currentTarget.elements.namedItem('smart-pallet-code').value.trim())
    }

    return (
      <div className="smart-putaway-dashboard">
        <section className="smart-engine-overview">
          <div className="smart-engine-status">
            <span className={`smart-engine-indicator ${analysis.status === 'analyzing' ? 'smart-engine-indicator--busy' : ''}`} />
            <div>
              <span className="smart-engine-label">SMART PUT-AWAY ENGINE</span>
              <strong>
                {analysis.status === 'analyzing'
                  ? 'Đang phân tích'
                  : analysis.status === 'ready'
                    ? 'Đã tìm thấy vị trí phù hợp'
                    : analysis.status === 'confirmed'
                      ? 'Đã xác nhận phương án'
                      : 'Hệ thống hoạt động'}
              </strong>
              <small>{analysis.status === 'idle' ? 'Sẵn sàng nhận pallet mới' : 'Phân tích từ dữ liệu kho hiện tại'}</small>
            </div>
          </div>
          <div className="smart-engine-metrics">
            <div><span>Vị trí còn trống</span><strong>{availableLocationCount.toLocaleString('vi-VN')}</strong></div>
            <div><span>Pallet đang trong luồng put-away</span><strong>{waitingPlacementCount.toLocaleString('vi-VN')}</strong></div>
          </div>
        </section>

        <section className="smart-scan-card">
          <div className="smart-scan-copy">
            <span className="smart-section-kicker">ĐIỂM BẮT ĐẦU</span>
            <h2>Quét pallet / lô hàng</h2>
            <p>Quét mã QR, mã vạch hoặc nhập mã pallet để đọc dữ liệu và phân tích vị trí lưu trữ.</p>
          </div>
          <div className="smart-scan-actions">
            <button className="smart-scan-primary" type="button" onClick={() => onOpenScanner()}>
              <span aria-hidden="true">▦</span> Quét QR / Mã vạch
            </button>
            <form className="smart-manual-scan" onSubmit={scanCode}>
              <label htmlFor="smart-pallet-code">Hoặc nhập mã thủ công</label>
              <div>
                <input id="smart-pallet-code" name="smart-pallet-code" placeholder="Nhập mã pallet / lô hàng" required />
                <button type="submit">Phân tích mã</button>
              </div>
            </form>
          </div>
        </section>

        {analysis.status === 'confirmed' && (
          <p className="smart-confirmed-banner" role="status">
            Đã xác nhận vị trí {analysis.selectedLocationId}; lô hàng đã được đưa vào luồng chờ nâng chuyển.
          </p>
        )}

        <section className="smart-process-panel">
          <div className="smart-panel-heading">
            <div><span className="smart-section-kicker">THEO DÕI PHÂN TÍCH</span><h3>Quy trình Smart Put-away</h3></div>
            <span>{analysis.status === 'confirmed' ? 'Đã hoàn tất lựa chọn' : batch ? 'Đang xử lý pallet' : 'Đang chờ pallet'}</span>
          </div>
          <ol className="smart-process-steps">
            {processSteps.map((step, index) => {
              const isComplete = index < completedSteps
              const isCurrent = index === completedSteps && completedSteps < processSteps.length
              return (
                <li className={`smart-process-step ${isComplete ? 'is-complete' : ''} ${isCurrent ? 'is-current' : ''}`} key={step}>
                  <span className="smart-step-marker">{isComplete ? '✓' : index + 1}</span>
                  <span>{step}</span>
                </li>
              )
            })}
          </ol>
        </section>

        {batch && (
          <section className="smart-analysis-layout">
            <article className="smart-pallet-card">
              <div className="smart-panel-heading">
                <div><span className="smart-section-kicker">NHẬN DIỆN THÀNH CÔNG</span><h3>Pallet đang xử lý</h3></div>
                <span className={`smart-state-badge ${analysis.status === 'confirmed' ? 'smart-state-badge--success' : ''}`}>
                  {analysis.status === 'confirmed' ? 'Đã xác nhận vị trí' : 'Dữ liệu đã đọc'}
                </span>
              </div>
              <div className="smart-pallet-identity">
                <div className="smart-pallet-icon" aria-hidden="true">▤</div>
                <div><span>Mã pallet</span><strong>{batch.palletCode || batch.palletId || 'Chưa có mã pallet'}</strong></div>
              </div>
              <dl className="smart-pallet-details">
                <div><dt>Mã lô hàng</dt><dd>{batch.lotCode || batch.lotId || batch.productCode || '—'}</dd></div>
                <div><dt>Mã sản phẩm</dt><dd>{batch.productCode || '—'}</dd></div>
                <div><dt>Tên hàng</dt><dd>{batch.productName || '—'}</dd></div>
                <div><dt>Khối lượng GW</dt><dd>{batch.grossWeightKg || '—'}{batch.grossWeightKg ? ' kg' : ''}</dd></div>
                <div><dt>Kích thước D × R × C</dt><dd>{batch.depthCm || '—'} × {batch.widthCm || '—'} × {batch.heightCm || '—'} cm</dd></div>
                <div><dt>Thể tích</dt><dd>{batch.cbm || '—'}{batch.cbm ? ' m³' : ''}</dd></div>
                <div><dt>Số lượng</dt><dd>{batch.quantity || '—'}</dd></div>
                <div><dt>Nhà cung cấp</dt><dd>{batch.supplier || batch.customerId || '—'}</dd></div>
                {batch.netWeightKg && <div><dt>Khối lượng NW</dt><dd>{batch.netWeightKg} kg</dd></div>}
                {batch.palletNote && <div className="smart-pallet-note"><dt>Ghi chú pallet</dt><dd>{batch.palletNote}</dd></div>}
              </dl>
            </article>

            <article className="smart-recommendation-card">
              <div className="smart-recommendation-heading">
                <div><span className="smart-section-kicker">ĐỀ XUẤT TỪ THUẬT TOÁN</span><h3>Vị trí đề xuất</h3></div>
                <span className={`smart-state-badge ${selectedRecommendation ? 'smart-state-badge--success' : 'smart-state-badge--warning'}`}>
                  {selectedRecommendation ? (selectedIsBest ? 'Phù hợp tối ưu' : 'Phương án thay thế') : 'Chưa tìm thấy ô phù hợp'}
                </span>
              </div>
              {selectedRecommendation ? (
                <>
                  <div className="smart-best-slot">
                    <div><span>{selectedIsBest ? 'VỊ TRÍ XẾP HẠNG CAO NHẤT' : 'VỊ TRÍ ĐANG CHỌN'}</span><strong>{selectedRecommendation.location.id}</strong></div>
                    <div className="smart-score"><strong>{selectedRecommendation.score}</strong><span>/ 100 điểm</span></div>
                  </div>
                  <p className="smart-recommendation-reason">
                    Ô còn trống và vượt qua các ràng buộc kích thước, thể tích, tải trọng. Điểm xếp hạng tổng hợp cân nhắc độ an toàn, quãng đường từ lối nhập, tầng kệ và nhóm hàng.
                  </p>
                  <div className="smart-recommendation-actions">
                    <button className="smart-map-button" type="button" onClick={() => onShowSmartLocation(selectedRecommendation.location.id)}>
                      Xem trên sơ đồ
                    </button>
                    <button
                      className="smart-confirm-button"
                      type="button"
                      disabled={analysis.status === 'confirmed'}
                      onClick={() => onConfirmSmartPlacement(batch, selectedRecommendation, recommendations[0])}
                    >
                      {analysis.status === 'confirmed' ? 'Đã xác nhận vị trí' : 'Xác nhận vị trí'}
                    </button>
                  </div>
                </>
              ) : (
                <div className="smart-no-recommendation">
                  {fits === false
                    ? 'Pallet chưa vượt qua điều kiện bắt buộc về kích thước, thể tích hoặc tải trọng. Vui lòng kiểm tra lại dữ liệu pallet.'
                    : 'Chưa có vị trí đủ điều kiện. Kiểm tra số ô còn trống, dữ liệu pallet và các vị trí đang bị khóa.'}
                </div>
              )}

              <div className="smart-hard-constraints">
                <div className="smart-panel-heading"><div><span className="smart-section-kicker">GIAI ĐOẠN 1</span><h4>Hard Constraints</h4></div><span>Loại vị trí không hợp lệ</span></div>
                <div className="smart-constraint-list">
                  <div className={fits ? 'is-pass' : 'is-fail'}><span>{fits ? '✓' : '!'}</span><div><strong>Kích thước &amp; thể tích pallet</strong><small>Giới hạn ô: {STORAGE_SLOT_LIMITS.heightCm} × {STORAGE_SLOT_LIMITS.widthCm} × {STORAGE_SLOT_LIMITS.depthCm} cm</small></div></div>
                  <div className={batch.grossWeightKg <= STORAGE_SLOT_LIMITS.maxGrossWeightKg ? 'is-pass' : 'is-fail'}><span>{batch.grossWeightKg <= STORAGE_SLOT_LIMITS.maxGrossWeightKg ? '✓' : '!'}</span><div><strong>Tải trọng tối đa {STORAGE_SLOT_LIMITS.maxGrossWeightKg.toLocaleString('vi-VN')} kg</strong><small>Pallet hiện tại: {batch.grossWeightKg || '—'} kg</small></div></div>
                  <div className={availableLocationCount ? 'is-pass' : 'is-fail'}><span>{availableLocationCount ? '✓' : '!'}</span><div><strong>Vị trí khả dụng</strong><small>{availableLocationCount.toLocaleString('vi-VN')} ô đang trống; ô đầy, bảo trì và bị khóa không được xét</small></div></div>
                </div>
              </div>
            </article>
          </section>
        )}

        {selectedRecommendation && (
          <section className="smart-results-layout">
            <article className="operations-panel smart-top-locations">
              <div className="smart-panel-heading">
                <div><span className="smart-section-kicker">CÁC PHƯƠNG ÁN ĐẠT ĐIỀU KIỆN</span><h3>Top vị trí đề xuất</h3></div>
                <span>{recommendations.length} vị trí</span>
              </div>
              <div className="smart-top-list">
                {recommendations.slice(0, 3).map((recommendation, index) => (
                  <button
                    className={`smart-top-item ${index === 0 ? 'smart-top-item--best' : ''} ${recommendation.location.id === selectedRecommendation.location.id ? 'smart-top-item--selected' : ''}`}
                    type="button"
                    key={recommendation.location.id}
                    aria-pressed={recommendation.location.id === selectedRecommendation.location.id}
                    onClick={() => onSelectSmartRecommendation(recommendation.location.id)}
                  >
                    <span className="smart-top-rank">TOP {index + 1}</span>
                    <strong>{recommendation.location.id}</strong>
                    <span className="smart-top-score">{recommendation.score}<small> / 100</small></span>
                    {index === 0 && <span className="smart-top-best-label">Tốt nhất</span>}
                  </button>
                ))}
              </div>
              <p className="smart-top-hint">Chọn một phương án để xem điểm phân tích và vị trí trên sơ đồ.</p>
            </article>

            <article className="operations-panel smart-score-panel">
              <div className="smart-panel-heading">
                <div><span className="smart-section-kicker">GIAI ĐOẠN 2</span><h3>Phân tích điểm vị trí</h3></div>
                <span>Trọng số / điểm thực tế</span>
              </div>
              <div className="smart-score-list">
                {scoreFactors.map((factor) => (
                  <div className="smart-score-row" key={factor.key}>
                    <div className="smart-score-row-heading">
                      <span>{factor.label}<small>{factor.value}/100 · trọng số {Math.round(factor.weight * 100)}%</small></span>
                      <strong>{factor.points.toFixed(1)} / {Math.round(factor.weight * 100)}</strong>
                    </div>
                    <div className="smart-score-track"><span style={{ width: `${factor.value}%` }} /></div>
                  </div>
                ))}
              </div>
              <div className="smart-score-total"><span>Tổng điểm vị trí đang chọn</span><strong>{selectedRecommendation.score}<small> / 100</small></strong></div>
            </article>
          </section>
        )}

        {!batch && (
          <section className="smart-empty-state">
            <div className="smart-empty-icon" aria-hidden="true">⌕</div>
            <div><h3>Sẵn sàng phân tích vị trí</h3><p>Quét hoặc nhập mã pallet để bắt đầu đọc dữ liệu, kiểm tra ràng buộc và xếp hạng các ô kệ phù hợp.</p></div>
          </section>
        )}

        <section className="smart-scoring-method">
          <div>
            <span className="smart-section-kicker">CÁCH HỆ THỐNG LỰA CHỌN</span>
            <h3>Hai giai đoạn đánh giá vị trí</h3>
            <p>Hệ thống loại các ô không đạt điều kiện bắt buộc trước; chỉ những ô hợp lệ mới được đưa vào chấm điểm và xếp hạng.</p>
          </div>
          <div className="smart-scoring-method-stages">
            <div><span>01</span><strong>Hard Constraints</strong><small>Đầy / khóa · kích thước · tải trọng · an toàn</small></div>
            <div><span>02</span><strong>Weighted Scoring</strong><small>An toàn 35% · di chuyển 25% · tầng/tải 20% · nhóm 15% · lịch sử 5%</small></div>
          </div>
        </section>
      </div>
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