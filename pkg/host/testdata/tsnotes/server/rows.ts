// The actor's alone: files under server/ are not part of the pages' program.
import type { Note } from '../api.ts'

export function toNote(r: Row): Note {
  return { id: Number(r.id), text: String(r.text), at: new Date(Number(r.at)) }
}
