import { configureStore } from '@reduxjs/toolkit'
import { useDispatch, useSelector } from 'react-redux'
import { slopApi } from '../api/slopApi'
import { toastAdded, toastExpired, ui } from './ui'

export const store = configureStore({
  reducer: { [slopApi.reducerPath]: slopApi.reducer, ui: ui.reducer },
  middleware: gdm => gdm().concat(slopApi.middleware),
})

export type AppStore = typeof store
export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
export const useAppDispatch = useDispatch.withTypes<AppDispatch>()
export const useAppSelector = useSelector.withTypes<RootState>()

// toast shows a message for a few seconds.
export function toast(text: string, bad?: boolean) {
  const a = store.dispatch(toastAdded(text, bad))
  setTimeout(() => store.dispatch(toastExpired(a.payload.id)), 4200)
}
