/**
 * Async task submission tool
 * Submits generation request and returns immediately with entry ID
 * Cloud Function (processGenerationTask) handles the actual generation.
 */

import {
  SubmitInputSchema,
  SubmitInput,
  SubmitOutputSchema,
} from "../schemas/index.js";
import {
  createEntryForProcessing,
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
  - size (string): '2K' (default), '4K', '4K-9:16' (2304x4096), or aspect ratios: '1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'
  - count (number): Number of images to generate (1-15, default: 4)
  - strength (number): Reference strength 0-1 for image/multi modes (default: 0.7)
  - images (string[]): Reference image URLs for 'image' or 'multi' modes

Examples:
  - Text mode: { prompt: "A sunset over mountains", mode: "text" }
  - Image mode: { prompt: "Make this photo look like an oil painting", mode: "image", images: ["https://...jpg"] }`,
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
      console.error(`[submit] Received params:`, {
        prompt: params.prompt.slice(0, 50) + "...",
        mode: params.mode,
        size: params.size,
        count: params.count,
        hasImages: !!params.images,
        imageCount: params.images?.length || 0,
      });

      if (!isFirebaseConfigured()) {
        return {
          content: [{
            type: "text",
            text: "## Error: Firebase Not Configured\n\nThe async task system requires Firebase."
          }],
          structuredContent: {
            success: false,
            entry_id: "",
            status: "error",
            message: "Firebase not configured",
          },
          isError: true,
        };
      }

      // Auto-detect mode based on images
      let effectiveMode = params.mode;
      if (params.images && params.images.length > 0 && params.mode === "text") {
        effectiveMode = params.images.length === 1 ? "image" : "multi";
        console.error(`[submit] Auto-corrected mode to '${effectiveMode}'`);
      }

      const entryId = `mcp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      try {
        await createEntryForProcessing(entryId, {
          prompt: params.prompt,
          mode: effectiveMode,
          size: params.size,
          strength: params.strength,
          expectedCount: params.count,
          referenceImageUrls: params.images,
        });

        console.error(`[submit] Entry ${entryId} created`);

        const output = {
          success: true,
          entry_id: entryId,
          status: "submitted" as const,
          message: `Task submitted! Generating ${params.count} image(s). View at https://seedream-gallery.firebaseapp.com`,
        };

        const textContent = [
          "# Task Submitted",
          "",
          `**Prompt:** ${params.prompt}`,
          `**Images:** ${params.count}`,
          "",
          "Your images will be ready in **30-60 seconds**.",
          "",
          "View results: https://seedream-gallery.firebaseapp.com",
        ].join("\n");

        return {
          content: [{ type: "text", text: textContent }],
          structuredContent: output,
        };

      } catch (error) {
        console.error(`[submit] Failed to create entry ${entryId}:`, error);

        return {
          content: [{
            type: "text",
            text: `## Error: Failed to Submit Task\n\n${error instanceof Error ? error.message : String(error)}`
          }],
          structuredContent: {
            success: false,
            entry_id: entryId,
            status: "error" as const,
            message: error instanceof Error ? error.message : String(error),
          },
          isError: true,
        };
      }
    }
  );
}
