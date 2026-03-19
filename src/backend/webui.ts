// @ts-expect-error: This is supported by bun
import VERSION from "../../VERSION" with { type: "text" };

export const buildWebUI = async () => await Bun.build({
  conditions: ['browser', 'module', 'import'],
  define: {
    __CDN_URL__: 'https://cdn.jsdelivr.net/npm/@iplookup/country/',
    VERSION: JSON.stringify(VERSION)
  },
  entrypoints: ['./src/frontend/main.tsx'],
  outdir: './dist',
  target: 'browser',
})

export const serveStaticFile = (pathname: string): Response | undefined => {
  if (pathname === '/') return new Response(Bun.file('./src/frontend/index.html'))
  if (pathname === '/src/main.tsx') return new Response(Bun.file('./dist/main.js'))
  if (pathname === '/logo-white.svg') return new Response(Bun.file('./public/logo-white.svg'))
  return undefined
}
