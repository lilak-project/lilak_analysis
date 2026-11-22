import './strings.js'
import { createRoot } from 'react-dom/client'
import { RackService } from 'racklist'
import 'racklist/rack.css'
import def from './def.jsx'
import FlowView from './FlowView.jsx'
import DirView from './DirView.jsx'
import { tr } from 'lilak-ui/i18n.jsx'
import { newFile } from './api.js'
import { askNewFile } from './NewFile.jsx'

const fileOf = (tab, api) => (api.doc?.flows || []).find((r) => r.id === tab.who)
const views = { flow: (tab, api) => <FlowView flow={fileOf(tab, api)} /> }

// With several files picked: one new file holding them one after another.
const pick = (api) => (
  <button type="button" className="rl-btn" disabled={(api.picked?.size || 0) < 2} title={tr('av_merge_hint')}
    onClick={async () => {
      const where = await askNewFile({ title: tr('av_merge') })
      if (!where) return
      try {
        const made = await newFile({ ...where, ids: (api.doc?.flows || []).map((f) => f.id).filter((id) => api.picked.has(id)) })
        await api.reload()
        api.openItem(made.id)
      } catch (e) { api.setNote(e.message) }
    }}>{tr('av_merge')}</button>
)

// The directory tab, beside home: the same files by folder.
const tabs = [{ id: 'dirs', lead: true, label: tr('av_tab_dirs'), render: (api) => <DirView api={api} /> }]

createRoot(document.getElementById('root')).render(<RackService def={def} slots={{ views, pick, tabs }} />)
