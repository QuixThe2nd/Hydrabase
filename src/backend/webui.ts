// @ts-expect-error: This is supported by bun
import VERSION from '../../VERSION' with { type: 'text' }
export const buildWebUI = async (): Promise<void> => {
  const result = await Bun.build({
    conditions: ['browser', 'module', 'import'],
    define: {
      __CDN_URL__: 'https://cdn.jsdelivr.net/npm/@iplookup/country/',
      VERSION: JSON.stringify(VERSION)
    },
    entrypoints: ['./src/frontend/main.tsx'],
    outdir: './dist',
    target: 'browser',
  })

  if (!result.success) throw new Error('[WEBUI] Build failed')
}

export const serveStaticFile = (pathname: string): Response | undefined => {
  const isAssetRequest = pathname.includes('.')
  const isAppRoute = pathname === '/'
    || pathname === '/dht'
    || pathname === '/messages'
    || pathname === '/overview'
    || pathname === '/peers'
    || pathname === '/search'
    || pathname === '/votes'

  if (pathname === '/') return new Response(Bun.file('./src/frontend/index.html'))
  if (pathname === '/src/main.tsx') return new Response(Bun.file('./dist/main.js'))
  if (pathname === '/logo-white.svg') return new Response(Bun.file('./public/logo-white.svg'))
  if (pathname === '/favicon.ico') return new Response(Bun.file('./public/favicon.ico'))
  // Support SPA deep-link refreshes for frontend routes.
  if (isAppRoute || (!isAssetRequest && pathname !== '/auth')) return new Response(Bun.file('./src/frontend/index.html'))
  return undefined
}
