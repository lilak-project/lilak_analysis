/**
 * lilak flow's toolbox: the tabs of racklist's RackToolbox beside a parameter
 * file's editor. A tool is { id, label (an i18n key), Body } and its Body gets
 * the ctx ParamEdit builds:
 *
 *   flow      the record: name, project, folder, path, dates, count, tags, note
 *   patch     (fields) => void, a change to the record (the kit's save stores it)
 *   fieldCtx  what the kit hands a field (the tag box needs it)
 *   file      { backups }, and reload(), restore(), copyTo(title, name) — saving is automatic
 *   view      the view now, and show(view)
 *   rows      the rows' operations on what is picked: add, comment, off, remove, move, copy, paste, some, raw
 *   doc(g)    LILAK's class reference for a group name
 */
import { Fragment } from 'react'
import { tr } from 'lilak-ui/i18n.jsx'
import { RackField, PathLine, typeOf, press } from 'racklist'
import './strings.js'
import { hhmm } from './history.js'

/** A tool's button and a line saying what it does. */
function Tool({ k, on, off, go }) {
  return (
    <>
      <button type="button" className={`rl-btn${on ? ' on' : ''}`} disabled={off} {...press(go)}>{tr(`av_t_${k}`)}</button>
      <span className="av-tdesc">{tr(`av_d_${k}`)}</span>
    </>
  )
}

const TAGS = { k: 'tags', type: 'tags', label: 'tags' }

const info = {
  id: 'info', label: 'av_info',
  Body({ flow, patch, fieldCtx, revert, locked }) {
    const T = typeOf(TAGS)
    return (
      <div className="rl-rec">
        <PathLine kind="flows" id={flow.id} />
        <RackField label={tr('av_f_path')}><span className="rl-mono av-wrap">{flow.path}</span></RackField>
        <RackField label={tr('av_f_project')}>{flow.project}{flow.folder ? <span className="rl-hint">/ {flow.folder}</span> : null}</RackField>
        <RackField label={tr('av_f_count')}>{flow.count}{flow.flow ? <span className="rl-hint">{tr('av_has_run')}</span> : null}</RackField>
        <RackField label={tr('av_f_updated')}>{flow.updated}</RackField>
        <RackField label={tr('av_f_created')}>{flow.created}</RackField>
        <RackField label={tr('rk_tags')}>
          {locked ? (flow.tags || []).join(', ') : <T.Edit value={flow.tags || []} onChange={(v) => patch({ tags: v })} field={TAGS} ctx={fieldCtx} rec={flow} patch={patch} />}
        </RackField>
        <RackField label={tr('av_f_note')}>
          <textarea className="rl-in rl-grow" rows={3} style={{ width: '100%' }} value={flow.note || ''} readOnly={locked}
            onChange={(e) => patch({ note: e.target.value })} />
        </RackField>
        <RackField label={tr('av_revert')}>
          <button type="button" className="rl-btn" disabled={locked} {...press(revert)}>{tr('av_revert_go')}</button>
          <span className="rl-hint">{tr('av_revert_hint')}</span>
        </RackField>
        <div className="rl-hint av-tip">{tr('av_info_save')}</div>
      </div>
    )
  },
}

const fileTool = {
  id: 'file', label: 'av_tool_file',
  Body({ file, flow, locked }) {
    return (
      <div className="av-tools">
        <Tool k="reload" go={file.reload} />
        <Tool k="restore" off={locked || !file.backups} go={file.restore} />
        <Tool k="clone" go={() => file.copyTo(tr('av_t_clone'), `copy_of_${flow.name}`)} />
        <Tool k="saveas" go={() => file.copyTo(tr('av_t_saveas'), flow.name)} />
        {/* This tab's record: the file as opened, then as it stood after each spell of editing. */}
        <span className="av-thead">{tr('av_hist')}</span>
        {file.history.map((h, i) => (
          <Fragment key={h.at}>
            <button type="button" className="rl-btn" disabled={locked} {...press(() => file.back(h))}>{hhmm(h.at)}</button>
            <span className="av-tdesc">{i === 0 ? tr('av_hist_first') : tr('av_hist_after', h.text.split('\n').filter(Boolean).length)}</span>
          </Fragment>
        ))}
        {file.history.length < 2 && <span className="av-tdesc av-tspan">{tr('av_hist_none')}</span>}
      </div>
    )
  },
}

const VIEWS = ['table', 'group', 'rich', 'raw']
const viewTool = {
  id: 'view', label: 'av_tool_view',
  Body({ view }) {
    const grouped = view.now !== 'group'
    return (
      <div className="av-tools">
        {VIEWS.map((v) => <Tool key={v} k={`v_${v}`} on={view.now === v} go={() => view.show(v)} />)}
        <Tool k="open_all" off={grouped || !view.shut.size} go={() => view.setShut(new Set())} />
        <Tool k="shut_all" off={grouped} go={() => view.setShut(new Set(view.groups()))} />
      </div>
    )
  },
}

const parTool = {
  id: 'par', label: 'av_tool_par',
  badge: ({ rows }) => (rows.some ? rows.some : null),
  Body({ rows: r, locked }) {
    const off = r.raw || locked, none = off || !r.some
    return (
      <div className="av-tools">
        <Tool k="par" off={off} go={r.addPar} />
        <Tool k="comment" off={off} go={r.addComment} />
        <Tool k="off" off={none} go={r.off} />
        <Tool k="remove" off={none} go={r.remove} />
        <Tool k="up" off={none} go={() => r.move(-1)} />
        <Tool k="down" off={none} go={() => r.move(1)} />
        <Tool k="top" off={none} go={() => r.move('top')} />
        <Tool k="end" off={none} go={() => r.move('end')} />
        <Tool k="copy" off={r.raw || !r.some} go={r.copy} />
        <Tool k="paste" off={off || !r.clip} go={r.paste} />
        {r.raw ? <span className="rl-hint av-tip">{tr('av_par_raw')}</span> : null}
        {locked ? <span className="rl-hint av-tip">{tr('av_locked_tip')}</span> : null}
      </div>
    )
  },
}

export const TOOLS = [info, fileTool, viewTool, parTool]
export { VIEWS }
