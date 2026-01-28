/**
 * Async task submission tool
 * Submits generation request and returns immediately with task ID
 * Designed for Claude.ai compatibility (avoids timeout issues)
 */

import {
  SubmitInputSchema,
  SubmitInput,
  SubmitOutputSchema,
  ResponseFormat
} from "../schemas/index.js";
import {
  createTask,
  updateTaskStatus,
  addTaskImage,
  isFirebaseConfigured,
  syncImageToFirebase,
  TaskImage,
} from "../services/firebase.js";
import { generateImages } from "../services/seedream.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerSubmitTool(server: McpServer): void {
  server.registerTool(
    "seedream_submit",
    {
      title: "Submit Image Generation Task",
      description: `Submit an image generation task and get a task ID immediately (no waiting).

**USE THIS TOOL ON CLAUDE.AI** - The regular seedream_generate tool may timeout on Claude.ai
because image generation takes 30-60 seconds. This tool returns immediately.

Workflow:
1. Call seedream_submit with your prompt → Get task_id instantly
2. Call seedream_result with task_id → Check if images are ready
3. Repeat step 2 until status is "completed"

Args:
  - prompt (string, required): Description of the image to generate
  - mode (string): 'text' (default), 'image' (editing), or 'multi' (blending)
  - size (string): Output size (default: '2K')
  - count (number): Number of images to generate (1-15, default: 4)

Returns:
  Task ID for tracking progress with seedream_result tool.

Example conversation:
  User: "Generate a cat wearing a hat"
  Assistant: [calls seedream_submit] "Task submitted! ID: abc123. Checking status..."
  Assistant: [calls seedream_result] "Still generating (2/4 images ready)..."
  Assistant: [calls seedream_result] "Done! Here are your 4 images: ..."`,
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
            check_command: "",
          },
          isError: true,
        };
      }

      try {
        // Create task in Firestore
        const taskId = await createTask({
          prompt: params.prompt,
          mode: params.mode,
          size: params.size,
          strength: params.strength,
          expectedCount: params.count,
        });

        // Start background processing (fire and forget)
        processTaskInBackground(taskId, params).catch((error) => {
          console.error(`[submit] Background processing failed for ${taskId}:`, error);
        });

        const output = {
          success: true,
          task_id: taskId,
          status: "pending",
          message: `Task submitted! Generating ${params.count} image(s) in background.`,
          check_command: `Call seedream_result with task_id="${taskId}" to check progress`,
        };

        const textContent = [
          "# Task Submitted Successfully",
          "",
          `**Task ID:** \`${taskId}\``,
          `**Status:** pending`,
          `**Prompt:** ${params.prompt}`,
          `**Images:** ${params.count}`,
          "",
          "## Next Steps",
          "",
          `Call \`seedream_result\` with task_id="${taskId}" to check progress.`,
          "",
          "The task is processing in the background. Images will be ready in 30-60 seconds.",
        ].join("\n");

        return {
          content: [{ type: "text", text: textContent }],
          structuredContent: output,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          content: [{
            type: "text",
            text: `## Error Submitting Task\n\n${errorMsg}`
          }],
          structuredContent: {
            success: false,
            task_id: "",
            status: "error",
            message: errorMsg,
            check_command: "",
          },
          isError: true,
        };
      }
    }
  );
}

/**
 * Process task in background
 * This runs after the tool returns to the client
 */
async function processTaskInBackground(
  taskId: string,
  params: SubmitInput
): Promise<void> {
  console.error(`[submit] Starting background processing for task ${taskId}`);

  try {
    // Update status to generating
    await updateTaskStatus(taskId, "generating");

    // Generate images
    const result = await generateImages(
      {
        prompt: params.prompt,
        size: params.size,
        batchCount: params.count,
      },
      true, // download
      "./generated_images"
    );

    if (!result.success) {
      await updateTaskStatus(taskId, "failed", {
        error: result.error || "Generation failed",
      });
      return;
    }

    // Process and save each image
    for (let i = 0; i < result.images.length; i++) {
      const img = result.images[i];
      const imageId = `img_${Date.now()}_${i}`;

      // Sync to Firebase Storage
      let storageUrl: string | undefined;
      if (img.localPath) {
        const syncResult = await syncImageToFirebase(
          img.url,
          img.localPath,
          params.prompt,
          img.size,
          params.mode
        );
        if (syncResult) {
          storageUrl = syncResult.storageUrl;
        }
      }

      const taskImage: TaskImage = {
        id: imageId,
        url: img.url,
        storageUrl,
        size: img.size,
        status: "ready",
        processedAt: Date.now(),
      };

      await addTaskImage(taskId, taskImage);
    }

    // Mark task as completed
    await updateTaskStatus(taskId, "completed", {
      usage: result.usage,
    });

    console.error(`[submit] Task ${taskId} completed with ${result.images.length} images`);
  } catch (error) {
    console.error(`[submit] Task ${taskId} failed:`, error);
    await updateTaskStatus(taskId, "failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
