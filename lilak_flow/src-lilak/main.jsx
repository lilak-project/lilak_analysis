import './strings.js'
import { createRoot } from 'react-dom/client'
import { RackService } from 'racklist'
import 'racklist/rack.css'
import def from './def.jsx'
import FlowView from './FlowView.jsx'
import DirView from './DirView.jsx'
import CodeView from './CodeView.jsx'
import InitView from './InitView.jsx'
import LogView from './LogView.jsx'
import Guide from './Guide.jsx'
import { tr } from 'lilak-ui/i18n.jsx'
import { newFile, logbookProject } from './api.js'
import { askNewFile } from './NewFile.jsx'

const fileOf = (tab, api) => (api.doc?.flows || []).find((r) => r.id === tab.who)
const views = {
  flow: (tab, api) => <FlowView flow={fileOf(tab, api)} api={api} />,
}
// A class's header or source, read only, in an editor pane beside the parameters: who is `LKRun.h` or `LKRun.cpp`.
// A file's parameters after Init, read only: who is the file's id.
const editors = {
  code: (tab) => { const [cls, kind] = (tab.who || '').split('.'); return <CodeView cls={cls} kind={kind} /> },
  init: (tab) => <InitView id={tab.who} />,
  // A logbook log this page wrote (an Init or Run): who is its id.
  log: (tab) => <LogView svc="logbook" proj={logbookProject()} id={tab.who} />,
  // Another service's record: who is `svc/proj/id` (the parameters set a run used).
  // A card's guide (run, inputfile, outputfile) for a file: who is `which|id`.
  guide: (tab, api) => { const [which, ...id] = (tab.who || '').split('|'); return <Guide which={which} id={id.join('|')} api={api} /> },
  rec: (tab) => { const [svc, proj, ...id] = (tab.who || '').split('/'); return <LogView svc={svc} proj={proj} id={id.join('/')} /> },
}

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

createRoot(document.getElementById('root')).render(<RackService def={def} slots={{ views, editors, pick, tabs }} />)
