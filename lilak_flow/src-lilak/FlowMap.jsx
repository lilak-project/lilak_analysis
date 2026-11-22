import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Background, BackgroundVariant, Controls, Handle, Position, ReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './flowmap.css'
import { flowLayout, portRows } from './layout.js'

const KIND = {
  task: '#b91c1c', detector: '#0d9488', inbranch: '#15803d', outbranch: '#b45309', parambox: '#2563eb',
}
const TAG = {
  run: 'run', master: 'system', parambox: 'parameters', inputfile: 'input', outputfile: 'output',
  inbranch: 'input', outbranch: 'output', task: 'task', detector: 'detector',
}

function PortRow({ left, right }) {
  return (
    <div className="av-row av-port">
      {left && <span className="av-pt">{left}<Handle id={left} type="target" position={Position.Left} /></span>}
      {right && <span className="av-pt out">{right}<Handle id={right} type="source" position={Position.Right} /></span>}
    </div>
  )
}

/** One card: a head row, then a row each for the subtitle and the ports. */
function LilakNode({ data }) {
  const { role } = data
  return (
    <div className={`av-node${data.empty ? ' empty' : ''}`} style={{ '--av-kind': KIND[role] }}>
      <div className="av-row av-head">
        <span className="av-title" title={data.label}>{data.label}</span>
        <span className="av-tag">{data.class_kind && role !== 'master' ? data.class_kind : TAG[role]}</span>
      </div>
      {role !== 'task' && data.subtitle && <div className="av-row av-sub" title={data.subtitle}>{data.subtitle}</div>}
      {portRows(role).map(([l, r], i) => <PortRow key={i} left={l} right={r} />)}
    </div>
  )
}

const NODE_TYPES = { lilak: LilakNode }

const PAD = 16

export default function FlowMap({ model }) {
  const { nodes, edges, width } = useMemo(() => flowLayout(model), [model])
  const box = useRef(null), rf = useRef(null)
  // Read from the top, as wide as the pane: the board fills the width, not the height.
  const place = useCallback(() => {
    const w = box.current?.clientWidth
    if (!rf.current || !w || !width) return
    rf.current.setViewport({ x: PAD, y: PAD, zoom: Math.min(1.5, Math.max(0.3, (w - PAD * 2) / width)) })
  }, [width])
  useEffect(() => {
    place()
    const ro = new ResizeObserver(place)
    if (box.current) ro.observe(box.current)
    return () => ro.disconnect()
  }, [place])
  return (
    <div ref={box} style={{ width: '100%', height: '100%' }}>
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={NODE_TYPES} onInit={(i) => { rf.current = i; place() }}
        nodesDraggable={false} nodesConnectable={false} minZoom={0.25} maxZoom={2}
        proOptions={{ hideAttribution: true }}>
        <Background variant={BackgroundVariant.Dots} gap={26} size={1} color="var(--rk-edge)" />
        <Controls showInteractive={false} position="bottom-right" onFitView={place} />
      </ReactFlow>
    </div>
  )
}
