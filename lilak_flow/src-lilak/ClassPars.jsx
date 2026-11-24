import { useEffect, useState } from 'react'
import { loadClassPars } from './api.js'

/** What class `cls` can take ([{ name, value, comment, from }]): LILAK's template for it and the
 *  names its source reads. Empty while it loads or when there is no class. */
export function useClassPars(cls) {
  const [pars, setPars] = useState([])
  useEffect(() => {
    let live = true
    setPars([])
    if (cls) loadClassPars(cls).then((p) => live && setPars(p)).catch(() => {})
    return () => { live = false }
  }, [cls])
  return pars
}
