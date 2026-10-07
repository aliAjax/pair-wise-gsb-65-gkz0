import { useMemo, useState } from 'react'
import { Button } from 'antd'
import type { TemperaturePoint } from '../types'

interface HandoverMark {
  at: string
  from: string
  to: string
}

interface Props {
  points: TemperaturePoint[]
  min: number
  max: number
  handovers?: HandoverMark[]
  frozenContainers?: string[]
}

const PALETTE = ['#146b74', '#b8813a', '#6a5aa8', '#3f7fb5']

export function TemperatureChart({ points, min, max, handovers = [], frozenContainers = [] }: Props) {
  const [zoom, setZoom] = useState(1)
  const containers = useMemo(() => {
    const ids: string[] = []
    points.forEach((point) => { if (point.containerId && !ids.includes(point.containerId)) ids.push(point.containerId) })
    return ids
  }, [points])
  const colorOf = (containerId?: string) => {
    if (!containerId) return PALETTE[0]
    const index = containers.indexOf(containerId)
    return PALETTE[index % PALETTE.length]
  }
  const geometry = useMemo(() => {
    const visible = points.slice(0, Math.max(4, Math.round(points.length * zoom)))
    const low = Math.min(min, ...visible.map((item) => item.value)) - 1
    const high = Math.max(max, ...visible.map((item) => item.value)) + 1
    const coordinates = visible.map((item, index) => ({
      ...item,
      x: 30 + (index / Math.max(visible.length - 1, 1)) * 520,
      y: 145 - ((item.value - low) / Math.max(high - low, 1)) * 100
    }))
    const marks = handovers.map((mark) => {
      const hit = coordinates.find((item) => item.time >= mark.at)
      return hit ? { ...mark, x: hit.x } : null
    }).filter((mark): mark is HandoverMark & { x: number } => Boolean(mark))
    return { low, high, coordinates, marks, path: coordinates.map((item, index) => `${index ? 'L' : 'M'} ${item.x} ${item.y}`).join(' ') }
  }, [points, min, max, zoom, handovers])

  return <div className="chart-wrap">
    <div className="chart-tools">
      <span>显示 {geometry.coordinates.length} 个原始时间点</span>
      {containers.length > 0 && <span className="chart-legend">{containers.map((id) => <em key={id}><i style={{ background: colorOf(id) }} />{id}{frozenContainers.includes(id) ? '（已冻结）' : '（在记）'}</em>)}</span>}
      <Button size="small" onClick={() => setZoom((value) => Math.max(.45, value - .15))}>缩小</Button>
      <Button size="small" onClick={() => setZoom((value) => Math.min(1, value + .15))}>放大</Button>
    </div>
    <svg viewBox="0 0 580 180" role="img" aria-label="温度曲线">
      <rect x="30" y={145 - ((max - geometry.low) / (geometry.high - geometry.low)) * 100} width="520" height={((max - min) / (geometry.high - geometry.low)) * 100} fill="#edf7f3" />
      <line x1="30" y1="145" x2="550" y2="145" stroke="#83918e" />
      <line x1="30" y1="20" x2="30" y2="145" stroke="#83918e" />
      <text x="4" y="28" fontSize="10">{geometry.high.toFixed(1)}℃</text>
      <text x="4" y="149" fontSize="10">{geometry.low.toFixed(1)}℃</text>
      <text x="32" y="18" fontSize="10" fill="#7a8784">允许范围 {min}-{max}℃</text>
      <path d={geometry.path} fill="none" stroke="#146b74" strokeWidth="2.2" strokeOpacity=".45" />
      {geometry.marks.map((mark) => <g key={`${mark.at}-${mark.to}`}>
        <line x1={mark.x} y1="20" x2={mark.x} y2="145" stroke="#b8813a" strokeDasharray="4 3" strokeWidth="1.6" />
        <text x={Math.min(mark.x + 4, 430)} y="32" fontSize="10" fill="#8a5f1f">换箱 {mark.at.slice(11, 16)} → {mark.to}</text>
      </g>)}
      {geometry.coordinates.map((item) => <g key={item.id}><circle cx={item.x} cy={item.y} r="3" fill={item.value < min || item.value > max ? '#bf3f39' : colorOf(item.containerId)} /><title>{`${item.time.replace('T', ' ').slice(0, 16)}，${item.value}℃${item.containerId ? `，${item.containerId}` : ''}`}</title></g>)}
    </svg>
  </div>
}
