/// <reference types="node" />

declare module 'bittorrent-dht' {
  import { EventEmitter } from 'events';
  import { KRPC } from 'k-rpc';

  /* -------------------------------------------------- *
   * Shared Node / Peer Types
   * -------------------------------------------------- */

  export interface DHTGetOptions {
    cache?: boolean;
    salt?: Buffer;
    verify?: (sig: Buffer, value: Buffer, key: Buffer) => boolean;
  }

  /* -------------------------------------------------- *
   * Options
   * -------------------------------------------------- */

  export interface DHTGetResult {
    id: Buffer;
    k?: Buffer;
    seq?: number;
    sig?: Buffer;
    v: Buffer;
  }

  /* -------------------------------------------------- *
   * BEP44 Types
   * -------------------------------------------------- */

  export interface DHTNode {
    host: string;
    port: number;
  }

  export interface DHTOptions {
    bootstrap?: (DHTNode | string)[] | false;
    concurrency?: number;
    hash?: (data: Buffer) => Buffer;
    host?: false | string;
    krpc?: KRPC;
    maxAge?: number;
    nodeId?: Buffer | string;
    timeBucketOutdated?: number;
    verify?: (sig: Buffer, value: Buffer, key: Buffer) => boolean;
  }

  export interface DHTPutImmutable {
    v: Buffer;
  }

  export interface DHTPutMutable {
    cas?: number;
    k: Buffer;
    salt?: Buffer;
    seq: number;
    sig?: Buffer;
    sign: (buf: Buffer) => Buffer;
    v: Buffer;
  }

  export type DHTPutOptions = DHTPutImmutable | DHTPutMutable;

  /* -------------------------------------------------- *
   * Main DHT Class
   * -------------------------------------------------- */

  export default class DHT extends EventEmitter {
    constructor(opts?: DHTOptions);

    addNode(node: DHTNode): void;

    address(): {
      address: string;
      family: string;
      port: number;
    };

    announce(
      infoHash: Buffer | string,
      port?: number,
      callback?: (err: Error | null) => void
    ): void;

    destroy(callback?: () => void): void;

    get(
      hash: Buffer | string,
      opts: DHTGetOptions,
      callback: (err: Error | null, res?: DHTGetResult) => void
    ): void;
    get(
      hash: Buffer | string,
      callback: (err: Error | null, res?: DHTGetResult) => void
    ): void;

    listen(
      port?: number,
      address?: string,
      onlistening?: () => void
    ): void;

    lookup(
      infoHash: Buffer | string,
      callback?: (err: Error | null, nodes: number) => void
    ): () => void;

    on(event: 'listening' | 'ready', listener: () => void): this;
    /* -------------------------------------------------- *
     * Events
     * -------------------------------------------------- */
    on(event: 'peer', listener: (peer: DHTPeer, infoHash: Buffer, from: DHTNode) => void): this;
    on(event: 'node', listener: (node: DHTNode) => void): this;
    on(event: 'announce', listener: (peer: DHTPeer, infoHash: Buffer) => void): this;
    on(event: 'error' | 'warning', listener: (err: Error) => void): this;
    put(
      opts: DHTPutOptions,
      callback: (err: Error | null, hash?: Buffer, n?: number) => void
    ): void;
    toJSON(): {
      nodes: DHTNode[];
      values: Record<string, unknown>;
    };
  }
}
