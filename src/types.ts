export type ShipmentStatus = '待装机' | '运输中' | '待放行' | '已放行' | '已拒绝'
export type DeviationStatus = '待调查' | '调查中' | '待放行复核' | '已拆分' | '已关闭'
export type HandoverStatus = '排队中' | '待确认' | '已确认'

export interface TemperaturePoint {
  id: string
  time: string
  value: number
  containerId?: string
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

/** 箱段：一只温控箱在一个航段内的责任时段，交接时旧箱段冻结 */
export interface CustodyPeriod {
  id: string
  shipmentId: string
  segmentId: string
  containerId: string
  startedAt: string
  endedAt: string
  frozen: boolean
  frozenPoints?: TemperaturePoint[]
  frozenEvidenceIds?: string[]
}

/** 温控箱交接单：中转机场换箱的任务单，带容量校验与乐观版本 */
export interface ContainerHandover {
  id: string
  shipmentId: string
  segmentId: string
  station: string
  fromContainerId: string
  toContainerId: string
  requiredCapacity: number
  backupCapacity: number
  capacityGap: number
  status: HandoverStatus
  handoverAt: string
  operator: string
  note: string
  version: number
  createdAt: string
  confirmedAt: string
}

export interface BackupContainer {
  id: string
  station: string
  capacity: number
  status: '可用' | '占用' | '维修'
}

export interface EvidenceFile {
  id: string
  name: string
  category: '温度曲线' | '设备报告' | '包装确认' | '交接签字'
  version: number
  uploadedBy: string
  uploadedAt: string
  verified: boolean
  custodyId?: string
  containerId?: string
}

export interface ShipmentSignature {
  role: '发货方' | '承运方' | '收货方' | '放行人员'
  name: string
  status: '待签' | '已签' | '已退回'
  signedAt: string
  comment: string
}

export interface Shipment {
  id: string
  product: string
  batch: string
  route: string
  containerId: string
  tempMin: number
  tempMax: number
  plannedDeparture: string
  actualArrival: string
  status: ShipmentStatus
  segments: ShipmentSegment[]
  custody: CustodyPeriod[]
  handovers: ContainerHandover[]
  handoverVersion: number
  evidence: EvidenceFile[]
  signatures: ShipmentSignature[]
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
  cause: string
  assessment: string
  disposition: '接受' | '补充处理' | '拒绝'
  correctiveAction: string
  evidence: string
  reviewer: string
  reviewNote: string
  version: number
  parentId?: string
  custodyId?: string
  containerId?: string
  windowStart?: string
  windowEnd?: string
  periodStart?: string
  periodEnd?: string
}

export interface AuditEntry {
  id: string
  shipmentId: string
  action: string
  operator: string
  detail: string
  createdAt: string
}

/** 已拆分的父偏差由子偏差接续调查，本身不再拦截放行 */
export const isOpenDeviation = (deviation: Deviation) => deviation.status !== '已关闭' && deviation.status !== '已拆分'
