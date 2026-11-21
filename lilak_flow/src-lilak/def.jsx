/**
 * lilak_flow — the declaration. An item is a LILAK parameter file under
 * $LILAK_PATH, found by the backend on each load; the file is the original and
 * only its tags and note are kept here. One with a run in it (a `lilak` or
 * `LKRun` group) opens as a flow board, any other as its parameters.
 */
import './strings.js'
import { tr } from 'lilak-ui/i18n.jsx'
import 'racklist'            // its words (rk_tags) before this declaration reads them
import { loadItems, saveItems, newFile } from './api.js'
import { askNewFile } from './NewFile.jsx'
import ParamEdit from './ParamEdit.jsx'
import { useTool, toggleTool, toggleLock, useLocked } from './toolstate.js'
import { press } from 'racklist'

/** The editor's top bar: the toolbox, as note has it, and the flow board for a file with a run. */
function Bar({ f, ctx }) {
  const tool = useTool()
  const locked = useLocked(f.id)
  return (
    <>
      <button type="button" className={`rl-btn${locked ? ' on' : ''}`} aria-pressed={locked} title={tr(locked ? 'av_unlock_hint' : 'av_lock_hint')}
        {...press(() => toggleLock(f.id))}>{tr(locked ? 'av_unlock' : 'av_lock')}</button>
      <button type="button" className={`rl-btn${tool ? ' on' : ''}`} aria-expanded={!!tool} title={tr('av_toolbox_hint')}
        {...press(toggleTool)}>{tr('av_toolbox')}</button>
      {f.flow && ctx?.openTab ? (
        <button type="button" className="rl-btn" onClick={() => ctx.openTab({ id: `flow:${f.id}`, kind: 'view', view: 'flow', who: f.id, label: f.name })}>
          {tr('av_open_board')}
        </button>
      ) : null}
    </>
  )
}
const bar = (f, setF, ctx) => (f.id ? <Bar f={f} ctx={ctx} /> : null)

export default {
  name: 'lilak_flow', title: tr('av_title'), unit: tr('av_unit'), key: 'av',
  source: { load: loadItems, save: saveItems },
  trash: false,
  item: {
    key: 'flows', noun: tr('av_noun'), allLabel: tr('av_tab_home'), tabId: 'home', label: 'name',
    order: { k: 'updated', dir: -1 },
    actions: bar,
    lock: () => true,      // a file is not deleted from here: the list would only find it again
    clone: false,          // a copy is a new file: the toolbox's clone asks where it goes
    // +new asks where the file goes, makes it, and the kit opens it.
    create: async () => {
      const where = await askNewFile({ title: tr('av_new_title'), withTemplate: true })
      if (!where) return null
      const made = await newFile(where)
      return { id: made.id, label: made.name }
    },
    fields: [
      { k: 'name', label: tr('av_f_name'), type: 'text', edit: false, col: { w: 220, min: 120 }, tone: 'ink' },
      { k: 'project', label: tr('av_f_project'), type: 'text', edit: false, col: { w: 90, min: 60 }, tone: 'dim' },
      { k: 'folder', label: tr('av_f_folder'), type: 'text', edit: false, col: { w: 90, min: 60, drop: 1000 }, tone: 'dim' },
      { k: 'flow', label: tr('av_f_flow'), type: 'check', edit: false, col: { w: 44, min: 36 } },
      { k: 'count', label: tr('av_f_count'), type: 'number', edit: false, col: { w: 60, min: 44 }, tone: 'dim' },
      { k: 'updated', label: tr('av_f_updated'), type: 'text', edit: false, col: { w: 130, min: 90 }, tone: 'dim' },
      { k: 'created', label: tr('av_f_created'), type: 'text', edit: false, col: { w: 130, min: 90, drop: 1200 }, tone: 'dim' },
      { k: 'path', label: tr('av_f_path'), type: 'text', mono: true, edit: false, col: { w: 300, min: 120, drop: 1100 }, tone: 'dim' },
      { k: 'tags', label: tr('rk_tags'), type: 'tags', bulk: true, edit: false, col: { w: 140, min: 60 }, tone: 'dim' },
      { k: 'note', label: tr('av_f_note'), type: 'longtext', rows: 3, edit: false },
      { k: 'pars', label: tr('av_open_pars'), type: 'text', store: false, when: (r, { draft }) => !draft,
        edit: (p) => <ParamEdit flow={p.rec} ctx={p.ctx} patch={p.patch} fieldCtx={p.ctx} /> },
    ],
  },
  classes: [{ k: 'tags', label: tr('rk_tags'), field: 'tags' }],
}
