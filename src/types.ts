export type ShipmentStatus = '待装机' | '运输中' | '待放行' | '已放行' | '已拒绝'
export type DeviationStatus = '待调查' | '调查中' | '待放行复核' | '已关闭'
export type HandoverStatus = '已生效' | '排队待箱'

export interface TemperaturePoint {
  id: string
  time: string
  value: number
  /** 采集该温度点的温控箱号；交接冻结后随旧箱历史固化 */
  containerId: string
  /** 交接冻结的温度点只读，新箱从交接时刻后续记 */
  frozen?: boolean
}

export interface ShipmentSegment {
  id: string
  from: string
  to: string
  flight: string
  plannedStart: string
  actualStart: string
  actualEnd: string
  handler: string
  note: string
  temperature: TemperaturePoint[]
}

export interface EvidenceFile {
  id: string
  name: string
  category: '温度曲线' | '设备报告' | '包装确认' | '交接签字'
  version: number
  uploadedBy: string
  uploadedAt: string
  verified: boolean
  /** 证据归属的温控箱号 */
  containerId: string
  /** 交接时冻结的旧箱依据，不允许再核验或覆盖 */
  frozen?: boolean
  /** 交接冻结时的快照说明 */
  frozenAt?: string
  frozenHandoverId?: string
}

export interface ShipmentSignature {
  role: '发货方' | '承运方' | '收货方' | '放行人员'
  name: string
  status: '待签' | '已签' | '已退回'
  signedAt: string
  comment: string
}

/** 备用温控箱池 */
export interface SpareContainer {
  id: string
  station: string
  /** 可用容积（升） */
  capacityFree: number
  /** 温区是否与任务匹配 */
  tempRangeOk: boolean
  status: '可用' | '补货中'
}

/**
 * 温控箱交接：把任务、旧箱读数/证据与新箱续记接成一条链。
 * 生效交接冻结旧箱依据；容量不足时排队并标缺口。
 */
export interface ContainerHandover {
  id: string
  shipmentId: string
  /** 序号从1开始，全任务交接链共用一个递增版本 */
  seq: number
  airport: string
  handoverAt: string
  fromContainerId: string
  toContainerId: string
  /** 新箱需要的容积（升） */
  requiredCapacity: number
  /** 备用箱实际可提供容积，不足时记入缺口 */
  allocatedCapacity: number
  capacityGap: number
  status: HandoverStatus
  reason: string
  operator: string
  /** 冻结的旧箱温度点数量 */
  frozenPointCount: number
  /** 冻结的旧箱证据数量 */
  frozenEvidenceCount: number
  /** 因本次交接拆开的跨箱偏差ID */
  splitDeviationIds: string[]
  /** 乐观锁：提交时任务必须处于该交接版本 */
  baseVersion: number
  version: number
  confirmedAt: string
  fulfilledAt?: string
  queuedNote?: string
}

export interface Shipment {
  id: string
  product: string
  batch: string
  route: string
  containerId: string
  /** 货物需要的温控箱容积（升） */
  cargoVolume: number
  tempMin: number
  tempMax: number
  plannedDeparture: string
  actualArrival: string
  status: ShipmentStatus
  segments: ShipmentSegment[]
  evidence: EvidenceFile[]
  signatures: ShipmentSignature[]
  /** 温控箱交接链，按交接时刻排序 */
  handovers: ContainerHandover[]
  /** 交接链版本：每次交接确认（含排队、缺口补齐）+1，各页显示同一版本 */
  handoverVersion: number
  version: number
  updatedAt: string
}

export interface Deviation {
  id: string
  shipmentId: string
  segmentId: string
  title: string
  source: '自动监测' | '人工报告'
  severity: '一般' | '重大'
  status: DeviationStatus
  owner: string
  openedAt: string
  dueDate: string
  /** 偏差覆盖的温度时段（ISO），用于跨交接按责任时段拆分 */
  startTime: string
  endTime: string
  /** 责任温控箱号 */
  containerId: string
  /** 由跨箱偏差拆分产生 */
  splitFromId?: string
  /** 责任时段：交接时刻/拆分时间 */
  periodStart: string
  periodEnd: string
  /** 旧箱责任片段在交接时冻结，保留历史但不再随新箱续记 */
  frozen?: boolean
  frozenHandoverId?: string
  cause: string
  assessment: string
  disposition: '接受' | '补充处理' | '拒绝'
  correctiveAction: string
  evidence: string
  reviewer: string
  reviewNote: string
  version: number
}

export interface AuditEntry {
  id: string
  shipmentId: string
  action: string
  operator: string
  detail: string
  /** 事件对应的交接链版本，保证审计页与其他页同版本 */
  handoverVersion?: number
  createdAt: string
}
