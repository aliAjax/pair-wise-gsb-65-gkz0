import { Fragment, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Alert, Badge, Button, Card, DatePicker, Descriptions, Divider, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, Tabs, Tag, Upload, message } from 'antd'
import { UploadOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { TemperatureChart } from '../components/TemperatureChart'
import { useShipmentStore } from '../store/useShipmentStore'
import { isOpenDeviation } from '../types'
import type { ContainerHandover, CustodyPeriod, EvidenceFile } from '../types'

const fmt = (value: string) => value ? value.replace('T', ' ').slice(0, 16) : '—'

export function ShipmentDetail() {
  const { id } = useParams()
  const state = useShipmentStore()
  const shipment = state.shipments.find((item) => item.id === id)
  const [activeSegmentId, setActiveSegmentId] = useState(shipment?.segments[0]?.id ?? '')
  const [signOpen, setSignOpen] = useState(false)
  const [deviationOpen, setDeviationOpen] = useState(false)
  const [initiateOpen, setInitiateOpen] = useState(false)
  const [confirmId, setConfirmId] = useState('')
  const [confirmBaseVersion, setConfirmBaseVersion] = useState(0)
  const [conflictMessage, setConflictMessage] = useState('')
  const [swapId, setSwapId] = useState('')
  const [form] = Form.useForm()
  const [initiateForm] = Form.useForm()
  const [confirmForm] = Form.useForm()
  const [swapForm] = Form.useForm()
  if (!shipment) return <section className="page empty">未找到运输任务</section>
  const activeSegment = shipment.segments.find((item) => item.id === activeSegmentId) ?? shipment.segments[0]
  const deviations = state.deviations.filter((item) => item.shipmentId === shipment.id)
  const openDeviations = deviations.filter(isOpenDeviation)
  const queuedHandovers = shipment.handovers.filter((item) => item.status === '排队中')
  const frozenContainers = [...new Set(shipment.custody.filter((item) => item.frozen).map((item) => item.containerId))]
  const activeSegmentHandovers = shipment.handovers
    .filter((item) => item.segmentId === activeSegment.id && item.status === '已确认')
    .map((item) => ({ at: item.handoverAt, from: item.fromContainerId, to: item.toContainerId }))
  const confirmLive = shipment.handovers.find((item) => item.id === confirmId)
  const swapLive = shipment.handovers.find((item) => item.id === swapId)

  const custodyGroups = (() => {
    const sorted = [...shipment.custody].sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    const groups: { containerId: string; items: CustodyPeriod[] }[] = []
    sorted.forEach((custody) => {
      const last = groups[groups.length - 1]
      if (last && last.containerId === custody.containerId) last.items.push(custody)
      else groups.push({ containerId: custody.containerId, items: [custody] })
    })
    return groups
  })()
  const pointsOf = (custody: CustodyPeriod) => custody.frozenPoints?.length
    ?? shipment.segments.find((item) => item.id === custody.segmentId)?.temperature.filter((point) => (point.containerId ?? shipment.containerId) === custody.containerId).length
    ?? 0

  const evidenceColumns = [
    { title: '文件', dataIndex: 'name', render: (value: string, row: EvidenceFile) => <div><strong>{value}</strong><small className="cell-sub">{row.category} · V{row.version}</small></div> },
    { title: '归属箱段', width: 190, render: (_: unknown, row: EvidenceFile) => {
      const custody = shipment.custody.find((item) => item.id === row.custodyId)
      if (!row.containerId) return <span className="cell-sub">未关联</span>
      return <div><span>{row.containerId}</span><small className="cell-sub">{custody ? `${custody.segmentId} · ${custody.frozen ? '已冻结' : '在记'}` : '链外证据'}</small></div>
    } },
    { title: '上传', render: (_: unknown, row: EvidenceFile) => `${row.uploadedBy} ${row.uploadedAt.replace('T', ' ').slice(0, 16)}` },
    { title: '核验', dataIndex: 'verified', width: 95, render: (value: boolean, row: EvidenceFile) => value ? <Tag color="success">已核验</Tag> : <Button size="small" onClick={() => state.verifyEvidence(shipment.id, row.id)}>核验</Button> }
  ]
  const handoverColumns = [
    { title: '交接单', dataIndex: 'id', width: 150, render: (value: string, row: ContainerHandover) => <div><strong>{value}</strong><small className="cell-sub">版本V{row.version}</small></div> },
    { title: '站点 / 航段', width: 170, render: (_: unknown, row: ContainerHandover) => <div><span>{row.station}</span><small className="cell-sub">{row.segmentId}</small></div> },
    { title: '换箱', width: 200, render: (_: unknown, row: ContainerHandover) => <span>{row.fromContainerId} → {row.toContainerId}</span> },
    { title: '交接时刻', dataIndex: 'handoverAt', width: 140, render: fmt },
    { title: '容量', width: 190, render: (_: unknown, row: ContainerHandover) => <div><span>需{row.requiredCapacity}m³ / 备{row.backupCapacity}m³</span>{row.capacityGap > 0 && <Tag color="error" className="gap-tag">缺口{row.capacityGap.toFixed(1)}m³</Tag>}</div> },
    { title: '状态', dataIndex: 'status', width: 90, render: (value: ContainerHandover['status']) => <Tag color={value === '已确认' ? 'success' : value === '排队中' ? 'error' : 'processing'}>{value}</Tag> },
    { title: '操作', width: 200, render: (_: unknown, row: ContainerHandover) => row.status === '已确认'
      ? <small className="cell-sub">{fmt(row.confirmedAt)} 确认</small>
      : <Space><Button size="small" type="primary" disabled={row.status !== '待确认'} onClick={() => openConfirm(row)}>确认交接</Button><Button size="small" onClick={() => { setSwapId(row.id); swapForm.resetFields() }}>更换备用箱</Button></Space> }
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
    message.success('已创建偏差并进入调查队列')
  }
  const release = () => {
    const result = state.setShipmentStatus(shipment.id, '已放行')
    result.ok ? message.success(result.message) : message.error(result.message)
  }
  const submitInitiate = async () => {
    const values = await initiateForm.validateFields()
    const result = state.initiateHandover(shipment.id, {
      segmentId: values.segmentId,
      toContainerId: values.toContainerId,
      requiredCapacity: values.requiredCapacity,
      handoverAt: values.handoverAt.format('YYYY-MM-DDTHH:mm:ss'),
      operator: values.operator,
      note: values.note ?? ''
    })
    if (!result.ok) return message.error(result.message)
    result.message.includes('排队') ? message.warning(result.message) : message.success(result.message)
    setInitiateOpen(false)
    initiateForm.resetFields()
  }
  const openConfirm = (handover: ContainerHandover) => {
    setConfirmId(handover.id)
    setConfirmBaseVersion(handover.version)
    setConflictMessage('')
    confirmForm.setFieldsValue({ operator: handover.operator, note: handover.note })
  }
  const submitConfirm = async () => {
    const values = await confirmForm.validateFields()
    const result = state.confirmHandover(confirmId, confirmBaseVersion, values)
    if (result.ok) {
      message.success(result.message)
      setConfirmId('')
      setConflictMessage('')
      confirmForm.resetFields()
    } else if (result.conflict) {
      setConflictMessage(result.message)
      if (result.currentVersion) setConfirmBaseVersion(result.currentVersion)
    } else {
      message.error(result.message)
    }
  }
  const submitSwap = async () => {
    const values = await swapForm.validateFields()
    const result = state.changeBackupContainer(swapId, values.toContainerId)
    if (!result.ok) return message.error(result.message)
    result.message.includes('排队') ? message.warning(result.message) : message.success(result.message)
    setSwapId('')
  }

  const confirmPreview = (() => {
    if (!confirmLive) return null
    const segment = shipment.segments.find((item) => item.id === confirmLive.segmentId)
    const freezeCount = segment?.temperature.filter((point) => point.time < confirmLive.handoverAt).length ?? 0
    const spanning = state.deviations.filter((item) => item.shipmentId === shipment.id && isOpenDeviation(item) && item.segmentId === confirmLive.segmentId
      && (item.windowStart ?? item.openedAt) < confirmLive.handoverAt && confirmLive.handoverAt < (item.windowEnd ?? item.openedAt))
    return { freezeCount, spanning }
  })()

  return <section className="page">
    <header className="page-head detail-head">
      <div><p>{shipment.id} · {shipment.batch}</p><h1>{shipment.product}</h1></div>
      <Space><Tag color={shipment.status === '已放行' ? 'success' : 'warning'}>{shipment.status}</Tag><Button onClick={() => setDeviationOpen(true)}>登记偏差</Button><Button onClick={() => setSignOpen(true)}>角色签收</Button><Button type="primary" onClick={release}>放行审核</Button></Space>
    </header>
    {openDeviations.length > 0 && <Alert type="error" showIcon message={`存在${openDeviations.length}项未关闭温度偏差，系统阻止放行`} />}
    {queuedHandovers.length > 0 && <Alert type="warning" showIcon message={`备用箱容量不足：${queuedHandovers.map((item) => `${item.id}缺口${item.capacityGap.toFixed(1)}m³`).join('，')}，交接排队中，更换足额备用箱后才能确认`} />}
    <Descriptions className="summary-band" size="small" column={6} items={[
      { key: 'route', label: '运输路线', children: shipment.route },
      { key: 'box', label: '当前温控箱', children: shipment.containerId },
      { key: 'range', label: '允许范围', children: `${shipment.tempMin} - ${shipment.tempMax} ℃` },
      { key: 'handover', label: '交接版本', children: `V${shipment.handoverVersion}` },
      { key: 'version', label: '任务版本', children: `V${shipment.version}` },
      { key: 'updated', label: '最近更新', children: shipment.updatedAt.replace('T', ' ').slice(0, 16) }
    ]} />
    <div className="detail-grid">
      <div className="timeline-panel">
        <div className="panel-title"><h2>航段时间轴</h2><span>原始温度点不可修改</span></div>
        {shipment.segments.map((segment) => {
          const containers = [...new Set(shipment.custody.filter((item) => item.segmentId === segment.id).map((item) => item.containerId))]
          const hasHandover = shipment.handovers.some((item) => item.segmentId === segment.id)
          return <button key={segment.id} className={activeSegment.id === segment.id ? 'active' : ''} onClick={() => setActiveSegmentId(segment.id)}>
            <div className="segment-index">{segment.id.replace('SEG-', '')}</div>
            <div><strong>{segment.from} → {segment.to}</strong><span>{segment.flight} · {segment.plannedStart.replace('T', ' ').slice(0, 16)}</span><small>操作人：{segment.handler} · {segment.note}</small><small>箱：{containers.join(' → ') || shipment.containerId}{hasHandover ? ' · ⇄有交接单' : ''}</small></div>
            <Badge status={segment.temperature.some((item) => item.value < shipment.tempMin || item.value > shipment.tempMax) ? 'error' : 'success'} />
          </button>
        })}
      </div>
      <div className="chart-panel">
        <div className="panel-title"><h2>{activeSegment.from} → {activeSegment.to}</h2><span>{activeSegment.flight}</span></div>
        <TemperatureChart points={activeSegment.temperature} min={shipment.tempMin} max={shipment.tempMax} handovers={activeSegmentHandovers} frozenContainers={frozenContainers} />
        <div className="segment-meta"><span>计划：{activeSegment.plannedStart.replace('T', ' ').slice(0, 16)}</span><span>实际：{activeSegment.actualStart.replace('T', ' ').slice(0, 16)} - {activeSegment.actualEnd ? activeSegment.actualEnd.replace('T', ' ').slice(0, 16) : '进行中'}</span></div>
      </div>
    </div>
    <Tabs className="detail-tabs" items={[
      { key: 'chain', label: `温控箱交接链 (${shipment.handovers.length})`, children: <div>
        <div className="tab-actions"><Button type="primary" onClick={() => setInitiateOpen(true)}>发起温控箱交接</Button><span>交接冻结旧箱依据，新箱自交接时刻续记，跨交接偏差按责任时段拆分</span></div>
        <div className="custody-chain">
          {custodyGroups.map((group, index) => {
            const handover = shipment.handovers.find((item) => item.fromContainerId === group.containerId && custodyGroups[index + 1]?.containerId === item.toContainerId)
            const frozen = group.items.every((item) => item.frozen)
            const pointCount = group.items.reduce((sum, item) => sum + pointsOf(item), 0)
            const evidenceCount = group.items.reduce((sum, item) => sum + (item.frozenEvidenceIds?.length ?? 0), 0)
            return <Fragment key={`${group.containerId}-${index}`}>
              <div className={frozen ? 'custody-node frozen' : 'custody-node'}>
                <div className="custody-head"><strong>{group.containerId}</strong><Tag color={frozen ? 'default' : 'processing'}>{frozen ? '已冻结' : '在记'}</Tag></div>
                <span>{group.items.map((item) => item.segmentId).join(' · ')}</span>
                <small>{fmt(group.items[0].startedAt)} → {group.items[group.items.length - 1].endedAt ? fmt(group.items[group.items.length - 1].endedAt) : '进行中'}</small>
                <small>{frozen ? `冻结读数${pointCount}点 · 冻结证据${evidenceCount}件` : `在记读数${pointCount}点`}</small>
              </div>
              {handover && <div className="handover-link">
                <span className="handover-arrow">→</span>
                <div className="handover-card"><strong>{handover.station} · {fmt(handover.handoverAt)}</strong><span>{handover.operator}</span><small>交接单{handover.id} · V{handover.version} · {handover.status}</small></div>
              </div>}
            </Fragment>
          })}
        </div>
        <Table rowKey="id" size="small" columns={handoverColumns} dataSource={shipment.handovers} pagination={false} locale={{ emptyText: '暂无交接单，可发起温控箱交接' }} />
      </div> },
      { key: 'evidence', label: `证据版本 (${shipment.evidence.length})`, children: <div><div className="tab-actions"><Upload beforeUpload={() => { state.addEvidence(shipment.id, { name: `现场补充材料-${Date.now()}.pdf`, category: '包装确认', uploadedBy: '当前用户', verified: false }); message.success('已新增证据版本'); return false }} showUploadList={false}><Button icon={<UploadOutlined />}>上传证据</Button></Upload><span>同分类文件自动递增版本，冻结箱段证据随交接保留</span></div><Table rowKey="id" size="small" columns={evidenceColumns} dataSource={shipment.evidence} pagination={false} /></div> },
      { key: 'signatures', label: `签收记录 (${shipment.signatures.filter((item) => item.status === '已签').length}/${shipment.signatures.length})`, children: <div className="signature-grid">{shipment.signatures.map((item) => <Card key={item.role} size="small"><div className="signature-head"><strong>{item.role}</strong><Tag color={item.status === '已签' ? 'success' : item.status === '已退回' ? 'error' : 'default'}>{item.status}</Tag></div><p>{item.name}</p><small>{item.signedAt ? item.signedAt.replace('T', ' ').slice(0, 16) : '尚未签署'}</small><Divider /><span>{item.comment || '暂无意见'}</span></Card>)}</div> },
      { key: 'deviations', label: `偏差 (${deviations.length})`, children: <Table rowKey="id" size="small" pagination={false} dataSource={deviations} columns={[
        { title: '编号', dataIndex: 'id', width: 170, render: (value: string, row: (typeof deviations)[number]) => <div><strong>{value}</strong>{row.parentId && <small className="cell-sub">拆分自{row.parentId}</small>}</div> },
        { title: '标题', dataIndex: 'title' },
        { title: '责任箱', dataIndex: 'containerId', width: 120, render: (value?: string) => value ?? '—' },
        { title: '责任时段', width: 190, render: (_: unknown, row: (typeof deviations)[number]) => row.periodStart ? `${row.periodStart.slice(11, 16)} - ${row.periodEnd?.slice(11, 16) ?? ''}` : '—' },
        { title: '状态', dataIndex: 'status', width: 100, render: (value: string) => <Tag color={value === '已关闭' ? 'success' : value === '已拆分' ? 'default' : 'processing'}>{value}</Tag> },
        { title: '版本', dataIndex: 'version', width: 65, render: (value: number) => `V${value}` }
      ]} /> }
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
        <Form.Item name="segmentId" label="发生航段" rules={[{ required: true }]}><Select options={shipment.segments.map((item) => ({ label: `${item.from} → ${item.to}`, value: item.id }))} /></Form.Item>
        <Form.Item name="title" label="偏差描述" rules={[{ required: true }]}><Input.TextArea rows={4} /></Form.Item>
        <Form.Item name="severity" label="严重度" rules={[{ required: true }]}><Select options={['一般', '重大'].map((value) => ({ label: value, value }))} /></Form.Item>
      </Form>
    </Modal>
    <Modal title="发起温控箱交接" open={initiateOpen} onCancel={() => setInitiateOpen(false)} onOk={submitInitiate} okText="提交交接单">
      <Form form={initiateForm} layout="vertical" initialValues={{ segmentId: activeSegment.id, handoverAt: dayjs(), requiredCapacity: 2.6, operator: '当前用户' }}>
        <Form.Item name="segmentId" label="交接航段" rules={[{ required: true }]}><Select options={shipment.segments.map((item) => ({ label: `${item.from} → ${item.to}（${item.id}）`, value: item.id }))} /></Form.Item>
        <Form.Item name="handoverAt" label="交接时刻" rules={[{ required: true, message: '必须指定交接时刻' }]}><DatePicker showTime={{ format: 'HH:mm' }} format="YYYY-MM-DD HH:mm" className="full-width" /></Form.Item>
        <Form.Item name="toContainerId" label="备用箱" rules={[{ required: true, message: '必须选择备用箱' }]}><Select options={state.backupContainers.filter((item) => item.status === '可用').map((item) => ({ label: `${item.id} · ${item.station} · 容量${item.capacity}m³`, value: item.id }))} /></Form.Item>
        <Form.Item name="requiredCapacity" label="所需容量 (m³)" rules={[{ required: true }]}><InputNumber min={0.5} step={0.1} className="full-width" /></Form.Item>
        <Form.Item name="operator" label="发起人" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="note" label="交接说明"><Input.TextArea rows={2} /></Form.Item>
      </Form>
      <Alert type="info" showIcon message="备用箱容量不足时交接单自动排队并标记缺口，容量补足后才能确认" />
    </Modal>
    <Modal title={`确认温控箱交接 ${confirmLive?.id ?? ''}`} open={Boolean(confirmLive)} onCancel={() => { setConfirmId(''); setConflictMessage('') }} onOk={submitConfirm} okText="提交交接确认">
      {confirmLive && <div>
        <Descriptions size="small" column={2} items={[
          { key: 'swap', label: '换箱', children: `${confirmLive.fromContainerId} → ${confirmLive.toContainerId}` },
          { key: 'at', label: '交接时刻', children: fmt(confirmLive.handoverAt) },
          { key: 'station', label: '站点', children: confirmLive.station },
          { key: 'version', label: '交接单版本', children: `V${confirmLive.version}` }
        ]} />
        {confirmPreview && <Alert className="confirm-preview" type="info" showIcon message={`确认后将冻结旧箱读数${confirmPreview.freezeCount}点，新箱自${confirmLive.handoverAt.slice(11, 16)}续记${confirmPreview.spanning.length > 0 ? `；${confirmPreview.spanning.length}项跨交接偏差将按责任时段拆分` : ''}`} />}
        {conflictMessage && <Alert className="confirm-preview" type="error" showIcon message="版本冲突" description={conflictMessage} />}
        <Form form={confirmForm} layout="vertical">
          <Form.Item name="operator" label="确认人" rules={[{ required: true, message: '必须填写确认人' }]}><Input /></Form.Item>
          <Form.Item name="note" label="交接备注"><Input.TextArea rows={3} /></Form.Item>
        </Form>
        <div className="drill-bar">
          <Button size="small" onClick={() => state.simulateConcurrentConfirm(confirmLive.id)}>模拟他人提交</Button>
          <span>落盘失败演练</span><Switch size="small" checked={state.persistFailureDrill} onChange={state.setPersistFailureDrill} />
        </div>
      </div>}
    </Modal>
    <Modal title={`更换备用箱 ${swapLive?.id ?? ''}`} open={Boolean(swapLive)} onCancel={() => setSwapId('')} onOk={submitSwap} okText="确认更换">
      {swapLive && <div>
        <Alert type="warning" showIcon message={`所需容量${swapLive.requiredCapacity}m³，当前备用箱${swapLive.toContainerId}容量${swapLive.backupCapacity}m³，缺口${swapLive.capacityGap.toFixed(1)}m³`} />
        <Form form={swapForm} layout="vertical" className="swap-form">
          <Form.Item name="toContainerId" label="新备用箱" rules={[{ required: true, message: '必须选择备用箱' }]}>
            <Select options={state.backupContainers.filter((item) => item.status === '可用' && item.id !== swapLive.toContainerId).map((item) => ({ label: `${item.id} · ${item.station} · 容量${item.capacity}m³${item.capacity >= swapLive.requiredCapacity ? '（可满足）' : `（仍缺${(swapLive.requiredCapacity - item.capacity).toFixed(1)}m³）`}`, value: item.id }))} />
          </Form.Item>
        </Form>
      </div>}
    </Modal>
  </section>
}
