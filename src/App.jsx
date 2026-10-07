import { useCallback, useEffect, useState } from 'react'
import './App.css'
import WarehouseMap from './components/WarehouseMap'
import Login from './components/Login'
import OperationsView from './components/OperationsView'
import PutAwayWorkflow from './components/PutAwayWorkflow'
import ScannerModal from './components/ScannerModal'
import BrandMark from './components/BrandMark'
import {
  ACCOUNT_PASSWORDS_KEY,
  createAccountPasswordCredential,
  readAccountPasswordHashes,
  verifyAccountPassword,
} from './data/accountSecurity'
import {
  WAREHOUSE_LOCATIONS,
  WAREHOUSE_STATS,
} from './data/warehouseConfig'
import { mergeWarehouseInventory } from './data/warehouseInventory'
import {
  advancePutAwayTask,
  getActivePutAwayTasks,
  normalizePutAwayTasks,
  PUT_AWAY_STATUSES,
} from './data/putAwayWorkflow'
import {
  advancePutAwayTask as advanceRemotePutAwayTask,
  createPutAwayIncident,
  createPutAwayTask,
  getUserProfile,
  loadPutAwaySnapshot,
  subscribeToPutAwayChanges,
} from './data/putAwayRepository'
import { supabase } from './data/supabase'

function readStoredUser() {
  try {
    const savedUser = JSON.parse(sessionStorage.getItem('smartLocationUser') || 'null')
    return savedUser && ['ADMIN', 'MOVER', 'LIFTER'].includes(savedUser.role) ? savedUser : null
  } catch {
    sessionStorage.removeItem('smartLocationUser')
    return null
  }
}

const NAV_GROUPS = [
  { title: 'TỔNG QUAN', items: [{ id: 'dashboard', label: 'Bảng điều khiển' }] },
  { title: 'ĐIỀU PHỐI', items: [{ id: 'workflow', label: 'Luồng Put-away' }] },
  {
    title: 'KHO',
    items: [
      { id: 'map', label: 'Bản đồ kho' },
      { id: 'inventory', label: 'Tồn kho' },
      { id: 'smart', label: 'Vị trí thông minh' },
    ],
  },
  {
    title: 'HOẠT ĐỘNG',
    items: [
      { id: 'inbound', label: 'Nhập kho' },
      { id: 'outbound', label: 'Xuất kho' },
      { id: 'scanner', label: 'Máy quét' },
      { id: 'putaway-log', label: 'Nhật ký Put-away (Báo cáo)' },
    ],
  },
  {
    title: 'QUẢN LÝ',
    items: [
      { id: 'customers', label: 'Khách hàng' },
      { id: 'reports', label: 'Báo cáo' },
      { id: 'settings', label: 'Cài đặt' },
    ],
  },
]

const VIEW_TITLES = Object.fromEntries(
  NAV_GROUPS.flatMap((group) => group.items.map((item) => [item.id, item.label]))
)
VIEW_TITLES.workflow = 'Luồng Put-away'
VIEW_TITLES['mover-tasks'] = 'Nhiệm vụ của tôi'
VIEW_TITLES['mover-map'] = 'Sơ đồ kho'
VIEW_TITLES['mover-issues'] = 'Báo sự cố'
VIEW_TITLES['mover-completed'] = 'Đã hoàn thành'
VIEW_TITLES['mover-performance'] = 'Hiệu suất ca'
VIEW_TITLES['lifter-tasks'] = 'Nhiệm vụ nâng hạ'
VIEW_TITLES['lifter-completed'] = 'Đã hoàn thành'
VIEW_TITLES['lifter-scan'] = 'Quét vị trí'
VIEW_TITLES['lifter-issues'] = 'Báo sự cố'

const ROLE_LABELS = {
  ADMIN: 'Admin · Kiểm hàng',
  MOVER: 'Người nâng chuyển',
  LIFTER: 'Nhân viên nâng hạ',
}

function readStoredArray(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

function readStoredPutAwayTasks() {
  return normalizePutAwayTasks(readStoredArray('smartLocationPutAwayTasks'))
}

function getCompletedWorkflowRecords(tasks) {
  const completedTasks = tasks.filter((task) => task.status === PUT_AWAY_STATUSES.COMPLETED)
  return {
    placements: completedTasks.map((task) => ({
      id: `inbound-${task.id}`,
      locationId: task.locationId,
      productCode: task.productCode,
      productName: task.productName,
      palletCode: task.palletCode,
      lotCode: task.lotCode,
      customerId: task.customerId,
      supplier: task.supplier,
      palletNote: task.palletNote,
      quantity: task.quantity,
      packageCount: task.packageCount,
      grossWeightKg: task.grossWeightKg,
      netWeightKg: task.netWeightKg,
      cbm: task.cbm,
      heightCm: task.heightCm,
      widthCm: task.widthCm,
      depthCm: task.depthCm,
      receivedAt: task.updatedAt,
    })),
    log: completedTasks.map((task) => {
      const completionEvent = task.events?.find(
        (event) => event.status === PUT_AWAY_STATUSES.COMPLETED
      )
      return {
        id: `putaway-log-${task.id}`,
        receivedAt: task.updatedAt,
        employeeName: completionEvent?.actorName || task.createdByName,
        employeeUsername: completionEvent?.actorUsername || task.createdByUsername,
        productCode: task.productCode,
        productName: task.productName,
        suggestedLocationId: task.suggestedLocationId,
        selectedLocationId: task.locationId,
        followedSuggestion: task.suggestedLocationId === task.locationId,
        selectionMethod: task.selectionMethod,
      }
    }),
  }
}

function saveLocalStorageUpdates(updates) {
  const previousValues = Object.fromEntries(
    Object.keys(updates).map((key) => [key, localStorage.getItem(key)])
  )
  try {
    for (const [key, value] of Object.entries(updates)) {
      localStorage.setItem(key, JSON.stringify(value))
    }
    return true
  } catch {
    for (const [key, value] of Object.entries(previousValues)) {
      try {
        if (value === null) localStorage.removeItem(key)
        else localStorage.setItem(key, value)
      } catch {
        // Keep the original persistence error visible to the caller.
      }
    }
    return false
  }
}

function createPutAwayTaskId() {
  return `putaway-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function createOutboundShipmentId() {
  return `outbound-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function App() {
  const [user, setUser] = useState(() => supabase ? null : readStoredUser())
  const [authReady, setAuthReady] = useState(!supabase)
  const [syncStatus, setSyncStatus] = useState(supabase ? 'connecting' : 'local')
  const [syncError, setSyncError] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [scannerInitialValue, setScannerInitialValue] = useState('')
  const [smartPutawayAnalysis, setSmartPutawayAnalysis] = useState({
    status: 'idle',
    batch: null,
    recommendations: [],
    selectedLocationId: '',
  })
  const [smartMapLocationId, setSmartMapLocationId] = useState('')
  const [activeView, setActiveView] = useState(() => user?.role === 'ADMIN' ? 'dashboard' : 'workflow')
  const [inboundPlacements, setInboundPlacements] = useState(() => {
    try {
      const savedPlacements = JSON.parse(
        localStorage.getItem('smartLocationInboundPlacements') || '[]'
      )
      return Array.isArray(savedPlacements) ? savedPlacements : []
    } catch {
      return []
    }
  })
  const [outboundLocationIds, setOutboundLocationIds] = useState(() => {
    try {
      const savedLocationIds = JSON.parse(
        localStorage.getItem('smartLocationOutboundLocationIds') || '[]'
      )
      return Array.isArray(savedLocationIds) ? savedLocationIds : []
    } catch {
      return []
    }
  })
  const [outboundLog, setOutboundLog] = useState(() => readStoredArray('smartLocationOutboundLog'))
  const [blockedLocationIds, setBlockedLocationIds] = useState(() => {
    try {
      const savedIds = JSON.parse(localStorage.getItem('smartLocationBlockedLocationIds') || '[]')
      return Array.isArray(savedIds) ? savedIds : []
    } catch {
      return []
    }
  })
  const [putAwayLog, setPutAwayLog] = useState(() => {
    try {
      const savedLog = JSON.parse(localStorage.getItem('smartLocationPutAwayLog') || '[]')
      return Array.isArray(savedLog) ? savedLog : []
    } catch {
      return []
    }
  })
  const [locationDiscrepancies, setLocationDiscrepancies] = useState(() => {
    try {
      const savedReports = JSON.parse(localStorage.getItem('smartLocationDiscrepancies') || '[]')
      return Array.isArray(savedReports) ? savedReports : []
    } catch {
      return []
    }
  })
  const [putAwayTasks, setPutAwayTasks] = useState(() => supabase ? [] : readStoredPutAwayTasks())
  const [putAwayIncidents, setPutAwayIncidents] = useState(() => supabase ? [] : readStoredArray('smartLocationPutAwayIncidents'))
  const [scannedPutAwayLocation, setScannedPutAwayLocation] = useState('')
  const activePutAwayTasks = getActivePutAwayTasks(putAwayTasks)
  const reservedTasksByLocation = new Map(
    activePutAwayTasks.map((task) => [task.locationId, task])
  )
  const warehouseLocations = mergeWarehouseInventory(
    WAREHOUSE_LOCATIONS,
    inboundPlacements,
    outboundLocationIds,
    blockedLocationIds,
    activePutAwayTasks
  )
  const reportedMismatchLocationIds = [...new Set(
    locationDiscrepancies.filter((report) => report.status === 'OPEN').map((report) => report.locationId)
  )]

  const handleLogin = (userData) => {
    setUser(userData)
    setSyncError('')
    if (supabase) setSyncStatus('connecting')
    if (!supabase) sessionStorage.setItem('smartLocationUser', JSON.stringify(userData))
    setActiveView(userData.role === 'ADMIN' ? 'dashboard' : 'workflow')
  }

  const handleLogout = async () => {
    if (supabase) {
      const { error } = await supabase.auth.signOut()
      if (error) {
        setSyncError(error.message)
        return
      }
    } else {
      sessionStorage.removeItem('smartLocationUser')
    }
    setUser(null)
    setPutAwayTasks([])
    setPutAwayIncidents([])
    setSyncError('')
  }

  const handleChangePassword = async (currentPassword, newPassword) => {
    if (!user?.username) return { success: false, message: 'Không xác định được tài khoản đang đăng nhập.' }

    try {
      if (supabase) {
        const { data, error: userError } = await supabase.auth.getUser()
        if (userError) throw userError
        if (!data.user?.email) throw new Error('Không lấy được email tài khoản Supabase.')
        const { error: verificationError } = await supabase.auth.signInWithPassword({
          email: data.user.email,
          password: currentPassword,
        })
        if (verificationError) {
          return { success: false, message: 'Mật khẩu hiện tại không chính xác.' }
        }
        const { error } = await supabase.auth.updateUser({ password: newPassword })
        if (error) throw error
        return { success: true, message: 'Đổi mật khẩu tài khoản Supabase thành công.' }
      }

      const passwordHashes = readAccountPasswordHashes()
      const savedHash = passwordHashes[user.username]
      const currentPasswordMatches = savedHash
        ? await verifyAccountPassword(currentPassword, savedHash)
        : currentPassword === '123456'

      if (!currentPasswordMatches) {
        return { success: false, message: 'Mật khẩu hiện tại không chính xác.' }
      }

      passwordHashes[user.username] = await createAccountPasswordCredential(newPassword)
      localStorage.setItem(ACCOUNT_PASSWORDS_KEY, JSON.stringify(passwordHashes))
      return { success: true, message: 'Đổi mật khẩu thành công. Mật khẩu mới sẽ được yêu cầu ở lần đăng nhập tiếp theo.' }
    } catch (passwordError) {
      return {
        success: false,
        message: passwordError.message || 'Không thể lưu mật khẩu mới trên thiết bị này.',
      }
    }
  }

  const handleNavigation = (view) => {
    const moverViews = ['workflow', 'mover-tasks', 'mover-map', 'mover-issues', 'mover-completed', 'mover-performance', 'settings']
    const lifterViews = ['workflow', 'lifter-tasks', 'lifter-completed', 'lifter-scan', 'lifter-issues', 'settings']
    if (user.role === 'MOVER' && !moverViews.includes(view)) return
    if (user.role === 'LIFTER' && !lifterViews.includes(view)) return
    setActiveView(view)
    setSidebarOpen(false)
    if (view === 'scanner' || (user.role === 'LIFTER' && view === 'lifter-scan')) handleOpenScanner()
  }

  const handleOpenScanner = (initialValue = '') => {
    setScannerInitialValue(initialValue)
    setScannerOpen(true)
  }

  const handlePutAwayLocationScanned = useCallback((locationId) => {
    setScannedPutAwayLocation(locationId)
    setScannerOpen(false)
    setScannerInitialValue('')
  }, [])

  const handleReportPutAwayIncident = async (incident) => {
    if (supabase) {
      try {
        await createPutAwayIncident(incident, user.id)
        setPutAwayIncidents((current) => current.some((item) => item.id === incident.id)
          ? current
          : [...current, incident])
        setSyncError('')
        return true
      } catch (error) {
        console.error('Unable to save the put-away incident to Supabase.', error)
        setSyncError(error.message || 'Không thể lưu báo cáo sự cố vào Supabase.')
        return false
      }
    }

    const nextIncidents = [...putAwayIncidents, incident]
    if (!saveLocalStorageUpdates({ smartLocationPutAwayIncidents: nextIncidents })) return false
    setPutAwayIncidents(nextIncidents)
    return true
  }

  const handleSelectSmartRecommendation = (locationId) => {
    setSmartPutawayAnalysis((current) => ({
      ...current,
      selectedLocationId: locationId,
    }))
  }

  const handleShowSmartLocation = (locationId) => {
    setSmartMapLocationId(locationId)
    setActiveView('map')
  }

  const handleConfirmSmartPlacement = async (batch, recommendation, bestRecommendation) => {
    if (user?.role !== 'ADMIN' || !recommendation?.location?.id) return
    const locationId = recommendation.location.id
    const target = warehouseLocations.find((location) => location.id === locationId)
    if (!target || target.status !== 'AVAILABLE' || target.isBlocked) {
      setSmartPutawayAnalysis((current) => ({
        ...current,
        status: 'analyzing',
      }))
      return
    }
    if (!window.confirm(`Xác nhận vị trí ${locationId} cho ${batch.productName || batch.productCode}?`)) return
    const saved = await handleInboundStore(batch, locationId, {
      suggestedLocationId: bestRecommendation?.location?.id || '',
      selectionMethod: recommendation.location.id === bestRecommendation?.location?.id
        ? 'RECOMMENDATION'
        : 'ALTERNATIVE',
    })
    if (!saved) return
    setSmartPutawayAnalysis((current) => ({
      ...current,
      batch,
      status: 'confirmed',
      selectedLocationId: locationId,
    }))
  }

  const handleInboundStore = async (batch, locationId, placementContext) => {
    if (user?.role !== 'ADMIN') return false
    const target = warehouseLocations.find((location) => location.id === locationId)
    if (!target || target.status !== 'AVAILABLE') return false

    const createdAt = new Date().toISOString()
    const task = {
      id: createPutAwayTaskId(),
      locationId,
      productCode: String(batch.productCode || '').trim(),
      productName: String(batch.productName || '').trim(),
      palletCode: String(batch.palletCode || batch.palletId || '').trim(),
      lotCode: String(batch.lotCode || batch.lotId || '').trim(),
      customerId: batch.customerId || null,
      supplier: batch.supplier || null,
      palletNote: batch.palletNote || null,
      quantity: batch.quantity || null,
      packageCount: 1,
      grossWeightKg: Number(batch.grossWeightKg),
      cbm: Number(batch.cbm) || null,
      netWeightKg: Number(batch.netWeightKg) || null,
      heightCm: Number(batch.heightCm),
      widthCm: Number(batch.widthCm),
      depthCm: Number(batch.depthCm),
      suggestedLocationId: placementContext?.suggestedLocationId || '',
      selectionMethod: placementContext?.selectionMethod || 'RECOMMENDATION',
      createdAt,
      createdByName: user.name || user.username,
      createdByUsername: user.username,
      status: PUT_AWAY_STATUSES.WAITING_MOVE,
      events: [{
        status: PUT_AWAY_STATUSES.WAITING_MOVE,
        label: 'Đã chọn vị trí; chờ nâng chuyển',
        actorName: user.name || user.username,
        actorUsername: user.username,
        occurredAt: createdAt,
      }],
    }
    if (supabase) {
      try {
        await createPutAwayTask(task, user.id)
        setPutAwayTasks((current) => current.some((item) => item.id === task.id)
          ? current
          : [...current, task])
        setSyncError('')
        return true
      } catch (error) {
        console.error('Unable to create the put-away task in Supabase.', error)
        setSyncError(error.message || 'Không thể tạo nhiệm vụ trên Supabase.')
        return false
      }
    }

    const nextTasks = [...putAwayTasks, task]
    if (!saveLocalStorageUpdates({ smartLocationPutAwayTasks: nextTasks })) return false

    setPutAwayTasks(nextTasks)
    return true
  }

  const handleAdvancePutAwayTask = async (taskId) => {
    const currentTask = putAwayTasks.find((task) => task.id === taskId)
    if (!currentTask || !user) return false
    const nextTask = advancePutAwayTask(currentTask, user.role, user)
    if (!nextTask) return false
    if (supabase) {
      try {
        const updated = await advanceRemotePutAwayTask(currentTask, nextTask)
        if (!updated) return false
        setPutAwayTasks((current) => current.map((task) =>
          task.id === taskId ? nextTask : task
        ))
        if (nextTask.status === PUT_AWAY_STATUSES.COMPLETED) {
          const completedRecords = getCompletedWorkflowRecords([nextTask])
          setInboundPlacements((current) => current.some(
            (placement) => placement.id === completedRecords.placements[0].id
          ) ? current : [...current, ...completedRecords.placements])
          setPutAwayLog((current) => current.some(
            (entry) => entry.id === completedRecords.log[0].id
          ) ? current : [...current, ...completedRecords.log])
        }
        setSyncError('')
        return true
      } catch (error) {
        console.error('Unable to advance the put-away task in Supabase.', error)
        setSyncError(error.message || 'Không thể cập nhật nhiệm vụ trên Supabase.')
        return false
      }
    }

    const nextTasks = putAwayTasks.map((task) => task.id === taskId ? nextTask : task)

    if (nextTask.status !== PUT_AWAY_STATUSES.COMPLETED) {
      if (!saveLocalStorageUpdates({ smartLocationPutAwayTasks: nextTasks })) return false
      setPutAwayTasks(nextTasks)
      return true
    }

    const target = warehouseLocations.find((location) => location.id === currentTask.locationId)
    if (target?.status !== 'RESERVED' || target.reservedTask?.id !== taskId) return false
    const receivedAt = nextTask.updatedAt
    const placement = {
      id: `inbound-${taskId}`,
      locationId: currentTask.locationId,
      productCode: currentTask.productCode,
      productName: currentTask.productName,
      palletCode: currentTask.palletCode,
      lotCode: currentTask.lotCode,
      customerId: currentTask.customerId,
      supplier: currentTask.supplier,
      palletNote: currentTask.palletNote,
      quantity: currentTask.quantity,
      packageCount: currentTask.packageCount,
      grossWeightKg: currentTask.grossWeightKg,
      netWeightKg: currentTask.netWeightKg,
      cbm: currentTask.cbm,
      heightCm: currentTask.heightCm,
      widthCm: currentTask.widthCm,
      depthCm: currentTask.depthCm,
      receivedAt,
    }
    const nextPlacements = [...inboundPlacements, placement]
    const completionEvent = nextTask.events[nextTask.events.length - 1]
    const nextLog = [...putAwayLog, {
      id: `putaway-log-${taskId}`,
      receivedAt,
      employeeName: completionEvent.actorName || currentTask.createdByName,
      employeeUsername: completionEvent.actorUsername || currentTask.createdByUsername,
      productCode: currentTask.productCode,
      productName: currentTask.productName,
      suggestedLocationId: currentTask.suggestedLocationId,
      selectedLocationId: currentTask.locationId,
      followedSuggestion: currentTask.suggestedLocationId === currentTask.locationId,
      selectionMethod: currentTask.selectionMethod,
    }]

    if (!saveLocalStorageUpdates({
      smartLocationPutAwayTasks: nextTasks,
      smartLocationInboundPlacements: nextPlacements,
      smartLocationPutAwayLog: nextLog,
    })) return false
    setPutAwayTasks(nextTasks)
    setInboundPlacements(nextPlacements)
    setPutAwayLog(nextLog)
    return true
  }

  const handleToggleLocationBlock = (locationId, shouldBlock) => {
    if (shouldBlock && reservedTasksByLocation.has(locationId)) return false
    const nextIds = shouldBlock
      ? [...new Set([...blockedLocationIds, locationId])]
      : blockedLocationIds.filter((id) => id !== locationId)

    try {
      localStorage.setItem('smartLocationBlockedLocationIds', JSON.stringify(nextIds))
    } catch {
      return false
    }

    setBlockedLocationIds(nextIds)
    return true
  }

  const handleReportLocationMismatch = (locationId, batch) => {
    const reportedAt = new Date().toISOString()
    const report = {
      id: `mismatch-${reportedAt}-${locationId}`,
      locationId,
      productCode: String(batch.productCode || ''),
      productName: String(batch.productName || ''),
      reportedAt,
      employeeName: user?.name || user?.username || 'Chưa xác định',
      employeeUsername: user?.username || '',
      status: 'OPEN',
    }
    const hasOpenReport = locationDiscrepancies.some(
      (entry) => entry.locationId === locationId && entry.status === 'OPEN'
    )
    const nextReports = hasOpenReport ? locationDiscrepancies : [...locationDiscrepancies, report]

    try {
      localStorage.setItem('smartLocationDiscrepancies', JSON.stringify(nextReports))
    } catch {
      return false
    }

    setLocationDiscrepancies(nextReports)
    return true
  }

  const handleResolveLocationMismatch = (reportId) => {
    const nextReports = locationDiscrepancies.map((report) =>
      report.id === reportId
        ? { ...report, status: 'RESOLVED', resolvedAt: new Date().toISOString() }
        : report
    )
    try {
      localStorage.setItem('smartLocationDiscrepancies', JSON.stringify(nextReports))
    } catch {
      return false
    }

    setLocationDiscrepancies(nextReports)
    return true
  }

  const handleOutboundShip = (locationId) => {
    const target = warehouseLocations.find((location) => location.id === locationId)
    const hasStoredGoods = target?.status === 'OCCUPIED' ||
      (target?.status === 'BLOCKED' && (target.inventoryItems?.length || target.lotId))
    if (!target || !hasStoredGoods) return false

    const shippedAt = new Date().toISOString()
    const shipmentId = createOutboundShipmentId()
    const items = target.inventoryItems?.length ? target.inventoryItems : [target]
    const shipmentEntries = items.map((item, index) => ({
      id: `${shipmentId}-${index}`,
      shipmentId,
      shippedAt,
      employeeName: user?.name || user?.username || 'Chưa xác định',
      employeeUsername: user?.username || '',
      locationId,
      productCode: item.productCode || item.lotId || target.lotId || '',
      productName: item.productName || target.productName || '',
      palletCode: item.palletCode || '',
      lotCode: item.lotCode || '',
      quantity: item.quantity || item.packageCount || 1,
      grossWeightKg: item.grossWeightKg || target.grossWeightKg || null,
    }))
    const nextOutboundLog = [...outboundLog, ...shipmentEntries]
    const isInboundPlacement = inboundPlacements.some(
      (placement) => placement.locationId === locationId
    )
    if (isInboundPlacement) {
      const nextPlacements = inboundPlacements.filter(
        (placement) => placement.locationId !== locationId
      )

      if (!saveLocalStorageUpdates({
        smartLocationInboundPlacements: nextPlacements,
        smartLocationOutboundLog: nextOutboundLog,
      })) return false

      setInboundPlacements(nextPlacements)
      setOutboundLog(nextOutboundLog)
      return true
    }

    const nextLocationIds = [...new Set([...outboundLocationIds, locationId])]
    if (!saveLocalStorageUpdates({
      smartLocationOutboundLocationIds: nextLocationIds,
      smartLocationOutboundLog: nextOutboundLog,
    })) return false

    setOutboundLocationIds(nextLocationIds)
    setOutboundLog(nextOutboundLog)
    return true
  }

  const handleExportBackup = () => {
    const backup = {
      exportedAt: new Date().toISOString(),
      inboundPlacements,
      outboundLocationIds,
      outboundLog,
      blockedLocationIds,
      putAwayLog,
      locationDiscrepancies,
      putAwayTasks,
    }
    const file = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
    const downloadUrl = URL.createObjectURL(file)
    const link = document.createElement('a')
    link.href = downloadUrl
    link.download = 'smart-location-backup.json'
    link.click()
    URL.revokeObjectURL(downloadUrl)
  }

  const handleResetInventory = () => {
    if (!window.confirm('Xóa mọi lượt nhập/xuất, các lệnh Put-away đang chờ, nhật ký, báo cáo sai lệch và trạng thái ô lỗi trên thiết bị này?')) return

    localStorage.removeItem('smartLocationInboundPlacements')
    localStorage.removeItem('smartLocationOutboundLocationIds')
    localStorage.removeItem('smartLocationOutboundLog')
    localStorage.removeItem('smartLocationBlockedLocationIds')
    localStorage.removeItem('smartLocationPutAwayLog')
    localStorage.removeItem('smartLocationDiscrepancies')
    localStorage.removeItem('smartLocationPutAwayTasks')
    localStorage.removeItem('smartLocationPutAwayIncidents')
    setInboundPlacements([])
    setOutboundLocationIds([])
    setOutboundLog([])
    setBlockedLocationIds([])
    setPutAwayLog([])
    setLocationDiscrepancies([])
    setPutAwayTasks([])
    setPutAwayIncidents([])
  }

  useEffect(() => {
    if (!supabase) return undefined
    let active = true

    const restoreSession = async () => {
      try {
        const { data, error } = await supabase.auth.getSession()
        if (error) throw error
        if (data.session) {
          const profile = await getUserProfile(data.session.user.id)
          if (active) {
            setUser({ ...profile, id: data.session.user.id })
            setActiveView(profile.role === 'ADMIN' ? 'dashboard' : 'workflow')
            setSyncError('')
          }
        }
      } catch (error) {
        console.error('Unable to restore the Supabase session.', error)
        if (active) setSyncError(error.message || 'Không thể khôi phục phiên Supabase.')
      } finally {
        if (active) setAuthReady(true)
      }
    }

    restoreSession()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT' && active) {
        setUser(null)
        setPutAwayTasks([])
        setPutAwayIncidents([])
      }
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!supabase || !user) return undefined
    let active = true
    let latestSnapshotRequest = 0

    const refreshSnapshot = async () => {
      const requestVersion = ++latestSnapshotRequest
      try {
        const snapshot = await loadPutAwaySnapshot()
        if (!active || requestVersion !== latestSnapshotRequest) return
        setPutAwayTasks(snapshot.tasks)
        setPutAwayIncidents(snapshot.incidents)
        const completedRecords = getCompletedWorkflowRecords(snapshot.tasks)
        setInboundPlacements(completedRecords.placements)
        setPutAwayLog(completedRecords.log)
        setSyncError('')
      } catch (error) {
        console.error('Unable to load the shared put-away workflow.', error)
        if (active && requestVersion === latestSnapshotRequest) {
          setSyncError(error.message || 'Không thể tải dữ liệu phân luồng từ Supabase.')
        }
      }
    }

    refreshSnapshot()
    const unsubscribe = subscribeToPutAwayChanges(
      refreshSnapshot,
      (status, error) => {
        if (!active) return
        if (status === 'SUBSCRIBED') {
          setSyncStatus('connected')
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setSyncStatus('error')
          setSyncError(error?.message || `Kết nối realtime thất bại (${status}).`)
        } else if (status === 'CLOSED') {
          setSyncStatus('connecting')
        }
      }
    )

    return () => {
      active = false
      unsubscribe()
    }
  }, [user])

  useEffect(() => {
    const syncStoredWorkflow = (event) => {
      if (event.key === 'smartLocationPutAwayTasks') setPutAwayTasks(readStoredPutAwayTasks())
      if (event.key === 'smartLocationPutAwayIncidents') setPutAwayIncidents(readStoredArray(event.key))
      if (event.key === 'smartLocationInboundPlacements') setInboundPlacements(readStoredArray(event.key))
      if (event.key === 'smartLocationPutAwayLog') setPutAwayLog(readStoredArray(event.key))
      if (event.key === 'smartLocationOutboundLocationIds') setOutboundLocationIds(readStoredArray(event.key))
      if (event.key === 'smartLocationOutboundLog') setOutboundLog(readStoredArray(event.key))
      if (event.key === 'smartLocationBlockedLocationIds') setBlockedLocationIds(readStoredArray(event.key))
    }
    window.addEventListener('storage', syncStoredWorkflow)
    return () => window.removeEventListener('storage', syncStoredWorkflow)
  }, [])

  const totalLocations = WAREHOUSE_STATS.locations
  const occupiedLocations = warehouseLocations.filter(
    (location) => location.status === 'OCCUPIED' ||
      (location.status === 'BLOCKED' && (location.inventoryItems?.length || location.lotId))
  ).length
  const availableLocations = warehouseLocations.filter(
    (location) => location.status === 'AVAILABLE'
  ).length

  if (!authReady) {
    return <div className="login-page"><p>Đang kết nối tài khoản Supabase...</p></div>
  }

  if (!user) {
    return <Login onLogin={handleLogin} authError={syncError} />
  }

  const visibleNavGroups = user.role === 'ADMIN'
    ? NAV_GROUPS
    : user.role === 'MOVER'
      ? [
        {
          title: 'TÁC NGHIỆP',
          items: [
            { id: 'workflow', label: 'Luồng Put-away' },
            { id: 'mover-tasks', label: 'Nhiệm vụ của tôi' },
            { id: 'mover-map', label: 'Sơ đồ kho' },
            { id: 'mover-issues', label: 'Báo sự cố' },
          ],
        },
        {
          title: 'LỊCH SỬ',
          items: [
            { id: 'mover-completed', label: 'Đã hoàn thành' },
            { id: 'mover-performance', label: 'Hiệu suất ca' },
          ],
        },
        { title: 'HỆ THỐNG', items: [{ id: 'settings', label: 'Cài đặt' }] },
      ]
      : user.role === 'LIFTER'
        ? [
          {
            title: 'TÁC NGHIỆP',
            items: [
              { id: 'lifter-tasks', label: 'Nhiệm vụ nâng hạ' },
              { id: 'lifter-completed', label: 'Đã hoàn thành' },
              { id: 'lifter-scan', label: 'Quét vị trí' },
              { id: 'lifter-issues', label: 'Báo sự cố' },
            ],
          },
          { title: 'TÀI KHOẢN', items: [{ id: 'settings', label: 'Cài đặt' }] },
        ]
        : [
          { title: 'CÔNG VIỆC', items: [{ id: 'workflow', label: 'Luồng Put-away' }] },
          { title: 'TÀI KHOẢN', items: [{ id: 'settings', label: 'Cài đặt' }] },
        ]
  const notificationCount = user.role === 'MOVER'
    ? putAwayTasks.filter((task) => task.status === PUT_AWAY_STATUSES.WAITING_MOVE).length
    : user.role === 'LIFTER'
      ? putAwayTasks.filter((task) => task.status === PUT_AWAY_STATUSES.WAITING_LIFT).length
      : activePutAwayTasks.length

  return (
    <div className={`app ${sidebarOpen ? 'app--sidebar-open' : ''}`}>
      {sidebarOpen && (
        <button
          className="sidebar-backdrop"
          type="button"
          aria-label="Đóng menu điều hướng"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <button
        className="sidebar-toggle"
        type="button"
        aria-label={sidebarOpen ? 'Thu gọn menu điều hướng' : 'Mở menu điều hướng'}
        aria-expanded={sidebarOpen}
        aria-controls="app-sidebar"
        onClick={() => setSidebarOpen((isOpen) => !isOpen)}
      >
        <span aria-hidden="true">{sidebarOpen ? '×' : '☰'}</span>
      </button>

      <aside
        className="sidebar"
        id="app-sidebar"
        aria-hidden={!sidebarOpen}
        inert={!sidebarOpen}
      >
        <div className="brand">
          <div className="brand-icon"><BrandMark /></div>

          <div>
            <h2>U&amp;I Smart Put-away</h2>
            <p>{user.role === 'MOVER' || user.role === 'LIFTER' ? 'U&I Warehouse 6' : 'Quản lý luồng cất hàng'}</p>
          </div>
        </div>

        <nav className="menu">
          {visibleNavGroups.map((group) => (
            <div key={group.title}>
              <p className="menu-title">{group.title}</p>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  className={`menu-item ${activeView === item.id ? 'active' : ''}`}
                  aria-current={activeView === item.id ? 'page' : undefined}
                  onClick={() => handleNavigation(item.id)}
                >
                  {item.label}
                  {(item.id === 'workflow' || item.id === 'mover-tasks' || item.id === 'lifter-tasks') && notificationCount > 0 && (
                    <span className="menu-notification">{notificationCount}</span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="admin">
          <div className="avatar">{user.name?.trim().charAt(0).toUpperCase() || 'U'}</div>

<div className="user-info">
  <strong>{user.name}</strong>
  <p>{user.role === 'MOVER' || user.role === 'LIFTER' ? <>{ROLE_LABELS[user.role]}<br />U&I Warehouse 6</> : `${ROLE_LABELS[user.role]} · U&I Warehouse 6`}</p>
</div>

<button
  className="logout-button"
  onClick={handleLogout}
>
  Đăng xuất
</button>
        </div>
      </aside>

      <main className="main">

        <header className={`topbar ${user.role === 'MOVER' ? 'topbar--mover' : ''} ${user.role === 'LIFTER' ? 'topbar--lifter' : ''}`}>
          <div>
            <h1>{VIEW_TITLES[activeView]}</h1>
            <p>{ROLE_LABELS[user.role]} · U&I Warehouse 6</p>
          </div>

          {user.role === 'ADMIN' && activeView !== 'smart' ? (
            <button className="scan-button" onClick={() => setScannerOpen(true)}>
              Quét QR / Mã vạch
            </button>
          ) : user.role === 'MOVER' ? (
            <div className="mover-header-status">
              <span className="mover-system-status"><i /> Đang hoạt động</span>
              <span>Ca làm việc · chưa cấu hình</span>
              <button className="mover-header-notice" type="button" aria-label={`${notificationCount} nhiệm vụ mới`} onClick={() => handleNavigation('mover-tasks')}><span aria-hidden="true">🔔</span> <strong>{notificationCount}</strong> nhiệm vụ mới</button>
            </div>
          ) : user.role === 'LIFTER' ? (
            <div className="lifter-header-status">
              <span className="lifter-system-status"><i /> Đang hoạt động</span>
              {notificationCount > 0 && <button type="button" className="lifter-header-notice" onClick={() => handleNavigation('lifter-tasks')}>🔔 Có {notificationCount} nhiệm vụ nâng hạ mới</button>}
            </div>
          ) : user.role !== 'ADMIN' ? (
            <span className="topbar-work-notice">
              {notificationCount ? `${notificationCount} việc mới cần tiếp nhận` : 'Không có việc mới'}
            </span>
          ) : null}
          <button className="mobile-logout" type="button" onClick={handleLogout}>Đăng xuất</button>
        </header>

        {supabase && (
          <div className={`workflow-sync-status workflow-sync-status--${syncStatus}`} role={syncError ? 'alert' : 'status'}>
            {syncError
              ? `Lỗi đồng bộ Supabase: ${syncError}`
              : syncStatus === 'connected'
                ? 'Đã kết nối dữ liệu Put-away realtime'
                : 'Đang kết nối dữ liệu Put-away...'}
          </div>
        )}

        {activeView === 'workflow' || activeView.startsWith('mover-') || activeView.startsWith('lifter-') ? (
          <PutAwayWorkflow
            tasks={putAwayTasks}
            user={user}
            view={activeView}
            locations={warehouseLocations}
            incidents={putAwayIncidents}
            scannedLocationCode={scannedPutAwayLocation}
            onClearScannedLocation={() => setScannedPutAwayLocation('')}
            onOpenScanner={handleOpenScanner}
            onAdvanceTask={handleAdvancePutAwayTask}
            onReportIncident={handleReportPutAwayIncident}
            onNavigate={handleNavigation}
            cloudConfigured={Boolean(supabase)}
          />
        ) : activeView === 'dashboard' ? (
          <>
        <section className="cards">

          <div className="card">
            <p>Tổng số vị trí</p>
            <h2>{totalLocations.toLocaleString('vi-VN')}</h2>
            <span>Dung lượng kho</span>
          </div>

          <div className="card">
            <p>Đã sử dụng</p>
            <h2>{occupiedLocations.toLocaleString('vi-VN')}</h2>
            <span>{totalLocations ? `${Math.round((occupiedLocations / totalLocations) * 100)}% sử dụng` : '0% sử dụng'}</span>
          </div>

          <div className="card">
            <p>Còn trống</p>
            <h2>{availableLocations.toLocaleString('vi-VN')}</h2>
            <span>Sẵn sàng cho put-away</span>
          </div>

          <div className="card">
            <p>Chờ nâng chuyển</p>
            <h2>{notificationCount.toLocaleString('vi-VN')}</h2>
            <span>Lô đã giữ chỗ, chưa di chuyển</span>
          </div>

        </section>

        <section className="content-grid">

          <div className="warehouse-panel">

            <div className="panel-header">
              <div>
                <h2>Tổng quan kho</h2>
              </div>

              <button onClick={() => setActiveView('map')}>Mở bản đồ kho</button>
            </div>

<WarehouseMap
  locations={warehouseLocations}
  onShipLocation={handleOutboundShip}
/>

          </div>

        </section>
          </>
        ) : (
          <OperationsView
            view={activeView}
            user={user}
            cloudConfigured={Boolean(supabase)}
            locations={warehouseLocations}
            inboundPlacements={inboundPlacements}
            putAwayLog={putAwayLog}
            outboundLog={outboundLog}
            locationDiscrepancies={locationDiscrepancies}
            reportedMismatchLocationIds={reportedMismatchLocationIds}
            onOpenScanner={handleOpenScanner}
            onShipLocation={handleOutboundShip}
            onToggleLocationBlock={handleToggleLocationBlock}
            onResolveLocationMismatch={handleResolveLocationMismatch}
            onExportBackup={handleExportBackup}
            onResetInventory={handleResetInventory}
            onChangePassword={handleChangePassword}
            smartPutawayAnalysis={smartPutawayAnalysis}
            onSelectSmartRecommendation={handleSelectSmartRecommendation}
            onShowSmartLocation={handleShowSmartLocation}
            onConfirmSmartPlacement={handleConfirmSmartPlacement}
            smartMapLocationId={smartMapLocationId}
          />
        )}

      </main>

      {scannerOpen && (
        <ScannerModal
          locations={warehouseLocations}
          reportedMismatchLocationIds={reportedMismatchLocationIds}
          onStoreBatch={handleInboundStore}
          onReportLocationMismatch={handleReportLocationMismatch}
          onShipLocation={handleOutboundShip}
          initialScanValue={scannerInitialValue}
          externalSelectedLocationId={smartPutawayAnalysis.selectedLocationId}
          onAnalysisChange={setSmartPutawayAnalysis}
          onLocationScanned={handlePutAwayLocationScanned}
          onClose={() => {
            setScannerOpen(false)
            setScannerInitialValue('')
          }}
        />
      )}

    </div>
  )
}

export default App