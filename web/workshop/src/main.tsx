import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { App, PendingScreen } from './app/App'
import { loadBoot } from './app/boot'
import { store } from './app/store'
import { startEvents } from './api/events'
import { slopApi } from './api/slopApi'
import './styles/workshop.css'
import './styles/react.css'

async function main() {
  const root = createRoot(document.getElementById('root')!)
  let b
  try {
    b = await loadBoot()
  } catch (e) {
    root.render(<p className="empty">{`The Workshop could not reach the server: ${(e as Error).message}`}</p>)
    return
  }
  if (!b) {
    location.href = '/auth/login?return=' + encodeURIComponent(location.pathname + location.search)
    return
  }
  if (b.me.user.role !== 'admin') {
    root.render(<PendingScreen />)
    return
  }
  // Names for console lines come from the cached user list.
  const nameOf = (id: string) => slopApi.endpoints.users.select()(store.getState()).data?.find(u => u.id === id)?.name ?? id
  startEvents(store, nameOf)
  root.render(<StrictMode><Provider store={store}><App /></Provider></StrictMode>)
}

void main()
