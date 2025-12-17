
import { Client } from "npm:@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "npm:@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "npm:@modelcontextprotocol/sdk/shared/transport.js";
import type { Tool } from "npm:@modelcontextprotocol/sdk/types.js";


conole.log("Client=", Client);

export interface ChatOptions {
  data: any;
  headers: Record<string, string>;
  apiUrl: string;
  fetchTimeout?: number;
  readTimeout?: number;
  totalTime?: number;
}
