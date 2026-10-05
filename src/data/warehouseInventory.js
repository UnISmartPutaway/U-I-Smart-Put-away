export function mergeWarehouseInventory(
  locations,
  inboundPlacements,
  outboundLocationIds,
  blockedLocationIds = [],
  activePutAwayTasks = []
) {
  const inboundByLocation = new Map(
    inboundPlacements.map((placement) => [placement.locationId, placement])
  )
  const outboundLocationSet = new Set(outboundLocationIds)
  const blockedLocationSet = new Set(blockedLocationIds)
  const reservedByLocation = new Map(
    activePutAwayTasks.map((task) => [task.locationId, task])
  )

  return locations.map((location) => {
    const isBlocked = blockedLocationSet.has(location.id)
    const placement = inboundByLocation.get(location.id)
    if (placement) {
      return {
        ...location,
        status: isBlocked ? 'BLOCKED' : 'OCCUPIED',
        isBlocked,
        inventoryItems: [{ ...placement, batchId: `inbound-${placement.receivedAt}` }],
        customerId: placement.customerId || null,
        lotId: placement.productCode,
        palletNote: placement.palletNote || null,
        productName: placement.productName,
        quantity: placement.quantity || null,
        packageCount: placement.packageCount,
        cbm: placement.cbm,
        grossWeightKg: placement.grossWeightKg,
      }
    }

    if (outboundLocationSet.has(location.id)) {
      return {
        ...location,
        status: isBlocked ? 'BLOCKED' : 'AVAILABLE',
        isBlocked,
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
      }
    }

    const reservedTask = reservedByLocation.get(location.id)
    if (reservedTask) {
      return {
        ...location,
        status: isBlocked ? 'BLOCKED' : 'RESERVED',
        isBlocked,
        reservedTask,
        lotId: reservedTask.productCode,
        productName: reservedTask.productName,
        grossWeightKg: reservedTask.grossWeightKg,
        cbm: reservedTask.cbm,
      }
    }

    return isBlocked ? { ...location, status: 'BLOCKED', isBlocked: true } : location
  })
}