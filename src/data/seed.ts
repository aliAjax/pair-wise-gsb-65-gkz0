import type { AuditEntry, Deviation, Shipment, SpareContainer, TemperaturePoint } from '../types'

const point = (id: string, time: string, value: number, containerId: string, frozen = false): TemperaturePoint => ({ id, time, value, containerId, frozen: frozen || undefined })

/** 旧箱 RKN-44018 航段读数（交接时刻前，已冻结） */
const oldBoxSeries = (base: number, pattern: number[], containerId: string, dayHour: [number, number], prefix: string): TemperaturePoint[] =>
  pattern.map((delta, index) => {
    const total = (dayHour[1] + index * 30)
    const hour = dayHour[0] + Math.floor(total / 60)
    const minute = total % 60
    return point(`${prefix}-T${String(index + 1).padStart(2, '0')}`, `2026-09-29T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`, base + delta, containerId, true)
  })

/** 新箱 RKN-55207 从交接时刻后续记（未冻结） */
const newBoxSeries = (base: number, pattern: number[], containerId: string, startHour: number, startMinute: number, prefix: string): TemperaturePoint[] =>
  pattern.map((delta, index) => {
    const total = startHour * 60 + startMinute + index * 30
    const hour = Math.floor(total / 60)
    const minute = total % 60
    return point(`${prefix}-T${String(index + 1).padStart(2, '0')}`, `2026-09-29T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`, base + delta, containerId)
  })

const HANDOVER_AT = '2026-09-29T05:25:00'

export const seedSpareContainers: SpareContainer[] = [
  { id: 'RKN-55207', station: 'PVG 浦东中转场', capacityFree: 680, tempRangeOk: true, status: '可用' },
  { id: 'RKN-55211', station: 'PVG 浦东中转场', capacityFree: 420, tempRangeOk: true, status: '补货中' },
  { id: 'CRT-9208', station: 'PEK 首都转运站', capacityFree: 260, tempRangeOk: true, status: '可用' },
  { id: 'CRT-9209', station: 'PEK 首都转运站', capacityFree: 180, tempRangeOk: true, status: '可用' }
]

export const seedShipments: Shipment[] = [
  {
    id: 'AIR-260929-01', product: '单克隆抗体注射液', batch: 'MAB-260927', route: '上海浦东 PVG → 巴黎 CDG', containerId: 'RKN-55207', cargoVolume: 620,
    tempMin: 2, tempMax: 8, plannedDeparture: '2026-09-29T06:00:00', actualArrival: '2026-09-29T06:00:00', status: '待放行', handoverVersion: 2, version: 5, updatedAt: '2026-09-29T10:10:00',
    segments: [
      {
        id: 'SEG-1', from: '上海医药仓库', to: '浦东机场货站', flight: '陆运', plannedStart: '2026-09-29T04:30:00', actualStart: '2026-09-29T04:36:00', actualEnd: '2026-09-29T05:22:00', handler: '张骁', note: '预冷至4.2℃后装车，旧箱 RKN-44018 读数',
        temperature: oldBoxSeries(3.8, [0, .2, .4, .7, .5, .3, .1, .2, .4, .6, .5, .3], 'RKN-44018', [4, 30], 'S1')
      },
      {
        id: 'SEG-2', from: '浦东机场货站', to: 'CDG货站', flight: 'AF111', plannedStart: '2026-09-29T06:00:00', actualStart: '2026-09-29T06:42:00', actualEnd: '2026-09-29T18:30:00', handler: '法航货运', note: '中转停留2小时；05:25 换箱 RKN-44018 → RKN-55207，前段超限旧箱担责',
        // 交接前两个点仍是旧箱（换机坪等待期间的残留读数），之后全部新箱续记
        temperature: [
          ...oldBoxSeries(8.4, [.2, .5], 'RKN-44018', [5, 0], 'S2OLD'),
          ...newBoxSeries(4.6, [-.3, -.6, -.4, .1, .3, .2, -.1, -.4, -.2, .1, .3, .5, .4, .2, .1, .3], 'RKN-55207', 6, 0, 'S2NEW')
        ]
      },
      {
        id: 'SEG-3', from: 'CDG货站', to: '巴黎中心仓', flight: '陆运', plannedStart: '2026-09-29T18:30:00', actualStart: '2026-09-29T19:05:00', actualEnd: '2026-09-29T20:20:00', handler: 'L. Martin', note: '新箱 RKN-55207 指示灯正常',
        temperature: newBoxSeries(4.5, [0, .4, .8, 1.2, .9, .5, .2, -.1, -.2, .1], 'RKN-55207', 19, 5, 'S3')
      }
    ],
    evidence: [
      { id: 'E-1', name: 'RKN-44018原始温度记录.csv', category: '温度曲线', version: 1, uploadedBy: '系统', uploadedAt: '2026-09-29T05:26:00', verified: true, containerId: 'RKN-44018', frozen: true, frozenAt: HANDOVER_AT, frozenHandoverId: 'HO-260929-01' },
      { id: 'E-2', name: 'RKN-44018设备出场报告.pdf', category: '设备报告', version: 1, uploadedBy: '法航货运', uploadedAt: '2026-09-29T05:26:00', verified: true, containerId: 'RKN-44018', frozen: true, frozenAt: HANDOVER_AT, frozenHandoverId: 'HO-260929-01' },
      { id: 'E-3', name: 'RKN-55207换箱交接签字.jpg', category: '交接签字', version: 2, uploadedBy: '中转值班员 何琳', uploadedAt: '2026-09-29T05:28:00', verified: false, containerId: 'RKN-55207' },
      { id: 'E-4', name: 'RKN-55207续记温度曲线.csv', category: '温度曲线', version: 2, uploadedBy: '系统', uploadedAt: '2026-09-29T20:32:00', verified: true, containerId: 'RKN-55207' }
    ],
    signatures: [
      { role: '发货方', name: '张骁', status: '已签', signedAt: '2026-09-29T05:30:00', comment: '包装与预冷符合要求，换箱后封签完好' },
      { role: '承运方', name: '法航货运', status: '已签', signedAt: '2026-09-29T19:12:00', comment: '航段交接无异常，跨箱偏差已按箱拆分' },
      { role: '收货方', name: 'L. Martin', status: '已签', signedAt: '2026-09-29T20:30:00', comment: '外包装完整，新箱数据已核' },
      { role: '放行人员', name: '顾言', status: '待签', signedAt: '', comment: '' }
    ],
    handovers: [
      {
        id: 'HO-260929-01', shipmentId: 'AIR-260929-01', seq: 1, airport: 'PVG 浦东机场中转坪', handoverAt: HANDOVER_AT,
        fromContainerId: 'RKN-44018', toContainerId: 'RKN-55207', requiredCapacity: 620, allocatedCapacity: 680, capacityGap: 0,
        status: '已生效', reason: '旧箱制冷告警，中转场按预案更换同温区备用箱', operator: '中转值班员 何琳',
        frozenPointCount: 14, frozenEvidenceCount: 2, splitDeviationIds: ['TDEV-260929-02', 'TDEV-260929-03'],
        baseVersion: 1, version: 2, confirmedAt: HANDOVER_AT
      }
    ]
  },
  {
    id: 'AIR-260929-02', product: '细胞治疗样本', batch: 'CELL-260929', route: '北京首都 PEK → 东京羽田 HND', containerId: 'CRT-9207', cargoVolume: 240,
    tempMin: 2, tempMax: 10, plannedDeparture: '2026-09-29T09:30:00', actualArrival: '2026-09-29T09:30:00', status: '待放行', handoverVersion: 0, version: 4, updatedAt: '2026-09-29T17:40:00',
    segments: [
      { id: 'SEG-1', from: '北京实验室', to: '首都机场', flight: '陆运', plannedStart: '2026-09-29T07:00:00', actualStart: '2026-09-29T07:12:00', actualEnd: '2026-09-29T08:05:00', handler: '苏晴', note: '干冰余量复核', temperature: newBoxSeries(4.2, [0, .3, .6, .8, .5, .2], 'CRT-9207', 7, 12, 'B1') },
      { id: 'SEG-2', from: '首都机场', to: '羽田机场', flight: 'NH964', plannedStart: '2026-09-29T09:30:00', actualStart: '2026-09-29T10:05:00', actualEnd: '2026-09-29T14:10:00', handler: '全日空货运', note: '货舱温度短时偏高', temperature: newBoxSeries(5.8, [0, .9, 1.8, 2.4, 3.1, 4.4, 3.2, 1.8, .7, .2], 'CRT-9207', 10, 5, 'B2') }
    ],
    evidence: [
      { id: 'E-5', name: 'CRT-9207温度曲线.xlsx', category: '温度曲线', version: 1, uploadedBy: '系统', uploadedAt: '2026-09-29T17:12:00', verified: true, containerId: 'CRT-9207' },
      { id: 'E-6', name: '货舱温控说明.pdf', category: '设备报告', version: 1, uploadedBy: '全日空货运', uploadedAt: '2026-09-29T17:20:00', verified: false, containerId: 'CRT-9207' }
    ],
    signatures: [
      { role: '发货方', name: '苏晴', status: '已签', signedAt: '2026-09-29T08:10:00', comment: '样本封箱完成' },
      { role: '承运方', name: '全日空货运', status: '已签', signedAt: '2026-09-29T14:30:00', comment: '温度波动已报告' },
      { role: '收货方', name: '佐藤健', status: '待签', signedAt: '', comment: '' },
      { role: '放行人员', name: '顾言', status: '待签', signedAt: '', comment: '' }
    ],
    handovers: []
  }
]

export const seedDeviations: Deviation[] = [
  {
    id: 'TDEV-260929-01', shipmentId: 'AIR-260929-02', segmentId: 'SEG-2', title: '航段温度最高达到10.4℃', source: '自动监测', severity: '重大', status: '调查中', owner: '温控质量组', openedAt: '2026-09-29T14:05:00', dueDate: '2026-09-29',
    startTime: '2026-09-29T11:35:00', endTime: '2026-09-29T12:20:00', containerId: 'CRT-9207', periodStart: '2026-09-29T11:35:00', periodEnd: '2026-09-29T12:20:00', version: 3,
    cause: '航班临时调整至非温控货舱，转运时开门时间延长。', assessment: '超限约18分钟，样本稳定性研究显示可承受30分钟内偏差，但需收货方确认。', disposition: '补充处理', correctiveAction: '收货方完成外观和温度标签复核后决定是否接收。', evidence: '温度原始曲线、航班货舱变更通知、地面操作记录。', reviewer: '', reviewNote: ''
  },
  {
    // 跨交接偏差 · 旧箱责任片段：交接时冻结
    id: 'TDEV-260929-02', shipmentId: 'AIR-260929-01', segmentId: 'SEG-2', title: '中转坪温度8.6-8.9℃超限（旧箱 RKN-44018 责任段）', source: '自动监测', severity: '重大', status: '待放行复核', owner: '温控质量组', openedAt: '2026-09-29T05:20:00', dueDate: '2026-09-29',
    startTime: '2026-09-29T05:00:00', endTime: HANDOVER_AT, containerId: 'RKN-44018', periodStart: '2026-09-29T05:00:00', periodEnd: HANDOVER_AT,
    frozen: true, frozenHandoverId: 'HO-260929-01', version: 2,
    cause: '旧箱制冷模块告警，中转坪等待期间温度抬升至8.9℃；交接时刻冻结读数，责任归于 RKN-44018 服务时段。', assessment: '超限约25分钟，换箱前最后读数8.6℃，货物外观待查。该片段随交接冻结，仅保留历史。', disposition: '补充处理', correctiveAction: '旧箱回场检修；随箱温度记录与告警单已冻结归档。', evidence: 'RKN-44018原始温度记录.csv（冻结）、设备告警单、换箱交接签字。', reviewer: '', reviewNote: ''
  },
  {
    // 跨交接偏差 · 新箱责任片段：从交接时刻续记
    id: 'TDEV-260929-03', shipmentId: 'AIR-260929-01', segmentId: 'SEG-2', title: '航段温度续记核查（新箱 RKN-55207 责任段）', source: '自动监测', severity: '一般', status: '调查中', owner: '温控质量组', openedAt: '2026-09-29T05:30:00', dueDate: '2026-09-30',
    startTime: HANDOVER_AT, endTime: '2026-09-29T06:30:00', containerId: 'RKN-55207', periodStart: HANDOVER_AT, periodEnd: '2026-09-29T06:30:00',
    splitFromId: 'TDEV-260929-02', version: 1,
    cause: '换箱后预冷衔接观察段，确认新箱温度从交接时刻起独立续记。', assessment: '新箱续记区间温度4.0-4.9℃，未见超限；与旧箱责任段在交接时刻切分，不混责。', disposition: '接受', correctiveAction: '保持新箱30分钟点频，CDG落地复核封签。', evidence: 'RKN-55207续记温度曲线.csv、换箱交接签字。', reviewer: '', reviewNote: ''
  }
]

export const seedAudit: AuditEntry[] = [
  { id: 'A65-1', shipmentId: 'AIR-260929-01', action: '任务创建', operator: '张骁', detail: '关联3个航段和4类证据要求', createdAt: '2026-09-29T04:10:00' },
  { id: 'A65-2', shipmentId: 'AIR-260929-02', action: '自动创建偏差', operator: '温度监测系统', detail: 'SEG-2温度10.4℃超出2-10℃范围', createdAt: '2026-09-29T14:05:00' },
  { id: 'A65-3', shipmentId: 'AIR-260929-02', action: '提交偏差调查', operator: '温控质量组', detail: '补充处理分支，等待收货方稳定性确认', createdAt: '2026-09-29T16:40:00' },
  { id: 'A65-4', shipmentId: 'AIR-260929-01', action: '温控箱交接确认 V2', operator: '中转值班员 何琳', detail: 'RKN-44018 → RKN-55207；冻结旧箱温度点14个、证据2份；跨箱偏差按05:25拆为旧箱/新箱两段', handoverVersion: 2, createdAt: HANDOVER_AT }
]
