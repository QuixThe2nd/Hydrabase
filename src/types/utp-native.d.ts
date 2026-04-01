declare module 'utp-native' {
  import { EventEmitter } from 'events'
  import { Duplex } from 'stream'

  export interface UTPConnection extends Duplex {
    address(): AddressInfo;
    destroy(): void;
    on(event: 'close' | 'connect' | 'end', listener: () => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
    on(event: 'data', listener: (data: Buffer) => void): this;
    remoteAddress: string;
    remotePort: number;
    setContentSize(size: number): void;
    setInteractive(interactive: boolean): void;
    setTimeout(ms: number, ontimeout?: () => void): void;
  }

  export interface UTPSocket extends EventEmitter {
    address(): AddressInfo;
    bind(port?: number, host?: string, onlistening?: () => void): void;
    close(): void;
    connect(port: number, host: string): UTPConnection;
    listen(port?: number, host?: string, onlistening?: () => void): void;
    on(event: 'close' | 'listening', listener: () => void): this;
    on(event: 'message', listener: (buffer: Buffer, rinfo: AddressInfo) => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
    on(event: 'connection', listener: (connection: UTPConnection) => void): this;
    ref(): void;
    send(
      buf: Buffer,
      offset: number,
      len: number,
      port: number,
      host: string,
      callback?: (err: Error | null) => void
    ): void;
    unref(): void;
  }

  interface AddressInfo {
    address: string;
    port: number;
  }

  interface UtpOptions {
    allowHalfOpen?: boolean;
  }

  function utp(options?: UtpOptions): UTPSocket;

  export = utp;
}