import { error } from './log';
import * as Node from './Node'

process.on('unhandledRejection', (err) => error('ERROR:', '[MAIN] Unhandled rejection', {err}))
process.on('uncaughtException', (err) => error('ERROR:', '[MAIN] Uncaught exception', {err}))

const artists = await Node.search('artists', 'jay z')
const albums = await Node.search('albums', 'made in england')
/*Const tracks = */await Node.search('tracks', 'dont stop me now')
// Log('Artist results:', artists)
// Log('Album results:', albums)
// Log('Track results:', tracks)
if (artists[0]) {
  await Node.search('artist.tracks', artists[0].soul_id)
  await Node.search('artist.albums', artists[0].soul_id)
}
if (albums[0]) await Node.search('album.tracks', albums[0].soul_id)

// TODO: Merge duplicate artists from diff plugins
