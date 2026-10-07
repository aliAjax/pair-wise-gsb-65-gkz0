import { useEffect, useState } from 'react'
import { Badge, Button, Card, Descriptions, Empty, Form, Input, Modal, Select, Space, Tabs, Tag, message } from 'antd'
import { useShipmentStore } from '../store/useShipmentStore'
import type { Deviation } from '../types'

export function DeviationWorkbench() {
  const state = useShipmentStore()
  const [selectedId, setSelectedId] = useState(state.deviations[0]?.id ?? '')
  const selected = state.deviations.find((item) => item.id === selectedId) ?? state.deviations[0]
  const [form] = Form.useForm()
  const [reviewOpen, setReviewOpen] = useState(false)
  useEffect(() => { if (selected) form.setFieldsValue(selected) }, [selected, form])
  useEffect(() => { if (!selectedId && selected) setSelectedId(selected.id) }, [selectedId, selected])
  const ship = selected ? state.shipments.find((item) => item.id === selected.shipmentId) : undefined
  const responsiblePoints = ship && selected
    ? ship.segments.flatMap((segment) => segment.temperature)
        .filter((point) => point.containerId === selected.containerId && point.time >= selected.periodStart && point.time <= selected.periodEnd)
    : []
  const readOnly = !selected || selected.status === '已关闭' || selected.frozen
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
  return <section className="page">
    <header className="page-head"><div><p>温度超限 / 原因调查 / 放行复核</p><h1>温度偏差调查</h1></div><Badge count={state.deviations.filter((item) => item.status !== '已关闭').length} showZero /></header>
    <div className="deviation-layout">
      <div className="deviation-nav">{state.deviations.map((item) => <button key={item.id} className={item.id === selected.id ? 'active' : ''} onClick={() => setSelectedId(item.id)}><div><Badge status={item.severity === '重大' ? 'error' : 'warning'} /><strong>{item.title}</strong></div><span>{item.id}</span><small>{item.shipmentId} · {item.containerId} · V{item.version}</small><div>{item.frozen && <Tag color="geekblue">旧箱冻结</Tag>}{item.splitFromId && <Tag color="purple">跨交接拆出</Tag>}<Tag color={item.status === '已关闭' ? 'success' : 'processing'}>{item.status}</Tag></div></button>)}</div>
      <div className="deviation-main">
        <div className="panel-title"><div><h2>{selected.title}</h2><span>{selected.id} · {selected.source} · 责任箱 {selected.containerId} · {ship ? `交接链 V${ship.handoverVersion}` : ''}</span></div><Space>
          {selected.frozen && <Tag color="geekblue">旧箱责任段已冻结保留</Tag>}
          {selected.splitFromId && <Tag color="purple">由 {selected.splitFromId} 拆出（新箱续记）</Tag>}
          <Button onClick={() => setReviewOpen(true)} disabled={selected.status !== '待放行复核'}>放行复核</Button>
          <Button type="primary" onClick={save} disabled={readOnly}>{selected.frozen ? '旧箱冻结，不可改写' : '保存并提交'}</Button>
        </Space></div>
        <Descriptions size="small" column={4} items={[
          { key: 'shipment', label: '运输任务', children: selected.shipmentId },
          { key: 'box', label: '责任温控箱', children: <b>{selected.containerId}</b> },
          { key: 'period', label: '责任时段', children: `${selected.periodStart.replace('T', ' ').slice(0, 16)} ~ ${selected.periodEnd.replace('T', ' ').slice(0, 16)}` },
          { key: 'due', label: '截止日期', children: selected.dueDate }
        ]} />
        {selected.frozen && <div className="frozen-banner">该片段在温控箱交接时冻结：读数、证据与调查结论保留为旧箱历史，只能查看与复核，不能随新箱续记修改。</div>}
        <Form form={form} layout="vertical" className="deviation-form">
          <div className="two-column">
            <Form.Item name="cause" label="原因调查" rules={[{ required: true, message: '必须记录设备、操作、转运或环境因素' }]}><Input.TextArea rows={5} disabled={readOnly} /></Form.Item>
            <Form.Item name="assessment" label="影响评估" rules={[{ required: true, message: '必须评估超限时间与货物稳定性' }]}><Input.TextArea rows={5} disabled={readOnly} /></Form.Item>
          </div>
          <div className="two-column">
            <Form.Item name="disposition" label="建议处置" rules={[{ required: true }]}><Select disabled={readOnly} options={['接受', '补充处理', '拒绝'].map((value) => ({ label: value, value }))} /></Form.Item>
            <Form.Item name="evidence" label="证据摘要" rules={[{ required: true }]}><Input disabled={readOnly} /></Form.Item>
          </div>
          <Form.Item name="correctiveAction" label="纠正措施或收货条件" rules={[{ required: true }]}><Input.TextArea rows={3} disabled={readOnly} /></Form.Item>
        </Form>
        <Tabs items={[{ key: 'point', label: `责任时段原始点 (${responsiblePoints.length})`, children: <div className="raw-points"><strong>温度点只读 · 仅取责任箱 {selected.containerId} 在责任时段内的读数</strong><p>跨交接偏差已在交接时刻拆分；旧箱冻结点显示虚线灰色，任何调查修订不得覆盖设备原始曲线。</p><code>{responsiblePoints.length ? responsiblePoints.map((item) => `${item.time.slice(11, 16)} ${item.value}℃${item.frozen ? '〔冻〕' : ''}`).join('  |  ') : '该责任时段内无温度点'}</code></div> }, { key: 'review', label: '复核记录', children: selected.reviewer ? <Card size="small"><strong>{selected.reviewer}</strong><p>{selected.reviewNote}</p></Card> : <Empty description="尚未复核" /> }]} />
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
