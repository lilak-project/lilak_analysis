import './strings.js'
import { createRoot } from 'react-dom/client'
import { RackService } from 'racklist'
import 'racklist/rack.css'
import def from './def.jsx'
import FlowView from './FlowView.jsx'

const views = { flow: (tab, api) => <FlowView flow={(api.doc?.flows || []).find((r) => r.id === tab.who)} /> }

createRoot(document.getElementById('root')).render(<RackService def={def} slots={{ views }} />)
