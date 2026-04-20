import * as Sentry from '@sentry/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { error } from '../utils/log'
import App from './App'

Sentry.init({
  dsn: 'https://5b65ce62e44ac7a7e4d3b6e27f725565@o4511068837314560.ingest.de.sentry.io/4511070311940176',
  enableLogs: true,
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration()
  ],
  replaysOnErrorSampleRate: 1,
  replaysSessionSampleRate: 1,
  sendDefaultPii: true,
  tracesSampleRate: 1
})

const root = document.getElementById('root')
if (root) createRoot(root).render(<StrictMode><App /></StrictMode>)
else error('ERROR:', '[DASHBOARD] Failed to get root element')
