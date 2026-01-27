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

// Server version
const SERVER_VERSION = "1.1.0";

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
 */
async function runHttp(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: "50mb" })); // Allow large base64 images

  // CORS for browser clients
  app.use((_req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    next();
  });

  // Health check endpoint
  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      server: "seedream-mcp-server",
      version: SERVER_VERSION,
      apiKeyConfigured: !!process.env.ARK_API_KEY,
    });
  });

  // MCP endpoint - stateless JSON request/response
  app.post("/mcp", async (req: Request, res: Response) => {
    try {
      // Create new transport for each request (stateless)
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });

      res.on("close", () => transport.close());

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("MCP request error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Info endpoint
  app.get("/", (_req: Request, res: Response) => {
    res.json({
      name: "SeeDream MCP Server",
      description: "Generate images via natural language using SeeDream 4.5",
      version: SERVER_VERSION,
      endpoints: {
        mcp: "POST /mcp",
        health: "GET /health",
      },
      tools: [
        "seedream_generate - Text to image",
        "seedream_edit - Edit existing image",
        "seedream_blend - Blend multiple images",
        "seedream_variations - Generate variations",
        "seedream_status - Check server status",
      ],
      documentation: "https://github.com/syh52/seedream-mcp-server",
      optimizations: ["parallel downloads", "caching", "retry mechanism", "timing metrics"],
    });
  });

  const port = parseInt(process.env.PORT || "3000", 10);
  app.listen(port, () => {
    console.log(`SeeDream MCP server v${SERVER_VERSION} started (HTTP mode)`);
    console.log(`  - MCP endpoint: http://localhost:${port}/mcp`);
    console.log(`  - Health check: http://localhost:${port}/health`);
    console.log(`  - Server info:  http://localhost:${port}/`);
    console.log(`  - API Key: ${process.env.ARK_API_KEY ? "configured" : "NOT SET"}`);
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
