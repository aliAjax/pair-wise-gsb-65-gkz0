import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { seedAudit, seedBackupContainers, seedDeviations, seedShipments } from '../data/seed'
import { isOpenDeviation } from '../types'
import type { AuditEntry, BackupContainer, ContainerHandover, CustodyPeriod, Deviation, EvidenceFile, Shipment, ShipmentStatus } from '../types'

export interface HandoverPayload {
  segmentId: string
  toContainerId: string
  requiredCapacity: number
  handoverAt: string
  operator: string
  note: string
}

export interface ConfirmResult {
  ok: boolean
  conflict?: boolean
  persistFailed?: boolean
  currentVersion?: number
  message: string
}

interface ShipmentState {
  shipments: Shipment[]
  deviations: Deviation[]
  audit: AuditEntry[]
  backupContainers: BackupContainer[]
  persistFailureDrill: boolean
  keyword: string
  status: ShipmentStatus | '全部'
  setKeyword: (value: string) => void
  setStatus: (value: ShipmentStatus | '全部') => void
  setPersistFailureDrill: (value: boolean) => void
  addEvidence: (shipmentId: string, evidence: Omit<EvidenceFile, 'id' | 'version' | 'uploadedAt'>) => void
  verifyEvidence: (shipmentId: string, evidenceId: string) => void
  sign: (shipmentId: string, role: string, comment: string, status: '已签' | '已退回') => { ok: boolean; message: string }
  createDeviation: (shipmentId: string, segmentId: string, title: string, severity: '一般' | '重大') => void
  saveInvestigation: (id: string, patch: Partial<Deviation>) => void
  reviewDeviation: (id: string, disposition: Deviation['disposition'], note: string) => { ok: boolean; message: string }
  setShipmentStatus: (id: string, status: ShipmentStatus) => { ok: boolean; message: string }
  initiateHandover: (shipmentId: string, payload: HandoverPayload) => { ok: boolean; message: string }
  changeBackupContainer: (handoverId: string, toContainerId: string) => { ok: boolean; message: string }
  confirmHandover: (handoverId: string, baseVersion: number, payload: { operator: string; note: string }) => ConfirmResult
  simulateConcurrentConfirm: (handoverId: string) => void
  reset: () => void
}

let idSeed = 10
const nextId = (prefix: string) => `${prefix}-${Date.now()}-${idSeed++}`
const round1 = (value: number) => Math.round(value * 10) / 10

const JOURNAL_KEY = 'gsb65:handover-journal'
/** 交接落盘：演练开关打开时模拟写盘失败，由调用方回滚 */
function persistHandoverJournal(state: Pick<ShipmentState, 'shipments' | 'persistFailureDrill'>) {
  if (state.persistFailureDrill) throw new Error('模拟落盘失败')
  localStorage.setItem(JOURNAL_KEY, JSON.stringify({
    at: new Date().toISOString(),
    shipments: state.shipments.map((item) => ({ id: item.id, handoverVersion: item.handoverVersion, handovers: item.handovers }))
  }))
}

export const useShipmentStore = create<ShipmentState>()(persist((set, get) => ({
  shipments: seedShipments,
  deviations: seedDeviations,
  audit: seedAudit,
  backupContainers: seedBackupContainers,
  persistFailureDrill: false,
  keyword: '',
  status: '全部',
  setKeyword: (keyword) => set({ keyword }),
  setStatus: (status) => set({ status }),
  setPersistFailureDrill: (persistFailureDrill) => set({ persistFailureDrill }),
  addEvidence: (shipmentId, evidence) => set((state) => {
    const shipment = state.shipments.find((item) => item.id === shipmentId)
    if (!shipment) return state
    const sameCount = shipment.evidence.filter((item) => item.category === evidence.category).length
    shipment.evidence.unshift({ ...evidence, id: nextId('E'), version: sameCount + 1, uploadedAt: new Date().toISOString() })
    shipment.version += 1
    shipment.updatedAt = new Date().toISOString()
    return { shipments: [...state.shipments], audit: [makeAudit(shipmentId, '上传证据版本', evidence.uploadedBy, `${evidence.name} 版本${sameCount + 1}`), ...state.audit] }
  }),
  verifyEvidence: (shipmentId, evidenceId) => set((state) => {
    const shipment = state.shipments.find((item) => item.id === shipmentId)
    const evidence = shipment?.evidence.find((item) => item.id === evidenceId)
    if (!shipment || !evidence) return state
    evidence.verified = true
    shipment.version += 1
    return { shipments: [...state.shipments], audit: [makeAudit(shipmentId, '核验证据', '当前用户', evidence.name), ...state.audit] }
  }),
  sign: (shipmentId, role, comment, status) => {
    const shipment = get().shipments.find((item) => item.id === shipmentId)
    const signature = shipment?.signatures.find((item) => item.role === role)
    if (!shipment || !signature) return { ok: false, message: '签收角色不存在' }
    if (status === '已退回' && !comment.trim()) return { ok: false, message: '退回必须填写原因' }
    signature.status = status
    signature.comment = comment
    signature.signedAt = new Date().toISOString()
    shipment.version += 1
    shipment.updatedAt = signature.signedAt
    set((state) => ({ shipments: [...state.shipments], audit: [makeAudit(shipmentId, `${role}${status}`, signature.name, comment || '签署确认'), ...state.audit] }))
    return { ok: true, message: status === '已签' ? '签收成功' : '已退回并要求补充材料' }
  },
  createDeviation: (shipmentId, segmentId, title, severity) => set((state) => {
    const shipment = state.shipments.find((item) => item.id === shipmentId)
    if (!shipment) return state
    const segment = shipment.segments.find((item) => item.id === segmentId)
    const outOfRange = segment?.temperature.filter((point) => point.value < shipment.tempMin || point.value > shipment.tempMax) ?? []
    const now = new Date().toISOString()
    const deviation: Deviation = {
      id: nextId('TDEV'), shipmentId, segmentId, title, source: '人工报告', severity, status: '待调查', owner: '温控质量组', openedAt: now,
      dueDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10), cause: '', assessment: '', disposition: '补充处理', correctiveAction: '', evidence: '', reviewer: '', reviewNote: '', version: 1,
      windowStart: outOfRange[0]?.time, windowEnd: outOfRange[outOfRange.length - 1]?.time
    }
    shipment.status = '待放行'
    shipment.version += 1
    return { deviations: [deviation, ...state.deviations], shipments: [...state.shipments], audit: [makeAudit(shipmentId, '登记温度偏差', '当前用户', title), ...state.audit] }
  }),
  saveInvestigation: (id, patch) => set((state) => {
    const deviation = state.deviations.find((item) => item.id === id)
    if (!deviation || !patch.cause?.trim() || !patch.assessment?.trim()) return state
    Object.assign(deviation, patch, { status: '待放行复核', version: deviation.version + 1 })
    return { deviations: [...state.deviations], audit: [makeAudit(deviation.shipmentId, '提交偏差调查', deviation.owner, deviation.assessment), ...state.audit] }
  }),
  reviewDeviation: (id, disposition, note) => {
    const deviation = get().deviations.find((item) => item.id === id)
    if (!deviation) return { ok: false, message: '偏差不存在' }
    if (disposition === '拒绝' && !note.trim()) return { ok: false, message: '拒绝放行必须填写理由' }
    deviation.disposition = disposition
    deviation.reviewer = '放行人员 顾言'
    deviation.reviewNote = note
    deviation.status = '已关闭'
    deviation.version += 1
    const shipment = get().shipments.find((item) => item.id === deviation.shipmentId)
    if (shipment) shipment.status = disposition === '拒绝' ? '已拒绝' : '待放行'
    set((state) => ({ deviations: [...state.deviations], shipments: [...state.shipments], audit: [makeAudit(deviation.shipmentId, `偏差复核：${disposition}`, deviation.reviewer, note), ...state.audit] }))
    return { ok: true, message: `已执行${disposition}` }
  },
  setShipmentStatus: (id, status) => {
    const state = get()
    const shipment = state.shipments.find((item) => item.id === id)
    if (!shipment) return { ok: false, message: '运输任务不存在' }
    const open = state.deviations.some((item) => item.shipmentId === id && isOpenDeviation(item))
    if (status === '已放行' && open) return { ok: false, message: '存在未关闭温度偏差，不能放行' }
    if (status === '已放行' && shipment.handovers.some((item) => item.status !== '已确认')) return { ok: false, message: '存在排队或待确认的温控箱交接，不能放行' }
    if (status === '已放行' && shipment.evidence.some((item) => !item.verified)) return { ok: false, message: '仍有证据未核验' }
    if (status === '已放行' && shipment.signatures.some((item) => item.role !== '放行人员' && item.status !== '已签')) return { ok: false, message: '多角色签收未完成' }
    shipment.status = status
    shipment.version += 1
    shipment.updatedAt = new Date().toISOString()
    set((current) => ({ shipments: [...current.shipments], audit: [makeAudit(id, `状态流转：${status}`, '当前用户', '放行工作台操作'), ...current.audit] }))
    return { ok: true, message: `状态已更新为${status}` }
  },
  initiateHandover: (shipmentId, payload) => {
    const state = get()
    const shipment = state.shipments.find((item) => item.id === shipmentId)
    if (!shipment) return { ok: false, message: '运输任务不存在' }
    const segment = shipment.segments.find((item) => item.id === payload.segmentId)
    if (!segment) return { ok: false, message: '航段不存在' }
    const backup = state.backupContainers.find((item) => item.id === payload.toContainerId)
    if (!backup) return { ok: false, message: '备用箱不存在' }
    if (shipment.handovers.some((item) => item.segmentId === payload.segmentId && item.status !== '已确认')) return { ok: false, message: '该航段已有未完成交接单' }
    const capacityGap = round1(Math.max(0, payload.requiredCapacity - backup.capacity))
    const handover: ContainerHandover = {
      id: nextId('HO'), shipmentId, segmentId: payload.segmentId, station: segment.to,
      fromContainerId: shipment.containerId, toContainerId: payload.toContainerId,
      requiredCapacity: payload.requiredCapacity, backupCapacity: backup.capacity, capacityGap,
      status: capacityGap > 0 ? '排队中' : '待确认',
      handoverAt: payload.handoverAt, operator: payload.operator, note: payload.note,
      version: 1, createdAt: new Date().toISOString(), confirmedAt: ''
    }
    shipment.handovers.push(handover)
    shipment.version += 1
    shipment.updatedAt = handover.createdAt
    const detail = capacityGap > 0
      ? `备用箱${backup.id}容量${backup.capacity}m³不足所需${payload.requiredCapacity}m³，交接排队，缺口${capacityGap.toFixed(1)}m³`
      : `${handover.fromContainerId} → ${handover.toContainerId} @${handover.station}`
    set((current) => ({ shipments: [...current.shipments], audit: [makeAudit(shipmentId, '发起温控箱交接', payload.operator, detail), ...current.audit] }))
    return capacityGap > 0
      ? { ok: true, message: `备用箱容量不足，交接已排队并标记缺口${capacityGap.toFixed(1)}m³` }
      : { ok: true, message: '交接单已创建，待双方确认' }
  },
  changeBackupContainer: (handoverId, toContainerId) => {
    const state = get()
    const shipment = state.shipments.find((item) => item.handovers.some((handover) => handover.id === handoverId))
    const handover = shipment?.handovers.find((item) => item.id === handoverId)
    const backup = state.backupContainers.find((item) => item.id === toContainerId)
    if (!shipment || !handover) return { ok: false, message: '交接单不存在' }
    if (!backup) return { ok: false, message: '备用箱不存在' }
    if (handover.status === '已确认') return { ok: false, message: '交接已确认，不能更换备用箱' }
    handover.toContainerId = toContainerId
    handover.backupCapacity = backup.capacity
    handover.capacityGap = round1(Math.max(0, handover.requiredCapacity - backup.capacity))
    handover.status = handover.capacityGap > 0 ? '排队中' : '待确认'
    handover.version += 1
    shipment.version += 1
    shipment.updatedAt = new Date().toISOString()
    const detail = handover.capacityGap > 0
      ? `改派${toContainerId}（${backup.capacity}m³），仍缺口${handover.capacityGap.toFixed(1)}m³，继续排队`
      : `改派${toContainerId}（${backup.capacity}m³），容量满足，交接转待确认`
    set((current) => ({ shipments: [...current.shipments], audit: [makeAudit(shipment.id, '更换备用箱', '当前用户', detail), ...current.audit] }))
    return { ok: true, message: handover.capacityGap > 0 ? `仍缺口${handover.capacityGap.toFixed(1)}m³，交接继续排队` : '容量已满足，交接转为待确认' }
  },
  confirmHandover: (handoverId, baseVersion, payload) => {
    const state = get()
    const shipment = state.shipments.find((item) => item.handovers.some((handover) => handover.id === handoverId))
    const handover = shipment?.handovers.find((item) => item.id === handoverId)
    if (!shipment || !handover) return { ok: false, message: '交接单不存在' }
    if (handover.status === '已确认') return { ok: false, message: '该交接已确认，请勿重复提交' }
    if (handover.status === '排队中') return { ok: false, message: `备用箱容量缺口${handover.capacityGap.toFixed(1)}m³未消除，交接仍在排队` }
    if (handover.version !== baseVersion) {
      return { ok: false, conflict: true, currentVersion: handover.version, message: `版本冲突：交接单已被他人更新至V${handover.version}，你的填写已保留，请核对后重新提交` }
    }

    // 交接前快照：落盘失败时整体回滚
    const snapshot = structuredClone({ shipments: state.shipments, deviations: state.deviations, audit: state.audit, backupContainers: state.backupContainers })
    const now = new Date().toISOString()
    const segment = shipment.segments.find((item) => item.id === handover.segmentId)
    if (!segment) return { ok: false, message: '交接航段不存在' }
    const segmentIndex = shipment.segments.indexOf(segment)
    const at = handover.handoverAt
    const audits: AuditEntry[] = []

    // 1) 冻结旧箱依据：已完成航段连同交接航段的旧箱段一并冻结，后续航段移交新箱
    shipment.custody.forEach((custody) => {
      if (custody.containerId !== handover.fromContainerId || custody.frozen) return
      const custodySegmentIndex = shipment.segments.findIndex((item) => item.id === custody.segmentId)
      const custodySegment = shipment.segments[custodySegmentIndex]
      if (custodySegmentIndex < segmentIndex || (custodySegmentIndex === segmentIndex && custody.startedAt < at)) {
        if (custodySegmentIndex === segmentIndex) custody.endedAt = at
        custody.endedAt = custody.endedAt || at
        custody.frozen = true
        custody.frozenPoints = custodySegment.temperature.filter((point) => point.time >= custody.startedAt && point.time < custody.endedAt)
        custody.frozenEvidenceIds = shipment.evidence.filter((item) => item.custodyId === custody.id).map((item) => item.id)
      } else {
        custody.containerId = handover.toContainerId
      }
    })

    // 2) 新箱从交接时刻续记
    const newCustody: CustodyPeriod = {
      id: nextId('CUST'), shipmentId: shipment.id, segmentId: segment.id,
      containerId: handover.toContainerId, startedAt: at, endedAt: segment.actualEnd, frozen: false
    }
    shipment.custody.push(newCustody)

    // 3) 航段温度点按交接时刻归属到箱
    shipment.segments.forEach((item, index) => {
      item.temperature.forEach((point) => {
        if (index < segmentIndex) point.containerId = handover.fromContainerId
        else if (index > segmentIndex) point.containerId = handover.toContainerId
        else point.containerId = point.time < at ? handover.fromContainerId : handover.toContainerId
      })
    })

    // 4) 跨交接偏差按责任时段拆开，旧箱历史随冻结读数保留
    const newDeviations: Deviation[] = []
    state.deviations.forEach((deviation) => {
      if (deviation.shipmentId !== shipment.id || !isOpenDeviation(deviation)) return
      const deviationSegmentIndex = shipment.segments.findIndex((item) => item.id === deviation.segmentId)
      if (deviationSegmentIndex < 0) return
      const deviationSegment = shipment.segments[deviationSegmentIndex]
      const outOfRange = deviationSegment.temperature.filter((point) => point.value < shipment.tempMin || point.value > shipment.tempMax)
      const windowStart = deviation.windowStart || outOfRange[0]?.time || deviation.openedAt
      const windowEnd = deviation.windowEnd || outOfRange[outOfRange.length - 1]?.time || deviation.openedAt
      const oldCustody = shipment.custody.find((item) => item.segmentId === deviation.segmentId && item.containerId === handover.fromContainerId)
      const spansHandover = deviationSegmentIndex === segmentIndex && windowStart < at && at < windowEnd
      const beforeHandover = deviationSegmentIndex < segmentIndex || (deviationSegmentIndex === segmentIndex && windowEnd <= at)
      if (spansHandover) {
        deviation.status = '已拆分'
        deviation.version += 1
        const frozenCount = oldCustody?.frozenPoints?.length ?? 0
        newDeviations.push(
          { ...deviation, id: nextId('TDEV'), parentId: deviation.id, title: `${deviation.title}｜旧箱${handover.fromContainerId}责任时段`, status: deviation.cause ? '调查中' : '待调查', containerId: handover.fromContainerId, custodyId: oldCustody?.id, periodStart: windowStart, periodEnd: at, windowStart, windowEnd, evidence: `${deviation.evidence ? `${deviation.evidence}；` : ''}旧箱冻结读数${frozenCount}点已随交接保留`, reviewer: '', reviewNote: '', version: 1 },
          { ...deviation, id: nextId('TDEV'), parentId: deviation.id, title: `${deviation.title}｜新箱${handover.toContainerId}责任时段`, status: '待调查', cause: '', assessment: '', correctiveAction: '', evidence: '', containerId: handover.toContainerId, custodyId: newCustody.id, periodStart: at, periodEnd: windowEnd, windowStart, windowEnd, reviewer: '', reviewNote: '', version: 1 }
        )
        audits.push(makeAudit(shipment.id, '拆分跨交接偏差', '系统', `${deviation.id}按责任时段拆分为旧箱${handover.fromContainerId}/新箱${handover.toContainerId}两段，旧箱历史保留`))
      } else {
        deviation.containerId = beforeHandover ? handover.fromContainerId : handover.toContainerId
        deviation.custodyId = beforeHandover
          ? oldCustody?.id
          : deviationSegmentIndex === segmentIndex
            ? newCustody.id
            : shipment.custody.find((item) => item.segmentId === deviation.segmentId && item.containerId === handover.toContainerId)?.id
        deviation.periodStart = windowStart
        deviation.periodEnd = windowEnd
        deviation.windowStart = windowStart
        deviation.windowEnd = windowEnd
        deviation.version += 1
      }
    })

    // 5) 交接单确认，任务交接版本递增（各页读取同一版本）
    handover.status = '已确认'
    handover.operator = payload.operator
    handover.note = payload.note || handover.note
    handover.confirmedAt = now
    handover.version += 1
    shipment.containerId = handover.toContainerId
    shipment.handoverVersion += 1
    shipment.version += 1
    shipment.updatedAt = now

    // 6) 交接签字证据归入新箱段
    const handoverEvidenceCount = shipment.evidence.filter((item) => item.category === '交接签字').length
    shipment.evidence.unshift({
      id: nextId('E'), name: `${handover.station}温控箱交接单-${handover.toContainerId}.pdf`, category: '交接签字',
      version: handoverEvidenceCount + 1, uploadedBy: payload.operator, uploadedAt: now, verified: false,
      custodyId: newCustody.id, containerId: handover.toContainerId
    })

    // 7) 备用箱转为占用
    const backup = state.backupContainers.find((item) => item.id === handover.toContainerId)
    if (backup) backup.status = '占用'

    audits.unshift(
      makeAudit(shipment.id, '确认温控箱交接', payload.operator, `交接单V${handover.version}，${handover.fromContainerId} → ${handover.toContainerId}，交接版本升至V${shipment.handoverVersion}`),
      makeAudit(shipment.id, '冻结旧箱依据', '系统', `旧箱${handover.fromContainerId}读数与关联证据已冻结，新箱${handover.toContainerId}自${at.slice(11, 16)}续记`)
    )

    set({ shipments: [...state.shipments], deviations: [...newDeviations, ...state.deviations], audit: [...audits, ...state.audit], backupContainers: [...state.backupContainers] })

    // 8) 落盘失败：回滚到交接前状态，由操作者重试
    try {
      persistHandoverJournal(get())
    } catch {
      set({ shipments: snapshot.shipments, deviations: snapshot.deviations, audit: snapshot.audit, backupContainers: snapshot.backupContainers })
      return { ok: false, persistFailed: true, message: '落盘失败：已回滚到交接前状态，填写内容已保留，请重试' }
    }
    return { ok: true, message: `交接已确认，交接版本V${shipment.handoverVersion}` }
  },
  simulateConcurrentConfirm: (handoverId) => set((state) => {
    const shipment = state.shipments.find((item) => item.handovers.some((handover) => handover.id === handoverId))
    const handover = shipment?.handovers.find((item) => item.id === handoverId)
    if (!handover || handover.status === '已确认') return state
    handover.version += 1
    return { shipments: [...state.shipments], audit: [makeAudit(shipment!.id, '他人提交交接确认', '复核员 林岚', `交接单更新至V${handover.version}`), ...state.audit] }
  }),
  reset: () => set({
    shipments: structuredClone(seedShipments), deviations: structuredClone(seedDeviations), audit: structuredClone(seedAudit),
    backupContainers: structuredClone(seedBackupContainers), persistFailureDrill: false, keyword: '', status: '全部'
  })
}), { name: 'gsb65:temperature-chain-v2' }))

function makeAudit(shipmentId: string, action: string, operator: string, detail: string): AuditEntry {
  return { id: nextId('AUD'), shipmentId, action, operator, detail, createdAt: new Date().toISOString() }
}
