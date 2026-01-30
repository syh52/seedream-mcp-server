/**
 * Async task submission tool
 * Submits generation request and returns immediately with task ID
 * Designed for Claude.ai compatibility (avoids timeout issues)
 *
 * Architecture:
 * - MCP creates task in Firestore with status='pending'
 * - Cloud Function (processGenerationTask) picks up and processes the task
 * - MCP does NOT process tasks itself (avoids race conditions and OOM issues)
 */

import {
  SubmitInputSchema,
  SubmitInput,
  SubmitOutputSchema,
} from "../schemas/index.js";
import {
  createTaskWithId,
  isFirebaseConfigured,
} from "../services/firebase.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerSubmitTool(server: McpServer): void {
  server.registerTool(
    "seedream_submit",
    {
      title: "Submit Image Generation Task",
      description: `Submit an image generation task. Returns immediately - images will appear in the Web App.

**USE THIS TOOL ON CLAUDE.AI** - The regular seedream_generate tool times out on Claude.ai.
This tool returns immediately after submitting the task.

**After submitting**: View your generated images at https://seedream-gallery.firebaseapp.com

Args:
  - prompt (string, required): Description of the image to generate
  - mode (string): 'text' (default), 'image' (editing), or 'multi' (blending)
  - size (string): Output size (default: '2K')
  - count (number): Number of images to generate (1-15, default: 4)

Example:
  User: "Generate a sunset over mountains"
  Assistant: [calls seedream_submit] "Task submitted! Your images will be ready in about 30-60 seconds. View them at https://seedream-gallery.firebaseapp.com"`,
      inputSchema: SubmitInputSchema,
      outputSchema: SubmitOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: SubmitInput) => {
      // Check Firebase configuration
      if (!isFirebaseConfigured()) {
        return {
          content: [{
            type: "text",
            text: "## Error: Firebase Not Configured\n\nThe async task system requires Firebase. Please configure Firebase credentials."
          }],
          structuredContent: {
            success: false,
            task_id: "",
            status: "error",
            message: "Firebase not configured",
          },
          isError: true,
        };
      }

      // Generate task ID (use mcp_ prefix to identify source)
      const taskId = `mcp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      try {
        // Create task in Firestore with status='pending'
        // Cloud Function (processGenerationTask) will pick it up and process it
        await createTaskWithId(taskId, {
          prompt: params.prompt,
          mode: params.mode,
          size: params.size,
          strength: params.strength,
          expectedCount: params.count,
        });

        console.error(`[submit] Task ${taskId} created, Cloud Function will process it`);

        const output = {
          success: true,
          task_id: taskId,
          status: "submitted" as const,
          message: `Task submitted! Generating ${params.count} image(s). View at https://seedream-gallery.firebaseapp.com`,
        };

        const textContent = [
          "# ✅ Task Submitted",
          "",
          `**Prompt:** ${params.prompt}`,
          `**Images:** ${params.count}`,
          "",
          "Your images will be ready in **30-60 seconds**.",
          "",
          "👉 **View results:** https://seedream-gallery.firebaseapp.com",
        ].join("\n");

        return {
          content: [{ type: "text", text: textContent }],
          structuredContent: output,
        };

      } catch (error) {
        console.error(`[submit] Failed to create task ${taskId}:`, error);

        return {
          content: [{
            type: "text",
            text: `## Error: Failed to Submit Task\n\n${error instanceof Error ? error.message : String(error)}`
          }],
          structuredContent: {
            success: false,
            task_id: taskId,
            status: "error" as const,
            message: error instanceof Error ? error.message : String(error),
          },
          isError: true,
        };
      }
    }
  );
}
