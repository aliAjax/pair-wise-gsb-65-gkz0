import { useMemo, useState } from 'react'
import { Alert, Button, Form, Input, InputNumber, Modal, Select, Tag, message } from 'antd'
import { WarningOutlined } from '@ant-design/icons'
import { useShipmentStore, type HandoverDraft } from '../store/useShipmentStore'
import type { Shipment } from '../types'

const toLocal = (iso: string) => iso.slice(0, 16)
const fmt = (iso: string) => iso.replace('T', ' ').slice(0, 16)

interface Props {
  open: boolean
  shipment: Shipment
  onClose: () => void
}

/**
 * 温控箱交接确认弹窗。
 * 打开时冻结交接链基线版本（乐观锁）：两人同时提交时后到者看到版本冲突，填写内容保留。
 * 落盘失败时草稿与基线保留，可从交接前原样重试。
 */
export function HandoverModal({ open, shipment, onClose }: Props) {
  const state = useShipmentStore()
  const [form] = Form.useForm()
  // 弹窗打开瞬间的交接链版本：提交时必须仍等于该版本
  const [baseVersion, setBaseVersion] = useState(shipment.handoverVersion)
  const [conflict, setConflict] = useState<{ base: number; latest: number } | null>(null)
  const [persistFailed, setPersistFailed] = useState(false)
  const [lastDraft, setLastDraft] = useState<HandoverDraft | null>(null)

  const lastPointTime = useMemo(() => {
    const times = shipment.segments.flatMap((segment) => segment.temperature.map((point) => point.time))
    return times.length ? times.sort().at(-1)! : shipment.actualArrival
  }, [shipment])

  const defaultTime = useMemo(() => {
    const date = new Date(lastPointTime)
    date.setMinutes(date.getMinutes() + 10)
    return toLocal(date.toISOString().slice(0, 19))
  }, [lastPointTime])

  const spareOptions = state.spares.map((spare) => ({
    value: spare.id,
    label: `${spare.id}（${spare.station} · 余量${spare.capacityFree}L · ${spare.status}）`,
    disabled: spare.id === shipment.containerId
  }))

  const submit = (draft: HandoverDraft, base: number) => {
    const result = state.confirmHandover(shipment.id, draft, base)
    if (result.ok) {
      result.queued ? message.warning(result.message) : message.success(result.message)
      setConflict(null); setPersistFailed(false)
      onClose()
      return
    }
    if (result.conflict) {
      setConflict({ base, latest: result.currentVersion ?? shipment.handoverVersion })
      message.error(result.message)
      return
    }
    if (result.persistFailed) {
      setPersistFailed(true)
      message.error(result.message)
      return
    }
    message.error(result.message)
  }

  const onFinish = (values: { airport: string; handoverAt: string; toContainerId: string; requiredCapacity: number; reason: string; operator: string }) => {
    const draft: HandoverDraft = { ...values, handoverAt: `${values.handoverAt}:00` }
    setLastDraft(draft)
    submit(draft, baseVersion)
  }

  /** 并发演练：模拟另一值班员用同基线抢先完成一次交接，把交接链推到下一版本 */
  const simulateConcurrent = () => {
    const values = form.getFieldsValue()
    const other = state.spares.find((spare) => spare.id !== values.toContainerId && spare.id !== shipment.containerId)
    if (!other) { message.warning('没有可用于演练的第二个备用箱'); return }
    const draft: HandoverDraft = {
      airport: values.airport || 'PVG 浦东机场中转坪',
      handoverAt: `${values.handoverAt}:00`,
      toContainerId: other.id,
      requiredCapacity: values.requiredCapacity,
      reason: '值班员B同时提交的并发交接（演练）',
      operator: '中转值班员 赵峥（演练）'
    }
    const result = state.confirmHandover(shipment.id, draft, baseVersion)
    if (result.ok) {
      message.warning(`值班员赵峥已先一步确认（V${result.currentVersion}），您现在提交将看到版本冲突`)
    } else {
      message.error(result.message)
    }
  }

  const retryAfterFailure = () => {
    if (lastDraft) submit(lastDraft, baseVersion)
  }

  const rebaseAndRetry = async () => {
    const values = await form.validateFields()
    const latest = state.shipments.find((item) => item.id === shipment.id)?.handoverVersion ?? baseVersion
    setBaseVersion(latest)
    setConflict(null)
    submit({ ...values, handoverAt: `${values.handoverAt}:00` }, latest)
  }

  return <Modal
    title={`温控箱交接确认 · ${shipment.id}`}
    open={open}
    onCancel={onClose}
    width={640}
    footer={null}
    destroyOnClose
    afterOpenChange={(openNow) => {
      if (openNow) {
        setBaseVersion(shipment.handoverVersion)
        setConflict(null); setPersistFailed(false); setLastDraft(null)
        form.setFieldsValue({
          airport: shipment.route.includes('PEK') ? 'PEK 首都机场中转场' : 'PVG 浦东机场中转坪',
          handoverAt: defaultTime,
          toContainerId: undefined,
          requiredCapacity: shipment.cargoVolume,
          reason: '',
          operator: '中转值班员 何琳'
        })
      }
    }}
  >
    <Alert
      className="handover-base"
      type="info" showIcon
      message={<span>当前温控箱 <b>{shipment.containerId}</b> · 交接链基线 <b>V{baseVersion}</b> · 货物需求 {shipment.cargoVolume}L</span>}
      description="交接确认后：交接时刻前的旧箱温度点与证据冻结；新箱从交接时刻续记；跨交接偏差按责任时段拆开，旧箱段冻结保留。"
    />
    {conflict && <Alert
      className="handover-alert"
      type="error" showIcon icon={<WarningOutlined />}
      message={<span>版本冲突：您的填写基于 V{conflict.base}，交接链已被另一值班员推进到 <b>V{conflict.latest}</b></span>}
      description="您填写的内容已全部保留。请核对最新交接链后，基于最新版本重新提交。"
      action={<Button size="small" danger type="primary" onClick={rebaseAndRetry}>保留填写并基于 V{conflict.latest} 重试</Button>}
    />}
    {persistFailed && <Alert
      className="handover-alert"
      type="error" showIcon
      message="落盘失败：交接未生效，数据仍停留在交接前状态"
      description="草稿与基线版本均已保留，请从交接前原样重试。"
      action={<Button size="small" danger type="primary" onClick={retryAfterFailure}>从交接前重试</Button>}
    />}
    <Form form={form} layout="vertical" onFinish={onFinish} initialValues={{ requiredCapacity: shipment.cargoVolume }}>
      <Form.Item name="airport" label="中转交接地点" rules={[{ required: true, message: '必须填写交接地点' }]}><Input placeholder="如：PVG 浦东机场中转坪" /></Form.Item>
      <Form.Item name="handoverAt" label="交接时刻（旧箱冻结 / 新箱续记的分界）" rules={[{ required: true, message: '必须指定交接时刻' }]}>
        <Input type="datetime-local" step={60} />
      </Form.Item>
      <Form.Item name="toContainerId" label="接入备用箱" rules={[{ required: true, message: '必须选择备用箱' }]}>
        <Select options={spareOptions} placeholder="选择备用温控箱" />
      </Form.Item>
      <Form.Item name="requiredCapacity" label="需要容量（升）" rules={[{ required: true, message: '必须填写容量' }]}><InputNumber min={1} style={{ width: '100%' }} addonAfter="L" /></Form.Item>
      <Form.Item name="reason" label="换箱原因与旧箱读数摘要" rules={[{ required: true, message: '必须记录换箱原因' }]}><Input.TextArea rows={2} placeholder="如：旧箱制冷告警，最后读数8.6℃，外观完好" /></Form.Item>
      <Form.Item name="operator" label="交接值班员" rules={[{ required: true }]}><Input /></Form.Item>
      <div className="handover-actions">
        <Button type="dashed" size="small" onClick={simulateConcurrent}>并发演练：模拟值班员赵峥先一步提交</Button>
        <span>最近读数 {fmt(lastPointTime)}（冻结线）</span>
        <Button type="primary" htmlType="submit">确认交接（V{baseVersion}）</Button>
      </div>
    </Form>
  </Modal>
}
