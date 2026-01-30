#!/usr/bin/env node
/**
 * SeeDream MCP Server
 *
 * Enables Claude Code to generate images via natural language using SeeDream 4.5.
 *
 * Optimizations in v1.1.0:
 * - Parallel image downloads (up to 4 concurrent)
 * - Base64 encoding cache for repeated image inputs
 * - Retry mechanism for transient failures
 * - Performance timing metrics
 * - Structured output schemas
 *
 * Available tools:
 * - seedream_generate: Create images from text descriptions
 * - seedream_edit: Edit existing images with text instructions
 * - seedream_blend: Combine elements from multiple images
 * - seedream_variations: Generate multiple variations of a concept
 * - seedream_status: Check server health (no API quota used)
 *
 * Required environment variable:
 * - ARK_API_KEY: Your BytePlus ARK API key
 *
 * Transport modes:
 * - stdio (default): Local CLI integration with Claude Code
 * - http: Remote server accessible via HTTP (set TRANSPORT=http)
 *
 * Usage:
 *   Local:  ARK_API_KEY=your-key node dist/index.js
 *   Remote: TRANSPORT=http PORT=3000 ARK_API_KEY=your-key node dist/index.js
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { Request, Response } from "express";

import { registerGenerateTool } from "./tools/generate.js";
import { registerEditTool } from "./tools/edit.js";
import { registerBlendTool } from "./tools/blend.js";
import { registerVariationsTool } from "./tools/variations.js";
import { registerStatusTool } from "./tools/status.js";
import { registerSubmitTool } from "./tools/submit.js";

// Server version
// v2.3.0: MCP submit only creates tasks, Cloud Function does processing
const SERVER_VERSION = "2.3.0";

// MCP Protocol version for Claude.ai compatibility
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
// Async task submission for Claude.ai (avoids timeout issues)
registerSubmitTool(server);

/**
 * Run server with stdio transport (local CLI mode)
 */
async function runStdio(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`SeeDream MCP server v${SERVER_VERSION} started (stdio mode)`);
  console.error("Available tools: seedream_generate, seedream_edit, seedream_blend, seedream_variations, seedream_status");
}

/**
 * Run server with HTTP transport (remote server mode)
 * Supports both Claude Code (/mcp) and Claude.ai (/) endpoints
 */
async function runHttp(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: "50mb" })); // Allow large base64 images

  // CORS for browser clients (including Claude.ai)
  app.use((_req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, HEAD, OPTIONS, DELETE");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept, Mcp-Session-Id");
    res.header("Access-Control-Expose-Headers", "Mcp-Session-Id, MCP-Protocol-Version");
    next();
  });

  // MCP handler - stateless, each request gets a fresh transport
  // This is the recommended approach for HTTP MCP servers
  async function handleMcpRequest(req: Request, res: Response) {
    try {
      // Create new transport for each request (stateless mode)
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // Stateless - no session tracking
        enableJsonResponse: true,
      });

      res.on("close", () => transport.close());

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("MCP request error:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  }

  // HEAD request for MCP protocol version (Claude.ai requirement)
  app.head("/", (_req: Request, res: Response) => {
    res.header("MCP-Protocol-Version", MCP_PROTOCOL_VERSION);
    res.status(200).end();
  });

  app.head("/mcp", (_req: Request, res: Response) => {
    res.header("MCP-Protocol-Version", MCP_PROTOCOL_VERSION);
    res.status(200).end();
  });

  // Root path for Claude.ai compatibility
  app.post("/", handleMcpRequest);

  // Legacy /mcp path for Claude Code compatibility
  app.post("/mcp", handleMcpRequest);

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

  // Info endpoint (moved to /info)
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
        "seedream_submit - Submit task, view results in Web App (for Claude.ai)",
      ],
      documentation: "https://github.com/syh52/seedream-mcp-server",
      optimizations: ["parallel downloads", "caching", "retry mechanism", "timing metrics"],
    });
  });

  // GET on root - return protocol info for discovery
  app.get("/", (_req: Request, res: Response) => {
    res.header("MCP-Protocol-Version", MCP_PROTOCOL_VERSION);
    res.json({
      name: "seedream-mcp-server",
      version: SERVER_VERSION,
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {
        tools: true,
      },
    });
  });

  const port = parseInt(process.env.PORT || "3000", 10);
  app.listen(port, () => {
    console.log(`SeeDream MCP server v${SERVER_VERSION} started (HTTP mode)`);
    console.log(`  - MCP endpoint: http://localhost:${port}/ (Claude.ai)`);
    console.log(`  - MCP endpoint: http://localhost:${port}/mcp (Claude Code)`);
    console.log(`  - Health check: http://localhost:${port}/health`);
    console.log(`  - Server info:  http://localhost:${port}/info`);
    console.log(`  - Protocol:     MCP ${MCP_PROTOCOL_VERSION}`);
    console.log(`  - API Key:      ${process.env.ARK_API_KEY ? "configured" : "NOT SET"}`);
  });
}

// Main function
async function main(): Promise<void> {
  // Check for API key
  if (!process.env.ARK_API_KEY) {
    console.error(
      "Warning: ARK_API_KEY environment variable is not set. " +
      "Image generation will fail until this is configured."
    );
  }

  // Select transport based on environment
  const transport = process.env.TRANSPORT || "stdio";

  if (transport === "http") {
    await runHttp();
  } else {
    await runStdio();
  }
}

// Run the server
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
