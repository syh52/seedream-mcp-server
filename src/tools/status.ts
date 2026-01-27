/**
 * Server status and health check tool
 * Provides quick diagnostics without consuming API quota
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as os from "os";
import { isFirebaseConfigured } from "../services/firebase.js";

// Input schema - no required parameters
const StatusInputSchema = z.object({
  verbose: z.boolean()
    .default(false)
    .describe("Include detailed system information"),
}).strict();

type StatusInput = z.infer<typeof StatusInputSchema>;

// Output schema
const StatusOutputSchema = z.object({
  status: z.enum(["healthy", "degraded", "error"]).describe("Overall server status"),
  api_key_configured: z.boolean().describe("Whether ARK_API_KEY is set"),
  firebase_configured: z.boolean().describe("Whether Firebase sync is configured"),
  firebase_user_id: z.string().optional().describe("Firebase user ID for image sync"),
  server_version: z.string().describe("MCP server version"),
  node_version: z.string().describe("Node.js version"),
  uptime_seconds: z.number().describe("Process uptime in seconds"),
  memory_mb: z.number().optional().describe("Memory usage in MB (verbose only)"),
  platform: z.string().optional().describe("Operating system (verbose only)"),
  tools_available: z.array(z.string()).describe("List of available tools"),
});

export type StatusOutput = z.infer<typeof StatusOutputSchema>;

export function registerStatusTool(server: McpServer): void {
  server.registerTool(
    "seedream_status",
    {
      title: "Check Server Status",
      description: `Check the health and status of the SeeDream MCP server.

Use this tool to verify the server is working correctly before generating images.
This does NOT consume API quota - it's a free diagnostic check.

Args:
  - verbose (boolean): Include detailed system info (default: false)

Returns:
  Server health status, configuration check, and available tools.

Use when:
  - First connecting to verify everything is set up correctly
  - Troubleshooting when image generation fails
  - Checking if API key is configured properly`,
      inputSchema: StatusInputSchema,
      outputSchema: StatusOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: StatusInput) => {
      const apiKeyConfigured = !!process.env.ARK_API_KEY;
      const firebaseConfigured = isFirebaseConfigured();
      const firebaseUserId = process.env.FIREBASE_USER_ID;
      const status = apiKeyConfigured ? "healthy" : "degraded";

      const tools = [
        "seedream_generate",
        "seedream_edit",
        "seedream_blend",
        "seedream_variations",
        "seedream_status",
      ];

      const output: StatusOutput = {
        status,
        api_key_configured: apiKeyConfigured,
        firebase_configured: firebaseConfigured,
        firebase_user_id: firebaseUserId,
        server_version: "1.1.0",
        node_version: process.version,
        uptime_seconds: Math.floor(process.uptime()),
        tools_available: tools,
      };

      // Add verbose info if requested
      if (params.verbose) {
        const memUsage = process.memoryUsage();
        output.memory_mb = Math.round(memUsage.heapUsed / 1024 / 1024);
        output.platform = `${os.platform()} ${os.release()}`;
      }

      // Format output
      const lines = [
        "# SeeDream MCP Server Status",
        "",
        `**Status:** ${status === "healthy" ? "✅ Healthy" : "⚠️ Degraded"}`,
        `**API Key:** ${apiKeyConfigured ? "✅ Configured" : "❌ Not set (ARK_API_KEY required)"}`,
        `**Firebase:** ${firebaseConfigured ? `✅ Configured (User: ${firebaseUserId || "mcp-public"})` : "❌ Not configured"}`,
        "",
        "## Server Info",
        `- Version: ${output.server_version}`,
        `- Node.js: ${output.node_version}`,
        `- Uptime: ${formatUptime(output.uptime_seconds)}`,
      ];

      if (params.verbose && output.memory_mb !== undefined) {
        lines.push(`- Memory: ${output.memory_mb} MB`);
        lines.push(`- Platform: ${output.platform}`);
      }

      lines.push("");
      lines.push("## Available Tools");
      for (const tool of tools) {
        lines.push(`- \`${tool}\``);
      }

      if (!apiKeyConfigured || !firebaseConfigured) {
        lines.push("");
        lines.push("## ⚠️ Action Required");

        if (!apiKeyConfigured) {
          lines.push("Set your API key to enable image generation:");
          lines.push("```bash");
          lines.push('export ARK_API_KEY="your-api-key"');
          lines.push("```");
        }

        if (!firebaseConfigured) {
          lines.push("");
          lines.push("Set Firebase credentials to enable image sync to Web App:");
          lines.push("```bash");
          lines.push('export FIREBASE_SERVICE_ACCOUNT=\'{"type":"service_account",...}\'');
          lines.push('export FIREBASE_USER_ID="your-firebase-uid"');
          lines.push('export FIREBASE_USER_NAME="Your Name"');
          lines.push("```");
        }
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        structuredContent: output,
      };
    }
  );
}

/**
 * Format uptime to human-readable string
 */
function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
}
