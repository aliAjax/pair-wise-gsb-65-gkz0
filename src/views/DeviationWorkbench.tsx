import { useEffect, useState } from 'react'
import { Badge, Button, Card, Descriptions, Empty, Form, Input, Modal, Select, Space, Tabs, Tag, message } from 'antd'
import { useShipmentStore } from '../store/useShipmentStore'
import { isOpenDeviation } from '../types'

export function DeviationWorkbench() {
  const state = useShipmentStore()
  const [selectedId, setSelectedId] = useState(state.deviations[0]?.id ?? '')
  const selected = state.deviations.find((item) => item.id === selectedId) ?? state.deviations[0]
  const [form] = Form.useForm()
  const [reviewOpen, setReviewOpen] = useState(false)
  useEffect(() => { if (selected) form.setFieldsValue(selected) }, [selected, form])
  useEffect(() => { if (!selectedId && selected) setSelectedId(selected.id) }, [selectedId, selected])
  const save = async () => {
    const values = await form.validateFields()
    state.saveInvestigation(selected.id, values)
    message.success('调查已提交放行复核')
  }
  const review = async () => {
    const values = await form.validateFields()
    const result = state.reviewDeviation(selected.id, values.disposition, values.reviewNote)
    result.ok ? message.success(result.message) : message.error(result.message)
    if (result.ok) setReviewOpen(false)
  }
  if (!selected) return <section className="page"><Empty description="暂无偏差" /></section>
  const readonly = selected.status === '已关闭' || selected.status === '已拆分'
  const shipment = state.shipments.find((item) => item.id === selected.shipmentId)
  const segment = shipment?.segments.find((item) => item.id === selected.segmentId)
  const children = state.deviations.filter((item) => item.parentId === selected.id)
  const parent = selected.parentId ? state.deviations.find((item) => item.id === selected.parentId) : undefined
  const rawPoints = (segment?.temperature ?? [])
    .filter((item) => !selected.periodStart || !selected.periodEnd || (item.time >= selected.periodStart && item.time <= selected.periodEnd))
    .slice(0, 8)
  return <section className="page">
    <header className="page-head"><div><p>温度超限 / 原因调查 / 放行复核</p><h1>温度偏差调查</h1></div><Badge count={state.deviations.filter(isOpenDeviation).length} showZero /></header>
    <div className="deviation-layout">
      <div className="deviation-nav">{state.deviations.map((item) => <button key={item.id} className={item.id === selected.id ? 'active' : ''} onClick={() => setSelectedId(item.id)}><div><Badge status={item.severity === '重大' ? 'error' : 'warning'} /><strong>{item.title}</strong></div><span>{item.id}</span><small>{item.shipmentId}{item.containerId ? ` · ${item.containerId}` : ''} · V{item.version}</small><Tag color={item.status === '已关闭' ? 'success' : item.status === '已拆分' ? 'default' : 'processing'}>{item.status}</Tag></button>)}</div>
      <div className="deviation-main">
        <div className="panel-title"><div><h2>{selected.title}</h2><span>{selected.id} · {selected.source}</span></div><Space><Button onClick={() => setReviewOpen(true)} disabled={selected.status !== '待放行复核'}>放行复核</Button><Button type="primary" onClick={save} disabled={readonly}>保存并提交</Button></Space></div>
        <Descriptions size="small" column={4} items={[
          { key: 'shipment', label: '运输任务', children: selected.shipmentId },
          { key: 'segment', label: '航段', children: selected.segmentId },
          { key: 'container', label: '责任箱', children: selected.containerId ?? '未归属' },
          { key: 'period', label: '责任时段', children: selected.periodStart ? `${selected.periodStart.replace('T', ' ').slice(5, 16)} - ${selected.periodEnd?.slice(11, 16) ?? ''}` : '全窗口' },
          { key: 'owner', label: '调查负责人', children: selected.owner },
          { key: 'due', label: '截止日期', children: selected.dueDate },
          { key: 'handover', label: '交接版本', children: `V${shipment?.handoverVersion ?? 1}` },
          { key: 'chain', label: '交接链', children: parent ? `拆分自${parent.id}` : children.length > 0 ? `已拆分为${children.map((item) => item.id.split('-').pop()).join('+')}段` : '未拆分' }
        ]} />
        {selected.status === '已拆分' && <Card size="small" className="split-note"><strong>跨交接偏差已按责任时段拆分</strong><p>旧箱历史随冻结读数保留，调查在子偏差中继续：</p>{children.map((item) => <Tag key={item.id} onClick={() => setSelectedId(item.id)} className="split-tag">{item.containerId} · {item.periodStart?.slice(11, 16)}-{item.periodEnd?.slice(11, 16)} · {item.status}</Tag>)}</Card>}
        <Form form={form} layout="vertical" className="deviation-form">
          <div className="two-column">
            <Form.Item name="cause" label="原因调查" rules={[{ required: true, message: '必须记录设备、操作、转运或环境因素' }]}><Input.TextArea rows={5} disabled={readonly} /></Form.Item>
            <Form.Item name="assessment" label="影响评估" rules={[{ required: true, message: '必须评估超限时间与货物稳定性' }]}><Input.TextArea rows={5} disabled={readonly} /></Form.Item>
          </div>
          <div className="two-column">
            <Form.Item name="disposition" label="建议处置" rules={[{ required: true }]}><Select disabled={readonly} options={['接受', '补充处理', '拒绝'].map((value) => ({ label: value, value }))} /></Form.Item>
            <Form.Item name="evidence" label="证据摘要" rules={[{ required: true }]}><Input disabled={readonly} /></Form.Item>
          </div>
          <Form.Item name="correctiveAction" label="纠正措施或收货条件" rules={[{ required: true }]}><Input.TextArea rows={3} disabled={readonly} /></Form.Item>
        </Form>
        <Tabs items={[{ key: 'point', label: '原始时间点', children: <div className="raw-points"><strong>温度点只读{selected.containerId ? ` · 责任箱${selected.containerId}` : ''}</strong><p>航段原始记录已关联至任务，任何调查修订不得覆盖设备原始曲线。</p><code>{rawPoints.map((item) => `${item.time.slice(11, 16)} ${item.value}℃${item.containerId ? ` ${item.containerId}` : ''}`).join('  |  ') || '该责任时段无读数'}</code></div> }, { key: 'review', label: '复核记录', children: selected.reviewer ? <Card size="small"><strong>{selected.reviewer}</strong><p>{selected.reviewNote}</p></Card> : <Empty description="尚未复核" /> }]} />
      </div>
    </div>
    <Modal title="放行复核" open={reviewOpen} onCancel={() => setReviewOpen(false)} onOk={review} okText="确认复核">
      <Form form={form} layout="vertical">
        <Form.Item name="disposition" label="复核结论" rules={[{ required: true }]}><Select options={['接受', '补充处理', '拒绝'].map((value) => ({ label: value, value }))} /></Form.Item>
        <Form.Item name="reviewNote" label="复核意见" rules={[{ required: true, message: '复核必须填写意见' }]}><Input.TextArea rows={4} /></Form.Item>
      </Form>
    </Modal>
  </section>
}
