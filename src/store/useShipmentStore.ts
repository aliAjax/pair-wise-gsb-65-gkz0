import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { seedAudit, seedDeviations, seedShipments, seedSpareContainers } from '../data/seed'
import type { AuditEntry, ContainerHandover, Deviation, EvidenceFile, Shipment, ShipmentStatus, SpareContainer, TemperaturePoint } from '../types'

const STORAGE_KEY = 'gsb65:temperature-chain:v2'
const DEFAULT_OPERATOR = '中转值班员 何琳'

export interface HandoverDraft {
  airport: string
  handoverAt: string
  toContainerId: string
  requiredCapacity: number
  reason: string
  operator: string
}

interface ActionResult {
  ok: boolean
  message: string
  /** 乐观锁版本冲突：后到者的填写保留 */
  conflict?: boolean
  currentVersion?: number
  /** 落盘失败：数据停留在交接前，可原样重试 */
  persistFailed?: boolean
  handoverId?: string
  queued?: boolean
}

interface ShipmentState {
  shipments: Shipment[]
  deviations: Deviation[]
  audit: AuditEntry[]
  spares: SpareContainer[]
  keyword: string
  status: ShipmentStatus | '全部'
  setKeyword: (value: string) => void
  setStatus: (value: ShipmentStatus | '全部') => void
  addEvidence: (shipmentId: string, evidence: Omit<EvidenceFile, 'id' | 'version' | 'uploadedAt' | 'containerId'>) => void
  verifyEvidence: (shipmentId: string, evidenceId: string) => { ok: boolean; message: string }
  sign: (shipmentId: string, role: string, comment: string, decision: '已签' | '已退回') => { ok: boolean; message: string }
  appendTemperaturePoint: (shipmentId: string, segmentId: string, value: number) => { ok: boolean; message: string }
  createDeviation: (shipmentId: string, segmentId: string, title: string, severity: '一般' | '重大') => void
  saveInvestigation: (id: string, patch: Partial<Deviation>) => void
  reviewDeviation: (id: string, disposition: Deviation['disposition'], note: string) => { ok: boolean; message: string }
  setShipmentStatus: (id: string, status: ShipmentStatus) => { ok: boolean; message: string }
  /** 交接确认：两人同时提交时后到者遇版本冲突；落盘失败则整体留在交接前，可原样重试 */
  confirmHandover: (shipmentId: string, draft: HandoverDraft, baseVersion: number) => ActionResult
  /** 排队交接缺口补齐：调拨容量足够的备用箱后交接生效 */
  allocateSpare: (shipmentId: string, handoverId: string, spareId: string, baseVersion: number) => ActionResult
  restockSpare: (spareId: string, litres: number) => void
  /** 落盘故障注入：仅切换模块内故障标记，不产生状态/落盘写入（否则注入会在开关时被消耗） */
  armFailNextWrite: (armed: boolean) => void
  reset: () => void
}

let idSeed = 10
const nextId = (prefix: string) => `${prefix}-${Date.now()}-${idSeed++}`
const nowIso = () => new Date().toISOString()
const addMinutes = (iso: string, minutes: number) => new Date(new Date(iso).getTime() + minutes * 60000).toISOString().slice(0, 19)
const fmt = (iso: string) => iso.replace('T', ' ').slice(0, 16)

/** 可注入故障的落盘适配器：置位后下一次写入抛错（仅消耗一次），用于模拟落盘失败后重试 */
let failNextWrite = false
const failingStorage: Storage = {
  getItem: (name) => localStorage.getItem(name),
  setItem: (name, value) => {
    if (failNextWrite) {
      failNextWrite = false
      throw new Error('SIMULATED_WRITE_FAILURE')
    }
    localStorage.setItem(name, value)
  },
  removeItem: (name) => localStorage.removeItem(name),
  clear: () => localStorage.clear(),
  key: (index) => localStorage.key(index),
  get length() { return localStorage.length }
}

function makeAudit(shipmentId: string, action: string, operator: string, detail: string, handoverVersion?: number): AuditEntry {
  return { id: nextId('AUD'), shipmentId, action, operator, detail, handoverVersion, createdAt: nowIso() }
}

/** 冻结旧箱依据：归属旧箱的温度点与证据随交接固化，不再被覆盖或补核验 */
function freezeOldBox(shipment: Shipment, fromContainerId: string, at: string, handoverId: string) {
  let frozenPointCount = 0
  shipment.segments.forEach((segment) => segment.temperature.forEach((point) => {
    if (point.containerId === fromContainerId && !point.frozen) {
      point.frozen = true
      frozenPointCount += 1
    }
  }))
  let frozenEvidenceCount = 0
  shipment.evidence.forEach((evidence) => {
    // 按箱归属冻结：事后补传的旧箱证据同样固化，避免混到新箱依据里
    if (evidence.containerId === fromContainerId && !evidence.frozen) {
      evidence.frozen = true
      evidence.frozenAt = at
      evidence.frozenHandoverId = handoverId
      frozenEvidenceCount += 1
    }
  })
  return { frozenPointCount, frozenEvidenceCount }
}

/** 跨交接偏差按责任时段拆开：旧箱段截到交接时刻并冻结保留，新箱段从交接时刻续记 */
function splitDeviations(deviations: Deviation[], shipmentId: string, fromContainerId: string, toContainerId: string, at: string, handoverId: string) {
  const created: Deviation[] = []
  const splitIds: string[] = []
  deviations.forEach((deviation) => {
    if (deviation.shipmentId !== shipmentId || deviation.status === '已关闭') return
    const spansHandover = deviation.containerId === fromContainerId && deviation.startTime < at && deviation.endTime > at
    if (spansHandover) {
      const originalEnd = deviation.endTime
      const baseTitle = deviation.title.replace(/（旧箱.*?责任段）$/, '')
      deviation.title = `${baseTitle}（旧箱 ${fromContainerId} 责任段）`
      deviation.endTime = at
      deviation.periodEnd = at
      deviation.frozen = true
      deviation.frozenHandoverId = handoverId
      deviation.version += 1
      created.push({
        ...structuredClone(deviation),
        id: nextId('TDEV'),
        title: `${baseTitle}（新箱 ${toContainerId} 责任段）`,
        containerId: toContainerId,
        startTime: at, periodStart: at, endTime: originalEnd, periodEnd: originalEnd,
        splitFromId: deviation.id,
        frozen: undefined, frozenHandoverId: undefined,
        status: '调查中', openedAt: at, version: 1,
        reviewer: '', reviewNote: '',
        cause: `由跨交接偏差 ${deviation.id} 在交接时刻 ${fmt(at)} 拆出，新箱 ${toContainerId} 自交接时刻续记责任。`,
        assessment: '', disposition: '补充处理', correctiveAction: '', evidence: ''
      })
      splitIds.push(deviation.id, created[created.length - 1].id)
    } else if (deviation.containerId === fromContainerId && deviation.endTime <= at && !deviation.frozen) {
      // 旧箱历史偏差整段落在交接前：冻结保留
      deviation.frozen = true
      deviation.frozenHandoverId = handoverId
      deviation.version += 1
    }
  })
  return { created, splitIds }
}

interface BuiltHandover {
  shipments: Shipment[]
  deviations: Deviation[]
  spares: SpareContainer[]
  audit: AuditEntry[]
  handover: ContainerHandover
  queued: boolean
}

/** 构造交接后的完整状态（纯函数，落盘成功后才提交，保证失败可从交接前重试） */
function buildHandover(state: ShipmentState, shipment: Shipment, draft: HandoverDraft, baseVersion: number, mode: 'confirm' | 'allocate', mergeHandoverId?: string): BuiltHandover {
  const shipments = structuredClone(state.shipments)
  const deviations = structuredClone(state.deviations)
  const spares = structuredClone(state.spares)
  const target = shipments.find((item) => item.id === shipment.id)!
  const spareRow = spares.find((item) => item.id === draft.toContainerId)!
  const enough = spareRow.capacityFree >= draft.requiredCapacity
  const seq = mode === 'allocate' && mergeHandoverId ? target.handovers.find((item) => item.id === mergeHandoverId)!.seq : target.handovers.length + 1
  const nextHandoverVersion = target.handoverVersion + 1
  const handoverId = mode === 'allocate' && mergeHandoverId ? mergeHandoverId : nextId('HO')

  const handover: ContainerHandover = {
    id: handoverId, shipmentId: target.id, seq, airport: draft.airport, handoverAt: draft.handoverAt,
    fromContainerId: target.containerId, toContainerId: draft.toContainerId,
    requiredCapacity: draft.requiredCapacity,
    allocatedCapacity: enough ? draft.requiredCapacity : spareRow.capacityFree,
    capacityGap: enough ? 0 : draft.requiredCapacity - spareRow.capacityFree,
    status: enough ? '已生效' : '排队待箱',
    reason: draft.reason, operator: draft.operator,
    frozenPointCount: 0, frozenEvidenceCount: 0, splitDeviationIds: [],
    baseVersion, version: nextHandoverVersion, confirmedAt: nowIso()
  }
  if (!enough) handover.queuedNote = `备用箱 ${draft.toContainerId} 容量不足，缺口 ${handover.capacityGap} 升，任务排队等待调拨`

  let detail: string
  if (enough) {
    const frozen = freezeOldBox(target, target.containerId, draft.handoverAt, handoverId)
    const split = splitDeviations(deviations, target.id, target.containerId, draft.toContainerId, draft.handoverAt, handoverId)
    deviations.push(...split.created)
    handover.frozenPointCount = frozen.frozenPointCount
    handover.frozenEvidenceCount = frozen.frozenEvidenceCount
    handover.splitDeviationIds = split.splitIds
    target.containerId = draft.toContainerId
    spareRow.capacityFree -= draft.requiredCapacity
    target.evidence.unshift({
      id: nextId('E'), name: `${draft.toContainerId}换箱交接签字 #${seq}.jpg`, category: '交接签字',
      version: target.evidence.filter((item) => item.category === '交接签字').length + 1,
      uploadedBy: draft.operator, uploadedAt: nowIso(), verified: false, containerId: draft.toContainerId
    })
    detail = `${handover.fromContainerId} → ${draft.toContainerId}（${draft.airport} @ ${fmt(draft.handoverAt)}）；冻结旧箱温度点${frozen.frozenPointCount}个、证据${frozen.frozenEvidenceCount}份${split.splitIds.length ? `；跨交接偏差按责任时段拆为 ${split.splitIds.join(' / ')}，旧箱段冻结保留` : ''}`
  } else {
    detail = `${handover.fromContainerId} → ${draft.toContainerId}（${draft.airport} @ ${fmt(draft.handoverAt)}）；${handover.queuedNote}，交接链保留至 V${nextHandoverVersion}`
  }

  const auditTail: AuditEntry[] = mode === 'allocate'
    ? [makeAudit(target.id, `交接缺口补齐 V${nextHandoverVersion}`, draft.operator, `排队交接 ${handoverId} 由 ${draft.toContainerId} 补齐容量并于 ${fmt(draft.handoverAt)} 生效；${detail.replace(/^.*?）；/, '')}`, nextHandoverVersion)]
    : [makeAudit(target.id, enough ? `温控箱交接确认 V${nextHandoverVersion}` : `交接排队待箱 V${nextHandoverVersion}`, draft.operator, detail, nextHandoverVersion)]

  if (mode === 'allocate') {
    const queued = target.handovers.find((item) => item.id === mergeHandoverId)!
    Object.assign(queued, handover, { id: mergeHandoverId })
  } else {
    target.handovers.push(handover)
  }
  target.handoverVersion = nextHandoverVersion
  target.version += 1
  target.updatedAt = nowIso()

  return { shipments, deviations, spares, audit: [...auditTail, ...state.audit], handover, queued: !enough }
}

export const useShipmentStore = create<ShipmentState>()(persist((set, get) => ({
  shipments: seedShipments,
  deviations: seedDeviations,
  audit: seedAudit,
  spares: seedSpareContainers,
  keyword: '',
  status: '全部',
  setKeyword: (keyword) => set({ keyword }),
  setStatus: (status) => set({ status }),

  addEvidence: (shipmentId, evidence) => set((state) => {
    const shipment = state.shipments.find((item) => item.id === shipmentId)
    if (!shipment) return state
    const sameCount = shipment.evidence.filter((item) => item.category === evidence.category).length
    shipment.evidence.unshift({ ...evidence, id: nextId('E'), version: sameCount + 1, uploadedAt: nowIso(), containerId: shipment.containerId })
    shipment.version += 1
    shipment.updatedAt = nowIso()
    return { shipments: [...state.shipments], audit: [makeAudit(shipmentId, '上传证据版本', evidence.uploadedBy, `${evidence.name} 版本${sameCount + 1}，归属 ${shipment.containerId}`, shipment.handoverVersion), ...state.audit] }
  }),

  verifyEvidence: (shipmentId, evidenceId) => {
    const shipment = get().shipments.find((item) => item.id === shipmentId)
    const evidence = shipment?.evidence.find((item) => item.id === evidenceId)
    if (!shipment || !evidence) return { ok: false, message: '证据不存在' }
    if (evidence.frozen) return { ok: false, message: '旧箱依据已随交接冻结，只能查看不能补核验' }
    evidence.verified = true
    shipment.version += 1
    set((state) => ({ shipments: [...state.shipments], audit: [makeAudit(shipmentId, `核验证据（${evidence.containerId}）`, '当前用户', evidence.name, shipment.handoverVersion), ...state.audit] }))
    return { ok: true, message: '证据已核验' }
  },

  sign: (shipmentId, role, comment, status) => {
    const shipment = get().shipments.find((item) => item.id === shipmentId)
    const signature = shipment?.signatures.find((item) => item.role === role)
    if (!shipment || !signature) return { ok: false, message: '签收角色不存在' }
    if (status === '已退回' && !comment.trim()) return { ok: false, message: '退回必须填写原因' }
    signature.status = status
    signature.comment = comment
    signature.signedAt = nowIso()
    shipment.version += 1
    shipment.updatedAt = signature.signedAt
    set((state) => ({ shipments: [...state.shipments], audit: [makeAudit(shipmentId, `${role}${status}`, signature.name, comment || '签署确认', shipment.handoverVersion), ...state.audit] }))
    return { ok: true, message: status === '已签' ? '签收成功' : '已退回并要求补充材料' }
  },

  appendTemperaturePoint: (shipmentId, segmentId, value) => {
    const shipment = get().shipments.find((item) => item.id === shipmentId)
    const segment = shipment?.segments.find((item) => item.id === segmentId)
    if (!shipment || !segment) return { ok: false, message: '航段不存在' }
    const lastEffective = [...shipment.handovers].filter((item) => item.status === '已生效').pop()
    // 航段在交接前已结束：旧箱时段冻结，不能往关闭的旧航段里续记
    if (lastEffective && segment.actualEnd <= lastEffective.handoverAt) return { ok: false, message: '该航段在交接前已结束，旧箱读数已冻结，请在交接后的新航段续记' }
    const nextTime = addMinutes(segment.temperature[segment.temperature.length - 1]?.time ?? shipment.plannedDeparture, 30)
    if (lastEffective && nextTime <= lastEffective.handoverAt) return { ok: false, message: '交接时刻前的旧箱时段已冻结，新箱只能从交接时刻续记' }
    const point: TemperaturePoint = { id: nextId('T'), time: nextTime, value, containerId: shipment.containerId }
    segment.temperature.push(point)
    shipment.version += 1
    shipment.updatedAt = nowIso()
    set((state) => ({ shipments: [...state.shipments], audit: [makeAudit(shipmentId, `续记温度点（${shipment.containerId}）`, '当前用户', `${segmentId} ${fmt(nextTime)} ${value}℃，自交接时刻续记`, shipment.handoverVersion), ...state.audit] }))
    return { ok: true, message: `已为当前箱 ${shipment.containerId} 续记 ${value}℃` }
  },

  createDeviation: (shipmentId, segmentId, title, severity) => set((state) => {
    const shipment = state.shipments.find((item) => item.id === shipmentId)
    if (!shipment) return state
    const segment = shipment.segments.find((item) => item.id === segmentId)
    const at = nowIso()
    const deviation: Deviation = {
      id: nextId('TDEV'), shipmentId, segmentId, title, source: '人工报告', severity, status: '待调查', owner: '温控质量组', openedAt: at,
      dueDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
      startTime: segment?.actualStart ?? at, endTime: at, containerId: shipment.containerId,
      periodStart: segment?.actualStart ?? at, periodEnd: at,
      cause: '', assessment: '', disposition: '补充处理', correctiveAction: '', evidence: '', reviewer: '', reviewNote: '', version: 1
    }
    shipment.status = '待放行'
    shipment.version += 1
    return { deviations: [deviation, ...state.deviations], shipments: [...state.shipments], audit: [makeAudit(shipmentId, '登记温度偏差', '当前用户', `${title}（责任箱 ${shipment.containerId}）`, shipment.handoverVersion), ...state.audit] }
  }),

  saveInvestigation: (id, patch) => set((state) => {
    const deviation = state.deviations.find((item) => item.id === id)
    if (!deviation || !patch.cause?.trim() || !patch.assessment?.trim()) return state
    Object.assign(deviation, patch, { status: '待放行复核', version: deviation.version + 1 })
    const shipment = state.shipments.find((item) => item.id === deviation.shipmentId)
    return { deviations: [...state.deviations], audit: [makeAudit(deviation.shipmentId, deviation.frozen ? '更新冻结偏差调查备注' : '提交偏差调查', deviation.owner, `${deviation.id} ${deviation.containerId} ${deviation.assessment}`, shipment?.handoverVersion), ...state.audit] }
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
    set((state) => ({ deviations: [...state.deviations], shipments: [...state.shipments], audit: [makeAudit(deviation.shipmentId, `偏差复核：${disposition}（${deviation.containerId}）`, deviation.reviewer, `${deviation.id} ${note}`, shipment?.handoverVersion), ...state.audit] }))
    return { ok: true, message: `已执行${disposition}` }
  },

  setShipmentStatus: (id, status) => {
    const state = get()
    const shipment = state.shipments.find((item) => item.id === id)
    if (!shipment) return { ok: false, message: '运输任务不存在' }
    if (status === '已放行' && state.deviations.some((item) => item.shipmentId === id && item.status !== '已关闭')) return { ok: false, message: '存在未关闭温度偏差，不能放行' }
    if (status === '已放行' && shipment.evidence.some((item) => !item.verified)) return { ok: false, message: '仍有证据未核验（含新箱交接签字）' }
    if (status === '已放行' && shipment.signatures.some((item) => item.role !== '放行人员' && item.status !== '已签')) return { ok: false, message: '多角色签收未完成' }
    if (status === '已放行' && shipment.handovers.some((item) => item.status === '排队待箱')) return { ok: false, message: '存在排队待箱的交接缺口，不能放行' }
    shipment.status = status
    shipment.version += 1
    shipment.updatedAt = nowIso()
    set((current) => ({ shipments: [...current.shipments], audit: [makeAudit(id, `状态流转：${status}`, '当前用户', `放行工作台操作，交接链 V${shipment.handoverVersion}`, shipment.handoverVersion), ...current.audit] }))
    return { ok: true, message: `状态已更新为${status}` }
  },

  confirmHandover: (shipmentId, draft, baseVersion) => {
    const state = get()
    const shipment = state.shipments.find((item) => item.id === shipmentId)
    if (!shipment) return { ok: false, message: '运输任务不存在' }
    // 乐观锁：两人同时提交交接确认，后到者看到版本冲突，填写内容保留
    if (shipment.handoverVersion !== baseVersion) {
      return { ok: false, conflict: true, currentVersion: shipment.handoverVersion, message: `版本冲突：交接链已到 V${shipment.handoverVersion}，您基于 V${baseVersion} 的填写已保留，请核对最新链后再提交` }
    }
    if (shipment.handovers.some((item) => item.status === '排队待箱')) {
      return { ok: false, message: '存在排队待箱的交接缺口，请先调拨备用箱补齐后再办理新交接' }
    }
    if (draft.toContainerId === shipment.containerId) return { ok: false, message: '新箱不能与当前箱相同' }
    const spare = state.spares.find((item) => item.id === draft.toContainerId)
    if (!spare) return { ok: false, message: '备用箱不存在' }
    if (!spare.tempRangeOk) return { ok: false, message: '备用箱温区与任务不匹配' }
    if (!draft.handoverAt) return { ok: false, message: '必须指定交接时刻' }

    const built = buildHandover(state, shipment, draft, baseVersion, 'confirm')
    // 两阶段：先落盘后提交。失败时内存状态不变，事务整体停留在交接前，草稿保留可重试
    if (!persistOrFail(built, state)) {
      return { ok: false, persistFailed: true, currentVersion: baseVersion, handoverId: built.handover.id, message: '落盘失败：交接未生效，数据保持交接前状态，填写已保留，请直接重试' }
    }
    commitBuilt(set, built)
    return built.queued
      ? { ok: true, queued: true, handoverId: built.handover.id, currentVersion: built.handover.version, message: `备用箱容量不足，已排队并标记缺口 ${built.handover.capacityGap} 升（交接链 V${built.handover.version}）` }
      : { ok: true, handoverId: built.handover.id, currentVersion: built.handover.version, message: `交接已生效（交接链 V${built.handover.version}）：旧箱依据冻结，新箱 ${draft.toContainerId} 自 ${fmt(draft.handoverAt)} 续记` }
  },

  allocateSpare: (shipmentId, handoverId, spareId, baseVersion) => {
    const state = get()
    const shipment = state.shipments.find((item) => item.id === shipmentId)
    const handover = shipment?.handovers.find((item) => item.id === handoverId)
    if (!shipment || !handover) return { ok: false, message: '排队交接不存在' }
    if (handover.status !== '排队待箱') return { ok: false, message: '该交接已生效' }
    if (shipment.handoverVersion !== baseVersion) {
      return { ok: false, conflict: true, currentVersion: shipment.handoverVersion, message: `版本冲突：交接链已到 V${shipment.handoverVersion}，请刷新后重试` }
    }
    const spare = state.spares.find((item) => item.id === spareId)
    if (!spare) return { ok: false, message: '备用箱不存在' }
    if (spare.capacityFree < handover.requiredCapacity) {
      return { ok: false, queued: true, message: `${spare.id} 仍不足，缺口 ${handover.requiredCapacity - spare.capacityFree} 升，继续排队` }
    }
    // 实际交接时刻 = 排队登记后 15 分钟（演示用确定值），冻结与拆分以该时刻为准
    const effectiveAt = addMinutes(handover.handoverAt, 15)
    const draft: HandoverDraft = {
      airport: handover.airport, handoverAt: effectiveAt, toContainerId: spareId,
      requiredCapacity: handover.requiredCapacity, reason: `${handover.reason}；缺口调拨补齐`, operator: DEFAULT_OPERATOR
    }
    const built = buildHandover(state, shipment, draft, baseVersion, 'allocate', handoverId)
    if (!persistOrFail(built, state)) {
      return { ok: false, persistFailed: true, currentVersion: baseVersion, message: '落盘失败：缺口补齐未生效，仍停留在交接前排队状态，可重试' }
    }
    commitBuilt(set, built)
    return { ok: true, handoverId, currentVersion: built.handover.version, message: `缺口已补齐，交接生效（交接链 V${built.handover.version}），新箱 ${spareId} 自 ${fmt(effectiveAt)} 续记` }
  },

  restockSpare: (spareId, litres) => set((state) => ({
    spares: state.spares.map((item) => item.id === spareId ? { ...item, capacityFree: item.capacityFree + litres, status: '可用' as const } : item),
    audit: [makeAudit('', '备用箱补货', '中转场调度', `${spareId} 新增可用容量 ${litres} 升`), ...state.audit]
  })),

  armFailNextWrite: (armed) => {
    // 只切换模块级故障标记：不触发 store 写入，否则 persist 会把这次故障在交接前消耗掉
    failNextWrite = armed
  },

  reset: () => {
    failNextWrite = false
    set({ shipments: structuredClone(seedShipments), deviations: structuredClone(seedDeviations), audit: structuredClone(seedAudit), spares: structuredClone(seedSpareContainers), keyword: '', status: '全部' })
  }
}), {
  name: STORAGE_KEY,
  version: 2,
  storage: createJSONStorage(() => failingStorage),
  partialize: (state) => ({ shipments: state.shipments, deviations: state.deviations, audit: state.audit, spares: state.spares }) as ShipmentState
}))

/** 两阶段落盘预写：用与 persist 相同的信封/存储先写一次，失败即放弃整笔事务（内存状态保持交接前，可重试） */
function persistOrFail(built: { shipments: Shipment[]; deviations: Deviation[]; spares: SpareContainer[]; audit: AuditEntry[] }, state: ShipmentState): boolean {
  try {
    failingStorage.setItem(STORAGE_KEY, JSON.stringify({
      state: { shipments: built.shipments, deviations: built.deviations, spares: built.spares, audit: built.audit },
      version: 2
    }))
    return true
  } catch {
    // 故障仅消耗一次：保留内存中的交接前状态与用户草稿，再次提交即为正常落盘
    failNextWrite = false
    void state
    return false
  }
}

function commitBuilt(set: (partial: Partial<ShipmentState>) => void, built: BuiltHandover) {
  set({ shipments: built.shipments, deviations: built.deviations, spares: built.spares, audit: built.audit })
}
