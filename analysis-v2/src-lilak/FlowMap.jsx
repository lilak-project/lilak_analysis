import { useEffect, useMemo } from 'react'
import { Background, BackgroundVariant, Controls, Handle, Position, ReactFlow, useNodesState } from '@xyflow/react'
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
const HEADS = ['detectors', 'inputs', 'tasks', 'output']

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
  const headed = role === 'master' || role === 'inputfile' || role === 'outputfile'
  const body = role === 'task' || role === 'detector' || role === 'inbranch' || role === 'outbranch'
  return (
    <div className={`av-node${data.empty ? ' empty' : ''}`} style={{ '--av-kind': KIND[role] }}>
      {role === 'run' && HEADS.map((h, i) => (
        <Handle key={h} id={`run-${h}`} type="source" position={Position.Bottom} style={{ left: `${20 + i * 20}%` }} />
      ))}
      {role === 'run' && <Handle id="param" type="source" position={Position.Left} />}
      {role === 'parambox' && <Handle id="pcin" type="target" position={Position.Right} />}
      {headed && <Handle id="top" type="target" position={Position.Top} />}
      {headed && <Handle id="chain" type="source" position={Position.Bottom} />}
      {body && <Handle id="chaintop" type="target" position={Position.Top} />}
      {body && <Handle id="chainbot" type="source" position={Position.Bottom} />}
      <div className="av-row av-head">
        <span className="av-title" title={data.label}>{data.label}</span>
        <span className="av-tag">{data.class_kind && role !== 'master' ? data.class_kind : TAG[role]}</span>
      </div>
      {role !== 'task' && data.subtitle && <div className="av-row av-sub" title={data.subtitle}>{data.subtitle}</div>}
      {portRows(role).map(([l, r], i) => <PortRow key={i} left={l} right={r} />)}
    </div>
  )
}

function RegionNode({ data }) {
  return <div className="av-region"><div className="av-region-head">{data.label}</div></div>
}

const NODE_TYPES = { lilak: LilakNode, region: RegionNode }

export default function FlowMap({ model }) {
  const { nodes: laid, edges } = useMemo(() => flowLayout(model), [model])
  const [nodes, setNodes, onNodesChange] = useNodesState(laid)
  useEffect(() => setNodes(laid), [laid, setNodes])
  return (
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={NODE_TYPES} onNodesChange={onNodesChange}
      nodesConnectable={false} fitView fitViewOptions={{ padding: 0.12, maxZoom: 1 }} minZoom={0.25}
      proOptions={{ hideAttribution: true }}>
      <Background variant={BackgroundVariant.Dots} gap={26} size={1} color="var(--rk-edge)" />
      <Controls showInteractive={false} position="bottom-right" />
    </ReactFlow>
  )
}
