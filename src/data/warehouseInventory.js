export function mergeWarehouseInventory(locations, inboundPlacements, outboundLocationIds) {
  const inboundByLocation = new Map(
    inboundPlacements.map((placement) => [placement.locationId, placement])
  )
  const outboundLocationSet = new Set(outboundLocationIds)

  return locations.map((location) => {
    const placement = inboundByLocation.get(location.id)
    if (placement) {
      return {
        ...location,
        status: 'OCCUPIED',
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
        status: 'AVAILABLE',
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

    return location
  })
}