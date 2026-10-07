import { useState } from 'react'
import WarehouseMap from './WarehouseMap'
import { PUT_AWAY_STATUS_LABELS, PUT_AWAY_STATUSES } from '../data/putAwayWorkflow'

function formatTimestamp(value) {
  return value ? new Date(value).toLocaleString('vi-VN') : '—'
}

function getMoverDuration(task) {
  const moverEvent = task.events?.find((event) => event.status === PUT_AWAY_STATUSES.WAITING_LIFT)
  const startedAt = new Date(task.createdAt || '').getTime()
  const completedAt = new Date(moverEvent?.occurredAt || '').getTime()
  return Number.isFinite(startedAt) && Number.isFinite(completedAt) && completedAt >= startedAt
    ? completedAt - startedAt
    : null
}

function formatDuration(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '—'
  const totalSeconds = Math.round(milliseconds / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes} phút ${String(seconds).padStart(2, '0')} giây`
}

function getTaskReference(task) {
  const timestamp = new Date(task.createdAt || 0)
  if (!Number.isFinite(timestamp.getTime()) || !task.createdAt) return `#${task.id}`
  const date = timestamp.toISOString().slice(0, 10).replaceAll('-', '')
  const suffix = String(task.id).slice(-4).toUpperCase().padStart(4, '0')
  return `#PA-${date}-${suffix}`
}

function getLocationParts(locationId = '') {
  const match = String(locationId).match(/^(\d+)-(\d+)-(\d)([A-Z])$/i)
  if (!match) return null
  return { row: match[1], bay: match[2], level: match[3], slot: match[4].toUpperCase() }
}

const INCIDENT_TYPES = [
  'Vị trí đã có hàng',
  'Pallet không vừa vị trí',
  'Vượt tải trọng',
  'Hàng hóa/Pallet bị hư hỏng',
  'Lối đi bị chặn',
  'Xe nâng gặp sự cố',
  'Không tìm thấy pallet',
  'Không thể tiếp cận vị trí',
  'Khác',
]

const LIFTER_INCIDENT_TYPES = [
  'Ô kệ đang bị chiếm dụng',
  'Pallet không phù hợp với ô kệ',
  'Kệ có dấu hiệu hư hỏng',
  'Không tìm thấy pallet tại vị trí',
  'Hàng hóa/pallet bị hư hỏng',
  'Không thể thực hiện nâng hạ',
  'Khác',
]

function getDeliveryEvent(task) {
  return task.events?.find((event) => event.status === PUT_AWAY_STATUSES.WAITING_LIFT)
}

function getCompletionEvent(task) {
  return task.events?.find((event) => event.status === PUT_AWAY_STATUSES.COMPLETED)
}

function getDeliveryPosition(task) {
  const location = getLocationParts(task.locationId)
  return location ? `Trước dãy ${location.row} – Khoang ${location.bay}` : 'Vị trí phía trước khu vực kệ'
}

function isToday(value) {
  if (!value) return false
  const date = new Date(value)
  const today = new Date()
  return Number.isFinite(date.getTime()) &&
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
}

function LifterWorkflow({
  tasks,
  user,
  view,
  incidents,
  scannedLocationCode,
  onClearScannedLocation,
  onOpenScanner,
  onAdvanceTask,
  onReportIncident,
  onNavigate,
}) {
  const [selectedTaskId, setSelectedTaskId] = useState('')
  const [manualLocation, setManualLocation] = useState('')
  const [manualConfirmed, setManualConfirmed] = useState(false)
  const [showCompletionModal, setShowCompletionModal] = useState(false)
  const [incidentTask, setIncidentTask] = useState(null)
  const [incidentType, setIncidentType] = useState(LIFTER_INCIDENT_TYPES[0])
  const [incidentDescription, setIncidentDescription] = useState('')
  const [message, setMessage] = useState('')

  const waitingTasks = tasks
    .filter((task) => task.status === PUT_AWAY_STATUSES.WAITING_LIFT)
    .sort((left, right) => (getDeliveryEvent(left)?.occurredAt || left.createdAt || '')
      .localeCompare(getDeliveryEvent(right)?.occurredAt || right.createdAt || ''))
  const activeTasks = tasks
    .filter((task) => task.status === PUT_AWAY_STATUSES.LIFTING)
    .sort((left, right) => (left.updatedAt || '').localeCompare(right.updatedAt || ''))
  const completedTasksToday = tasks
    .filter((task) => task.status === PUT_AWAY_STATUSES.COMPLETED && isToday(getCompletionEvent(task)?.occurredAt))
    .sort((left, right) => (getCompletionEvent(right)?.occurredAt || '').localeCompare(getCompletionEvent(left)?.occurredAt || ''))
  const selectedTask = [...waitingTasks, ...activeTasks].find((task) => task.id === selectedTaskId)
  const activeTask = activeTasks.find((task) => task.id === selectedTaskId) || activeTasks[0]
  const currentTask = activeTask || selectedTask || waitingTasks[0]
  const location = getLocationParts(currentTask?.locationId)
  const actualLocation = scannedLocationCode || manualLocation
  const locationMatches = Boolean(currentTask && actualLocation &&
    actualLocation.trim().toUpperCase().replace(/\s/g, '') === currentTask.locationId.toUpperCase())
  const canComplete = Boolean(currentTask && currentTask.status === PUT_AWAY_STATUSES.LIFTING &&
    (locationMatches || manualConfirmed))

  const beginLifting = async (task) => {
    setSelectedTaskId(task.id)
    setManualLocation('')
    setManualConfirmed(false)
    onClearScannedLocation()
    setMessage('')
    if (!await onAdvanceTask(task.id)) {
      setMessage('Không thể bắt đầu nâng hạ. Hãy tải lại danh sách và thử lại.')
      return
    }
    setMessage(`Đang nâng hạ pallet ${task.palletCode || task.productCode}.`)
  }

  const submitIncident = async (event) => {
    event.preventDefault()
    if (!incidentTask) return
    const incident = {
      id: `lifter-incident-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      taskId: incidentTask.id,
      taskReference: getTaskReference(incidentTask),
      incidentType,
      description: incidentDescription.trim(),
      locationId: incidentTask.locationId,
      productCode: incidentTask.productCode,
      productName: incidentTask.productName,
      palletCode: incidentTask.palletCode || '',
      reportedAt: new Date().toISOString(),
      employeeName: user.name || user.username,
      employeeUsername: user.username,
      reportedByRole: 'LIFTER',
      status: 'OPEN',
    }
    if (!await onReportIncident(incident)) {
      setMessage('Không lưu được báo cáo sự cố trên thiết bị này. Hãy thử lại.')
      return
    }
    setMessage('Đã gửi báo cáo sự cố cho Admin/kiểm hàng.')
    setIncidentTask(null)
    setIncidentDescription('')
  }

  const completeLifting = async () => {
    if (!canComplete || !currentTask) return
    if (!window.confirm(`Xác nhận hoàn thành nâng hạ pallet ${currentTask.palletCode || currentTask.productCode} tại ${currentTask.locationId}?`)) return
    if (!await onAdvanceTask(currentTask.id)) {
      setMessage('Không thể hoàn thành nâng hạ. Hãy kiểm tra trạng thái nhiệm vụ rồi thử lại.')
      return
    }
    setMessage(`Đã hoàn thành nâng hạ tại ${currentTask.locationId}. Tồn kho và lịch sử Put-away đã được cập nhật.`)
    setShowCompletionModal(false)
    setManualLocation('')
    setManualConfirmed(false)
    onClearScannedLocation()
    setSelectedTaskId('')
  }

  const renderHistory = (historyTasks) => (
    historyTasks.length ? (
      <div className="operations-table-wrap lifter-history-table-wrap">
        <table className="operations-table lifter-history-table">
          <thead><tr><th>Thời gian</th><th>Pallet</th><th>Hàng hóa</th><th>Vị trí lưu trữ</th><th>Nhân viên</th><th>Trạng thái</th></tr></thead>
          <tbody>{historyTasks.map((task) => {
            const completed = getCompletionEvent(task)
            return (
              <tr key={task.id}>
                <td>{completed?.occurredAt ? new Date(completed.occurredAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                <td>{task.palletCode || '—'}</td>
                <td>{task.productName || task.productCode || '—'}</td>
                <td><strong>{task.locationId}</strong></td>
                <td>{completed?.actorName || completed?.actorUsername || '—'}</td>
                <td><span className="operations-status operations-status--completed">✓ Hoàn thành</span></td>
              </tr>
            )
          })}</tbody>
        </table>
      </div>
    ) : <div className="lifter-empty-inline">Chưa có lượt nâng hạ hoàn thành hôm nay.</div>
  )

  const incidentDialog = incidentTask ? (
    <div className="lifter-modal-backdrop" role="presentation">
      <section className="lifter-modal" role="dialog" aria-modal="true" aria-labelledby="lifter-incident-heading">
        <div className="lifter-modal-heading"><div><span>BÁO CÁO NGOẠI LỆ</span><h2 id="lifter-incident-heading">Báo sự cố nâng hạ</h2></div><button type="button" aria-label="Đóng" onClick={() => setIncidentTask(null)}>×</button></div>
        <p>{incidentTask.palletCode || incidentTask.productCode} · vị trí {incidentTask.locationId}</p>
        <form onSubmit={submitIncident}>
          <label>Loại sự cố<select value={incidentType} onChange={(event) => setIncidentType(event.target.value)}>{LIFTER_INCIDENT_TYPES.map((type) => <option key={type}>{type}</option>)}</select></label>
          <label>Ghi chú<textarea rows={4} value={incidentDescription} onChange={(event) => setIncidentDescription(event.target.value)} placeholder="Mô tả tình trạng tại vị trí nâng hạ..." /></label>
          <div><button type="button" className="lifter-secondary-button" onClick={() => setIncidentTask(null)}>Hủy</button><button type="submit" className="lifter-danger-button">Gửi báo cáo</button></div>
        </form>
      </section>
    </div>
  ) : null

  const renderLiftingQueue = () => (
    <section className="operations-panel lifter-queue-panel">
      <div className="lifter-panel-heading"><div><span>ĐIỀU PHỐI CA LÀM VIỆC</span><h2>Hàng đợi nâng hạ</h2></div><strong>{waitingTasks.length} pallet</strong></div>
      {waitingTasks.length ? (
        <div className="lifter-queue-list">
          {waitingTasks.map((task) => {
            const delivered = getDeliveryEvent(task)
            const taskLocation = getLocationParts(task.locationId)
            return (
              <article className="lifter-queue-card" key={task.id}>
                <div className="lifter-queue-top">
                  <div><span>{getTaskReference(task)}</span><h3>{task.palletCode || 'Chưa gán mã pallet'}</h3><p>{task.productName || '—'} · {task.productCode || '—'}</p></div>
                  <span className="lifter-status lifter-status--waiting">Chờ nâng hạ</span>
                </div>
                <div className="lifter-queue-meta"><span>{task.grossWeightKg ? `${task.grossWeightKg} kg` : 'Khối lượng —'}</span><span>{task.heightCm && task.widthCm && task.depthCm ? `${task.heightCm} × ${task.widthCm} × ${task.depthCm} cm` : 'Kích thước —'}</span><span>Giao lúc {delivered?.occurredAt ? formatTimestamp(delivered.occurredAt) : 'Chưa ghi nhận'}</span><span>Ưu tiên: {task.priority || task.urgency || 'Chưa thiết lập'}</span></div>
                <div className="lifter-location-pair">
                  <div className="lifter-location-current"><span>VỊ TRÍ HÀNG HIỆN TẠI</span><strong>📦 {getDeliveryPosition(task)}</strong><small>Hàng đã được nhân viên nâng chuyển giao đến</small></div>
                  <div className="lifter-location-target"><span>VỊ TRÍ CẦN NÂNG LÊN</span><strong>⬆ {task.locationId}</strong><small>{taskLocation ? `Dãy ${taskLocation.row} · Khoang ${taskLocation.bay} · Tầng ${taskLocation.level} · Ô ${taskLocation.slot}` : 'Ô kệ chỉ định'}</small></div>
                </div>
                <div className="lifter-queue-footer"><span>Đã bàn giao từ Mover{delivered?.actorName ? ` · ${delivered.actorName}` : ''}</span><button type="button" className="lifter-start-button" onClick={() => beginLifting(task)}>Bắt đầu nâng hạ</button></div>
              </article>
            )
          })}
        </div>
      ) : <div className="lifter-empty-inline">Chưa có pallet chờ nâng hạ. Hàng đợi sẽ tự cập nhật sau khi Mover xác nhận bàn giao.</div>}
    </section>
  )

  if (view === 'lifter-completed') {
    return <div className="lifter-page"><div className="lifter-section-heading"><span>LỊCH SỬ</span><h2>Toàn bộ lịch sử nâng hạ</h2></div><section className="operations-panel lifter-history-panel">{renderHistory(tasks.filter((task) => task.status === PUT_AWAY_STATUSES.COMPLETED).sort((left, right) => (getCompletionEvent(right)?.occurredAt || '').localeCompare(getCompletionEvent(left)?.occurredAt || '')))}</section></div>
  }

  if (view === 'lifter-issues') {
    return <div className="lifter-page"><div className="lifter-section-heading"><span>AN TOÀN VẬN HÀNH</span><h2>Báo cáo sự cố</h2><p>Sự cố nâng hạ đã được ghi nhận trong hệ thống.</p></div><section className="operations-panel lifter-history-panel">{incidents.filter((incident) => incident.reportedByRole === 'LIFTER').length ? <div className="operations-table-wrap"><table className="operations-table"><thead><tr><th>Thời gian</th><th>Pallet</th><th>Sự cố</th><th>Vị trí</th><th>Nhân viên</th><th>Trạng thái</th></tr></thead><tbody>{[...incidents].filter((incident) => incident.reportedByRole === 'LIFTER').reverse().map((incident) => <tr key={incident.id}><td>{formatTimestamp(incident.reportedAt)}</td><td>{incident.palletCode || incident.productCode}</td><td>{incident.incidentType}</td><td>{incident.locationId}</td><td>{incident.employeeName}</td><td>{incident.status === 'OPEN' ? 'Chờ xử lý' : 'Đã xử lý'}</td></tr>)}</tbody></table></div> : <div className="lifter-empty-inline">Chưa có sự cố nâng hạ được ghi nhận.</div>}</section>{currentTask && <button type="button" className="lifter-danger-button" onClick={() => setIncidentTask(currentTask)}>⚠ Báo sự cố cho nhiệm vụ hiện tại</button>}{incidentDialog}</div>
  }

  if (view === 'lifter-scan') {
    return <div className="lifter-page"><div className="lifter-section-heading"><span>QUÉT VỊ TRÍ</span><h2>Xác minh ô kệ</h2><p>Quét mã vị trí được chỉ định cho nhiệm vụ nâng hạ đang thực hiện.</p></div><section className="operations-panel lifter-scan-panel">{activeTask ? <><p>Nhiệm vụ đang nâng hạ: <strong>{activeTask.palletCode || activeTask.productCode}</strong></p><div className="lifter-target-code">{activeTask.locationId}</div><button type="button" className="lifter-start-button" onClick={() => { onClearScannedLocation(); setManualLocation(''); onOpenScanner() }}>Quét QR / mã vạch vị trí</button>{scannedLocationCode && <p className={scannedLocationCode === activeTask.locationId ? 'lifter-scan-match' : 'lifter-scan-mismatch'}>{scannedLocationCode === activeTask.locationId ? '✓ Vị trí chính xác' : `⚠ Sai vị trí · Đã quét ${scannedLocationCode}`}</p>}</> : <div className="lifter-empty-inline">Bắt đầu một nhiệm vụ nâng hạ trước khi quét vị trí.</div>}</section></div>
  }

  const incidentCountToday = incidents.filter((incident) => incident.reportedByRole === 'LIFTER' && isToday(incident.reportedAt)).length
  const allCompletedToday = completedTasksToday.length
  const statusSteps = ['Kiểm hàng', 'Đề xuất vị trí', 'Nâng chuyển', 'Nâng hạ', 'Hoàn tất']

  return (
    <div className="lifter-dashboard">
      {waitingTasks.length > 0 && (
        <section className="lifter-handoff-banner" role="status">
          <span className="lifter-handoff-icon" aria-hidden="true">↘</span>
          <div><strong>NHIỆM VỤ NÂNG HẠ MỚI</strong><p>{waitingTasks[0].palletCode || waitingTasks[0].productCode} đã được đưa đến vị trí nâng hạ.</p><small>Vị trí hàng hiện tại: {getDeliveryPosition(waitingTasks[0])} · Vị trí cần đưa lên: {waitingTasks[0].locationId}</small></div>
          <span className="lifter-handoff-count">{waitingTasks.length} mới</span>
        </section>
      )}

      <section className="lifter-summary-grid" aria-label="Tổng quan nâng hạ">
        <article className="lifter-summary-card lifter-summary-card--waiting"><span aria-hidden="true">↓</span><div><small>CHỜ NÂNG HẠ</small><strong>{waitingTasks.length}</strong></div></article>
        <article className="lifter-summary-card lifter-summary-card--active"><span aria-hidden="true">↥</span><div><small>ĐANG NÂNG HẠ</small><strong>{activeTasks.length}</strong></div></article>
        <article className="lifter-summary-card lifter-summary-card--done"><span aria-hidden="true">✓</span><div><small>HOÀN THÀNH HÔM NAY</small><strong>{allCompletedToday}</strong></div></article>
        <article className="lifter-summary-card lifter-summary-card--issue"><span aria-hidden="true">!</span><div><small>SỰ CỐ HÔM NAY</small><strong>{incidentCountToday}</strong></div></article>
      </section>

      {message && <p className="lifter-feedback" role="status">{message}</p>}

      {currentTask?.status === PUT_AWAY_STATUSES.LIFTING && (
        <section className="lifter-active-card">
          <div className="lifter-active-heading"><div><span>THAO TÁC ĐANG DIỄN RA</span><h2>Đang nâng hạ</h2></div><span className="lifter-status lifter-status--active">Đang thực hiện</span></div>
          {activeTasks.length > 1 && <div className="lifter-task-switcher" aria-label="Chuyển nhiệm vụ đang nâng hạ">{activeTasks.map((task) => <button className={task.id === currentTask.id ? 'is-selected' : ''} type="button" key={task.id} onClick={() => { setSelectedTaskId(task.id); setManualLocation(''); setManualConfirmed(false); onClearScannedLocation() }}>{task.palletCode || task.productCode} · {task.locationId}</button>)}</div>}
          <div className="lifter-active-product"><span>Pallet {currentTask.palletCode || '—'}</span><strong>{currentTask.productName || '—'} · {currentTask.productCode || '—'}</strong><small>{currentTask.grossWeightKg ? `${currentTask.grossWeightKg} kg` : 'Khối lượng chưa ghi nhận'}{currentTask.heightCm && currentTask.widthCm && currentTask.depthCm ? ` · ${currentTask.heightCm} × ${currentTask.widthCm} × ${currentTask.depthCm} cm` : ''}</small></div>
          <div className="lifter-active-locations"><div><span>HÀNG HIỆN TẠI</span><strong>📦 {getDeliveryPosition(currentTask)}</strong><small>Đã được Mover bàn giao · {getDeliveryEvent(currentTask)?.occurredAt ? formatTimestamp(getDeliveryEvent(currentTask).occurredAt) : 'Thời điểm chưa ghi nhận'}</small></div><div className="lifter-active-target"><span>NÂNG LÊN Ô KỆ</span><strong>{currentTask.locationId}</strong><small>{location ? `DÃY ${location.row} · KHOANG ${location.bay} · TẦNG ${location.level} · Ô ${location.slot}` : 'Ô kệ được chỉ định'}</small></div></div>
          <ol className="lifter-workflow-steps">{statusSteps.map((step, index) => <li className={index < 3 ? 'is-done' : index === 3 ? 'is-active' : ''} key={step}><span>{index < 3 ? '✓' : index === 3 ? '●' : '○'}</span>{step}</li>)}</ol>
          <div className="lifter-active-actions"><button type="button" className="lifter-complete-button" onClick={() => { setManualLocation(''); setManualConfirmed(false); onClearScannedLocation(); setShowCompletionModal(true) }}>Xác nhận đã đưa hàng lên kệ</button><button type="button" className="lifter-danger-button" onClick={() => setIncidentTask(currentTask)}>⚠ Báo sự cố</button></div>
        </section>
      )}

      {(view === 'workflow' || view === 'lifter-tasks') && (
        <>
          {activeTasks.length > 0 && currentTask?.status !== PUT_AWAY_STATUSES.LIFTING && (
            <section className="lifter-active-card lifter-active-card--resume">
              <div className="lifter-active-heading"><div><span>ĐANG NÂNG HẠ</span><h2>{activeTasks.length} pallet đang được xử lý</h2></div></div>
              <p>Chọn nhiệm vụ đang nâng để tiếp tục thao tác.</p>
              {activeTasks.map((task) => <button className="lifter-resume-task" type="button" key={task.id} onClick={() => setSelectedTaskId(task.id)}>{task.palletCode || task.productCode} · <strong>{task.locationId}</strong></button>)}
            </section>
          )}
          {renderLiftingQueue()}
          <section className="operations-panel lifter-history-panel"><div className="lifter-panel-heading"><div><span>HOÀN TẤT PUT-AWAY</span><h2>Lịch sử nâng hạ hôm nay</h2></div><button type="button" className="lifter-link-button" onClick={() => onNavigate('lifter-completed')}>Xem toàn bộ lịch sử</button></div>{renderHistory(completedTasksToday.slice(0, 6))}</section>
        </>
      )}

      {waitingTasks.length === 0 && activeTasks.length === 0 && (view === 'workflow' || view === 'lifter-tasks') && (
        <section className="lifter-empty-state"><span>✓</span><h2>Chưa có nhiệm vụ nâng hạ</h2><p>Khi Mover xác nhận bàn giao pallet, nhiệm vụ sẽ tự động xuất hiện tại đây.</p><strong>● Hệ thống đang hoạt động</strong></section>
      )}

      {showCompletionModal && currentTask && (
        <div className="lifter-modal-backdrop" role="presentation"><section className="lifter-modal lifter-completion-modal" role="dialog" aria-modal="true" aria-labelledby="lifter-completion-heading">
          <div className="lifter-modal-heading"><div><span>XÁC NHẬN HOÀN THÀNH NÂNG HẠ</span><h2 id="lifter-completion-heading">Kiểm tra vị trí lưu trữ</h2></div><button type="button" aria-label="Đóng" onClick={() => setShowCompletionModal(false)}>×</button></div>
          <div className="lifter-confirm-info"><span>Pallet: <strong>{currentTask.palletCode || currentTask.productCode}</strong></span><span>Vị trí lưu trữ: <strong>{currentTask.locationId}</strong></span><small>{location ? `Dãy ${location.row} · Khoang ${location.bay} · Tầng ${location.level} · Ô ${location.slot}` : 'Vị trí ô kệ được chỉ định'}</small></div>
          <div className="lifter-verify-field"><label htmlFor="lifter-location-code">Quét mã vị trí hoặc nhập thủ công</label><div><input id="lifter-location-code" value={actualLocation} onChange={(event) => { onClearScannedLocation(); setManualConfirmed(false); setManualLocation(event.target.value) }} placeholder="Ví dụ: 110-57-2B" /><button type="button" className="lifter-secondary-button" onClick={() => { setManualLocation(''); setManualConfirmed(false); onClearScannedLocation(); onOpenScanner() }}>Quét QR / mã vạch</button></div></div>
          {actualLocation && (locationMatches ? <p className="lifter-scan-match">✓ Đúng vị trí {currentTask.locationId}</p> : <p className="lifter-scan-mismatch">⚠ Sai vị trí lưu trữ · Vị trí yêu cầu: {currentTask.locationId} · Vừa quét: {actualLocation}</p>)}
          {manualConfirmed && <p className="lifter-scan-match">✓ Đã xác nhận thủ công vị trí {currentTask.locationId}</p>}
          <div className="lifter-modal-actions"><button type="button" className="lifter-secondary-button" onClick={() => { if (window.confirm(`Xác nhận thủ công rằng pallet đã được đặt đúng tại ${currentTask.locationId}?`)) { setManualLocation(''); onClearScannedLocation(); setManualConfirmed(true) } }}>Xác nhận thủ công</button><button type="button" className="lifter-complete-button" disabled={!canComplete} onClick={completeLifting}>Hoàn thành nâng hạ</button></div>
        </section></div>
      )}
      {incidentDialog}
    </div>
  )
}

function MoverWorkflow({
  tasks,
  user,
  view,
  locations,
  incidents,
  scannedLocationCode,
  onClearScannedLocation,
  onOpenScanner,
  onAdvanceTask,
  onReportIncident,
  onNavigate,
}) {
  const [filter, setFilter] = useState('ALL')
  const [selectedTaskId, setSelectedTaskId] = useState('')
  const [startedTasks, setStartedTasks] = useState({})
  const [confirmedLocation, setConfirmedLocation] = useState('')
  const [incidentTask, setIncidentTask] = useState(null)
  const [incidentType, setIncidentType] = useState(INCIDENT_TYPES[0])
  const [incidentDescription, setIncidentDescription] = useState('')
  const [message, setMessage] = useState('')

  const waitingMoveTasks = tasks.filter((task) => task.status === PUT_AWAY_STATUSES.WAITING_MOVE)
  const waitingLiftCount = tasks.filter((task) => task.status === PUT_AWAY_STATUSES.WAITING_LIFT).length
  const completedTasks = [...tasks]
    .filter((task) => task.status === PUT_AWAY_STATUSES.COMPLETED)
    .sort((left, right) => (right.updatedAt || '').localeCompare(left.updatedAt || ''))
  const currentTask = waitingMoveTasks.find((task) => task.id === selectedTaskId) || waitingMoveTasks[0]
  const isStarted = Boolean(currentTask && startedTasks[currentTask.id])
  const actualLocation = scannedLocationCode || confirmedLocation
  const isLocationCorrect = Boolean(currentTask && actualLocation &&
    actualLocation.trim().toUpperCase().replace(/\s/g, '') === currentTask.locationId.toUpperCase())
  const routeFrame = currentTask?.locationId.match(/^(\d+)-(\d+)-/)?.slice(1, 3)
  const completedDurations = completedTasks
    .map(getMoverDuration)
    .filter((duration) => duration !== null)
  const averageDuration = completedDurations.length
    ? completedDurations.reduce((sum, duration) => sum + duration, 0) / completedDurations.length
    : null

  const filteredTasks = tasks.filter((task) => {
    if (filter === 'ALL') return task.status !== PUT_AWAY_STATUSES.COMPLETED
    if (filter === 'IN_PROGRESS') return Boolean(startedTasks[task.id]) && task.status === PUT_AWAY_STATUSES.WAITING_MOVE
    return task.status === filter
  }).sort((left, right) => (left.createdAt || '').localeCompare(right.createdAt || ''))

  const beginTask = (task) => {
    setSelectedTaskId(task.id)
    setStartedTasks((current) => ({ ...current, [task.id]: current[task.id] || new Date().toISOString() }))
    setConfirmedLocation('')
    onClearScannedLocation()
    setMessage('')
  }

  const submitIncident = async (event) => {
    event.preventDefault()
    if (!incidentTask) return
    const incident = {
      id: `mover-incident-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      taskId: incidentTask.id,
      taskReference: getTaskReference(incidentTask),
      incidentType,
      description: incidentDescription.trim(),
      locationId: incidentTask.locationId,
      productCode: incidentTask.productCode,
      productName: incidentTask.productName,
      palletCode: incidentTask.palletCode || '',
      reportedAt: new Date().toISOString(),
      employeeName: user.name || user.username,
      employeeUsername: user.username,
      reportedByRole: 'MOVER',
      status: 'OPEN',
    }
    if (!await onReportIncident(incident)) {
      setMessage('Không lưu được báo cáo sự cố trên thiết bị này. Hãy thử lại.')
      return
    }
    setMessage('Đã gửi báo cáo sự cố cho Admin/kiểm hàng.')
    setIncidentTask(null)
    setIncidentDescription('')
  }
  const incidentDialog = incidentTask ? (
    <div className="mover-modal-backdrop" role="presentation"><section className="mover-incident-modal" role="dialog" aria-modal="true" aria-labelledby="mover-incident-title">
      <div className="mover-card-heading"><div><span>EXCEPTION HANDLING</span><h2 id="mover-incident-title">Báo sự cố</h2></div><button className="mover-modal-close" type="button" aria-label="Đóng" onClick={() => setIncidentTask(null)}>×</button></div>
      <p>Nhiệm vụ {getTaskReference(incidentTask)} · vị trí {incidentTask.locationId}</p>
      <form onSubmit={submitIncident}><label>Loại sự cố<select value={incidentType} onChange={(event) => setIncidentType(event.target.value)}>{INCIDENT_TYPES.map((type) => <option key={type}>{type}</option>)}</select></label><label>Mô tả sự cố<textarea rows={4} value={incidentDescription} onChange={(event) => setIncidentDescription(event.target.value)} placeholder="Mô tả ngắn tình trạng thực tế..." /></label><div><button className="operations-button mover-secondary-button" type="button" onClick={() => setIncidentTask(null)}>Hủy</button><button className="operations-button operations-button--danger" type="submit">Gửi báo cáo</button></div></form>
    </section></div>
  ) : null

  if (view === 'mover-map') {
    return (
      <section className="mover-map-page">
        <div className="mover-page-heading"><span>SƠ ĐỒ KHO</span><h2>Sơ đồ kho & lộ trình di chuyển</h2><p>Vị trí đích được làm nổi bật theo nhiệm vụ nâng chuyển đang chờ.</p></div>
        <div className="operations-panel mover-map-panel">
          <div className="mover-route-summary">
            <div><span>ĐIỂM LẤY</span><strong>Khu tập kết</strong><small>Chưa ghi nhận mã vị trí cụ thể</small></div>
            <span className="mover-route-arrow" aria-hidden="true">→</span>
            <div><span>VỊ TRÍ ĐÍCH</span><strong>{currentTask?.locationId || 'Chưa có nhiệm vụ'}</strong><small>{currentTask ? 'Ô kệ được chỉ định' : 'Đang chờ nhiệm vụ mới'}</small></div>
          </div>
          <div className="mover-map-container">
            <WarehouseMap
              locations={locations}
              compactMode
              showLegend
              disableFrameSelection
              highlightFrameIds={routeFrame ? [`${routeFrame[0]}-${routeFrame[1]}`] : []}
            />
          </div>
          <p className="mover-route-data-note">Khoảng cách và thời gian di chuyển chưa được ghi nhận trong dữ liệu nhiệm vụ.</p>
        </div>
      </section>
    )
  }

  if (view === 'mover-issues') {
    return (
      <section className="mover-page-section">
        <div className="mover-page-heading"><span>THEO DÕI NGOẠI LỆ</span><h2>Báo sự cố</h2><p>Sự cố gửi từ tài khoản Mover sẽ hiển thị tại đây và phía Admin.</p>{currentTask && <button className="operations-button operations-button--danger" type="button" onClick={() => setIncidentTask(currentTask)}>Báo sự cố nhiệm vụ hiện tại</button>}</div>
        <div className="operations-panel">
          {incidents.length ? (
            <div className="operations-table-wrap"><table className="operations-table">
              <thead><tr><th>Thời gian</th><th>Nhiệm vụ</th><th>Sự cố</th><th>Vị trí</th><th>Mô tả</th><th>Trạng thái</th></tr></thead>
              <tbody>{[...incidents].reverse().map((incident) => (
                <tr key={incident.id}><td>{formatTimestamp(incident.reportedAt)}</td><td>{incident.taskReference}</td><td>{incident.incidentType}</td><td><strong>{incident.locationId}</strong></td><td>{incident.description || '—'}</td><td>{incident.status === 'OPEN' ? 'Chờ xử lý' : 'Đã xử lý'}</td></tr>
              ))}</tbody>
            </table></div>
          ) : <div className="mover-empty-inline">Chưa có sự cố nào được ghi nhận.</div>}
        </div>
        {message && <p className="operations-message" role="status">{message}</p>}
        {incidentDialog}
      </section>
    )
  }

  if (view === 'mover-performance') {
    return (
      <section className="mover-page-section">
        <div className="mover-page-heading"><span>HIỆU SUẤT</span><h2>Hiệu suất ca làm việc</h2><p>Số liệu tổng hợp từ các nhiệm vụ đã hoàn thành được lưu trên thiết bị này, không đại diện riêng cho một ca.</p></div>
        <div className="mover-performance-grid">
          <article><span>ĐÃ HOÀN THÀNH</span><strong>{completedTasks.length}</strong><small>Nhiệm vụ Put-away</small></article>
          <article><span>THỜI GIAN XỬ LÝ TRUNG BÌNH</span><strong>{averageDuration === null ? '—' : formatDuration(averageDuration)}</strong><small>{completedDurations.length ? `Từ lúc tạo đến khi Mover xác nhận · ${completedDurations.length} nhiệm vụ` : 'Chưa có đủ timestamp cho bước Mover'}</small></article>
          <article><span>ĐANG CHỜ BẠN</span><strong>{waitingMoveTasks.length}</strong><small>Nhiệm vụ chờ nâng chuyển</small></article>
        </div>
      </section>
    )
  }

  const renderCompactCompleted = (limit = Infinity) => (
    <div className="mover-completed-table-wrap">
      <table className="mover-completed-table">
        <thead><tr><th>Thời gian</th><th>Pallet</th><th>Hàng hóa</th><th>Vị trí</th><th>Thời gian xử lý</th></tr></thead>
        <tbody>{completedTasks.slice(0, limit).map((task) => {
          const duration = getMoverDuration(task)
          return <tr key={task.id}><td>{task.updatedAt ? new Date(task.updatedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '—'}</td><td>{task.palletCode || '—'}</td><td>{task.productName || task.productCode || '—'}</td><td><strong>{task.locationId}</strong></td><td>{duration === null ? '—' : formatDuration(duration)}</td></tr>
        })}</tbody>
      </table>
      {!completedTasks.length && <div className="mover-empty-inline">Chưa có nhiệm vụ hoàn thành.</div>}
    </div>
  )

  if (view === 'mover-completed') {
    return <section className="mover-page-section"><div className="mover-page-heading"><span>LỊCH SỬ</span><h2>Nhiệm vụ đã hoàn thành</h2></div><div className="operations-panel">{renderCompactCompleted()}</div></section>
  }

  return (
    <div className="mover-dashboard">
      <section className="mover-stats-grid" aria-label="Thống kê nhiệm vụ">
        <article className="mover-stat-card mover-stat-card--move"><span aria-hidden="true">🚚</span><div><small>CHỜ NÂNG CHUYỂN</small><strong>{waitingMoveTasks.length}</strong><span>pallet</span></div></article>
        <article className="mover-stat-card mover-stat-card--lift"><span aria-hidden="true">🏗</span><div><small>CHỜ NÂNG HẠ</small><strong>{waitingLiftCount}</strong><span>pallet</span></div></article>
        <article className="mover-stat-card mover-stat-card--active"><span aria-hidden="true">▶</span><div><small>ĐANG THỰC HIỆN</small><strong>{Object.keys(startedTasks).filter((id) => waitingMoveTasks.some((task) => task.id === id)).length}</strong><span>pallet</span></div></article>
        <article className="mover-stat-card mover-stat-card--done"><span aria-hidden="true">✓</span><div><small>ĐÃ HOÀN THÀNH</small><strong>{completedTasks.length}</strong><span>pallet</span></div></article>
        <article className="mover-stat-card mover-stat-card--performance"><span aria-hidden="true">◷</span><div><small>HIỆU SUẤT TỔNG HỢP</small><strong>{averageDuration === null ? '—' : formatDuration(averageDuration)}</strong><span>{completedTasks.length} pallet hoàn thành · không phân tách theo ca</span></div></article>
      </section>

      <div className="mover-primary-grid">
        <section className="operations-panel mover-current-task">
          <div className="mover-card-heading"><div><span>NHIỆM VỤ PUT-AWAY HIỆN TẠI</span><h2>{currentTask ? getTaskReference(currentTask) : 'Đang chờ nhiệm vụ'}</h2></div>{currentTask && <span className="mover-priority">Ưu tiên chưa được chỉ định</span>}</div>
          {currentTask ? (
            <>
              <div className="mover-pallet-info">
                <div className="mover-pallet-illustration" aria-hidden="true">📦</div>
                <div className="mover-pallet-details">
                  <div><span>MÃ PALLET</span><strong>{currentTask.palletCode || 'Chưa gán mã pallet'}</strong></div>
                  <div><span>MÃ LÔ HÀNG</span><strong>{currentTask.lotCode || '—'}</strong></div>
                  <div><span>MÃ SẢN PHẨM</span><strong>{currentTask.productCode || '—'}</strong></div>
                  <div><span>TÊN HÀNG</span><strong>{currentTask.productName || '—'}</strong></div>
                  <div><span>KHỐI LƯỢNG</span><strong>{currentTask.grossWeightKg ? `${currentTask.grossWeightKg} kg` : '—'}</strong></div>
                  <div><span>KÍCH THƯỚC</span><strong>{currentTask.heightCm && currentTask.widthCm && currentTask.depthCm ? `${currentTask.heightCm} × ${currentTask.widthCm} × ${currentTask.depthCm} cm` : '—'}</strong></div>
                  <div><span>CBM</span><strong>{currentTask.cbm ? `${currentTask.cbm} m³` : '—'}</strong></div>
                  <div><span>SỐ LƯỢNG</span><strong>{currentTask.quantity || currentTask.packageCount || '—'}</strong></div>
                  <div><span>KHÁCH HÀNG / NHÀ CUNG CẤP</span><strong>{currentTask.customerId || currentTask.supplier || '—'}</strong></div>
                </div>
              </div>
              <div className="mover-location-flow">
                <div><span>VỊ TRÍ LẤY HÀNG</span><strong>Khu tập kết</strong><small>Vị trí chi tiết chưa được ghi nhận</small></div>
                <span className="mover-flow-arrow" aria-hidden="true">↓</span>
                <div className="mover-location-destination"><span>VỊ TRÍ PUT-AWAY</span><strong>{currentTask.locationId}</strong>{getLocationParts(currentTask.locationId) && <small>Dãy {getLocationParts(currentTask.locationId).row} · Khoang {getLocationParts(currentTask.locationId).bay} · Tầng {getLocationParts(currentTask.locationId).level} · Ô {getLocationParts(currentTask.locationId).slot}</small>}</div>
              </div>
              <div className="mover-route-metrics"><span>Khoảng cách <strong>Chưa có dữ liệu</strong></span><span>Thời gian dự kiến <strong>Chưa có dữ liệu</strong></span></div>
              <div className="mover-task-actions">
                <button className="operations-button mover-start-button" type="button" disabled={isStarted} onClick={() => beginTask(currentTask)}>{isStarted ? 'Đang nâng chuyển' : 'Bắt đầu nâng chuyển'}</button>
                <button className="operations-button mover-secondary-button" type="button" onClick={() => document.getElementById('mover-route-map')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Xem đường đi</button>
                <button className="operations-button operations-button--danger" type="button" onClick={() => setIncidentTask(currentTask)}>Báo sự cố</button>
              </div>
              <div className="mover-location-check">
                <div className="mover-card-heading"><div><span>KIỂM TRA TẠI ĐÍCH</span><h3>Xác nhận vị trí Put-away</h3></div></div>
                <p>Vị trí yêu cầu: <strong>{currentTask.locationId}</strong></p>
                <div className="mover-location-input-row">
                  <input aria-label="Nhập mã vị trí thực tế" placeholder="Nhập mã vị trí thực tế" value={actualLocation} onChange={(event) => { onClearScannedLocation(); setConfirmedLocation(event.target.value) }} />
                  <button className="operations-button mover-secondary-button" type="button" onClick={() => { onClearScannedLocation(); setConfirmedLocation(''); onOpenScanner() }}>Quét QR / Mã vạch vị trí</button>
                </div>
                {actualLocation && (isLocationCorrect
                  ? <p className="mover-location-feedback mover-location-feedback--success">✓ VỊ TRÍ CHÍNH XÁC · {currentTask.locationId}</p>
                  : <p className="mover-location-feedback mover-location-feedback--error">⚠ SAI VỊ TRÍ · Yêu cầu {currentTask.locationId}, vừa nhập/quét {actualLocation}</p>)}
              </div>
              <ol className="mover-progress">
                {['Nhận nhiệm vụ', 'Đến điểm lấy', 'Xác nhận pallet', 'Di chuyển', 'Đến vị trí', 'Nâng hàng', 'Quét vị trí', 'Hoàn thành'].map((step, index) => {
                  const complete = index === 0
                  const active = !complete && (isLocationCorrect ? index === 6 : isStarted ? index === 3 : index === 1)
                  return <li className={complete ? 'is-complete' : active ? 'is-active' : ''} key={step}><span>{complete ? '✓' : index + 1}</span><small>{step}</small></li>
                })}
              </ol>
              {currentTask.events?.length > 0 && (
                <ul className="mover-recorded-events">
                  {currentTask.events.map((event, index) => (
                    <li key={`${event.status}-${event.occurredAt}-${index}`}>
                      <strong>{event.label}</strong>
                      <span>{event.occurredAt ? formatTimestamp(event.occurredAt) : 'Thời gian chưa ghi nhận'}</span>
                    </li>
                  ))}
                </ul>
              )}
              <button className="operations-button mover-complete-button" type="button" disabled={!isStarted || !isLocationCorrect} onClick={async () => {
                if (!window.confirm('Xác nhận pallet đã được chuyển đến đúng ô chỉ định (chưa đặt lên kệ)?')) return
                const advanced = await onAdvanceTask(currentTask.id)
                setMessage(advanced ? 'Đã xác nhận chuyển pallet đến vị trí. Lô hàng chuyển sang chờ nâng hạ.' : 'Không thể cập nhật công việc. Hãy tải lại trang và kiểm tra trạng thái vị trí.')
                if (advanced) {
                  setSelectedTaskId('')
                  setConfirmedLocation('')
                }
              }}>Xác nhận đã chuyển đến vị trí</button>
              {!isStarted && <p className="mover-action-hint">Bắt đầu nhiệm vụ trước khi xác nhận vị trí.</p>}
            </>
          ) : (
            <div className="mover-empty-state"><span aria-hidden="true">✓</span><h3>Hiện chưa có nhiệm vụ Put-away</h3><p>Hệ thống đang chờ nhiệm vụ mới. Danh sách sẽ tự cập nhật khi có pallet được phân công.</p><strong>🟢 Smart Put-away Engine đang hoạt động</strong></div>
          )}
          {message && <p className="operations-message" role="status">{message}</p>}
        </section>

        <section className="operations-panel mover-route-panel" id="mover-route-map">
          <div className="mover-card-heading"><div><span>ĐIỂM ĐẾN ĐƯỢC CHỈ ĐỊNH</span><h2>Sơ đồ kho & lộ trình di chuyển</h2></div></div>
          <div className="mover-route-steps">
            <div><i className="mover-route-marker mover-route-marker--start" /><span>VỊ TRÍ LẤY</span><strong>Khu tập kết</strong></div>
            <div><i className="mover-route-line" /></div>
            <div><i className="mover-route-marker mover-route-marker--end" /><span>VỊ TRÍ PUT-AWAY</span><strong>{currentTask?.locationId || 'Chưa phân công'}</strong></div>
          </div>
          <div className="mover-map-container"><WarehouseMap locations={locations} compactMode showLegend={false} disableFrameSelection highlightFrameIds={routeFrame ? [`${routeFrame[0]}-${routeFrame[1]}`] : []} /></div>
          <div className="mover-map-note"><strong>Đường đi</strong><span>{currentTask ? `Điểm đích nằm tại dãy ${getLocationParts(currentTask.locationId)?.row || '—'}, khoang ${getLocationParts(currentTask.locationId)?.bay || '—'}.` : 'Đang chờ nhiệm vụ để hiển thị vị trí đích.'}</span><small>Chưa có dữ liệu khoảng cách hoặc thời gian tuyến trong nhiệm vụ.</small></div>
        </section>
      </div>

      <section className="operations-panel mover-task-list-panel">
        <div className="mover-card-heading"><div><span>PHÂN CÔNG</span><h2>Danh sách nhiệm vụ</h2></div><div className="mover-filter-group">
          {[['ALL', 'Tất cả'], [PUT_AWAY_STATUSES.WAITING_MOVE, 'Chờ nâng chuyển'], [PUT_AWAY_STATUSES.WAITING_LIFT, 'Chờ nâng hạ'], ['IN_PROGRESS', 'Đang thực hiện']].map(([value, label]) => <button type="button" className={filter === value ? 'is-selected' : ''} key={value} onClick={() => setFilter(value)}>{label}</button>)}
        </div></div>
        {filteredTasks.length ? <div className="operations-table-wrap"><table className="operations-table"><thead><tr><th>STT</th><th>Pallet</th><th>Hàng hóa</th><th>Vị trí đích</th><th>Ưu tiên</th><th>Trạng thái</th></tr></thead><tbody>{filteredTasks.map((task, index) => <tr key={task.id} onClick={() => { if (task.status === PUT_AWAY_STATUSES.WAITING_MOVE) { setSelectedTaskId(task.id); setConfirmedLocation(''); onClearScannedLocation() } }}><td>{index + 1}</td><td>{task.palletCode || '—'}</td><td>{task.productName || task.productCode || '—'}</td><td><strong>{task.locationId}</strong></td><td>Chưa chỉ định</td><td><span className={`operations-status operations-status--${task.status.toLowerCase()}`}>{startedTasks[task.id] ? 'Đang thực hiện' : PUT_AWAY_STATUS_LABELS[task.status] || task.status}</span></td></tr>)}</tbody></table></div> : <div className="mover-empty-inline">Không có nhiệm vụ phù hợp với bộ lọc.</div>}
      </section>

      <section className="operations-panel mover-completed-panel">
        <div className="mover-card-heading"><div><span>LỊCH SỬ</span><h2>Các lô đã hoàn thành</h2></div><button className="mover-link-button" type="button" onClick={() => onNavigate('mover-completed')}>Xem tất cả ({completedTasks.length})</button></div>
        {renderCompactCompleted(5)}
      </section>

      {incidentDialog}
    </div>
  )
}

function PutAwayWorkflow({ tasks, user, view = 'workflow', locations = [], incidents = [], scannedLocationCode = '', onClearScannedLocation = () => {}, onOpenScanner, onAdvanceTask, onReportIncident, onNavigate, cloudConfigured = false }) {
  const [actionMessage, setActionMessage] = useState('')
  const pendingMoveCount = tasks.filter((task) => task.status === PUT_AWAY_STATUSES.WAITING_MOVE).length
  const pendingLiftCount = tasks.filter((task) => task.status === PUT_AWAY_STATUSES.WAITING_LIFT).length
  const activeTasks = tasks.filter((task) => task.status !== PUT_AWAY_STATUSES.COMPLETED)
  const workTasks = user.role === 'ADMIN'
    ? tasks
    : tasks.filter((task) => user.role === 'MOVER'
      ? task.status === PUT_AWAY_STATUSES.WAITING_MOVE
      : task.status === PUT_AWAY_STATUSES.WAITING_LIFT)
  const heading = user.role === 'ADMIN'
    ? 'Theo dõi luồng Put-away'
    : user.role === 'MOVER'
      ? 'Công việc nâng chuyển'
      : 'Công việc nâng hạ'

  if (user.role === 'MOVER') {
    return <MoverWorkflow
      tasks={tasks}
      user={user}
      view={view}
      locations={locations}
      incidents={incidents}
      scannedLocationCode={scannedLocationCode}
      onClearScannedLocation={onClearScannedLocation}
      onOpenScanner={onOpenScanner}
      onAdvanceTask={onAdvanceTask}
      onReportIncident={onReportIncident}
      onNavigate={onNavigate}
    />
  }

  if (user.role === 'LIFTER') {
    return <LifterWorkflow
      tasks={tasks}
      user={user}
      view={view}
      incidents={incidents}
      scannedLocationCode={scannedLocationCode}
      onClearScannedLocation={onClearScannedLocation}
      onOpenScanner={onOpenScanner}
      onAdvanceTask={onAdvanceTask}
      onReportIncident={onReportIncident}
      onNavigate={onNavigate}
    />
  }

  const getAction = (task) => {
    if (user.role === 'MOVER' && task.status === PUT_AWAY_STATUSES.WAITING_MOVE) {
      return { label: 'Xác nhận đã chuyển đến ô chỉ định', confirm: 'Xác nhận lô hàng đã được chuyển đến ô chỉ định nhưng chưa đặt lên kệ?' }
    }
    if (user.role === 'LIFTER' && task.status === PUT_AWAY_STATUSES.WAITING_LIFT) {
      return { label: 'Xác nhận đã cất lên kệ', confirm: 'Xác nhận lô hàng đã được nâng lên đúng ô kệ?' }
    }
    return null
  }

  return (
    <div className="putaway-workflow">
      <section className="operations-heading">
        <div>
          <h2>{heading}</h2>
          <p>
            {user.role === 'ADMIN'
              ? 'Theo dõi trạng thái chung của các lô từ lúc chọn vị trí đến khi được cất lên kệ.'
              : 'Thực hiện công việc rồi xác nhận hoàn tất bước của bạn. Không cần xác nhận nhận việc.'}
          </p>
        </div>
        {user.role === 'ADMIN' && (
          <button className="operations-button" type="button" onClick={onOpenScanner}>
            Quét lô và tạo việc put-away
          </button>
        )}
      </section>

      <div className="operations-summary-grid">
        <div><span>Đang chờ nâng chuyển</span><strong>{pendingMoveCount.toLocaleString('vi-VN')}</strong></div>
        <div><span>Đang chờ nâng hạ</span><strong>{pendingLiftCount.toLocaleString('vi-VN')}</strong></div>
        <div><span>Đang xử lý</span><strong>{activeTasks.length.toLocaleString('vi-VN')}</strong></div>
        <div><span>Đã hoàn thành</span><strong>{tasks.length - activeTasks.length}</strong></div>
      </div>

      {user.role !== 'ADMIN' && (
        <div className="putaway-notification" role="status">
          {workTasks.length
            ? `Bạn có ${workTasks.length} lô đang chờ bước ${user.role === 'MOVER' ? 'nâng chuyển' : 'nâng hạ'}.`
            : `Hiện không có lô hàng chờ ${user.role === 'MOVER' ? 'nâng chuyển' : 'nâng hạ'}.`}
          {' '}{cloudConfigured
            ? 'Danh sách tự cập nhật khi trạng thái thay đổi trên các thiết bị đang kết nối.'
            : 'Danh sách tự cập nhật khi trạng thái thay đổi trên các tab của trình duyệt này.'}
        </div>
      )}

      <section className="operations-panel">
        <div className="operations-panel-heading">
          <h3>Tất cả lô hàng</h3>
          <span>{workTasks.length} lô</span>
        </div>
        {actionMessage && <p className="operations-message" role="status">{actionMessage}</p>}
        {workTasks.length ? (
          <div className="putaway-task-list">
            {[...workTasks].reverse().map((task) => {
              const action = getAction(task)
              return (
                <article className="putaway-task-card" key={task.id}>
                  <div className="putaway-task-heading">
                    <div>
                      <span className={`operations-status operations-status--${task.status.toLowerCase()}`}>
                        {PUT_AWAY_STATUS_LABELS[task.status] || task.status}
                      </span>
                      <h4>{task.productName || task.productCode}</h4>
                      <p>Mã hàng: <strong>{task.productCode}</strong></p>
                    </div>
                    <div className="putaway-task-target">
                      <span>Ô kệ đã chỉ định</span>
                      <strong>{task.locationId}</strong>
                    </div>
                  </div>
                  <div className="putaway-task-meta">
                    <span>GW: {task.grossWeightKg || '—'} kg</span>
                    <span>Kích thước: {task.heightCm} × {task.widthCm} × {task.depthCm} cm</span>
                    <span>Tạo bởi: {task.createdByName || '—'}</span>
                    <span>Đề xuất AI: {task.suggestedLocationId || '—'}</span>
                  </div>
                  {task.events?.length > 0 && (
                    <ol className="putaway-task-events">
                      {task.events.map((event, index) => (
                        <li key={`${task.id}-${event.occurredAt}-${index}`}>
                          <strong>{event.label}</strong>
                          <span>{event.actorName} · {formatTimestamp(event.occurredAt)}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                  {action && (
                    <button
                      className="operations-button putaway-task-action"
                      type="button"
                      onClick={async () => {
                        if (!window.confirm(action.confirm)) return
                        setActionMessage(
                          await onAdvanceTask(task.id)
                            ? 'Đã cập nhật trạng thái lô hàng.'
                            : 'Không thể cập nhật công việc. Hãy tải lại trang và kiểm tra trạng thái ô.'
                        )
                      }}
                    >
                      {action.label}
                    </button>
                  )}
                </article>
              )
            })}
          </div>
        ) : (
          <div className="operations-empty">
            {user.role === 'ADMIN'
              ? 'Chưa có lô hàng nào trong luồng put-away.'
              : 'Hiện chưa có lô hàng chờ bạn xử lý.'}
          </div>
        )}
      </section>

      {user.role === 'ADMIN' && (
        <section className="operations-panel">
          <div className="operations-panel-heading"><h3>Sự cố do Mover / Lifter báo cáo</h3><span>{incidents.filter((incident) => incident.status === 'OPEN').length} chưa xử lý</span></div>
          {incidents.length ? <div className="operations-table-wrap"><table className="operations-table"><thead><tr><th>Thời gian</th><th>Nhân viên</th><th>Vai trò</th><th>Nhiệm vụ</th><th>Sự cố</th><th>Vị trí</th><th>Mô tả</th></tr></thead><tbody>{[...incidents].reverse().map((incident) => <tr key={incident.id}><td>{formatTimestamp(incident.reportedAt)}</td><td>{incident.employeeName}</td><td>{incident.reportedByRole === 'LIFTER' ? 'Nâng hạ' : 'Nâng chuyển'}</td><td>{incident.taskReference}</td><td>{incident.incidentType}</td><td>{incident.locationId}</td><td>{incident.description || '—'}</td></tr>)}</tbody></table></div> : <div className="operations-empty">Chưa có sự cố được báo cáo.</div>}
        </section>
      )}

      <section className="operations-panel">
        <div className="operations-panel-heading">
          <h3>Các lô đã hoàn thành</h3>
          <span>{tasks.filter((task) => task.status === PUT_AWAY_STATUSES.COMPLETED).length} lô</span>
        </div>
        {tasks.some((task) => task.status === PUT_AWAY_STATUSES.COMPLETED) ? (
          <div className="putaway-task-list">
            {[...tasks].filter((task) => task.status === PUT_AWAY_STATUSES.COMPLETED).reverse().map((task) => (
              <article className="putaway-task-card putaway-task-card--completed" key={task.id}>
                <div className="putaway-task-heading">
                  <div>
                    <span className="operations-status operations-status--completed">Hoàn thành</span>
                    <h4>{task.productName || task.productCode}</h4>
                    <p>Mã hàng: <strong>{task.productCode}</strong></p>
                  </div>
                  <div className="putaway-task-target">
                    <span>Ô kệ</span>
                    <strong>{task.locationId}</strong>
                  </div>
                </div>
                <ol className="putaway-task-events">
                  {(task.events || []).map((event, index) => (
                    <li key={`${task.id}-${event.occurredAt}-${index}`}>
                      <strong>{event.label}</strong>
                      <span>{event.actorName} · {formatTimestamp(event.occurredAt)}</span>
                    </li>
                  ))}
                </ol>
              </article>
            ))}
          </div>
        ) : (
          <div className="operations-empty">Chưa có lô nào hoàn thành Put-away.</div>
        )}
      </section>
      <p className="putaway-prototype-note">
        {cloudConfigured
          ? 'Nhiệm vụ, trạng thái phân luồng và báo cáo sự cố được chia sẻ qua Supabase realtime.'
          : 'Bản mô phỏng đồng bộ giữa các tab của cùng trình duyệt bằng localStorage; chưa đồng bộ đa thiết bị.'}
      </p>
    </div>
  )
}

export default PutAwayWorkflow
