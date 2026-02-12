import type { ServerWebSocket } from "bun";
import { matchRequest, type Request, type Response } from "./Messages";
import type MetadataManager from "./Metadata";

export default class Server {
  constructor(private readonly metadataManager: MetadataManager, port = 3000) {
    Bun.serve({
      port,
      fetch: (req, server) =>  server.upgrade(req) ? undefined : new Response("Upgrade failed", { status: 500 }),
      websocket: { message: (ws, message) => this.handleMessage(ws, message) }
    });
  }

  private handleMessage(ws: ServerWebSocket, message: string | Buffer<ArrayBuffer>) {
    if (typeof message !== 'string') return;
    const { request: _request, nonce } = JSON.parse(message);
    const request = matchRequest(_request);
    if (request) this.handleRequest(request, ws, nonce);
  }

  private async handleRequest(request: Request, ws: ServerWebSocket, nonce: number) {
    const response = await this.handleRawRequest(request)
    if (response) this.sendResponse(response, ws, nonce)
  }

  public async handleRawRequest(request: Request) {
    if (request.type === 'search') return await this.metadataManager.search(request.trackName);
    else console.log(request)
  }

  private readonly sendResponse = (response: Response, ws: ServerWebSocket, nonce: number) => ws.send(JSON.stringify({ response, nonce }));
}
