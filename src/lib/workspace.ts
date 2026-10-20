let ownerId: string | null = null
export function getWorkspaceOwner() { return ownerId }
export function setWorkspaceOwner(id: string | null) { ownerId = id }
export function workspaceKey(name: string, owner: string | null = ownerId) {
  if (owner) return `reflective-journey/v0.6/users/${encodeURIComponent(owner)}/${name}`
  if (name === 'preferred-provider') return 'reflective-journey/v0.4/preferred-provider'
  return `reflective-journey/v0.5/${name}`
}
