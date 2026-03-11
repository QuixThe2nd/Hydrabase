
/// <reference types="node" />

declare module 'k-rpc-socket' {
  export interface RpcSocket extends EventEmitter {
    /**
     * Bind to a specific port and/or address.
     * If port is 0 or omitted, the OS picks a random free port.
     * If address is omitted, listens on all interfaces.
     */
    bind(port?: number, address?: string, callback?: () => void): void;

    bind(port?: number, callback?: () => void): void;

    bind(callback?: () => void): void;

    /**
     * Cancel a pending query by its ID.
     * Calls the query's callback with a cancellation error.
     * @param id - The query ID returned by `.query()`.
     */
    cancel(id: number): void;

    /**
     * Destroys and unbinds the socket.
     */
    destroy(): void;

    /**
     * Send an error reply to a received query.
     * @param peer - The peer to respond to.
     * @param query - The original query being replied to.
     * @param error - The error to send.
     * @param callback - Called when the message has been flushed from the socket.
     */
    error(peer: Peer, query: Query, error: Error | RpcError, callback?: FlushCallback): void;

    /** Number of concurrent queries currently pending. */
    inflight: number;

    on(event: "query", listener: (query: Query, peer: Peer) => void): this;
    on(event: "error" | "warning", listener: (error: Error) => void): this;

    on(event: string, listener: (...args: unknown[]) => void): this;
    /**
     * Send a query message to a peer.
     * @param peer - The target peer.
     * @param query - The query object. Set method name as `{ q: 'method_name' }` and data as `{ a: ... }`.
     * @param callback - Called with `(err, response, peer, request)` when a response is received.
     * @returns A query ID that can be used to cancel the query.
     */
    query(peer: Peer, query: Query, callback?: QueryCallback): number;
    /**
     * Send a response to a received query.
     * @param peer - The peer to respond to.
     * @param query - The original query being responded to.
     * @param response - The response data.
     * @param callback - Called when the message has been flushed from the socket.
     */
    response(peer: Peer, query: Query, response: Record<string, unknown>, callback?: FlushCallback): void;
    /**
     * Send a raw message to a peer.
     * @param peer - The target peer.
     * @param message - The raw message object to send.
     * @param callback - Called when the message has been flushed from the socket.
     */
    send(peer: Peer, message: Record<string, unknown>, callback?: FlushCallback): void;
  }

  type FlushCallback = (err: Error | null) => void;

  interface Peer {
    host: string;
    port: number;
  }

  interface Query {
    [key: string]: unknown;
    a?: Record<string, unknown>;
    q: string;
    t?: Buffer;
  }

  type QueryCallback = (
    err: Error | null,
    response: KRPCResponse,
    peer: Peer,
    request: Query
  ) => void;

  interface RpcError {
    [key: string]: unknown;
    e?: [number, string];
    t?: Buffer;
  }

  interface RpcSocketOptions {
    /** Custom function to determine if a value is an IP address. */
    isIP?: (address: string) => boolean;
    /** An existing UDP socket to use. */
    socket?: UDPSocket;
    /** Query timeout in milliseconds. Defaults to 2000 (2s). */
    timeout?: number;
  }

  /**
   * Create a new k-rpc-socket instance.
   */
  function rpc(options?: RpcSocketOptions): RpcSocket;

  export = rpc;
}
