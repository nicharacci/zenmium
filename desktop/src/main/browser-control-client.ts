import type {
  BrowserControlCapabilities, BrowserControlCommand, BrowserControlReceipt,
  BrowserControlSession, ControlEventPage, ControlSessionInput,
} from "../shared/browser-control";

/** Native host client. Keep its bearer token in host memory, never browser UI state. */
export class BrowserControlClient {
  private sequence = 0;
  private readonly url: string;
  private readonly token: string;
  private readonly fetcher: typeof fetch;
  constructor(options: { url: string; token: string; fetch?: typeof fetch }) {
    const endpoint = new URL(options.url);
    if (endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1" || endpoint.pathname !== "/mcp" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error("A local Zenmium MCP endpoint is required.");
    this.url = options.url;
    this.token = options.token;
    this.fetcher = options.fetch || fetch;
  }
  private async rpc(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const response = await this.fetcher(this.url, { method: "POST", headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-03-26" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++this.sequence, method, params }), signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`Zennium bridge request rejected (${response.status}).`);
    const message = await response.json() as { result?: unknown; error?: { message: string } };
    if (message.error) throw new Error(message.error.message);
    return message.result;
  }
  async initialize(): Promise<unknown> { return this.rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "zenmium-local-host", version: "0.0.1" } }); }
  private async tool<T>(name: string, args: object): Promise<T> {
    const result = await this.rpc("tools/call", { name, arguments: args }) as { content: { type: string; text?: string }[] };
    const text = result.content.find((item) => item.type === "text")?.text;
    if (!text) throw new Error("Zennium did not return a native result.");
    // Preserve action failure/uncertainty receipts rather than auto-retrying.
    return JSON.parse(text) as T;
  }
  capabilities(): Promise<BrowserControlCapabilities> { return this.tool("zenmium_capabilities", {}); }
  createSession(input: ControlSessionInput): Promise<BrowserControlSession> { return this.tool("zenmium_session", input); }
  execute(command: BrowserControlCommand): Promise<BrowserControlReceipt> { return this.tool("zenmium_action", command); }
  events(input: { epoch?: string; after?: number } = {}): Promise<ControlEventPage> { return this.tool("zenmium_events", input); }
}
