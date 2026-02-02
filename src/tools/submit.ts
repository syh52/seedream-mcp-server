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
  - mode (string): 'text' (default), 'image' (editing with 1 ref image), or 'multi' (blending 2+ images)
  - size (string): Output size (default: '2K')
  - count (number): Number of images to generate (1-15, default: 4)
  - strength (number): Reference strength 0-1 for image/multi modes (default: 0.7)
  - images (string[]): Reference image URLs for 'image' or 'multi' modes

**Modes:**
  - 'text': Pure text-to-image generation (no reference images needed)
  - 'image': Edit/transform a single reference image (requires 1 image URL)
  - 'multi': Blend multiple images together (requires 2-14 image URLs)

Examples:
  - Text mode: { prompt: "A sunset over mountains", mode: "text" }
  - Image mode: { prompt: "Make this photo look like an oil painting", mode: "image", images: ["https://...jpg"] }
  - Multi mode: { prompt: "Dress the person in image 1 with outfit from image 2", mode: "multi", images: ["https://...1.jpg", "https://...2.jpg"] }`,
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
          referenceImageUrls: params.images,
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
