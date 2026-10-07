import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Badge, Button, Card, Empty, InputNumber, Modal, Select, Space, Switch, Table, Tag, Timeline, message } from 'antd'
import { useShipmentStore } from '../store/useShipmentStore'
import { HandoverModal } from '../components/HandoverModal'
import type { ContainerHandover, Shipment, SpareContainer } from '../types'

const fmt = (iso: string) => iso ? iso.replace('T', ' ').slice(0, 16) : '—'

export function HandoverCenter() {
  const state = useShipmentStore()
  const navigate = useNavigate()
  const [target, setTarget] = useState<Shipment | null>(null)
  const [failArmed, setFailArmed] = useState(false)
  const [restock, setRestock] = useState<SpareContainer | null>(null)
  const [restockLitres, setRestockLitres] = useState(300)
  const [allocating, setAllocating] = useState<{ shipment: Shipment; handover: ContainerHandover } | null>(null)
  const [allocSpare, setAllocSpare] = useState<string | undefined>()
  const [allocBase, setAllocBase] = useState(0)

  const queued = state.shipments.flatMap((shipment) =>
    shipment.handovers.filter((item) => item.status === '排队待箱').map((handover) => ({ shipment, handover })))

  const openAlloc = (shipment: Shipment, handover: ContainerHandover) => {
    setAllocating({ shipment, handover })
    setAllocBase(shipment.handoverVersion)
    setAllocSpare(state.spares.find((spare) => spare.capacityFree >= handover.requiredCapacity)?.id)
  }

  const submitAlloc = () => {
    if (!allocating || !allocSpare) return
    const result = state.allocateSpare(allocating.shipment.id, allocating.handover.id, allocSpare, allocBase)
    if (result.ok) {
      message.success(result.message)
      setAllocating(null)
    } else if (result.conflict) {
      message.error(result.message)
      const latest = state.shipments.find((item) => item.id === allocating.shipment.id)?.handoverVersion ?? allocBase
      setAllocBase(latest)
    } else if (result.persistFailed) {
      message.error(result.message)
    } else {
      message.warning(result.message)
    }
  }

  const spareColumns = [
    { title: '备用箱', dataIndex: 'id', width: 120, render: (value: string) => <strong>{value}</strong> },
    { title: '所在场站', dataIndex: 'station' },
    { title: '可用容量', dataIndex: 'capacityFree', width: 130, render: (value: number) => <span className={value < 300 ? 'gap-text' : ''}>{value} L</span> },
    { title: '温区', dataIndex: 'tempRangeOk', width: 90, render: (value: boolean) => value ? <Tag color="success">匹配</Tag> : <Tag color="error">不符</Tag> },
    { title: '状态', dataIndex: 'status', width: 100, render: (value: SpareContainer['status']) => <Tag color={value === '可用' ? 'processing' : 'warning'}>{value}</Tag> },
    { title: '操作', width: 110, render: (_: unknown, row: SpareContainer) => <Button size="small" onClick={() => { setRestock(row); setRestockLitres(300) }}>补货入库</Button> }
  ]

  return <section className="page">
    <header className="page-head">
      <div><p>任务 → 温控箱交接 → 航段温度点 → 证据 → 温度偏差</p><h1>温控箱交接中心</h1></div>
      <Space>
        <span className="sync">落盘故障注入</span>
        <Switch checked={failArmed} checkedChildren="下次交接写入失败" unCheckedChildren="正常写入" onChange={(checked) => { state.armFailNextWrite(checked); setFailArmed(checked); checked ? message.loading('已注入：下一次交接落盘将失败，可验证从交接前重试', 3) : undefined }} />
      </Space>
    </header>

    {queued.length > 0 && <Alert
      className="queue-banner"
      type="warning" showIcon
      message={`${queued.length} 笔交接因备用箱容量不足排队待箱，已标缺口；缺口未补齐前任务不能放行`}
    />}

    <div className="handover-grid">
      <Card className="spare-pool" size="small" title="备用箱池（容量不足即排队）">
        <Table rowKey="id" size="small" columns={spareColumns} dataSource={state.spares} pagination={false} />
      </Card>
      <Card className="queue-panel" size="small" title={`排队待箱与缺口 (${queued.length})`}>
        {queued.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无排队交接" /> : queued.map(({ shipment, handover }) => <div key={handover.id} className="queue-item">
          <div className="queue-head">
            <strong>{shipment.id}</strong>
            <Tag color="warning">排队待箱</Tag>
            <Tag color="error" className="gap-tag">缺口 {handover.capacityGap} L</Tag>
            <span className="queue-ver">V{handover.version}</span>
          </div>
          <p>{handover.fromContainerId} → 待配箱 · {handover.airport} · {fmt(handover.handoverAt)}</p>
          <small>已登记 {handover.allocatedCapacity}L / 需求 {handover.requiredCapacity}L · {handover.queuedNote}</small>
          <div className="queue-foot"><Button size="small" type="primary" onClick={() => openAlloc(shipment, handover)}>调拨备用箱补齐</Button><Button size="small" type="link" onClick={() => navigate(`/shipments/${shipment.id}`)}>查看任务</Button></div>
        </div>)}
      </Card>
    </div>

    <Card size="small" className="chain-panel" title="交接链（旧箱冻结 → 新箱续记 → 偏差按责任时段拆分）">
      {state.shipments.map((shipment) => <div key={shipment.id} className="chain-shipment">
        <div className="chain-head">
          <div><strong>{shipment.id}</strong><span>{shipment.product} · {shipment.route}</span></div>
          <Space>
            <Tag color="cyan">交接链 V{shipment.handoverVersion}</Tag>
            <Tag>当前箱 {shipment.containerId}</Tag>
            <Button size="small" type="primary" onClick={() => setTarget(shipment)}>办理中转交接</Button>
            <Button size="small" type="link" onClick={() => navigate(`/shipments/${shipment.id}`)}>任务详情</Button>
          </Space>
        </div>
        {shipment.handovers.length === 0
          ? <div className="chain-empty">尚未发生换箱，全程由 {shipment.containerId} 记录。</div>
          : <Timeline items={[
            { color: 'gray', children: <div className="chain-node"><b>起运 · {shipment.containerId}</b><span>{fmt(shipment.plannedDeparture)} 起记温度点与证据</span></div> },
            ...shipment.handovers.map((handover) => ({
              color: handover.status === '已生效' ? 'green' : 'orange',
              children: <div className="chain-node" key={handover.id}>
                <div className="chain-node-head">
                  <b>交接 #{handover.seq}：{handover.fromContainerId} → {handover.toContainerId}</b>
                  <Badge status={handover.status === '已生效' ? 'success' : 'warning'} text={handover.status === '已生效' ? `已生效 V${handover.version}` : `排队待箱 V${handover.version}`} />
                </div>
                <span>{handover.airport} · 分界时刻 {fmt(handover.handoverAt)} · {handover.operator}</span>
                <p>{handover.reason}</p>
                {handover.status === '已生效'
                  ? <Space size={[8, 4]} wrap>
                      <Tag color="blue">冻结旧箱温度点 {handover.frozenPointCount} 个</Tag>
                      <Tag color="blue">冻结旧箱证据 {handover.frozenEvidenceCount} 份</Tag>
                      {handover.splitDeviationIds.length > 0 && <Tag color="purple">跨交接偏差拆分：{handover.splitDeviationIds.join(' / ')}</Tag>}
                      {handover.fulfilledAt && <Tag>缺口补齐于 {fmt(handover.fulfilledAt)}</Tag>}
                    </Space>
                  : <Space><Tag color="error">缺口 {handover.capacityGap} L</Tag><Button size="small" type="primary" onClick={() => openAlloc(shipment, handover)}>调拨补齐</Button></Space>}
              </div>
            })),
            ...(shipment.handovers.some((item) => item.status === '已生效')
              ? [{ color: 'green' as const, children: <div className="chain-node"><b>{shipment.containerId} 续记中</b><span>温度点、证据与偏差自交接时刻续记，旧箱历史只读保留</span></div> }]
              : [])
          ]} />}
      </div>)}
    </Card>

    {target && <HandoverModal open={!!target} shipment={target} onClose={() => setTarget(null)} />}

    <Modal
      title={`调拨备用箱补齐缺口 · ${allocating?.shipment.id ?? ''}`}
      open={!!allocating}
      onCancel={() => setAllocating(null)}
      onOk={submitAlloc}
      okText="确认调拨并生效交接"
      okButtonProps={{ disabled: !allocSpare }}
    >
      {allocating && <>
        <Alert type="info" showIcon className="handover-alert"
          message={<span>排队交接 {allocating.handover.id} · 需求 <b>{allocating.handover.requiredCapacity}L</b>，已登记 {allocating.handover.allocatedCapacity}L，缺口 <b className="gap-text">{allocating.handover.capacityGap}L</b> · 基线 V{allocBase}</span>}
          description="容量足够的备用箱调拨到位后，以补齐时刻为交接时刻冻结旧箱、新箱续记。" />
        <Select
          style={{ width: '100%' }}
          placeholder="选择调拨备用箱"
          value={allocSpare}
          onChange={setAllocSpare}
          options={state.spares.map((spare) => ({
            value: spare.id,
            disabled: spare.capacityFree < allocating.handover.requiredCapacity,
            label: `${spare.id} · 余量${spare.capacityFree}L${spare.capacityFree < allocating.handover.requiredCapacity ? `（不足，仍缺${allocating.handover.requiredCapacity - spare.capacityFree}L）` : ''} · ${spare.station}`
          }))}
        />
      </>}
    </Modal>

    <Modal
      title={`备用箱补货 · ${restock?.id ?? ''}`}
      open={!!restock}
      onCancel={() => setRestock(null)}
      onOk={() => { if (restock) { state.restockSpare(restock.id, restockLitres); message.success(`${restock.id} 已补货 ${restockLitres}L`); setRestock(null) } }}
      okText="确认入库"
    >
      <p>{restock?.station} · 当前可用 {restock?.capacityFree}L</p>
      <InputNumber min={1} value={restockLitres} onChange={(value) => setRestockLitres(value ?? 0)} addonAfter="L" style={{ width: '100%' }} />
    </Modal>
  </section>
}
