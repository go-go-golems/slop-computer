// The contract between the page and the actor: types only, imported with
// `import type` on both sides (SLOP3-024, design §5.4).
export interface Note {
  id: number
  text: string
  at: Date
}

export interface Actions {
  list(args: { max?: number }): Note[]
  add(args: { text: string }): { id: number }
  draftFiles(args: { store: string }): number
}
