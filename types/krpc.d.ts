/// <reference types="node" />

declare module 'k-rpc' {
  import { EventEmitter } from 'events';

  /* -------------------------------------------------- *
   * Shared / Core Types
   * -------------------------------------------------- */

  export interface KRPCNode {
    id?: Buffer;
    host: string;
    port: number;
    token?: Buffer;
  }

  export interface KRPCQuery {
    q: string;
    a?: Record<string, any>;
    t?: Buffer;
  }

  export interface KRPCResponse {
    r?: Record<string, any>;
    e?: [number, string];
    t?: Buffer;
  }

  export interface KRPCError {
    code: number;
    message: string;
  }

  export type OnReply = (
    message: KRPCResponse,
    node: KRPCNode
  ) => void | false;

  /* -------------------------------------------------- *
   * Options
   * -------------------------------------------------- */

  export interface KRPCOptions {
    timeout?: number;
    nodes?: string[];
    concurrency?: number;
    k?: number;
    id?: Buffer;
    idLength?: number;
    krpcSocket?: any;
  }

  /* -------------------------------------------------- *
   * Main RPC Interface
   * -------------------------------------------------- */

  export interface KRPC extends EventEmitter {
    readonly id: Buffer;
    readonly nodes: any;

    populate(
      target: Buffer,
      query: KRPCQuery,
      callback?: (err: Error | null, replies: number) => void
    ): void;

    closest(
      target: Buffer,
      query: KRPCQuery,
      onreply: OnReply,
      callback?: (err: Error | null, replies: number) => void
    ): void;

    query(
      node: KRPCNode,
      query: KRPCQuery,
      callback: (err: Error | null, reply?: KRPCResponse) => void
    ): void;

    queryAll(
      nodes: KRPCNode[],
      query: KRPCQuery,
      onreply: (reply: KRPCResponse, node: KRPCNode) => void,
      callback?: (err: Error | null, replies: number) => void
    ): void;

    response(
      node: KRPCNode,
      query: KRPCQuery,
      response: KRPCResponse,
      nodes?: KRPCNode[],
      callback?: () => void
    ): void;

    error(
      node: KRPCNode,
      query: KRPCQuery,
      error: KRPCError,
      callback?: () => void
    ): void;

    destroy(): void;

    on(event: 'query', listener: (query: KRPCQuery, node: KRPCNode) => void): this;
    on(event: 'ping', listener: (oldNodes: KRPCNode[], swapNew: (node: KRPCNode) => void) => void): this;
  }

  /* -------------------------------------------------- *
   * Factory
   * -------------------------------------------------- */

  function createKRPC(opts?: KRPCOptions): KRPC;
  export = createKRPC;
}
