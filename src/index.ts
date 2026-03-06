import { error } from './log';
import { Node } from './Node'

process.on('unhandledRejection', (err) => error('ERROR:', '[MAIN] Unhandled rejection', {err}))
process.on('uncaughtException', (err) => error('ERROR:', '[MAIN] Uncaught exception', {err}))

const node = await Node.init()

const artists = await node.search('artists', 'jay z')
const albums = await node.search('albums', 'made in england')
/*Const tracks = */await node.search('tracks', 'dont stop me now')
// Log('Artist results:', artists)
// Log('Album results:', albums)
// Log('Track results:', tracks)
if (artists[0]) {
  await node.search('artist.tracks', artists[0].soul_id)
  await node.search('artist.albums', artists[0].soul_id)
}
if (albums[0]) await node.search('album.tracks', albums[0].soul_id)

// TODO: Merge duplicate artists from diff plugins
