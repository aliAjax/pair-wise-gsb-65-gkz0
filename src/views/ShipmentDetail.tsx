import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Alert, Badge, Button, Card, Descriptions, Divider, Form, Input, InputNumber, Modal, Select, Space, Table, Tabs, Tag, Timeline, Upload, message } from 'antd'
import { UploadOutlined, SwapOutlined } from '@ant-design/icons'
import { TemperatureChart } from '../components/TemperatureChart'
import { HandoverModal } from '../components/HandoverModal'
import { useShipmentStore } from '../store/useShipmentStore'
import type { ContainerHandover, EvidenceFile } from '../types'

const fmt = (iso?: string) => iso ? iso.replace('T', ' ').slice(0, 16) : '—'

export function ShipmentDetail() {
  const { id } = useParams()
  const state = useShipmentStore()
  const shipment = state.shipments.find((item) => item.id === id)
  const [activeSegmentId, setActiveSegmentId] = useState(shipment?.segments[0]?.id ?? '')
  const [signOpen, setSignOpen] = useState(false)
  const [deviationOpen, setDeviationOpen] = useState(false)
  const [handoverOpen, setHandoverOpen] = useState(false)
  const [newPointValue, setNewPointValue] = useState<number | null>(4.5)
  const [form] = Form.useForm()
  const deviations = useMemo(() => state.deviations.filter((item) => item.shipmentId === id), [state.deviations, id])
  if (!shipment) return <section className="page empty">未找到运输任务</section>
  const activeSegment = shipment.segments.find((item) => item.id === activeSegmentId) ?? shipment.segments[0]
  const openDeviations = deviations.filter((item) => item.status !== '已关闭')
  const queuedHandovers = shipment.handovers.filter((item) => item.status === '排队待箱')
  const lastEffective = [...shipment.handovers].filter((item) => item.status === '已生效').pop()
  const oldBoxIds = new Set(shipment.handovers.map((item) => item.fromContainerId))

  const evidenceColumns = [
    { title: '文件', dataIndex: 'name', render: (value: string, row: EvidenceFile) => <div><strong>{value}</strong><small className="cell-sub">{row.category} · V{row.version}</small></div> },
    { title: '归属温控箱', dataIndex: 'containerId', width: 130, render: (value: string) => <Tag color={oldBoxIds.has(value) ? 'default' : 'cyan'}>{value}{oldBoxIds.has(value) ? '（旧箱）' : ''}</Tag> },
    { title: '上传', render: (_: unknown, row: EvidenceFile) => `${row.uploadedBy} ${fmt(row.uploadedAt)}` },
    { title: '状态', width: 180, render: (_: unknown, row: EvidenceFile) => row.frozen
      ? <Tag color="geekblue">已冻结 {fmt(row.frozenAt)}</Tag>
      : row.verified ? <Tag color="success">已核验</Tag> : <Button size="small" onClick={() => { const r = state.verifyEvidence(shipment.id, row.id); r.ok ? message.success(r.message) : message.error(r.message) }}>核验</Button> }
  ]

  const deviationColumns = [
    { title: '编号', dataIndex: 'id', width: 150 },
    { title: '标题 / 责任箱', render: (_: unknown, row: typeof deviations[number]) => <div><strong>{row.title}</strong><small className="cell-sub">责任箱 {row.containerId} · {fmt(row.periodStart)} ~ {fmt(row.periodEnd)}</small></div> },
    { title: '来源', dataIndex: 'source', width: 90 },
    { title: '状态', dataIndex: 'status', width: 100 },
    { title: '版本/标记', width: 130, render: (_: unknown, row: typeof deviations[number]) => <Space size={4} wrap><Tag>V{row.version}</Tag>{row.frozen && <Tag color="geekblue">旧箱冻结</Tag>}{row.splitFromId && <Tag color="purple">拆出</Tag>}</Space> }
  ]

  const sign = async () => {
    const values = await form.validateFields()
    const result = state.sign(shipment.id, values.role, values.comment ?? '', values.decision)
    result.ok ? message.success(result.message) : message.error(result.message)
    if (result.ok) setSignOpen(false)
  }
  const createDeviation = async () => {
    const values = await form.validateFields()
    state.createDeviation(shipment.id, values.segmentId, values.title, values.severity)
    setDeviationOpen(false)
    message.success('已创建偏差并进入调查队列（责任归属当前温控箱）')
  }
  const release = () => {
    const result = state.setShipmentStatus(shipment.id, '已放行')
    result.ok ? message.success(result.message) : message.error(result.message)
  }
  const appendPoint = () => {
    if (newPointValue == null) { message.warning('请填写温度读数'); return }
    const result = state.appendTemperaturePoint(shipment.id, activeSegment.id, newPointValue)
    result.ok ? message.success(result.message) : message.error(result.message)
  }

  const handoverTimeline: { color: string; children: React.ReactNode }[] = [
    { color: 'gray', children: <div className="chain-node"><b>起运 · {shipment.handovers[0]?.fromContainerId ?? shipment.containerId}</b><span>{fmt(shipment.plannedDeparture)} 开始记录温度点与证据</span></div> },
    ...shipment.handovers.map((handover: ContainerHandover) => ({
      color: handover.status === '已生效' ? 'green' : 'orange',
      children: <div className="chain-node" key={handover.id}>
        <div className="chain-node-head"><b>交接 #{handover.seq}：{handover.fromContainerId} → {handover.toContainerId}</b><Badge status={handover.status === '已生效' ? 'success' : 'warning'} text={`${handover.status} V${handover.version}`} /></div>
        <span>{handover.airport} · 分界时刻 {fmt(handover.handoverAt)} · {handover.operator}</span>
        <p>{handover.reason}</p>
        {handover.status === '已生效'
          ? <Space size={[8, 4]} wrap><Tag color="blue">冻结旧箱温度点 {handover.frozenPointCount} 个</Tag><Tag color="blue">冻结旧箱证据 {handover.frozenEvidenceCount} 份</Tag>{handover.splitDeviationIds.length > 0 && <Tag color="purple">偏差拆分：{handover.splitDeviationIds.join(' / ')}</Tag>}</Space>
          : <Space wrap><Tag color="error">缺口 {handover.capacityGap} L</Tag><Tag color="warning">排队待箱，已登记 {handover.allocatedCapacity}/{handover.requiredCapacity}L</Tag></Space>}
      </div>
    })),
    ...(lastEffective ? [{ color: 'green' as const, children: <div className="chain-node"><b>{shipment.containerId} 续记中（V{shipment.handoverVersion}）</b><span>温度点、证据与偏差自 {fmt(lastEffective.handoverAt)} 起独立续记，旧箱历史只读保留</span></div> }] : [])
  ]

  return <section className="page">
    <header className="page-head detail-head">
      <div><p>{shipment.id} · {shipment.batch}</p><h1>{shipment.product}</h1></div>
      <Space><Tag color={shipment.status === '已放行' ? 'success' : 'warning'}>{shipment.status}</Tag><Button onClick={() => setDeviationOpen(true)}>登记偏差</Button><Button onClick={() => setSignOpen(true)}>角色签收</Button><Button icon={<SwapOutlined />} type="default" onClick={() => setHandoverOpen(true)}>中转换箱交接</Button><Button type="primary" onClick={release}>放行审核</Button></Space>
    </header>
    {queuedHandovers.length > 0 && <Alert type="warning" showIcon className="detail-alert" message={`${queuedHandovers.length}笔交接排队待箱，共缺口 ${queuedHandovers.reduce((sum, item) => sum + item.capacityGap, 0)}L；请到「温控箱交接」调拨补齐后再放行`} />}
    {openDeviations.length > 0 && <Alert type="error" showIcon className="detail-alert" message={`存在${openDeviations.length}项未关闭温度偏差（已按责任箱/责任时段归属），系统阻止放行`} />}
    <Descriptions className="summary-band" size="small" column={6} items={[
      { key: 'route', label: '运输路线', children: shipment.route },
      { key: 'box', label: '当前温控箱', children: <b>{shipment.containerId}</b> },
      { key: 'range', label: '允许范围', children: `${shipment.tempMin} - ${shipment.tempMax} ℃` },
      { key: 'volume', label: '货物容量', children: `${shipment.cargoVolume} L` },
      { key: 'hversion', label: '交接链版本', children: <Tag color={queuedHandovers.length ? 'warning' : 'cyan'}>V{shipment.handoverVersion}</Tag> },
      { key: 'version', label: '任务版本', children: `V${shipment.version}` }
    ]} />
    <div className="detail-grid">
      <div className="timeline-panel">
        <div className="panel-title"><h2>航段时间轴</h2><span>旧箱温度点冻结只读</span></div>
        {shipment.segments.map((segment) => {
          const outOfRange = segment.temperature.some((item) => item.value < shipment.tempMin || item.value > shipment.tempMax)
          const boxes = [...new Set(segment.temperature.map((item) => item.containerId))]
          return <button key={segment.id} className={activeSegment.id === segment.id ? 'active' : ''} onClick={() => setActiveSegmentId(segment.id)}>
            <div className="segment-index">{segment.id.replace('SEG-', '')}</div>
            <div><strong>{segment.from} → {segment.to}</strong><span>{segment.flight} · {fmt(segment.plannedStart)}</span><small>操作人：{segment.handler} · {segment.note}</small><small className="box-line">温度箱：{boxes.map((box) => <Tag key={box} className={oldBoxIds.has(box) ? 'frozen-box' : ''}>{box}{oldBoxIds.has(box) ? ' ·冻结' : ''}</Tag>)}</small></div>
            <Badge status={outOfRange ? 'error' : 'success'} />
          </button>
        })}
      </div>
      <div className="chart-panel">
        <div className="panel-title"><h2>{activeSegment.from} → {activeSegment.to}</h2><span>{activeSegment.flight}</span></div>
        <TemperatureChart points={activeSegment.temperature} min={shipment.tempMin} max={shipment.tempMax} boundaryAt={lastEffective?.handoverAt} />
        <div className="chart-legend"><span><i className="legend-frozen" />旧箱冻结点</span><span><i className="legend-normal" />当前箱续记点</span><span><i className="legend-boundary" />交接分界</span><span className="legend-append">新箱续记：<InputNumber size="small" min={-20} max={40} step={0.1} value={newPointValue} onChange={setNewPointValue} addonAfter="℃" /><Button size="small" type="primary" onClick={appendPoint}>续记温度点</Button></span></div>
        <div className="segment-meta"><span>计划：{fmt(activeSegment.plannedStart)}</span><span>实际：{fmt(activeSegment.actualStart)} - {fmt(activeSegment.actualEnd)}</span></div>
        <Table className="points-table" rowKey="id" size="small" pagination={false}
          dataSource={activeSegment.temperature.slice(-8)}
          columns={[
            { title: '时间', dataIndex: 'time', render: (value: string) => fmt(value) },
            { title: '读数', dataIndex: 'value', render: (value: number) => `${value}℃` },
            { title: '温控箱', dataIndex: 'containerId' },
            { title: '状态', dataIndex: 'frozen', render: (value: boolean) => value ? <Tag color="geekblue">冻结（旧箱）</Tag> : <Tag color="cyan">续记（当前箱）</Tag> }
          ]} />
      </div>
    </div>
    <Tabs className="detail-tabs" items={[
      { key: 'handovers', label: `温控箱交接链 (${shipment.handovers.length})`, children: <div className="handover-chain-tab"><div className="tab-actions"><span>交接链版本 V{shipment.handoverVersion}：交接时冻结旧箱依据，新箱从交接时刻续记，跨交接偏差按责任时段拆开</span><Button type="primary" icon={<SwapOutlined />} onClick={() => setHandoverOpen(true)}>办理中转换箱</Button></div><Timeline items={handoverTimeline} /></div> },
      { key: 'evidence', label: `证据 (${shipment.evidence.length})`, children: <div><div className="tab-actions"><Upload beforeUpload={() => { state.addEvidence(shipment.id, { name: `现场补充材料-${Date.now()}.pdf`, category: '包装确认', uploadedBy: '当前用户', verified: false }); message.success(`已新增证据版本，归属当前箱 ${shipment.containerId}`); return false }} showUploadList={false}><Button icon={<UploadOutlined />}>上传证据</Button></Upload><span>证据随箱归属；旧箱证据交接冻结，新箱证据自交接时刻累计版本</span></div><Table rowKey="id" size="small" columns={evidenceColumns} dataSource={shipment.evidence} pagination={false} /></div> },
      { key: 'signatures', label: `签收记录 (${shipment.signatures.filter((item) => item.status === '已签').length}/${shipment.signatures.length})`, children: <div className="signature-grid">{shipment.signatures.map((item) => <Card key={item.role} size="small"><div className="signature-head"><strong>{item.role}</strong><Tag color={item.status === '已签' ? 'success' : item.status === '已退回' ? 'error' : 'default'}>{item.status}</Tag></div><p>{item.name}</p><small>{item.signedAt ? fmt(item.signedAt) : '尚未签署'}</small><Divider /><span>{item.comment || '暂无意见'}</span></Card>)}</div> },
      { key: 'deviations', label: `偏差 (${deviations.length})`, children: <div><div className="tab-actions"><span>跨交接偏差已按责任时段拆分：旧箱段冻结保留，新箱段从交接时刻续记调查</span></div><Table rowKey="id" size="small" pagination={false} dataSource={deviations} columns={deviationColumns} /></div> }
    ]} />
    <Modal title="多角色签收" open={signOpen} onCancel={() => setSignOpen(false)} onOk={sign} okText="提交签收">
      <Form form={form} layout="vertical" initialValues={{ role: '放行人员', decision: '已签' }}>
        <Form.Item name="role" label="签收角色" rules={[{ required: true }]}><Select options={shipment.signatures.map((item) => ({ label: item.role, value: item.role }))} /></Form.Item>
        <Form.Item name="decision" label="签收决定" rules={[{ required: true }]}><Select options={[{ label: '签署确认', value: '已签' }, { label: '退回补充', value: '已退回' }]} /></Form.Item>
        <Form.Item name="comment" label="签收意见"><Input.TextArea rows={3} /></Form.Item>
      </Form>
    </Modal>
    <Modal title="登记温度偏差" open={deviationOpen} onCancel={() => setDeviationOpen(false)} onOk={createDeviation} okText="创建偏差">
      <Form form={form} layout="vertical" initialValues={{ segmentId: activeSegment.id, severity: '一般' }}>
        <Alert type="info" showIcon className="handover-alert" message={`新偏差将归属当前温控箱 ${shipment.containerId}，责任时段从所选航段开始`} />
        <Form.Item name="segmentId" label="发生航段" rules={[{ required: true }]}><Select options={shipment.segments.map((item) => ({ label: `${item.from} → ${item.to}`, value: item.id }))} /></Form.Item>
        <Form.Item name="title" label="偏差描述" rules={[{ required: true }]}><Input.TextArea rows={4} /></Form.Item>
        <Form.Item name="severity" label="严重度" rules={[{ required: true }]}><Select options={['一般', '重大'].map((value) => ({ label: value, value }))} /></Form.Item>
      </Form>
    </Modal>
    {handoverOpen && <HandoverModal open={handoverOpen} shipment={shipment} onClose={() => setHandoverOpen(false)} />}
  </section>
}
