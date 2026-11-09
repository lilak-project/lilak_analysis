/**
 * analysis-v2 — the declaration. A flow is a name and the macro it draws; the
 * macro file stays the original, and the record only points at it. `root` names
 * where the path starts (the backend's ROOTS).
 */
import './strings.js'
import { tr } from 'lilak-ui/i18n.jsx'
import MacroField from './MacroField.jsx'

const openMap = (f, setF, ctx) => (f.id && f.path && ctx?.openTab ? (
  <button type="button" className="rl-btn" onClick={() => ctx.openTab({
    id: `flow:${f.id}`, kind: 'view', view: 'flow', who: f.id, label: f.name || f.path })}>
    {tr('av_open_map')}
  </button>
) : null)

export default {
  name: 'analysis-v2', title: tr('av_title'), unit: tr('av_unit'), key: 'av',
  item: {
    key: 'flows', noun: tr('av_noun'), allLabel: tr('av_tab_home'), tabId: 'home', label: 'name',
    order: { k: 'updatedAt', dir: -1 },
    actions: openMap,
    check: (r) => {
      if (!String(r.name || '').trim()) return tr('av_need_name')
      return /\.(mac|par)$/.test(r.path || '') ? '' : tr('av_need_macro')
    },
    fill: (r) => ({ ...r, name: String(r.name || '').trim(), root: r.root || 'lilak' }),
    fields: [
      { k: 'name', label: tr('av_f_name'), type: 'text', required: true, width: 320, col: { w: 240, min: 120 }, tone: 'ink' },
      { k: 'path', label: tr('av_f_path'), type: 'text', required: true, mono: true, hint: tr('av_f_path_hint'),
        edit: (p) => <MacroField {...p} />, col: { w: 340, min: 140 }, tone: 'dim' },
      { k: 'note', label: tr('av_f_note'), type: 'longtext', rows: 3, col: { w: 240, min: 80, drop: 1000 }, tone: 'dim' },
    ],
  },
  classes: [],
}
