/**
 * The files as folders: { name, path, dirs: [...], files: [...], count } from each file's
 * `path` (relative to its root, e.g. stark/macros_ko2421/config_check.mac). Folders first,
 * both by name. `node src-lilak/tree.check.mjs` holds it to its word.
 */
export function treeOf(files) {
  const root = { name: '', path: '', dirs: [], files: [], count: 0, at: new Map() }
  for (const f of files) {
    const parts = String(f.path || '').split('/').slice(0, -1)
    let d = root
    d.count += 1
    for (const p of parts) {
      if (!d.at.has(p)) {
        const n = { name: p, path: d.path ? `${d.path}/${p}` : p, dirs: [], files: [], count: 0, at: new Map() }
        d.at.set(p, n); d.dirs.push(n)
      }
      d = d.at.get(p)
      d.count += 1
    }
    d.files.push(f)
  }
  const tidy = (d) => {
    d.dirs.sort((a, b) => a.name.localeCompare(b.name)); d.files.sort((a, b) => a.name.localeCompare(b.name))
    d.dirs.forEach(tidy); delete d.at
    return d
  }
  return tidy(root)
}

/** Every folder path in a tree (for open all). */
export const allDirs = (d) => d.dirs.flatMap((c) => [c.path, ...allDirs(c)])
