import { useCallback, useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader } from '@zxing/browser'
import WarehouseMap from './WarehouseMap'
import { getLocalFrameNumber } from '../data/warehouseConfig'
import {
  fitsStorageSlot,
  recommendStorageSlots,
  STORAGE_SLOT_LIMITS,
} from '../data/recommendationEngine'
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
        palletCode: payload.palletCode || payload.palletId || '',
        lotCode: payload.lotCode || payload.batchCode || '',
        quantity: payload.quantity ?? '',
        supplier: payload.supplier || payload.customerId || '',
        netWeightKg: payload.netWeightKg ?? '',
        palletNote: payload.palletNote || '',
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
        palletCode: url.searchParams.get('palletCode') || url.searchParams.get('palletId') || '',
        lotCode: url.searchParams.get('lotCode') || url.searchParams.get('batchCode') || '',
        quantity: url.searchParams.get('quantity') || '',
        supplier: url.searchParams.get('supplier') || url.searchParams.get('customerId') || '',
        netWeightKg: url.searchParams.get('netWeightKg') || '',
        palletNote: url.searchParams.get('palletNote') || '',
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
    palletCode: '',
    lotCode: '',
    quantity: '',
    supplier: '',
    netWeightKg: '',
    palletNote: '',
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

function normalizeSlotId(value) {
  return String(value || '').trim().toUpperCase().replace(/\s/g, '')
}

function getBatchSizeError(batch) {
  const dimensions = [Number(batch.heightCm), Number(batch.widthCm), Number(batch.depthCm)]
  if (!dimensions.every((dimension) => Number.isFinite(dimension) && dimension > 0)) {
    return 'Cần nhập đủ kích thước kiện hàng trước khi cất.'
  }

  const packageDimensions = dimensions.sort((left, right) => right - left)
  const slotDimensions = [
    STORAGE_SLOT_LIMITS.heightCm,
    STORAGE_SLOT_LIMITS.widthCm,
    STORAGE_SLOT_LIMITS.depthCm,
  ].sort((left, right) => right - left)
  if (!packageDimensions.every((dimension, index) => dimension <= slotDimensions[index])) {
    return `Kiện hàng vượt kích thước ô tối đa ${STORAGE_SLOT_LIMITS.heightCm} × ${STORAGE_SLOT_LIMITS.widthCm} × ${STORAGE_SLOT_LIMITS.depthCm} cm.`
  }

  if (Number(batch.grossWeightKg) > STORAGE_SLOT_LIMITS.maxGrossWeightKg) {
    return `Tải trọng kiện hàng vượt quá ${STORAGE_SLOT_LIMITS.maxGrossWeightKg} kg.`
  }

  if (!fitsStorageSlot(batch)) {
    return 'Thông số hoặc tải trọng kiện hàng không phù hợp với ô lưu trữ.'
  }
  return ''
}

function ScannerModal({
  onClose,
  locations,
  onStoreBatch,
  onReportLocationMismatch,
  onShipLocation,
  reportedMismatchLocationIds = [],
  initialScanValue = '',
  externalSelectedLocationId = '',
  onAnalysisChange,
  onLocationScanned,
}) {
  const videoRef = useRef(null)
  const controlsRef = useRef(null)
  const [scanValue, setScanValue] = useState('')
  const [matches, setMatches] = useState([])
  const [batchDetails, setBatchDetails] = useState(null)
  const [selectedSampleId, setSelectedSampleId] = useState('')
  const [recommendations, setRecommendations] = useState([])
  const [selectedRecommendationId, setSelectedRecommendationId] = useState('')
  const [manualLocationId, setManualLocationId] = useState('')
  const [selectionMethod, setSelectionMethod] = useState('RECOMMENDATION')
  const [batchHint, setBatchHint] = useState('')
  const [storeMessage, setStoreMessage] = useState('')
  const [cameraRunning, setCameraRunning] = useState(false)
  const [error, setError] = useState('')
  const [cameraError, setCameraError] = useState('')
  const [showScanResultPopup, setShowScanResultPopup] = useState(false)
  const initialLookupRef = useRef('')

  const topRecommendation = recommendations[0] || null
  const recommendationPreview = recommendations.slice(0, 4)
  const selectedRecommendation = recommendationPreview.find(
    (recommendation) => recommendation.location.id === (externalSelectedLocationId || selectedRecommendationId)
  ) || topRecommendation
  const selectedIsBest = selectedRecommendation?.location.id === topRecommendation?.location.id
  const selectedLocationId = selectionMethod === 'MANUAL'
    ? normalizeSlotId(manualLocationId)
    : selectedRecommendation?.location.id || ''
  const selectedLocation = locations.find((location) => location.id === selectedLocationId)
  const manualTarget = locations.find((location) => location.id === normalizeSlotId(manualLocationId))
  const manualPlacementError = !manualLocationId.trim()
    ? ''
    : !manualTarget
      ? 'Không tìm thấy mã vị trí này trong kho.'
      : manualTarget.status === 'BLOCKED' || manualTarget.isBlocked
        ? 'Ô đang bị khóa do lỗi/bảo trì và không thể cất hàng.'
        : manualTarget.status === 'MAINTENANCE' || manualTarget.status === 'UNDER_MAINTENANCE'
          ? 'Ô đang bảo trì và không thể cất hàng.'
        : manualTarget.status !== 'AVAILABLE'
          ? 'Ô đã đầy hoặc không còn sức chứa.'
          : getBatchSizeError(batchDetails || {})

  const stopCamera = () => {
    controlsRef.current?.stop()
    controlsRef.current = null
    setCameraRunning(false)
  }

  useEffect(() => () => controlsRef.current?.stop(), [])

  const applyRecommendations = useCallback((nextBatchDetails, overrideMessage = '') => {
    const results = recommendStorageSlots(nextBatchDetails, locations, 4, reportedMismatchLocationIds)
    setRecommendations(results)
    setSelectedRecommendationId(results[0]?.location.id || '')
    setSelectionMethod('RECOMMENDATION')
    setShowScanResultPopup(true)
    setStoreMessage('')
    setError(results.length ? '' : overrideMessage || 'Không có ô trống phù hợp với kích thước hoặc tải trọng của lô hàng.')
    onAnalysisChange?.({
      batch: nextBatchDetails,
      recommendations: results,
      selectedLocationId: results[0]?.location.id || '',
      status: results.length ? 'ready' : 'analyzing',
    })
  }, [locations, onAnalysisChange, reportedMismatchLocationIds])

  const searchCode = useCallback((value) => {
    onAnalysisChange?.({
      status: 'reading',
      batch: null,
      recommendations: [],
      selectedLocationId: '',
    })
    setStoreMessage('')
    setSelectedSampleId('')
    setManualLocationId('')
    setSelectionMethod('RECOMMENDATION')
    const raw = String(value || '').trim()
    if (!raw) {
      setError('Nhập mã hàng hoặc mã vị trí để tra cứu.')
      setMatches([])
      onAnalysisChange?.({ status: 'idle', batch: null, recommendations: [], selectedLocationId: '' })
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
      setSelectedRecommendationId('')
      setManualLocationId('')
      setBatchHint('')
      setError('')
      onLocationScanned?.(exactLocation.id)
      onAnalysisChange?.({ status: 'idle', batch: null, recommendations: [], selectedLocationId: '' })
      return
    }

    const productCode = String(scanData.productCode || '').trim().toLowerCase()
    if (!productCode) {
      setMatches([])
      setBatchDetails(null)
      setShowScanResultPopup(false)
      setError('Không tìm thấy vị trí khớp với mã vừa quét.')
      onAnalysisChange?.({ status: 'idle', batch: null, recommendations: [], selectedLocationId: '' })
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
    setSelectedRecommendationId('')

    if (productMatches.length > 0) {
      setBatchDetails(null)
      setBatchHint('')
      setShowScanResultPopup(false)
      onAnalysisChange?.({ status: 'idle', batch: null, recommendations: [], selectedLocationId: '' })
      return
    }

    const matchedBatches = productMatches.flatMap((location) => location.matchedItems)
    const reference = matchedBatches[0]
    const nextBatchDetails = {
      productCode: scanData.productCode,
      productName: scanData.productName || reference?.productName || '',
      grossWeightKg: scanData.grossWeightKg || median(matchedBatches.map((item) => item.grossWeightKg)),
      heightCm: scanData.heightCm || '',
      widthCm: scanData.widthCm || '',
      depthCm: scanData.depthCm || '',
      cbm: scanData.cbm || median(matchedBatches.map((item) => item.cbm)),
      palletCode: scanData.palletCode || '',
      lotCode: scanData.lotCode || '',
      quantity: scanData.quantity || '',
      supplier: scanData.supplier || '',
      netWeightKg: scanData.netWeightKg || '',
      palletNote: scanData.palletNote || '',
    }

    setBatchDetails(nextBatchDetails)
    setShowScanResultPopup(false)
    setBatchHint(
      productMatches.length
        ? 'Thông số GW và CBM được tham chiếu từ các vị trí đang lưu mặt hàng này.'
        : 'Mã mới chưa có dữ liệu lịch sử. Nhập thông số lô để nhận đề xuất.'
    )
    applyRecommendations(nextBatchDetails)
  }, [applyRecommendations, locations, onAnalysisChange, onLocationScanned])

  useEffect(() => {
    const code = initialScanValue.trim()
    if (!code || initialLookupRef.current === code) return
    initialLookupRef.current = code
    setScanValue(code)
    searchCode(code)
  }, [initialScanValue, searchCode])

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
    setSelectedRecommendationId('')
    setSelectionMethod('RECOMMENDATION')
    setError('')
    onAnalysisChange?.({
      batch: { ...batchDetails, [name]: value },
      recommendations: [],
      selectedLocationId: '',
      status: 'analyzing',
    })
  }

  const handleSampleSelect = (event) => {
    const sample = SAMPLE_INBOUND_BATCHES.find((batch) => batch.id === event.target.value)
    setSelectedSampleId(event.target.value)
    if (!sample) return

    const nextSample = { ...sample }
    setScanValue(sample.productCode)
    setMatches([])
    setBatchDetails(nextSample)
    setBatchHint('Lô mẫu dùng để thử đề xuất; kích thước kiện là số liệu giả lập.')
    setRecommendations([])
    setManualLocationId('')
    setSelectionMethod('RECOMMENDATION')
    setStoreMessage('')
    setError('')
    applyRecommendations(nextSample)
  }

  const runRecommendation = () => {
    if (!batchDetails) {
      setError('Chưa có thông tin lô hàng để đề xuất vị trí.')
      return
    }

    applyRecommendations(batchDetails)
  }

  const handleRecommend = (event) => {
    event?.preventDefault?.()
    runRecommendation()
  }

  const handleStoreSelectedRecommendation = () => {
    if (!batchDetails || !selectedLocationId) return

    const batchSizeError = getBatchSizeError(batchDetails)
    if (batchSizeError) {
      setError(batchSizeError)
      return
    }

    if (!selectedLocation || selectedLocation.status !== 'AVAILABLE' || selectedLocation.isBlocked) {
      setError(selectedLocation?.isBlocked || selectedLocation?.status === 'BLOCKED'
        ? 'Ô đang bị khóa do lỗi/bảo trì và không thể cất hàng.'
        : 'Ô đã đầy hoặc không còn sức chứa. Hãy chọn vị trí khác.')
      return
    }

    const locationId = selectedLocation.id
    if (!window.confirm(`Tạo lệnh put-away cho ${batchDetails.productName || batchDetails.productCode} tại ${locationId}? Lô sẽ chờ người nâng chuyển đưa đến vị trí này.`)) return

    if (!onStoreBatch(batchDetails, locationId, {
      suggestedLocationId: topRecommendation?.location.id || '',
      selectionMethod,
    })) {
      setError('Không thể cất hàng vào vị trí này. Hãy kiểm tra lại trạng thái ô.')
      return
    }

    setError('')
    setStoreMessage(`Đã tạo lệnh di chuyển ${batchDetails.productName || batchDetails.productCode} đến ${locationId}. Lô đang chờ người nâng chuyển nhận việc.`)
    onAnalysisChange?.({
      batch: batchDetails,
      recommendations,
      selectedLocationId: locationId,
      status: 'confirmed',
    })
    setBatchDetails(null)
    setRecommendations([])
    setSelectedRecommendationId('')
    setSelectedSampleId('')
    setShowScanResultPopup(false)
  }

  const handleReportLocationMismatch = () => {
    if (!selectedRecommendation || !batchDetails) return
    const locationId = selectedRecommendation.location.id
    if (!window.confirm(`Ghi nhận ${locationId} đang có hàng thực tế và đề xuất một vị trí khác?`)) return

    if (!onReportLocationMismatch(locationId, batchDetails)) {
      setError('Không thể lưu báo cáo sai lệch. Hãy thử lại.')
      return
    }

    const excludedLocationIds = [...new Set([...reportedMismatchLocationIds, locationId])]
    const results = recommendStorageSlots(batchDetails, locations, 4, excludedLocationIds)
    setRecommendations(results)
    setSelectedRecommendationId(results[0]?.location.id || '')
    setSelectionMethod('RECOMMENDATION')
    setError(results.length ? '' : 'Đã ghi nhận sai lệch, nhưng hiện không còn vị trí phù hợp khác.')
    setStoreMessage(`Đã ghi nhận ${locationId} cần kiểm kê và loại vị trí này khỏi đề xuất.`)
    onAnalysisChange?.({
      batch: batchDetails,
      recommendations: results,
      selectedLocationId: results[0]?.location.id || '',
      status: results.length ? 'ready' : 'analyzing',
    })
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
    if (status === 'RESERVED') return 'Đã giữ chỗ · chờ put-away'
    if (status === 'BLOCKED') return 'Ô lỗi / đã khóa'
    return status || 'Chưa xác định'
  }

  return (
    <div className="scanner-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      {showScanResultPopup && batchDetails && (
        <div
          className="scanner-result-overlay"
          onMouseDown={(event) => event.target === event.currentTarget && setShowScanResultPopup(false)}
        >
          <div className="scanner-result-popup" role="dialog" aria-modal="true" aria-labelledby="scan-result-title">
            <header className="scanner-result-header">
              <div>
                <p className="scanner-eyebrow">KẾT QUẢ QUÉT</p>
                <h2 id="scan-result-title">Vị trí đề xuất cho lô hàng</h2>
              </div>
              <button className="modal-close-button" onClick={() => setShowScanResultPopup(false)} aria-label="Đóng popup đề xuất">×</button>
            </header>

            <div className="scanner-result-grid">
              <div className="scanner-result-card">
                <div className="scanner-result-summary">
                  <span className="scanner-result-badge">Mặt hàng vừa quét</span>
                  <h3>{batchDetails.productName || batchDetails.productCode || 'Mã hàng chưa xác định'}</h3>
                  <div className="scanner-result-meta">
                    <span>Mã hàng: {batchDetails.productCode || 'Chưa có'}</span>
                    <span>GW: {batchDetails.grossWeightKg || '—'} kg</span>
                    <span>CBM: {batchDetails.cbm || '—'} m³</span>
                  </div>
                </div>

                {selectionMethod === 'MANUAL' && selectedLocation ? (
                  <div className="scanner-result-slot">
                    <div className="scanner-result-slot-header">
                      <span className="scanner-result-badge scanner-result-badge--best">Vị trí nhập tay</span>
                      <strong>{selectedLocation.id}</strong>
                    </div>
                    <p className="scanner-result-note">Đã kiểm tra: ô trống, không bị khóa và phù hợp kích thước kiện.</p>
                  </div>
                ) : topRecommendation ? (
                  <div className="scanner-result-slot">
                    <div className="scanner-result-slot-header">
                      <span className="scanner-result-badge scanner-result-badge--best">
                        {selectedIsBest ? 'Đề xuất tốt nhất' : 'Vị trí đang chọn'}
                      </span>
                      <strong>{selectedRecommendation.location.id}</strong>
                    </div>
                    <p className="scanner-result-score">{selectedRecommendation.score} điểm phù hợp</p>
                    <dl className="scanner-result-factor-grid">
                      <div><dt>An toàn</dt><dd>{selectedRecommendation.factors.safety}</dd></div>
                      <div><dt>Di chuyển</dt><dd>{selectedRecommendation.factors.travel}</dd></div>
                      <div><dt>Tải trọng</dt><dd>{selectedRecommendation.factors.weightLevel}</dd></div>
                      <div><dt>Nhóm</dt><dd>{selectedRecommendation.factors.group}</dd></div>
                    </dl>
                    <p className="scanner-result-note">Tầng {selectedRecommendation.location.level} · Khu {selectedRecommendation.location.zone}</p>
                  </div>
                ) : (
                  <div className="scanner-result-empty">Chưa có đề xuất. Bấm nút bên dưới để tính toán vị trí phù hợp.</div>
                )}
                {recommendationPreview.length > 0 && (
                  <div className="scanner-result-recommendations">
                    <div className="scanner-result-recommendations-header">
                      <h4>Top 4 vị trí đề xuất</h4>
                    </div>
                    <div className="scanner-result-recommendation-list">
                      {recommendationPreview.map((recommendation, index) => (
                        <button
                          key={recommendation.location.id}
                          className={`scanner-result-slot-item ${index === 0 ? 'scanner-result-slot-item--best' : ''} ${recommendation.location.id === selectedRecommendation?.location.id ? 'scanner-result-slot-item--selected' : ''}`}
                          type="button"
                          aria-pressed={recommendation.location.id === selectedRecommendation?.location.id}
                          onClick={() => {
                            setSelectedRecommendationId(recommendation.location.id)
                            setSelectionMethod('RECOMMENDATION')
                            setError('')
                            onAnalysisChange?.({
                              batch: batchDetails,
                              recommendations,
                              selectedLocationId: recommendation.location.id,
                              status: 'ready',
                            })
                          }}
                        >
                          <div className="scanner-result-slot-item__top">
                            <span>{index === 0 ? 'Ưu tiên' : `Lựa chọn ${index + 1}`}</span>
                            <strong>{recommendation.location.id}</strong>
                          </div>
                          <div className="scanner-result-slot-item__meta">
                            <span>{recommendation.score} điểm</span>
                            <span>Tầng {recommendation.location.level}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {selectionMethod === 'RECOMMENDATION' && selectedRecommendation && (
                  <button type="button" className="scanner-result-mismatch-button" onClick={handleReportLocationMismatch}>
                    Đổi vị trí khác · ô này đã có hàng
                  </button>
                )}

                <div className="scanner-manual-placement">
                  <label htmlFor="scanner-popup-manual-location">Hoặc nhập một vị trí khác</label>
                  <div className="scanner-input-row">
                    <input
                      id="scanner-popup-manual-location"
                      value={manualLocationId}
                      onChange={(event) => {
                        setManualLocationId(event.target.value)
                        setSelectionMethod('MANUAL')
                        setError('')
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          setSelectionMethod('MANUAL')
                        }
                      }}
                      placeholder="VD: 101-01-1A"
                      autoComplete="off"
                      aria-invalid={Boolean(manualPlacementError)}
                      aria-describedby="scanner-manual-location-alert"
                    />
                    <button
                      type="button"
                      disabled={!manualLocationId.trim() || Boolean(manualPlacementError)}
                      onClick={() => {
                        setSelectionMethod('MANUAL')
                        setError('')
                      }}
                    >
                      Chọn ô này
                    </button>
                  </div>
                  {manualPlacementError && (
                    <p className="scanner-error" id="scanner-manual-location-alert" role="alert">
                      {manualPlacementError}
                    </p>
                  )}
                </div>

                {error && <p className="scanner-error" role="alert">{error}</p>}
                {storeMessage && <p className="scanner-success" role="status">{storeMessage}</p>}

                <div className="scanner-result-actions">
                  {selectedLocationId ? (
                    <button
                      type="button"
                      className="scanner-result-primary"
                      disabled={
                        !selectedLocation ||
                        selectedLocation.status !== 'AVAILABLE' ||
                        selectedLocation.isBlocked ||
                        (selectionMethod === 'MANUAL' && Boolean(manualPlacementError))
                      }
                      onClick={handleStoreSelectedRecommendation}
                    >
                      Cất hàng vào {selectedLocationId}
                    </button>
                  ) : (
                    <button type="button" className="scanner-result-primary" onClick={runRecommendation}>
                      Đề xuất vị trí
                    </button>
                  )}
                  <button type="button" className="scanner-result-back-button" onClick={() => setShowScanResultPopup(false)}>
                    Quay lại
                  </button>
                  <button type="button" className="scanner-result-secondary" onClick={() => setShowScanResultPopup(false)}>
                    Đóng
                  </button>
                </div>
              </div>

              <div className="scanner-result-map-panel">
                <div className="scanner-result-map-header">
                  <h3>Bản đồ kho</h3>
                  <span>{selectedLocation ? `Đang chọn ô ${selectedLocation.id}` : 'Đang xem toàn cảnh kho'}</span>
                </div>

                <div className="scanner-result-map">
                  <WarehouseMap
                    locations={locations}
                    compactMode
                    showLegend={false}
                    disableFrameSelection
                    highlightFrameIds={
                      selectedLocation ? [`${selectedLocation.row}-${selectedLocation.frame}`] : []
                    }
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

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
              {cameraRunning && (
                <div className="scanner-target-overlay" aria-hidden="true">
                  <span className="scanner-target-crosshair" />
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
                    {(location.status === 'OCCUPIED' ||
                      (location.status === 'BLOCKED' && (location.inventoryItems?.length || location.lotId))) && (
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

          </div>
        </div>
      </section>
    </div>
  )
}

export default ScannerModal