import { useEffect, useId, useState } from 'react'
import { PORTAL_BASE, authHeaders } from 'racklist'

/** A macro's path: typed, or picked from what is under the root. */
export default function MacroField({ value, onChange, rec }) {
  const id = useId()
  const [macros, setMacros] = useState([])
  const root = rec?.root || 'lilak'
  useEffect(() => {
    let live = true
    fetch(`${PORTAL_BASE}/api/flow/macros?root=${encodeURIComponent(root)}`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : { macros: [] }))
      .then((d) => live && setMacros(d.macros || []))
      .catch(() => {})
    return () => { live = false }
  }, [root])
  return (
    <>
      <input className="rl-in" style={{ width: 420, fontFamily: 'var(--font-mono)' }} list={id} value={value || ''}
        onChange={(e) => onChange(e.target.value.trim())} />
      <datalist id={id}>{macros.map((m) => <option key={m} value={m} />)}</datalist>
    </>
  )
}
