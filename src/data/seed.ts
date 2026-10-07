import type { AuditEntry, BackupContainer, CustodyPeriod, Deviation, Shipment, ShipmentSegment, TemperaturePoint } from '../types'

const series = (base: number, pattern: number[], containerId: string): TemperaturePoint[] => pattern.map((value, index) => ({
  id: `T-${index}`,
  time: `2026-09-29T${String(6 + Math.floor(index / 2)).padStart(2, '0')}:${index % 2 ? '30' : '00'}:00`,
  value: base + value,
  containerId
}))

const pts = (date: string, list: [string, number][], containerId: string): TemperaturePoint[] =>
  list.map(([clock, value], index) => ({ id: `T-${date}-${clock.replace(':', '')}-${index}`, time: `${date}T${clock}:00`, value, containerId }))

/** 交接时刻前的读数归旧箱，交接时刻起归新箱 */
const attribute = (points: TemperaturePoint[], at: string, from: string, to: string): TemperaturePoint[] =>
  points.map((point) => ({ ...point, containerId: point.time < at ? from : to }))

/** 无交接任务默认一箱到底的交接链 */
const chainFromSegments = (shipmentId: string, segments: ShipmentSegment[], containerId: string, prefix: string): CustodyPeriod[] =>
  segments.map((segment, index) => ({
    id: `${prefix}${index + 1}`, shipmentId, segmentId: segment.id, containerId,
    startedAt: segment.actualStart || segment.plannedStart, endedAt: segment.actualEnd, frozen: false
  }))

const air1Segments: ShipmentSegment[] = [
  { id: 'SEG-1', from: '上海医药仓库', to: '浦东机场货站', flight: '陆运', plannedStart: '2026-09-29T04:30:00', actualStart: '2026-09-29T04:36:00', actualEnd: '2026-09-29T05:22:00', handler: '张骁', note: '预冷至4.2℃后装车', temperature: series(3.8, [0, .2, .4, .7, .5, .3, .1, .2, .4, .6, .5, .3], 'RKN-44018') },
  { id: 'SEG-2', from: '浦东机场货站', to: 'CDG货站', flight: 'AF111', plannedStart: '2026-09-29T06:00:00', actualStart: '2026-09-29T06:42:00', actualEnd: '2026-09-29T18:30:00', handler: '法航货运', note: '中转停留2小时，外包装完整', temperature: series(4.1, [0, .3, .5, .2, -.2, -.5, -.8, -.4, .1, .8, 1.3, 1.7, 1.9, 1.4, .7, .2, -.1, .3], 'RKN-44018') },
  { id: 'SEG-3', from: 'CDG货站', to: '巴黎中心仓', flight: '陆运', plannedStart: '2026-09-29T18:30:00', actualStart: '2026-09-29T19:05:00', actualEnd: '2026-09-29T20:20:00', handler: 'L. Martin', note: '交接时箱体指示灯正常', temperature: series(4.5, [0, .4, .8, 1.2, .9, .5, .2, -.1, -.2, .1], 'RKN-44018') }
]

const air2Segments: ShipmentSegment[] = [
  { id: 'SEG-1', from: '北京实验室', to: '首都机场', flight: '陆运', plannedStart: '2026-09-29T07:00:00', actualStart: '2026-09-29T07:12:00', actualEnd: '2026-09-29T08:05:00', handler: '苏晴', note: '干冰余量复核', temperature: series(4.2, [0, .3, .6, .8, .5, .2], 'CRT-9207') },
  { id: 'SEG-2', from: '首都机场', to: '羽田机场', flight: 'NH964', plannedStart: '2026-09-29T09:30:00', actualStart: '2026-09-29T10:05:00', actualEnd: '2026-09-29T14:10:00', handler: '全日空货运', note: '货舱温度短时偏高', temperature: series(5.8, [0, .9, 1.8, 2.4, 3.1, 4.4, 3.2, 1.8, .7, .2], 'CRT-9207') }
]

const AIR3_HANDOVER_AT = '2026-09-29T18:30:00'
const air3Segments: ShipmentSegment[] = [
  { id: 'SEG-1', from: '疫苗冷库', to: '浦东机场货站', flight: '陆运', plannedStart: '2026-09-29T02:00:00', actualStart: '2026-09-29T02:10:00', actualEnd: '2026-09-29T03:05:00', handler: '赵敏', note: '预冷4.0℃装车', temperature: series(4.0, [0, .1, .3, .2, .4, .3, .2, .1], 'RKN-31880') },
  { id: 'SEG-2', from: '浦东机场', to: '法兰克福机场', flight: 'CA1043', plannedStart: '2026-09-29T04:00:00', actualStart: '2026-09-29T04:05:00', actualEnd: '2026-09-29T16:20:00', handler: '国航货运', note: '全程温控正常', temperature: series(4.2, [0, .2, .4, .3, .1, -.1, .2, .4, .3, .2, 0, .1], 'RKN-31880') },
  {
    id: 'SEG-3', from: '法兰克福机场T1货站', to: '法兰克福机场T2货站', flight: '地面转运', plannedStart: '2026-09-29T16:20:00', actualStart: '2026-09-29T16:20:00', actualEnd: '2026-09-29T22:00:00', handler: 'FRA地面代理', note: '旧箱机组报警，18:30换备用箱',
    temperature: attribute(pts('2026-09-29', [['16:20', 4.6], ['16:40', 4.7], ['17:00', 4.9], ['17:20', 5.3], ['17:40', 6.0], ['18:00', 7.0], ['18:20', 8.1], ['18:40', 9.2], ['19:00', 8.8], ['19:20', 8.4], ['19:40', 7.6], ['20:00', 6.8], ['20:20', 6.0], ['20:40', 5.4], ['21:00', 4.9], ['21:20', 4.6], ['21:40', 4.4], ['22:00', 4.3]], ''), AIR3_HANDOVER_AT, 'RKN-31880', 'RKN-55201')
  },
  { id: 'SEG-4', from: '法兰克福机场', to: '芝加哥奥黑尔', flight: 'UA907', plannedStart: '2026-09-29T23:00:00', actualStart: '2026-09-29T23:05:00', actualEnd: '', handler: '美联航货运', note: '新箱随机温控', temperature: series(4.4, [0, .2, .4, .3, .1, -.1, 0, .2], 'RKN-55201') }
]

const AIR4_HANDOVER_AT = '2026-10-07T09:30:00'
const air4Segments: ShipmentSegment[] = [
  { id: 'SEG-1', from: '药企冷库', to: '首都机场货站', flight: '陆运', plannedStart: '2026-10-06T22:00:00', actualStart: '2026-10-06T22:06:00', actualEnd: '2026-10-06T23:05:00', handler: '王强', note: '冷藏车直发货站', temperature: pts('2026-10-06', [['22:06', 3.9], ['22:20', 4.1], ['22:35', 4.3], ['22:50', 4.2], ['23:05', 4.4]], 'RKN-77410') },
  { id: 'SEG-2', from: '首都机场', to: '新加坡樟宜', flight: 'SQ801', plannedStart: '2026-10-07T00:10:00', actualStart: '2026-10-07T00:25:00', actualEnd: '2026-10-07T06:40:00', handler: '新航货运', note: '宽体货舱温控', temperature: pts('2026-10-07', [['00:25', 4.4], ['01:30', 4.7], ['02:30', 4.9], ['03:30', 4.6], ['04:30', 4.2], ['05:30', 4.5], ['06:40', 4.7]], 'RKN-77410') },
  {
    id: 'SEG-3', from: '樟宜机场T2货站', to: '樟宜机场T3货站', flight: '地面转运', plannedStart: '2026-10-07T06:40:00', actualStart: '2026-10-07T06:55:00', actualEnd: '', handler: '樟宜地面代理', note: '旧箱压缩机异响，等待换备用箱',
    temperature: pts('2026-10-07', [['06:55', 4.8], ['07:20', 5.2], ['07:45', 5.8], ['08:10', 6.5], ['08:35', 7.3], ['09:00', 8.2], ['09:25', 8.8], ['09:50', 8.4], ['10:15', 7.6]], 'RKN-77410')
  },
  { id: 'SEG-4', from: '樟宜机场', to: '悉尼金斯福德', flight: 'SQ231', plannedStart: '2026-10-07T12:00:00', actualStart: '', actualEnd: '', handler: '新航货运', note: '计划续程', temperature: [] }
]

export const seedShipments: Shipment[] = [
  {
    id: 'AIR-260929-01', product: '单克隆抗体注射液', batch: 'MAB-260927', route: '上海浦东 PVG → 巴黎 CDG', containerId: 'RKN-44018',
    tempMin: 2, tempMax: 8, plannedDeparture: '2026-09-29T06:00:00', actualArrival: '2026-09-29T06:00:00', status: '待放行', version: 5, updatedAt: '2026-09-29T10:10:00',
    segments: air1Segments,
    custody: chainFromSegments('AIR-260929-01', air1Segments, 'RKN-44018', 'CUST-10'),
    handovers: [], handoverVersion: 1,
    evidence: [
      { id: 'E-1', name: 'RKN-44018原始温度记录.csv', category: '温度曲线', version: 1, uploadedBy: '系统', uploadedAt: '2026-09-29T20:32:00', verified: true, custodyId: 'CUST-103', containerId: 'RKN-44018' },
      { id: 'E-2', name: 'AF111装机确认.pdf', category: '设备报告', version: 2, uploadedBy: '法航货运', uploadedAt: '2026-09-29T06:50:00', verified: true, custodyId: 'CUST-102', containerId: 'RKN-44018' },
      { id: 'E-3', name: '巴黎中心仓交接单.jpg', category: '交接签字', version: 1, uploadedBy: 'L. Martin', uploadedAt: '2026-09-29T20:25:00', verified: false, custodyId: 'CUST-103', containerId: 'RKN-44018' }
    ],
    signatures: [
      { role: '发货方', name: '张骁', status: '已签', signedAt: '2026-09-29T05:30:00', comment: '包装与预冷符合要求' },
      { role: '承运方', name: '法航货运', status: '已签', signedAt: '2026-09-29T19:12:00', comment: '航段交接无异常' },
      { role: '收货方', name: 'L. Martin', status: '已签', signedAt: '2026-09-29T20:30:00', comment: '外包装完整，箱体数据已核' },
      { role: '放行人员', name: '顾言', status: '待签', signedAt: '', comment: '' }
    ]
  },
  {
    id: 'AIR-260929-02', product: '细胞治疗样本', batch: 'CELL-260929', route: '北京首都 PEK → 东京羽田 HND', containerId: 'CRT-9207',
    tempMin: 2, tempMax: 10, plannedDeparture: '2026-09-29T09:30:00', actualArrival: '2026-09-29T09:30:00', status: '待放行', version: 4, updatedAt: '2026-09-29T17:40:00',
    segments: air2Segments,
    custody: chainFromSegments('AIR-260929-02', air2Segments, 'CRT-9207', 'CUST-20'),
    handovers: [], handoverVersion: 1,
    evidence: [
      { id: 'E-4', name: 'CRT-9207温度曲线.xlsx', category: '温度曲线', version: 1, uploadedBy: '系统', uploadedAt: '2026-09-29T17:12:00', verified: true, custodyId: 'CUST-202', containerId: 'CRT-9207' },
      { id: 'E-5', name: '货舱温控说明.pdf', category: '设备报告', version: 1, uploadedBy: '全日空货运', uploadedAt: '2026-09-29T17:20:00', verified: false, custodyId: 'CUST-202', containerId: 'CRT-9207' }
    ],
    signatures: [
      { role: '发货方', name: '苏晴', status: '已签', signedAt: '2026-09-29T08:10:00', comment: '样本封箱完成' },
      { role: '承运方', name: '全日空货运', status: '已签', signedAt: '2026-09-29T14:30:00', comment: '温度波动已报告' },
      { role: '收货方', name: '佐藤健', status: '待签', signedAt: '', comment: '' },
      { role: '放行人员', name: '顾言', status: '待签', signedAt: '', comment: '' }
    ]
  },
  {
    id: 'AIR-260929-03', product: '流感疫苗', batch: 'FLU-260928', route: '上海浦东 PVG → 法兰克福 FRA → 芝加哥 ORD', containerId: 'RKN-55201',
    tempMin: 2, tempMax: 8, plannedDeparture: '2026-09-29T04:00:00', actualArrival: '', status: '运输中', version: 6, updatedAt: '2026-09-29T18:36:00',
    segments: air3Segments,
    custody: [
      { id: 'CUST-301', shipmentId: 'AIR-260929-03', segmentId: 'SEG-1', containerId: 'RKN-31880', startedAt: '2026-09-29T02:10:00', endedAt: '2026-09-29T03:05:00', frozen: true, frozenPoints: air3Segments[0].temperature, frozenEvidenceIds: [] },
      { id: 'CUST-302', shipmentId: 'AIR-260929-03', segmentId: 'SEG-2', containerId: 'RKN-31880', startedAt: '2026-09-29T04:05:00', endedAt: '2026-09-29T16:20:00', frozen: true, frozenPoints: air3Segments[1].temperature, frozenEvidenceIds: ['E-6'] },
      { id: 'CUST-303', shipmentId: 'AIR-260929-03', segmentId: 'SEG-3', containerId: 'RKN-31880', startedAt: '2026-09-29T16:20:00', endedAt: AIR3_HANDOVER_AT, frozen: true, frozenPoints: air3Segments[2].temperature.filter((point) => point.time < AIR3_HANDOVER_AT), frozenEvidenceIds: ['E-8'] },
      { id: 'CUST-304', shipmentId: 'AIR-260929-03', segmentId: 'SEG-3', containerId: 'RKN-55201', startedAt: AIR3_HANDOVER_AT, endedAt: '2026-09-29T22:00:00', frozen: false },
      { id: 'CUST-305', shipmentId: 'AIR-260929-03', segmentId: 'SEG-4', containerId: 'RKN-55201', startedAt: '2026-09-29T23:05:00', endedAt: '', frozen: false }
    ],
    handovers: [
      { id: 'HO-260929-01', shipmentId: 'AIR-260929-03', segmentId: 'SEG-3', station: '法兰克福机场', fromContainerId: 'RKN-31880', toContainerId: 'RKN-55201', requiredCapacity: 3.2, backupCapacity: 4.5, capacityGap: 0, status: '已确认', handoverAt: AIR3_HANDOVER_AT, operator: 'FRA地面代理 穆勒', note: '旧箱制冷机组报警，启用备用箱', version: 2, createdAt: '2026-09-29T17:55:00', confirmedAt: '2026-09-29T18:34:00' }
    ],
    handoverVersion: 2,
    evidence: [
      { id: 'E-6', name: 'RKN-31880全程温度记录.csv', category: '温度曲线', version: 1, uploadedBy: '系统', uploadedAt: '2026-09-29T16:25:00', verified: true, custodyId: 'CUST-302', containerId: 'RKN-31880' },
      { id: 'E-7', name: 'FRA温控箱交接单-RKN-55201.pdf', category: '交接签字', version: 1, uploadedBy: 'FRA地面代理 穆勒', uploadedAt: '2026-09-29T18:36:00', verified: true, custodyId: 'CUST-304', containerId: 'RKN-55201' },
      { id: 'E-8', name: 'RKN-31880机组报警记录.pdf', category: '设备报告', version: 1, uploadedBy: 'FRA地面代理 穆勒', uploadedAt: '2026-09-29T17:50:00', verified: true, custodyId: 'CUST-303', containerId: 'RKN-31880' }
    ],
    signatures: [
      { role: '发货方', name: '赵敏', status: '已签', signedAt: '2026-09-29T03:20:00', comment: '疫苗出库复核完成' },
      { role: '承运方', name: '国航货运', status: '已签', signedAt: '2026-09-29T16:30:00', comment: '到港交接，旧箱报警已告知地面' },
      { role: '收货方', name: '芝加哥仓 艾伦', status: '待签', signedAt: '', comment: '' },
      { role: '放行人员', name: '顾言', status: '待签', signedAt: '', comment: '' }
    ]
  },
  {
    id: 'AIR-261007-01', product: '门冬胰岛素注射液', batch: 'INS-261005', route: '北京首都 PEK → 新加坡 SIN → 悉尼 SYD', containerId: 'RKN-77410',
    tempMin: 2, tempMax: 8, plannedDeparture: '2026-10-07T00:10:00', actualArrival: '', status: '运输中', version: 3, updatedAt: '2026-10-07T09:05:00',
    segments: air4Segments,
    custody: chainFromSegments('AIR-261007-01', air4Segments, 'RKN-77410', 'CUST-40'),
    handovers: [
      { id: 'HO-261007-01', shipmentId: 'AIR-261007-01', segmentId: 'SEG-3', station: '新加坡樟宜机场', fromContainerId: 'RKN-77410', toContainerId: 'RKN-88312', requiredCapacity: 2.6, backupCapacity: 1.8, capacityGap: 0.8, status: '排队中', handoverAt: AIR4_HANDOVER_AT, operator: '樟宜地面代理 陈凯', note: '旧箱压缩机异响，申请换箱', version: 1, createdAt: '2026-10-07T08:50:00', confirmedAt: '' }
    ],
    handoverVersion: 1,
    evidence: [
      { id: 'E-9', name: 'RKN-77410温度曲线.xlsx', category: '温度曲线', version: 1, uploadedBy: '系统', uploadedAt: '2026-10-07T09:05:00', verified: true, custodyId: 'CUST-403', containerId: 'RKN-77410' },
      { id: 'E-10', name: 'RKN-77410压缩机检查单.pdf', category: '设备报告', version: 1, uploadedBy: '樟宜地面代理 陈凯', uploadedAt: '2026-10-07T08:40:00', verified: false, custodyId: 'CUST-403', containerId: 'RKN-77410' }
    ],
    signatures: [
      { role: '发货方', name: '王强', status: '已签', signedAt: '2026-10-06T23:10:00', comment: '冷链车交接完成' },
      { role: '承运方', name: '新航货运', status: '待签', signedAt: '', comment: '' },
      { role: '收货方', name: '悉尼仓 未指派', status: '待签', signedAt: '', comment: '' },
      { role: '放行人员', name: '顾言', status: '待签', signedAt: '', comment: '' }
    ]
  }
]

export const seedBackupContainers: BackupContainer[] = [
  { id: 'RKN-88312', station: '新加坡樟宜机场', capacity: 1.8, status: '可用' },
  { id: 'RKN-88320', station: '新加坡樟宜机场', capacity: 3.0, status: '可用' },
  { id: 'RKN-88321', station: '新加坡樟宜机场', capacity: 2.4, status: '维修' },
  { id: 'RKN-55201', station: '法兰克福机场', capacity: 4.5, status: '占用' },
  { id: 'RKN-55202', station: '法兰克福机场', capacity: 2.0, status: '可用' }
]

export const seedDeviations: Deviation[] = [
  {
    id: 'TDEV-260929-01', shipmentId: 'AIR-260929-02', segmentId: 'SEG-2', title: '航段温度最高达到10.4℃', source: '自动监测', severity: '重大', status: '调查中', owner: '温控质量组', openedAt: '2026-09-29T14:05:00', dueDate: '2026-09-29', version: 3,
    cause: '航班临时调整至非温控货舱，转运时开门时间延长。', assessment: '超限约18分钟，样本稳定性研究显示可承受30分钟内偏差，但需收货方确认。', disposition: '补充处理', correctiveAction: '收货方完成外观和温度标签复核后决定是否接收。', evidence: '温度原始曲线、航班货舱变更通知、地面操作记录。', reviewer: '', reviewNote: ''
  },
  {
    id: 'TDEV-260929-02', shipmentId: 'AIR-260929-03', segmentId: 'SEG-3', title: '中转停留温度升至9.2℃', source: '自动监测', severity: '重大', status: '已拆分', owner: '温控质量组', openedAt: '2026-09-29T17:45:00', dueDate: '2026-09-30', version: 2,
    cause: '中转停留期间旧箱RKN-31880制冷机组报警，箱内温度持续上升。', assessment: '超限横跨18:30换箱交接，已按责任时段拆分。', disposition: '补充处理', correctiveAction: '', evidence: '旧箱冻结读数、交接单HO-260929-01。', reviewer: '', reviewNote: '',
    windowStart: '2026-09-29T17:40:00', windowEnd: '2026-09-29T19:10:00'
  },
  {
    id: 'TDEV-260929-02-A', shipmentId: 'AIR-260929-03', segmentId: 'SEG-3', title: '中转停留温度升至9.2℃｜旧箱RKN-31880责任时段', source: '自动监测', severity: '重大', status: '调查中', owner: '温控质量组', openedAt: '2026-09-29T17:45:00', dueDate: '2026-09-30', version: 1,
    cause: '旧箱RKN-31880制冷机组报警，换箱前温度由6.0℃升至9.2℃。', assessment: '旧箱责任时段超限约50分钟，疫苗稳定性数据待评估。', disposition: '补充处理', correctiveAction: '', evidence: '旧箱冻结读数7点（16:20-18:20）已随交接保留。', reviewer: '', reviewNote: '',
    parentId: 'TDEV-260929-02', custodyId: 'CUST-303', containerId: 'RKN-31880', periodStart: '2026-09-29T17:40:00', periodEnd: AIR3_HANDOVER_AT, windowStart: '2026-09-29T17:40:00', windowEnd: '2026-09-29T19:10:00'
  },
  {
    id: 'TDEV-260929-02-B', shipmentId: 'AIR-260929-03', segmentId: 'SEG-3', title: '中转停留温度升至9.2℃｜新箱RKN-55201责任时段', source: '自动监测', severity: '重大', status: '待调查', owner: '温控质量组', openedAt: '2026-09-29T18:34:00', dueDate: '2026-09-30', version: 1,
    cause: '', assessment: '', disposition: '补充处理', correctiveAction: '', evidence: '', reviewer: '', reviewNote: '',
    parentId: 'TDEV-260929-02', custodyId: 'CUST-304', containerId: 'RKN-55201', periodStart: AIR3_HANDOVER_AT, periodEnd: '2026-09-29T19:10:00', windowStart: '2026-09-29T17:40:00', windowEnd: '2026-09-29T19:10:00'
  },
  {
    id: 'TDEV-261007-01', shipmentId: 'AIR-261007-01', segmentId: 'SEG-3', title: '中转停留温度升至8.8℃', source: '自动监测', severity: '一般', status: '待调查', owner: '温控质量组', openedAt: '2026-10-07T09:05:00', dueDate: '2026-10-08', version: 1,
    cause: '', assessment: '', disposition: '补充处理', correctiveAction: '', evidence: '', reviewer: '', reviewNote: '',
    windowStart: '2026-10-07T08:35:00', windowEnd: '2026-10-07T10:15:00'
  }
]

export const seedAudit: AuditEntry[] = [
  { id: 'A65-1', shipmentId: 'AIR-260929-01', action: '任务创建', operator: '张骁', detail: '关联3个航段和4类证据要求', createdAt: '2026-09-29T04:10:00' },
  { id: 'A65-2', shipmentId: 'AIR-260929-02', action: '自动创建偏差', operator: '温度监测系统', detail: 'SEG-2温度10.4℃超出2-10℃范围', createdAt: '2026-09-29T14:05:00' },
  { id: 'A65-3', shipmentId: 'AIR-260929-02', action: '提交偏差调查', operator: '温控质量组', detail: '补充处理分支，等待收货方稳定性确认', createdAt: '2026-09-29T16:40:00' },
  { id: 'A65-4', shipmentId: 'AIR-260929-03', action: '发起温控箱交接', operator: 'FRA地面代理 穆勒', detail: 'RKN-31880 → RKN-55201 @法兰克福机场', createdAt: '2026-09-29T17:55:00' },
  { id: 'A65-5', shipmentId: 'AIR-260929-03', action: '确认温控箱交接', operator: 'FRA地面代理 穆勒', detail: '交接单V2落盘，交接版本升至V2', createdAt: '2026-09-29T18:34:00' },
  { id: 'A65-6', shipmentId: 'AIR-260929-03', action: '冻结旧箱依据', operator: '系统', detail: 'RKN-31880读数与关联证据已冻结，新箱RKN-55201自18:30续记', createdAt: '2026-09-29T18:34:00' },
  { id: 'A65-7', shipmentId: 'AIR-260929-03', action: '拆分跨交接偏差', operator: '系统', detail: 'TDEV-260929-02按责任时段拆分为旧箱/新箱两段，旧箱历史保留', createdAt: '2026-09-29T18:34:00' },
  { id: 'A65-8', shipmentId: 'AIR-261007-01', action: '发起温控箱交接', operator: '樟宜地面代理 陈凯', detail: '备用箱RKN-88312容量1.8m³不足所需2.6m³，交接排队，缺口0.8m³', createdAt: '2026-10-07T08:50:00' },
  { id: 'A65-9', shipmentId: 'AIR-261007-01', action: '自动创建偏差', operator: '温度监测系统', detail: 'SEG-3温度8.8℃超出2-8℃范围', createdAt: '2026-10-07T09:05:00' }
]
