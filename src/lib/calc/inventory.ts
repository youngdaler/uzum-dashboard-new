import { D, Decimal, roundCost, roundUzs, sum } from '@/lib/money'
import type {
  CostMethod,
  InventoryMovement,
  MovementType,
  ReturnRow,
  Sale,
  SaleItem,
} from '@/types/db'

/**
 * Складской движок. Чистая функция: из журнала движений, стоимости партий и продаж
 * выводит остатки, стоимость запасов и себестоимость каждой проданной строки.
 *
 * Метод себестоимости (FIFO или средневзвешенная) применяется ко ВСЕЙ истории единообразно.
 * Стоимость прихода берётся из актуального расчёта партии (поздние расходы партии
 * автоматически меняют себестоимость остатков и ещё не проданных единиц).
 *
 * Порядок обработки за один день: начальный остаток → приход → (+корректировка) → продажа →
 * возврат → списание/брак/(−корректировка).
 *
 * Отдельно ведётся FIFO-привязка единиц к партиям (только для отчёта «по партиям»).
 */

export interface ReceiptCost {
  totalUzs: Decimal
  qtyBasis: number
}

export interface InventoryInput {
  method: CostMethod
  movements: InventoryMovement[]
  /** batch_item_id → стоимость позиции партии. */
  receiptCosts: Map<string, ReceiptCost>
  saleItems: SaleItem[]
  sales: Sale[]
  returns: ReturnRow[]
  productIds: string[]
}

export interface ProductStock {
  productId: string
  opening: number
  received: number
  sold: number
  returned: number
  writtenOff: number
  adjustments: number
  stock: number
  reserved: number
  available: number
  value: Decimal
  avgCost: Decimal | null
  lossValue: Decimal
}

export interface MovementCost {
  movementId: string
  unitCost: Decimal | null
  totalCost: Decimal
}

export interface BatchAttribution {
  saleItemId: string
  batchId: string | null
  qty: number
}

export interface InventoryResult {
  byProduct: Map<string, ProductStock>
  /** Себестоимость каждой проданной строки (сумма по её движению). */
  cogsBySaleItem: Map<string, Decimal>
  movementCosts: Map<string, MovementCost>
  /** Стоимость списаний/брака/отрицательных корректировок по дням (убыток). */
  losses: { date: string; productId: string; value: Decimal }[]
  /** Себестоимость возвращённых на склад единиц по возвратам. */
  returnCostByReturn: Map<string, Decimal>
  attribution: BatchAttribution[]
  /** Стоимость и количество запасов на конец каждого дня с движениями. */
  timeline: { date: string; value: Decimal; qty: number }[]
  totalValue: Decimal
  totalQty: number
  warnings: string[]
}

interface Layer {
  qty: number
  value: Decimal
}

const priority = (m: InventoryMovement): number => {
  switch (m.type) {
    case 'opening':
      return 0
    case 'receipt':
      return 1
    case 'adjustment':
      return m.qty > 0 ? 2 : 5
    case 'sale':
      return 3
    case 'return':
      return 4
    default:
      return 5
  }
}

export function sortMovements(ms: InventoryMovement[]): InventoryMovement[] {
  return [...ms].sort(
    (a, b) =>
      a.movement_date.localeCompare(b.movement_date) ||
      priority(a) - priority(b) ||
      a.created_at.localeCompare(b.created_at) ||
      a.id.localeCompare(b.id),
  )
}

export function computeInventory(input: InventoryInput): InventoryResult {
  const { method } = input
  const warnings: string[] = []
  const stock = new Map<string, ProductStock>()
  for (const id of input.productIds) stock.set(id, blank(id))

  const layers = new Map<string, Layer[]>() // FIFO (стоимостные слои)
  const wac = new Map<string, Layer>() // средневзвешенная
  const batchQueue = new Map<string, { batchId: string | null; qty: number }[]>() // привязка к партиям

  const cogsBySaleItem = new Map<string, Decimal>()
  const movementCosts = new Map<string, MovementCost>()
  const losses: InventoryResult['losses'] = []
  const returnCostByReturn = new Map<string, Decimal>()
  const attribution: BatchAttribution[] = []
  const timeline: InventoryResult['timeline'] = []

  const saleItemsById = new Map(input.saleItems.map((s) => [s.id, s]))
  const returnsById = new Map(input.returns.map((r) => [r.id, r]))
  const saleOf = new Map(input.sales.map((s) => [s.id, s]))
  const saleQty = new Map<string, number>() // sale_item_id → проданное кол-во по движению

  const getStock = (id: string): ProductStock => {
    let s = stock.get(id)
    if (!s) {
      s = blank(id)
      stock.set(id, s)
    }
    return s
  }

  const qtyOf = (id: string): number => {
    const st = getStock(id)
    return st.stock
  }

  const valueOf = (id: string): Decimal => {
    if (method === 'wac') return wac.get(id)?.value ?? new Decimal(0)
    return sum((layers.get(id) ?? []).map((l) => l.value))
  }

  const add = (productId: string, qty: number, value: Decimal): void => {
    if (method === 'wac') {
      const w = wac.get(productId) ?? { qty: 0, value: new Decimal(0) }
      w.qty += qty
      w.value = w.value.plus(value)
      wac.set(productId, w)
    } else {
      const arr = layers.get(productId) ?? []
      arr.push({ qty, value })
      layers.set(productId, arr)
    }
  }

  /** Списывает qty единиц; возвращает стоимость. При нехватке остатка — по последней известной цене. */
  const consume = (productId: string, qty: number): Decimal => {
    let cost = new Decimal(0)
    let remaining = qty
    if (method === 'wac') {
      const w = wac.get(productId) ?? { qty: 0, value: new Decimal(0) }
      const take = Math.min(remaining, Math.max(w.qty, 0))
      if (take > 0) {
        const c = take === w.qty ? w.value : roundUzs(w.value.mul(take).div(w.qty))
        cost = cost.plus(c)
        w.qty -= take
        w.value = w.value.minus(c)
        remaining -= take
      }
      if (remaining > 0 && w.qty >= 0) {
        warnings.push('Продажа/списание превышает остаток — часть единиц учтена по нулевой стоимости.')
      }
      wac.set(productId, w)
      return cost
    }
    const arr = layers.get(productId) ?? []
    while (remaining > 0 && arr.length > 0) {
      const l = arr[0]
      const take = Math.min(remaining, l.qty)
      const c = take === l.qty ? l.value : roundUzs(l.value.mul(take).div(l.qty))
      cost = cost.plus(c)
      l.qty -= take
      l.value = l.value.minus(c)
      remaining -= take
      if (l.qty === 0) arr.shift()
    }
    if (remaining > 0) warnings.push('Продажа/списание превышает остаток — часть единиц учтена по нулевой стоимости.')
    layers.set(productId, arr)
    return cost
  }

  /** FIFO-привязка к партиям: возвращает список (batchId, qty). */
  const consumeQueue = (productId: string, qty: number): { batchId: string | null; qty: number }[] => {
    const q = batchQueue.get(productId) ?? []
    const out: { batchId: string | null; qty: number }[] = []
    let remaining = qty
    while (remaining > 0 && q.length > 0) {
      const head = q[0]
      const take = Math.min(remaining, head.qty)
      out.push({ batchId: head.batchId, qty: take })
      head.qty -= take
      remaining -= take
      if (head.qty === 0) q.shift()
    }
    if (remaining > 0) out.push({ batchId: null, qty: remaining })
    batchQueue.set(productId, q)
    return out
  }

  let curDate: string | null = null
  const snapshot = (date: string): void => {
    let v = new Decimal(0)
    let q = 0
    for (const id of stock.keys()) {
      v = v.plus(valueOf(id))
      q += stock.get(id)!.stock
    }
    const last = timeline[timeline.length - 1]
    if (last && last.date === date) {
      last.value = v
      last.qty = q
    } else timeline.push({ date, value: v, qty: q })
  }

  for (const m of sortMovements(input.movements)) {
    if (curDate !== null && curDate !== m.movement_date) snapshot(curDate)
    curDate = m.movement_date
    const st = getStock(m.product_id)
    const abs = Math.abs(m.qty)

    switch (m.type as MovementType) {
      case 'opening': {
        const unit = D(m.unit_cost_uzs)
        const value = roundUzs(unit.mul(abs))
        add(m.product_id, abs, value)
        st.opening += abs
        st.stock += abs
        movementCosts.set(m.id, { movementId: m.id, unitCost: roundCost(unit), totalCost: value })
        const q = batchQueue.get(m.product_id) ?? []
        q.push({ batchId: null, qty: abs })
        batchQueue.set(m.product_id, q)
        break
      }
      case 'receipt': {
        const rc = m.batch_item_id ? input.receiptCosts.get(m.batch_item_id) : undefined
        let value: Decimal
        if (rc && rc.qtyBasis > 0) value = roundUzs(rc.totalUzs.mul(abs).div(rc.qtyBasis))
        else {
          value = roundUzs(D(m.unit_cost_uzs).mul(abs))
          warnings.push('Приход без стоимости партии — использована указанная стоимость единицы.')
        }
        add(m.product_id, abs, value)
        st.received += abs
        st.stock += abs
        movementCosts.set(m.id, { movementId: m.id, unitCost: roundCost(value.div(abs)), totalCost: value })
        const q = batchQueue.get(m.product_id) ?? []
        q.push({ batchId: m.batch_id, qty: abs })
        batchQueue.set(m.product_id, q)
        break
      }
      case 'sale': {
        const cost = consume(m.product_id, abs)
        st.sold += abs
        st.stock -= abs
        if (m.sale_item_id) {
          cogsBySaleItem.set(m.sale_item_id, cost)
          saleQty.set(m.sale_item_id, abs)
          for (const a of consumeQueue(m.product_id, abs)) {
            attribution.push({ saleItemId: m.sale_item_id, batchId: a.batchId, qty: a.qty })
          }
        }
        movementCosts.set(m.id, { movementId: m.id, unitCost: roundCost(cost.div(abs)), totalCost: cost })
        break
      }
      case 'return': {
        // Возврат на склад по себестоимости исходной продажи.
        const ret = m.return_id ? returnsById.get(m.return_id) : undefined
        const si = ret ? saleItemsById.get(ret.sale_item_id) : undefined
        const soldCost = si ? cogsBySaleItem.get(si.id) : undefined
        const soldQty = si ? saleQty.get(si.id) : undefined
        let value: Decimal
        if (soldCost && soldQty) value = roundUzs(soldCost.mul(abs).div(soldQty))
        else {
          const w = valueOf(m.product_id)
          const q = qtyOf(m.product_id)
          value = q > 0 ? roundUzs(w.mul(abs).div(q)) : roundUzs(D(m.unit_cost_uzs).mul(abs))
        }
        add(m.product_id, abs, value)
        st.returned += abs
        st.stock += abs
        if (m.return_id) returnCostByReturn.set(m.return_id, value)
        movementCosts.set(m.id, { movementId: m.id, unitCost: roundCost(value.div(abs)), totalCost: value })
        const q = batchQueue.get(m.product_id) ?? []
        const firstBatch = si ? attribution.find((a) => a.saleItemId === si.id)?.batchId ?? null : null
        q.unshift({ batchId: firstBatch, qty: abs })
        batchQueue.set(m.product_id, q)
        break
      }
      case 'writeoff':
      case 'defect': {
        const cost = consume(m.product_id, abs)
        st.writtenOff += abs
        st.stock -= abs
        st.lossValue = st.lossValue.plus(cost)
        losses.push({ date: m.movement_date, productId: m.product_id, value: cost })
        consumeQueue(m.product_id, abs)
        movementCosts.set(m.id, { movementId: m.id, unitCost: roundCost(cost.div(abs)), totalCost: cost })
        break
      }
      case 'adjustment': {
        if (m.qty > 0) {
          const q0 = qtyOf(m.product_id)
          const unit = m.unit_cost_uzs !== null ? D(m.unit_cost_uzs) : q0 > 0 ? valueOf(m.product_id).div(q0) : new Decimal(0)
          const value = roundUzs(unit.mul(abs))
          add(m.product_id, abs, value)
          st.adjustments += abs
          st.stock += abs
          movementCosts.set(m.id, { movementId: m.id, unitCost: roundCost(unit), totalCost: value })
          const q = batchQueue.get(m.product_id) ?? []
          q.push({ batchId: null, qty: abs })
          batchQueue.set(m.product_id, q)
        } else {
          const cost = consume(m.product_id, abs)
          st.adjustments -= abs
          st.stock -= abs
          st.lossValue = st.lossValue.plus(cost)
          losses.push({ date: m.movement_date, productId: m.product_id, value: cost })
          consumeQueue(m.product_id, abs)
          movementCosts.set(m.id, { movementId: m.id, unitCost: roundCost(cost.div(abs)), totalCost: cost })
        }
        break
      }
    }
  }
  if (curDate !== null) snapshot(curDate)

  // Резерв под заказы в работе.
  for (const si of input.saleItems) {
    const sale = saleOf.get(si.sale_id)
    if (sale?.status === 'in_progress') getStock(si.product_id).reserved += si.qty
  }

  let totalValue = new Decimal(0)
  let totalQty = 0
  for (const [id, st] of stock) {
    st.value = valueOf(id)
    st.avgCost = st.stock > 0 ? roundCost(st.value.div(st.stock)) : null
    st.available = st.stock - st.reserved
    totalValue = totalValue.plus(st.value)
    totalQty += st.stock
    if (st.stock < 0) warnings.push('Отрицательный остаток по одному из товаров — проверьте журнал движений.')
  }

  return {
    byProduct: stock,
    cogsBySaleItem,
    movementCosts,
    losses,
    returnCostByReturn,
    attribution,
    timeline,
    totalValue,
    totalQty,
    warnings: [...new Set(warnings)],
  }
}

function blank(productId: string): ProductStock {
  return {
    productId,
    opening: 0,
    received: 0,
    sold: 0,
    returned: 0,
    writtenOff: 0,
    adjustments: 0,
    stock: 0,
    reserved: 0,
    available: 0,
    value: new Decimal(0),
    avgCost: null,
    lossValue: new Decimal(0),
  }
}

/**
 * Рекомендуемое количество к закупке:
 *   потребность = скорость продаж/день × (срок поставки + желаемый запас дней)
 *   к закупке   = max(0, потребность − доступный остаток − уже заказанное в пути)
 */
export function recommendedReorder(args: {
  soldLastDays: number
  windowDays: number
  available: number
  inbound: number
  leadTimeDays: number
  coverDays: number
}): { perDay: number; qty: number; daysLeft: number | null } {
  const perDay = args.windowDays > 0 ? args.soldLastDays / args.windowDays : 0
  const need = Math.ceil(perDay * (args.leadTimeDays + args.coverDays))
  const qty = Math.max(0, need - args.available - args.inbound)
  const daysLeft = perDay > 0 ? Math.floor(args.available / perDay) : null
  return { perDay, qty, daysLeft }
}
