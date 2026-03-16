/// <reference types="node" />

declare module 'k-rpc' {
  import { EventEmitter } from 'events';

  /* -------------------------------------------------- *
   * Shared / Core Types
   * -------------------------------------------------- */

  export interface KRPC extends EventEmitter {
    bind(port: number): void;
    closest(
      target: Buffer,
      query: KRPCQuery,
      onreply: OnReply,
      callback?: (err: Error | null, replies: number) => void
    ): void;

    destroy(): void;

    error(
      node: KRPCNode,
      query: KRPCQuery,
      error: KRPCError,
      callback?: () => void
    ): void;

    readonly id: Buffer;

    readonly nodes: unknown;

    on(event: 'query', listener: (query: KRPCQuery, node: { address: string, family: "IPv4" | "IPv6"; port: number, size: number }) => void): this;

    on(event: 'ping', listener: (oldNodes: KRPCNode[], swapNew: (node: KRPCNode) => void) => void): this;

    populate(
      target: Buffer,
      query: KRPCQuery,
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
  }

  export interface KRPCError {
    code: number;
    message: string;
  }

  export interface KRPCNode {
    host: string;
    id?: Buffer;
    port: number;
    token?: Buffer;
  }

  export interface KRPCOptions {
    concurrency?: number;
    id?: Buffer;
    idLength?: number;
    k?: number;
    krpcSocket?: unknown;
    nodes?: string[];
    timeout?: number;
  }

  export interface KRPCQuery {
    [key: string]: unknown;
    a?: Record<string, unknown>;
    d?: string;
    q: string;
    t?: Buffer;
  }

  /* -------------------------------------------------- *
   * Options
   * -------------------------------------------------- */

  export interface KRPCResponse {
    address?: `0x${string}`;
    e?: [number, string];
    ok: 0 | 1
    r?: Record<string, unknown> & {
      e?: [number, Buffer]
    };
    signature?: string;
    t?: Buffer;
    userAgent?: string;
    username?: string;
  }

  /* -------------------------------------------------- *
   * Main RPC Interface
   * -------------------------------------------------- */

  export type OnReply = (
    message: KRPCResponse,
    node: KRPCNode
  ) => false | undefined;

  /* -------------------------------------------------- *
   * Factory
   * -------------------------------------------------- */

  function createKRPC(opts?: KRPCOptions): KRPC;
  export = createKRPC;
}
