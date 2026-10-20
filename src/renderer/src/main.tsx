import { createRoot } from 'react-dom/client'
import { App } from './App'
import { CrashScreen } from './components/CrashScreen'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <CrashScreen>
    <App />
  </CrashScreen>
)
