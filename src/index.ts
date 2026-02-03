#!/usr/bin/env node
/**
 * SeeDream MCP Server v2.5.0
 *
 * Enables Claude to generate images via natural language using SeeDream 4.5.
 *
 * v2.5.0 Changes:
 * - Fixed critical Promise.race() memory leak bug in seedream.ts
 * - Simplified HTTP handler: per-request transport for better isolation
 * - Added Accept header middleware for Claude.ai compatibility
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import express, { Request, Response } from "express";

import { registerGenerateTool } from "./tools/generate.js";
import { registerEditTool } from "./tools/edit.js";
import { registerBlendTool } from "./tools/blend.js";
import { registerVariationsTool } from "./tools/variations.js";
import { registerStatusTool } from "./tools/status.js";
import { registerSubmitTool } from "./tools/submit.js";

// Server version - v2.5.0: Fixed memory leak, simplified HTTP handler
const SERVER_VERSION = "2.5.0";

// MCP Protocol version
const MCP_PROTOCOL_VERSION = "2024-11-05";

// Create MCP server instance
const server = new McpServer({
  name: "seedream-mcp-server",
  version: SERVER_VERSION,
});

// Register all tools
registerGenerateTool(server);
registerEditTool(server);
registerBlendTool(server);
registerVariationsTool(server);
registerStatusTool(server);
registerSubmitTool(server);

/**
 * Run server with stdio transport (local CLI mode)
 */
async function runStdio(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`SeeDream MCP server v${SERVER_VERSION} started (stdio mode)`);
  console.error("Available tools: seedream_generate, seedream_edit, seedream_blend, seedream_variations, seedream_status, seedream_submit");
}

/**
 * Handle a single MCP request with per-request transport isolation
 * Creates a new InMemoryTransport pair for each request to avoid shared state issues
 */
async function handleMcpRequest(body: unknown): Promise<unknown> {
  const request = body as { id?: string | number; method?: string };
  const requestId = request.id;

  // For notifications (no id), return empty response
  if (requestId === undefined) {
    return { jsonrpc: "2.0", result: {} };
  }

  // Create a new linked transport pair for this request
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  return new Promise(async (resolve, reject) => {
    // Set up timeout
    const timeout = setTimeout(() => {
      clientTransport.close();
      serverTransport.close();
      reject(new Error(`Request timeout for ${request.method || "unknown"}`));
    }, 300000); // 5 minute timeout

    // Set up message handler on client transport
    clientTransport.onmessage = (message: unknown) => {
      const msg = message as { id?: string | number };
      if (msg.id !== undefined && msg.id === requestId) {
        clearTimeout(timeout);
        resolve(message);
        // Clean up transports after response
        clientTransport.close();
        serverTransport.close();
      }
    };

    try {
      // Connect server to this request's transport
      await server.connect(serverTransport);
      await clientTransport.start();

      // Send the request
      await clientTransport.send(body as Parameters<typeof clientTransport.send>[0]);
    } catch (err) {
      clearTimeout(timeout);
      clientTransport.close();
      serverTransport.close();
      reject(err);
    }
  });
}

/**
 * Run server with HTTP transport (remote server mode)
 * Uses per-request transport isolation for better concurrency handling
 */
async function runHttp(): Promise<void> {
  const app = express();

  // Parse JSON body with large limit for base64 images
  app.use(express.json({ limit: "50mb" }));

  // Accept header middleware - ensures Claude.ai compatibility
  // SDK requires Accept: application/json, text/event-stream
  app.use((req, _res, next) => {
    if (!req.headers.accept?.includes("text/event-stream")) {
      req.headers.accept = "application/json, text/event-stream";
    }
    next();
  });

  // CORS for browser clients
  app.use((_req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, HEAD, OPTIONS, DELETE");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept, Mcp-Session-Id");
    res.header("Access-Control-Expose-Headers", "Mcp-Session-Id, MCP-Protocol-Version");
    next();
  });

  // OPTIONS preflight
  app.options("*", (_req, res) => {
    res.status(204).end();
  });

  // MCP POST handler - per-request transport isolation
  async function handleMcpPost(req: Request, res: Response) {
    const startTime = Date.now();

    try {
      console.error(`[mcp] ${req.method} ${req.path}`, {
        method: req.body?.method,
        id: req.body?.id,
        accept: req.headers.accept,
      });

      // Handle the MCP request with isolated transport
      const response = await handleMcpRequest(req.body);

      console.error(`[mcp] Response in ${Date.now() - startTime}ms`);

      // Return JSON response
      res.header("Content-Type", "application/json");
      res.header("MCP-Protocol-Version", MCP_PROTOCOL_VERSION);
      res.json(response);
    } catch (error) {
      console.error("[mcp] Request error:", error);
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : "Internal server error",
        },
        id: req.body?.id || null,
      });
    }
  }

  // HEAD request for MCP protocol version discovery
  app.head("/", (_req: Request, res: Response) => {
    res.header("MCP-Protocol-Version", MCP_PROTOCOL_VERSION);
    res.status(200).end();
  });

  app.head("/mcp", (_req: Request, res: Response) => {
    res.header("MCP-Protocol-Version", MCP_PROTOCOL_VERSION);
    res.status(200).end();
  });

  // MCP POST endpoints
  app.post("/", handleMcpPost);
  app.post("/mcp", handleMcpPost);

  // Health check endpoint
  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      server: "seedream-mcp-server",
      version: SERVER_VERSION,
      mcpProtocolVersion: MCP_PROTOCOL_VERSION,
      apiKeyConfigured: !!process.env.ARK_API_KEY,
    });
  });

  // Info endpoint
  app.get("/info", (_req: Request, res: Response) => {
    res.json({
      name: "SeeDream MCP Server",
      description: "Generate images via natural language using SeeDream 4.5",
      version: SERVER_VERSION,
      mcpProtocolVersion: MCP_PROTOCOL_VERSION,
      endpoints: {
        mcp: "POST / or POST /mcp",
        health: "GET /health",
        info: "GET /info",
      },
      tools: [
        "seedream_generate - Text to image",
        "seedream_edit - Edit existing image",
        "seedream_blend - Blend multiple images",
        "seedream_variations - Generate variations",
        "seedream_status - Check server status",
        "seedream_submit - Submit task for Claude.ai (async)",
      ],
    });
  });

  // GET on root - return protocol info
  app.get("/", (_req: Request, res: Response) => {
    res.header("MCP-Protocol-Version", MCP_PROTOCOL_VERSION);
    res.json({
      name: "seedream-mcp-server",
      version: SERVER_VERSION,
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: true },
    });
  });

  const port = parseInt(process.env.PORT || "3000", 10);
  app.listen(port, () => {
    console.log(`SeeDream MCP server v${SERVER_VERSION} started (HTTP mode)`);
    console.log(`  - MCP endpoint: http://localhost:${port}/`);
    console.log(`  - Health check: http://localhost:${port}/health`);
    console.log(`  - Protocol:     MCP ${MCP_PROTOCOL_VERSION}`);
    console.log(`  - API Key:      ${process.env.ARK_API_KEY ? "configured" : "NOT SET"}`);
    console.log(`  - Per-request transport isolation enabled`);
    console.log(`  - Accept header auto-injection enabled`);
  });
}

// Main function
async function main(): Promise<void> {
  if (!process.env.ARK_API_KEY) {
    console.error("Warning: ARK_API_KEY not set. Image generation will fail.");
  }

  const transport = process.env.TRANSPORT || "stdio";

  if (transport === "http") {
    await runHttp();
  } else {
    await runStdio();
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
