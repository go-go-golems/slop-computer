import type { Artifact, Project } from '../api/types'

export interface ProjectGroup { id: string | null; name: string; project?: Project; items: Artifact[] }

// projectGroups groups artifacts by the project each one names. The groups
// come from the artifacts themselves; projects only supply names and order,
// so no artifact disappears while the projects are loading, failed to load,
// or name a project that is gone. "No project" comes last.
export function projectGroups(arts: Artifact[], projects: Project[]): ProjectGroup[] {
  const byId = new Map<string | null, Artifact[]>()
  for (const a of arts) {
    const id = a.project ?? null
    byId.set(id, [...(byId.get(id) ?? []), a])
  }
  const order = (id: string | null) => (id == null ? Infinity : projects.findIndex(p => p.id === id) + 1 || projects.length + 1)
  return [...byId.keys()]
    .sort((x, y) => order(x) - order(y) || String(x).localeCompare(String(y)))
    .map(id => {
      const project = projects.find(p => p.id === id)
      return { id, name: id == null ? 'No project' : project?.name ?? id, project, items: byId.get(id)! }
    })
}
