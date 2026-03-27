import type { Trace } from '../utils/trace'
import type { Config } from './hydrabase'
import type { Request, Response, SearchResult } from './hydrabase-schemas'

export interface IPeerProvider {
  requestAll(
    formulas: Config['formulas'],
    req: Request,
    hashes: Set<bigint>,
    plugins: Set<string>,
    trace: Trace
  ): Promise<Map<bigint, SearchResult[keyof SearchResult]>>
}

export interface ISearchable {
  search<T extends Request['type']>(type: T, query: string, searchPeers?: boolean): Promise<Response<T>>
}