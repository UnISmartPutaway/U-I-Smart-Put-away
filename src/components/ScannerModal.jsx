import { useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader } from '@zxing/browser'
import { getLocalFrameNumber } from '../data/warehouseConfig'
import { fitsStorageSlot, recommendStorageSlots } from '../data/recommendationEngine'
import { SAMPLE_INBOUND_BATCHES } from '../data/sampleInboundBatches'

function normalizeLocationCode(value) {
  const code = String(value || '').trim().toUpperCase().replace(/\s/g, '')
  const dashed = code.match(/^(?:6)?(\d{3})-(\d{1,3})-(\d)-([ABC])$/)
  const compact = code.match(/^(\d{3})-(\d{1,3})-(\d)([ABC])$/)
  const match = dashed || compact

  if (!match) return null

  const [, row, frame, level, position] = match
  const localFrame = dashed
    ? getLocalFrameNumber(Number(row), Number(frame))
    : Number(frame)
  return `${row}-${String(localFrame).padStart(2, '0')}-${level}${position}`
}

function extractScanData(value) {
  const raw = String(value || '').trim()

  try {
    const payload = JSON.parse(raw)
    if (payload && typeof payload === 'object') {
      return {
        location: payload.locationCode || payload.locationId || payload.location || '',
        productCode: payload.productCode || payload.lotCode || payload.sku || payload.code || '',
        productName: payload.productName || payload.name || '',
        grossWeightKg: payload.grossWeightKg ?? payload.grossWeight ?? payload.weight ?? '',
        heightCm: payload.heightCm ?? payload.height ?? '',
        widthCm: payload.widthCm ?? payload.width ?? '',
        depthCm: payload.depthCm ?? payload.depth ?? '',
        cbm: payload.cbm ?? payload.volume ?? '',
      }
    }
  } catch {
    // Plain text barcodes are handled below.
  }

  try {
    const url = new URL(raw)
    const location = url.searchParams.get('locationCode') || url.searchParams.get('location') || ''
    const productCode = url.searchParams.get('productCode') || url.searchParams.get('sku') || url.searchParams.get('lotCode') || ''
    if (location || productCode) {
      return {
        location,
        productCode,
        grossWeightKg: url.searchParams.get('grossWeightKg') || '',
        heightCm: url.searchParams.get('heightCm') || '',
        widthCm: url.searchParams.get('widthCm') || '',
        depthCm: url.searchParams.get('depthCm') || '',
        cbm: url.searchParams.get('cbm') || '',
      }
    }
  } catch {
    // The scanned value may not be a URL.
  }

  const isLocation = Boolean(normalizeLocationCode(raw))
  return {
    location: isLocation ? raw : '',
    productCode: isLocation ? '' : raw,
    productName: '',
    grossWeightKg: '',
    heightCm: '',
    widthCm: '',
    depthCm: '',
    cbm: '',
  }
}

function median(values) {
  const sorted = values
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((left, right) => left - right)

  if (!sorted.length) return ''
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function ScannerModal({ onClose, locations, onStoreBatch, onShipLocation }) {
  const videoRef = useRef(null)
  const controlsRef = useRef(null)
  const [scanValue, setScanValue] = useState('')
  const [matches, setMatches] = useState([])
  const [batchDetails, setBatchDetails] = useState(null)
  const [selectedSampleId, setSelectedSampleId] = useState('')
  const [recommendations, setRecommendations] = useState([])
  const [batchHint, setBatchHint] = useState('')
  const [customLocationId, setCustomLocationId] = useState('')
  const [storeMessage, setStoreMessage] = useState('')
  const [cameraRunning, setCameraRunning] = useState(false)
  const [error, setError] = useState('')
  const [cameraError, setCameraError] = useState('')

  const stopCamera = () => {
    controlsRef.current?.stop()
    controlsRef.current = null
    setCameraRunning(false)
  }

  useEffect(() => () => controlsRef.current?.stop(), [])

  const searchCode = (value) => {
    setStoreMessage('')
    setSelectedSampleId('')
    const raw = String(value || '').trim()
    if (!raw) {
      setError('Nhập mã hàng hoặc mã vị trí để tra cứu.')
      setMatches([])
      return
    }

    const scanData = extractScanData(raw)
    const locationCode = normalizeLocationCode(scanData.location)
    const exactLocation = locationCode
      ? locations.find((location) => location.id === locationCode)
      : null

    if (exactLocation && !scanData.productCode) {
      setMatches([exactLocation])
      setBatchDetails(null)
      setRecommendations([])
      setBatchHint('')
      setError('')
      return
    }

    const productCode = String(scanData.productCode || '').trim().toLowerCase()
    if (!productCode) {
      setMatches([])
      setBatchDetails(null)
      setError('Không tìm thấy vị trí khớp với mã vừa quét.')
      return
    }

    const productMatches = locations.map((location) => {
      const matchedItems = (location.inventoryItems || []).filter(
        (item) => String(item.productCode || '').trim().toLowerCase() === productCode
      )
      const legacyMatch = !location.inventoryItems?.length &&
        String(location.lotId || '').trim().toLowerCase() === productCode

      return matchedItems.length || legacyMatch
        ? { ...location, matchedItems: matchedItems.length ? matchedItems : [location] }
        : null
    }).filter(Boolean)

    setMatches(productMatches)
    setError('')
    setRecommendations([])

    const matchedBatches = productMatches.flatMap((location) => location.matchedItems)
    const reference = matchedBatches[0]
    setBatchDetails({
      productCode: scanData.productCode,
      productName: scanData.productName || reference?.productName || '',
      grossWeightKg: scanData.grossWeightKg || median(matchedBatches.map((item) => item.grossWeightKg)),
      heightCm: scanData.heightCm || '',
      widthCm: scanData.widthCm || '',
      depthCm: scanData.depthCm || '',
      cbm: scanData.cbm || median(matchedBatches.map((item) => item.cbm)),
    })
    setBatchHint(
      productMatches.length
        ? 'Thông số GW và CBM được tham chiếu từ các vị trí đang lưu mặt hàng này.'
        : 'Mã mới chưa có dữ liệu lịch sử. Nhập thông số lô để nhận đề xuất.'
    )
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    searchCode(scanValue)
  }

  const handleBatchChange = (event) => {
    const { name, value } = event.target
    setSelectedSampleId('')
    setStoreMessage('')
    setBatchDetails((current) => ({ ...current, [name]: value }))
    setRecommendations([])
  }

  const handleSampleSelect = (event) => {
    const sample = SAMPLE_INBOUND_BATCHES.find((batch) => batch.id === event.target.value)
    setSelectedSampleId(event.target.value)
    if (!sample) return

    setScanValue(sample.productCode)
    setMatches([])
    setBatchDetails({ ...sample })
    setBatchHint('Lô mẫu dùng để thử đề xuất; kích thước kiện là số liệu giả lập.')
    setRecommendations([])
    setCustomLocationId('')
    setStoreMessage('')
    setError('')
  }

  const handleRecommend = (event) => {
    event.preventDefault()
    const results = recommendStorageSlots(batchDetails, locations, 5)
    setRecommendations(results)
    setStoreMessage('')
    setError(results.length ? '' : 'Không có ô trống phù hợp với kích thước hoặc tải trọng của lô hàng.')
  }

  const handleShipLocation = (location) => {
    const items = location.inventoryItems || []
    const description = items.length > 1
      ? `${items.length} lô (${items.map((item) => item.productCode).filter(Boolean).join(', ')})`
      : location.productName || location.lotId || location.id
    if (!window.confirm(`Xác nhận xuất toàn bộ hàng ${description} khỏi vị trí ${location.id}?`)) return

    if (!onShipLocation(location.id)) {
      setError('Không thể xuất hàng tại vị trí này. Hãy kiểm tra lại trạng thái ô.')
      return
    }

    setMatches((current) => current.filter((item) => item.id !== location.id))
    setRecommendations([])
    setError('')
    setStoreMessage(`Đã xuất hàng khỏi vị trí ${location.id}.`)
  }

  const storeBatchAt = (rawLocationId) => {
    const locationId = String(rawLocationId || '').trim().toUpperCase().replace(/\s/g, '')
    const target = locations.find((location) => location.id === locationId)

    if (!batchDetails || !fitsStorageSlot(batchDetails)) {
      setError('Thông số lô hàng chưa hợp lệ để nhập kho.')
      return
    }
    if (!target) {
      setError('Không tìm thấy mã vị trí trong kho.')
      return
    }
    if (target.status !== 'AVAILABLE') {
      setError('Vị trí này đã có hàng hoặc không thể sử dụng.')
      return
    }
    if (!onStoreBatch(batchDetails, locationId)) {
      setError('Không thể lưu lần nhập hàng này. Hãy thử lại.')
      return
    }

    setError('')
    setStoreMessage(`Đã cất ${batchDetails.productName || batchDetails.productCode} vào ${locationId}.`)
    setBatchDetails(null)
    setMatches([])
    setRecommendations([])
    setCustomLocationId('')
    setSelectedSampleId('')
  }

  const startCamera = async () => {
    setCameraError('')

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Trình duyệt không hỗ trợ camera hoặc trang chưa chạy trên HTTPS/localhost.')
      return
    }

    if (!videoRef.current) return

    const reader = new BrowserMultiFormatReader()
    let didScan = false
    let scannerControls = null

    try {
      scannerControls = await reader.decodeFromVideoDevice(
        undefined,
        videoRef.current,
        (result) => {
          if (!result || didScan) return

          didScan = true
          const value = result.getText()
          scannerControls?.stop()
          controlsRef.current?.stop()
          controlsRef.current = null
          setCameraRunning(false)
          setScanValue(value)
          searchCode(value)
        }
      )

      if (didScan) {
        scannerControls.stop()
      } else {
        controlsRef.current = scannerControls
        setCameraRunning(true)
      }
    } catch (cameraFailure) {
      const cameraMessages = {
        NotAllowedError: 'Bạn chưa cấp quyền camera. Hãy cho phép truy cập camera trong trình duyệt.',
        NotFoundError: 'Không tìm thấy camera trên thiết bị này.',
        NotReadableError: 'Camera đang được ứng dụng khác sử dụng.',
      }

      setCameraError(cameraMessages[cameraFailure.name] || 'Không thể khởi động camera. Hãy thử nhập mã thủ công.')
      setCameraRunning(false)
    }
  }

  const formatStatus = (status) => {
    if (status === 'OCCUPIED') return 'Có hàng'
    if (status === 'MAINTENANCE' || status === 'UNDER_MAINTENANCE') return 'Bảo trì'
    if (status === 'AVAILABLE') return 'Trống'
    return status || 'Chưa xác định'
  }

  return (
    <div className="scanner-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="scanner-modal" role="dialog" aria-modal="true" aria-labelledby="scanner-title">
        <header className="scanner-header">
          <div>
            <p className="scanner-eyebrow">TRA CỨU KHO</p>
            <h2 id="scanner-title">Quét QR / mã vạch</h2>
            <p>Quét mã hàng, mã vị trí hoặc QR chứa thông tin lô hàng.</p>
          </div>
          <button className="modal-close-button" onClick={onClose} aria-label="Đóng trình quét">×</button>
        </header>

        <div className="scanner-content">
          <div className="scanner-camera-column">
            <div className={`scanner-camera ${cameraRunning ? 'scanner-camera--active' : ''}`}>
              <video ref={videoRef} muted playsInline />
              {!cameraRunning && (
                <div className="scanner-camera-placeholder">
                  <span className="scanner-camera-mark" aria-hidden="true">⌗</span>
                  <span>Camera chưa bật</span>
                </div>
              )}
            </div>

            <button
              className="scanner-camera-button"
              onClick={cameraRunning ? stopCamera : startCamera}
            >
              {cameraRunning ? 'Dừng camera' : 'Bật camera'}
            </button>
            {cameraError && <p className="scanner-error">{cameraError}</p>}
          </div>

          <div className="scanner-results-column">
            <form className="scanner-search" onSubmit={handleSubmit}>
              <label htmlFor="scanner-code">Mã hàng hoặc mã vị trí</label>
              <div className="scanner-input-row">
                <input
                  id="scanner-code"
                  value={scanValue}
                  onChange={(event) => setScanValue(event.target.value)}
                  placeholder="VD: 6108-87-5-C hoặc mã hàng"
                  autoComplete="off"
                />
                <button type="submit">Tra cứu</button>
              </div>
            </form>

            <div className="scanner-sample-select">
              <label htmlFor="scanner-sample-batch">Lô hàng thử nghiệm</label>
              <select id="scanner-sample-batch" value={selectedSampleId} onChange={handleSampleSelect}>
                <option value="">Chọn lô mẫu</option>
                {SAMPLE_INBOUND_BATCHES.map((batch) => (
                  <option key={batch.id} value={batch.id}>
                    {batch.productName} · {batch.productCode}
                  </option>
                ))}
              </select>
            </div>

            {storeMessage && <p className="scanner-success" role="status">{storeMessage}</p>}
            {error && <p className="scanner-error">{error}</p>}

            {batchDetails && (
              <form className="scanner-batch-form" onSubmit={handleRecommend}>
                <div className="scanner-match-heading">
                  <h3>Thông tin lô nhập</h3>
                  <span>Điều chỉnh nếu cần</span>
                </div>
                {batchHint && <p className="scanner-batch-hint">{batchHint}</p>}
                <div className="scanner-batch-fields">
                  <label>
                    Mã hàng
                    <input name="productCode" value={batchDetails.productCode} onChange={handleBatchChange} required />
                  </label>
                  <label>
                    Tên hàng / nhóm
                    <input name="productName" value={batchDetails.productName} onChange={handleBatchChange} placeholder="Nhập nhóm hàng nếu có" />
                  </label>
                  <label>
                    GW lô (kg)
                    <input name="grossWeightKg" type="number" min="0.01" step="0.01" value={batchDetails.grossWeightKg} onChange={handleBatchChange} required />
                  </label>
                  <label>
                    Chiều cao (cm)
                    <input name="heightCm" type="number" min="0.1" step="0.1" value={batchDetails.heightCm} onChange={handleBatchChange} required />
                  </label>
                  <label>
                    Chiều rộng (cm)
                    <input name="widthCm" type="number" min="0.1" step="0.1" value={batchDetails.widthCm} onChange={handleBatchChange} required />
                  </label>
                  <label>
                    Chiều sâu (cm)
                    <input name="depthCm" type="number" min="0.1" step="0.1" value={batchDetails.depthCm} onChange={handleBatchChange} required />
                  </label>
                  <label>
                    Thể tích CBM
                    <input name="cbm" type="number" min="0" step="0.001" value={batchDetails.cbm} onChange={handleBatchChange} />
                  </label>
                </div>
                <button className="scanner-recommend-button" type="submit">Đề xuất vị trí</button>
                <p className="scanner-assumption">Tạm tính lối nhập gần dãy 101; lịch sử di chuyển chưa có nên tiêu chí này dùng điểm trung tính.</p>
                <div className="scanner-custom-placement">
                  <label htmlFor="scanner-custom-location">Hoặc nhập mã ô muốn cất</label>
                  <div className="scanner-input-row">
                    <input
                      id="scanner-custom-location"
                      value={customLocationId}
                      onChange={(event) => setCustomLocationId(event.target.value)}
                      placeholder="VD: 101-01-1A"
                      autoComplete="off"
                    />
                    <button type="button" onClick={() => storeBatchAt(customLocationId)}>
                      Cất vào ô
                    </button>
                  </div>
                </div>
              </form>
            )}

            {matches.length > 0 ? (
              <div className="scanner-match-list" aria-live="polite">
                <div className="scanner-match-heading">
                  <h3>Lịch sử mã hàng</h3>
                  <span>{matches.length} vị trí</span>
                </div>
                {matches.slice(0, 6).map((location) => (
                  <article className="scanner-match" key={location.id}>
                    <div className="scanner-match-title">
                      <strong>{location.id}</strong>
                      <span className={`scanner-status scanner-status--${location.status.toLowerCase()}`}>
                        {formatStatus(location.status)}
                      </span>
                    </div>
                    {(location.matchedItems || location.inventoryItems || [location]).map((item, index) => (
                      <div className="scanner-match-batch" key={item.batchId || item.sourceRow || `${location.id}-${index}`}>
                        <p>{item.productName || 'Chưa có tên hàng'}</p>
                        <dl>
                          <div><dt>Mã hàng</dt><dd>{item.productCode || item.lotId || 'Chưa có'}</dd></div>
                          <div><dt>Số lượng</dt><dd>{item.quantity || 'Chưa có'}</dd></div>
                          <div><dt>Nhà cung cấp</dt><dd>{item.supplier || item.customerId || 'Chưa có'}</dd></div>
                          {item.palletNote && <div><dt>Ghi chú pallet</dt><dd>{item.palletNote}</dd></div>}
                        </dl>
                      </div>
                    ))}
                    {location.status === 'OCCUPIED' && (
                      <button
                        className="scanner-outbound-button"
                        type="button"
                        onClick={() => handleShipLocation(location)}
                      >
                        Xuất hàng khỏi ô này
                      </button>
                    )}
                  </article>
                ))}
                {matches.length > 6 && <p className="scanner-assumption">Hiển thị 6 trong {matches.length} vị trí trùng mã hàng.</p>}
              </div>
            ) : (
              !batchDetails && !error && <p className="scanner-empty">Kết quả tra cứu sẽ hiển thị tại đây.</p>
            )}

            {recommendations.length > 0 && (
              <section className="scanner-recommendations" aria-live="polite">
                <div className="scanner-match-heading">
                  <h3>5 vị trí đề xuất</h3>
                  <span>Chỉ đề xuất, chưa giữ chỗ</span>
                </div>
                {recommendations.map((recommendation, index) => (
                  <article className={`scanner-recommendation ${index === 0 ? 'scanner-recommendation--best' : ''}`} key={recommendation.location.id}>
                    <div className="scanner-match-title">
                      <strong>{index === 0 ? 'Phù hợp nhất · ' : ''}{recommendation.location.id}</strong>
                      <span className="scanner-recommendation-score">{recommendation.score} điểm</span>
                    </div>
                    <p>Tầng {recommendation.location.level} · Khu {recommendation.location.zone}</p>
                    <div className="scanner-score-breakdown">
                      <span>An toàn {recommendation.factors.safety} × 35%</span>
                      <span>Di chuyển {recommendation.factors.travel} × 25%</span>
                      <span>Tải trọng {recommendation.factors.weightLevel} × 20%</span>
                      <span>Nhóm hàng {recommendation.factors.group} × 15%</span>
                      <span>Lịch sử {recommendation.factors.movementHistory} × 5%</span>
                    </div>
                    <button
                      className="scanner-place-button"
                      type="button"
                      onClick={() => storeBatchAt(recommendation.location.id)}
                    >
                      Cất hàng vào ô này
                    </button>
                  </article>
                ))}
              </section>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

export default ScannerModal