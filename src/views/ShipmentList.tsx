import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Badge, Button, Input, Select, Table, Tag } from 'antd'
import { useShipmentStore } from '../store/useShipmentStore'
import { loadShipmentSnapshot } from '../services/api'
import type { Shipment, ShipmentStatus } from '../types'

const statusColor = (status: ShipmentStatus) => status === '已放行' ? 'success' : status === '已拒绝' ? 'error' : status === '待放行' ? 'warning' : 'processing'

export function ShipmentList() {
  const navigate = useNavigate()
  const state = useShipmentStore()
  const { isFetching } = useQuery({ queryKey: ['shipments'], queryFn: () => loadShipmentSnapshot(state.shipments), staleTime: 60000 })
  const rows = useMemo(() => state.shipments.filter((item) => {
    const text = `${item.id} ${item.product} ${item.batch} ${item.route} ${item.containerId} ${item.handovers.map((handover) => `${handover.fromContainerId} ${handover.toContainerId}`).join(' ')}`.toLowerCase()
    return (!state.keyword || text.includes(state.keyword.toLowerCase())) && (state.status === '全部' || item.status === state.status)
  }), [state.shipments, state.keyword, state.status])
  const columns = [
    { title: '任务编号', dataIndex: 'id', width: 150 },
    { title: '货物', dataIndex: 'product', render: (value: string, row: Shipment) => <div><strong>{value}</strong><small className="cell-sub">{row.batch}</small></div> },
    { title: '航线', dataIndex: 'route', width: 220 },
    { title: '温控箱 / 交接', render: (_: unknown, row: Shipment) => {
      const queue = row.handovers.filter((item) => item.status === '排队待箱').length
      const gaps = row.handovers.reduce((sum, item) => sum + item.capacityGap, 0)
      return <div><strong>{row.containerId}</strong>{row.handovers.length > 0 && <small className="cell-sub">已换箱 {row.handovers.length} 次{queue > 0 ? ` · ${queue}笔排队 · 缺口${gaps}L` : ''}</small>}</div>
    }, width: 150 },
    { title: '范围', render: (_: unknown, row: Shipment) => `${row.tempMin} - ${row.tempMax} ℃`, width: 100 },
    { title: '状态', dataIndex: 'status', width: 100, render: (value: ShipmentStatus) => <Tag color={statusColor(value)}>{value}</Tag> },
    { title: '交接链版本', width: 100, render: (_: unknown, row: Shipment) => <Tag color={row.handovers.some((item) => item.status === '排队待箱') ? 'warning' : 'cyan'}>V{row.handoverVersion}{row.handovers.some((item) => item.status === '排队待箱') ? ' · 排队' : ''}</Tag> },
    { title: '任务版本', dataIndex: 'version', width: 75, render: (value: number) => `V${value}` },
    { title: '', width: 80, render: (_: unknown, row: Shipment) => <Button type="link" onClick={() => navigate(`/shipments/${row.id}`)}>打开</Button> }
  ]
  return <section className="page">
    <header className="page-head"><div><p>温控运输中心 / 在途与待放行</p><h1>温控货物运输任务</h1></div><span className="sync">{isFetching ? '正在同步' : '本地证据快照已加载'}</span></header>
    <div className="metrics">
      <article><span>运输任务</span><strong>{state.shipments.length}</strong><small>PVG与PEK始发</small></article>
      <article><span>待放行</span><strong>{state.shipments.filter((item) => item.status === '待放行').length}</strong><small>需完成证据核验</small></article>
      <article><span>未关闭偏差</span><strong>{state.deviations.filter((item) => item.status !== '已关闭').length}</strong><small>按温控箱责任时段归属</small></article>
      <article><span>排队交接缺口</span><strong>{state.shipments.flatMap((item) => item.handovers).filter((item) => item.status === '排队待箱').length}</strong><small>备用箱容量不足</small></article>
    </div>
    <div className="toolbar">
      <Input value={state.keyword} onChange={(event) => state.setKeyword(event.target.value)} allowClear placeholder="搜索任务、货物、批次、航线或温控箱（含旧箱号）" />
      <Select value={state.status} onChange={state.setStatus} options={['全部', '待装机', '运输中', '待放行', '已放行', '已拒绝'].map((value) => ({ label: value, value }))} />
      <Badge status="processing" text="温度点按原始时间与箱号持久化，交接后旧箱冻结" />
    </div>
    <Table rowKey="id" size="small" columns={columns} dataSource={rows} pagination={false} />
  </section>
}
