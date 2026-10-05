import { useState } from 'react'
import './App.css'
import WarehouseMap from './components/WarehouseMap'
import Login from './components/Login'
import OperationsView from './components/OperationsView'
import ScannerModal from './components/ScannerModal'
import {
  WAREHOUSE_LOCATIONS,
  WAREHOUSE_STATS,
} from './data/warehouseConfig'
import { mergeWarehouseInventory } from './data/warehouseInventory'

const NAV_GROUPS = [
  { title: 'TỔNG QUAN', items: [{ id: 'dashboard', label: 'Bảng điều khiển' }] },
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

function App() {
  const [scannerOpen, setScannerOpen] = useState(false)
  const [activeView, setActiveView] = useState('dashboard')
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
  const [user, setUser] = useState(() => {
    const savedUser = localStorage.getItem('smartLocationUser')

    if (savedUser) {
      return JSON.parse(savedUser)
    }

    return null
  })

  const warehouseLocations = mergeWarehouseInventory(
    WAREHOUSE_LOCATIONS,
    inboundPlacements,
    outboundLocationIds,
    blockedLocationIds
  )
  const reportedMismatchLocationIds = [...new Set(
    locationDiscrepancies.filter((report) => report.status === 'OPEN').map((report) => report.locationId)
  )]

  const handleLogin = (userData) => {
    setUser(userData)

    localStorage.setItem(
      'smartLocationUser',
      JSON.stringify(userData)
    )
  }

  const handleLogout = () => {
    localStorage.removeItem('smartLocationUser')
    setUser(null)
  }

  const handleNavigation = (view) => {
    setActiveView(view)
    if (view === 'scanner') setScannerOpen(true)
  }

  const handleInboundStore = (batch, locationId, placementContext) => {
    const target = warehouseLocations.find((location) => location.id === locationId)
    if (!target || target.status !== 'AVAILABLE') return false

    const receivedAt = new Date().toISOString()
    const placement = {
      id: `inbound-${receivedAt}`,
      locationId,
      productCode: String(batch.productCode || '').trim(),
      productName: String(batch.productName || '').trim(),
      customerId: batch.customerId || null,
      palletNote: batch.palletNote || null,
      quantity: batch.quantity || null,
      packageCount: 1,
      grossWeightKg: Number(batch.grossWeightKg),
      cbm: Number(batch.cbm) || null,
      receivedAt,
    }
    const nextPlacements = [...inboundPlacements, placement]
    const logEntry = {
      id: `putaway-${receivedAt}`,
      receivedAt,
      employeeName: user?.name || user?.username || 'Chưa xác định',
      employeeUsername: user?.username || '',
      productCode: placement.productCode,
      productName: placement.productName,
      suggestedLocationId: placementContext?.suggestedLocationId || '',
      selectedLocationId: locationId,
      followedSuggestion: placementContext?.suggestedLocationId === locationId,
      selectionMethod: placementContext?.selectionMethod || 'RECOMMENDATION',
    }
    const nextLog = [...putAwayLog, logEntry]

    try {
      localStorage.setItem('smartLocationInboundPlacements', JSON.stringify(nextPlacements))
      localStorage.setItem('smartLocationPutAwayLog', JSON.stringify(nextLog))
    } catch {
      try {
        localStorage.setItem('smartLocationInboundPlacements', JSON.stringify(inboundPlacements))
        localStorage.setItem('smartLocationPutAwayLog', JSON.stringify(putAwayLog))
      } catch {
        return false
      }
      return false
    }

    setInboundPlacements(nextPlacements)
    setPutAwayLog(nextLog)
    return true
  }

  const handleToggleLocationBlock = (locationId, shouldBlock) => {
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

    const isInboundPlacement = inboundPlacements.some(
      (placement) => placement.locationId === locationId
    )
    if (isInboundPlacement) {
      const nextPlacements = inboundPlacements.filter(
        (placement) => placement.locationId !== locationId
      )

      try {
        localStorage.setItem(
          'smartLocationInboundPlacements',
          JSON.stringify(nextPlacements)
        )
      } catch {
        return false
      }

      setInboundPlacements(nextPlacements)
      return true
    }

    const nextLocationIds = [...new Set([...outboundLocationIds, locationId])]
    try {
      localStorage.setItem(
        'smartLocationOutboundLocationIds',
        JSON.stringify(nextLocationIds)
      )
    } catch {
      return false
    }

    setOutboundLocationIds(nextLocationIds)
    return true
  }

  const handleExportBackup = () => {
    const backup = {
      exportedAt: new Date().toISOString(),
      inboundPlacements,
      outboundLocationIds,
      blockedLocationIds,
      putAwayLog,
      locationDiscrepancies,
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
    if (!window.confirm('Xóa mọi lượt nhập/xuất, nhật ký Put-away, báo cáo sai lệch và trạng thái ô lỗi trên thiết bị này?')) return

    localStorage.removeItem('smartLocationInboundPlacements')
    localStorage.removeItem('smartLocationOutboundLocationIds')
    localStorage.removeItem('smartLocationBlockedLocationIds')
    localStorage.removeItem('smartLocationPutAwayLog')
    localStorage.removeItem('smartLocationDiscrepancies')
    setInboundPlacements([])
    setOutboundLocationIds([])
    setBlockedLocationIds([])
    setPutAwayLog([])
    setLocationDiscrepancies([])
  }

  const totalLocations = WAREHOUSE_STATS.locations
  const occupiedLocations = warehouseLocations.filter(
    (location) => location.status === 'OCCUPIED' ||
      (location.status === 'BLOCKED' && (location.inventoryItems?.length || location.lotId))
  ).length
  const availableLocations = warehouseLocations.filter(
    (location) => location.status === 'AVAILABLE'
  ).length

  if (!user) {
    return <Login onLogin={handleLogin} />
  }

  return (
    <div className="app">

      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">SL</div>

          <div>
            <h2>SMART LOCATION</h2>
            <p>Warehouse Management</p>
          </div>
        </div>

        <nav className="menu">
          {NAV_GROUPS.map((group) => (
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
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="admin">
          <div className="avatar">A</div>

<div className="user-info">
  <strong>{user.name}</strong>
  <p>U&I Warehouse 6</p>
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

        <header className="topbar">
          <div>
            <h1>{VIEW_TITLES[activeView]}</h1>
            <p>U&I Warehouse 6</p>
          </div>

          <button className="scan-button" onClick={() => setScannerOpen(true)}>
            Quét QR / Mã vạch
          </button>
        </header>

        {activeView === 'dashboard' ? (
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
            <p>Đang chờ put-away</p>
            <h2>0</h2>
            <span>Chờ phân bổ</span>
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
            locations={warehouseLocations}
            inboundPlacements={inboundPlacements}
            putAwayLog={putAwayLog}
            locationDiscrepancies={locationDiscrepancies}
            reportedMismatchLocationIds={reportedMismatchLocationIds}
            onOpenScanner={() => setScannerOpen(true)}
            onShipLocation={handleOutboundShip}
            onToggleLocationBlock={handleToggleLocationBlock}
            onResolveLocationMismatch={handleResolveLocationMismatch}
            onExportBackup={handleExportBackup}
            onResetInventory={handleResetInventory}
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
          onClose={() => setScannerOpen(false)}
        />
      )}

    </div>
  )
}

export default App