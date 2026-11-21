const normalizePath = (value) =>
  String(value)
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.')
    .join('/')

const segments = (value) => normalizePath(value).split('/').filter(Boolean)

const isParent = (parent, child) => {
  const a = segments(parent)
  const b = segments(child)
  if (a.length >= b.length) return false
  return a.every((part, index) => part === b[index])
}

const pathsOverlap = (owned, incoming) => {
  for (const mine of owned) {
    for (const theirs of incoming) {
      const left = normalizePath(mine)
      const right = normalizePath(theirs)
      if (!left || !right) continue
      if (left === right) return { same: left, nested: null }
    }
  }
  for (const mine of owned) {
    for (const theirs of incoming) {
      const left = normalizePath(mine)
      const right = normalizePath(theirs)
      if (!left || !right) continue
      if (isParent(left, right)) return { same: null, nested: [left, right] }
      if (isParent(right, left)) return { same: null, nested: [right, left] }
    }
  }
  return { same: null, nested: null }
}

const liveClaims = (claims, at = Date.now()) =>
  claims.filter((claim) => new Date(claim.lease_until).getTime() > at)

const detectConflict = ({ session, paths, claims }) => {
  const incoming = (paths ?? []).map(normalizePath).filter(Boolean)
  if (!incoming.length) return null

  for (const claim of liveClaims(claims)) {
    if (!claim.session || claim.session === session) continue
    const owned = (claim.touched_paths ?? []).map(normalizePath).filter(Boolean)
    if (!owned.length) continue
    const { same, nested } = pathsOverlap(owned, incoming)
    if (same) return { kind: 'same', path: same, with: claim }
    if (nested) return { kind: 'nested', path: nested[1], with: claim }
  }
  return null
}

export { normalizePath, pathsOverlap, detectConflict }