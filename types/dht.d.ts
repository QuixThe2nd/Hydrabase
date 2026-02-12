/// <reference types="node" />

declare module 'bittorrent-dht' {
  import { EventEmitter } from 'events';
  import { KRPC } from 'k-rpc';

  /* -------------------------------------------------- *
   * Shared Node / Peer Types
   * -------------------------------------------------- */

  export interface DHTNode {
    host: string;
    port: number;
  }

  export interface DHTPeer extends DHTNode {}

  /* -------------------------------------------------- *
   * Options
   * -------------------------------------------------- */

  export interface DHTOptions {
    nodeId?: Buffer | string;
    bootstrap?: Array<string | DHTNode> | false;
    host?: string | false;
    concurrency?: number;
    hash?: (data: Buffer) => Buffer;
    krpc?: KRPC;
    verify?: (sig: Buffer, value: Buffer, key: Buffer) => boolean;
    timeBucketOutdated?: number;
    maxAge?: number;
  }

  /* -------------------------------------------------- *
   * BEP44 Types
   * -------------------------------------------------- */

  export interface DHTPutImmutable {
    v: Buffer;
  }

  export interface DHTPutMutable {
    v: Buffer;
    k: Buffer;
    seq: number;
    sig?: Buffer;
    cas?: number;
    salt?: Buffer;
    sign: (buf: Buffer) => Buffer;
  }

  export type DHTPutOptions = DHTPutImmutable | DHTPutMutable;

  export interface DHTGetOptions {
    verify?: (sig: Buffer, value: Buffer, key: Buffer) => boolean;
    salt?: Buffer;
    cache?: boolean;
  }

  export interface DHTGetResult {
    v: Buffer;
    id: Buffer;
    k?: Buffer;
    sig?: Buffer;
    seq?: number;
  }

  /* -------------------------------------------------- *
   * Main DHT Class
   * -------------------------------------------------- */

  export default class DHT extends EventEmitter {
    constructor(opts?: DHTOptions);

    listen(
      port?: number,
      address?: string,
      onlistening?: () => void
    ): void;

    address(): {
      address: string;
      family: string;
      port: number;
    };

    lookup(
      infoHash: Buffer | string,
      callback?: (err: Error | null, nodes: number) => void
    ): () => void;

    announce(
      infoHash: Buffer | string,
      port?: number,
      callback?: (err: Error | null) => void
    ): void;

    addNode(node: DHTNode): void;

    toJSON(): {
      nodes: DHTNode[];
      values: Record<string, unknown>;
    };

    destroy(callback?: () => void): void;

    put(
      opts: DHTPutOptions,
      callback: (err: Error | null, hash?: Buffer, n?: number) => void
    ): void;

    get(
      hash: Buffer | string,
      opts: DHTGetOptions,
      callback: (err: Error | null, res?: DHTGetResult) => void
    ): void;

    get(
      hash: Buffer | string,
      callback: (err: Error | null, res?: DHTGetResult) => void
    ): void;

    /* -------------------------------------------------- *
     * Events
     * -------------------------------------------------- */

    on(event: 'ready', listener: () => void): this;
    on(event: 'listening', listener: () => void): this;
    on(event: 'peer', listener: (peer: DHTPeer, infoHash: Buffer, from: DHTNode) => void): this;
    on(event: 'node', listener: (node: DHTNode) => void): this;
    on(event: 'announce', listener: (peer: DHTPeer, infoHash: Buffer) => void): this;
    on(event: 'warning', listener: (err: Error) => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
  }
}
