import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

// The only client state outside RTK Query: toasts, the console (what happened
// recently, from the event stream) and whether the stream is connected.
export interface Toast { id: number; text: string; bad?: boolean }
export interface ConsoleLine { id: number; at: string; who: string; kind: string; text: string }

interface UIState { toasts: Toast[]; console: ConsoleLine[]; live: boolean }

const initialState: UIState = { toasts: [], console: [], live: false }
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
  },
})

export const { toastAdded, toastExpired, consoleAdded, liveChanged } = ui.actions
