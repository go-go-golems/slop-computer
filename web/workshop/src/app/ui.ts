import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

// The only client state outside RTK Query: toasts, the console (what happened
// recently, from the event stream), whether the stream is connected, and the
// project the artifact lists show (null: all, '': artifacts in none).
export interface Toast { id: number; text: string; bad?: boolean }
export interface ConsoleLine { id: number; at: string; who: string; kind: string; text: string }

interface UIState { toasts: Toast[]; console: ConsoleLine[]; live: boolean; project: string | null }

const projectKey = 'slop:workshop:project'
const savedProject = (): string | null => {
  try { return JSON.parse(localStorage.getItem(projectKey) ?? 'null') as string | null } catch { return null }
}

const initialState: UIState = { toasts: [], console: [], live: false, project: savedProject() }
let seq = 0

export const ui = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    toastAdded: {
      reducer: (s, a: PayloadAction<Toast>) => { s.toasts.push(a.payload) },
      prepare: (text: string, bad?: boolean) => ({ payload: { id: ++seq, text, bad } }),
    },
    toastExpired: (s, a: PayloadAction<number>) => { s.toasts = s.toasts.filter(t => t.id !== a.payload) },
    consoleAdded: {
      reducer: (s, a: PayloadAction<ConsoleLine>) => {
        s.console.push(a.payload)
        if (s.console.length > 300) s.console.splice(0, s.console.length - 300)
      },
      prepare: (l: Omit<ConsoleLine, 'id'>) => ({ payload: { ...l, id: ++seq } }),
    },
    liveChanged: (s, a: PayloadAction<boolean>) => { s.live = a.payload },
    projectPicked: (s, a: PayloadAction<string | null>) => {
      s.project = a.payload
      try { localStorage.setItem(projectKey, JSON.stringify(a.payload)) } catch { /* storage may be unavailable */ }
    },
  },
})

export const { toastAdded, toastExpired, consoleAdded, liveChanged, projectPicked } = ui.actions
