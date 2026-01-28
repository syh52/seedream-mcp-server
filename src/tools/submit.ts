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
  createTaskWithId,
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

      // Generate optimistic task ID immediately (don't wait for Firebase)
      const taskId = `mcp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      // Return immediately, process everything in background
      // This ensures Claude.ai doesn't timeout waiting for Firebase
      setImmediate(() => {
        processTaskWithFirebase(taskId, params).catch((error) => {
          console.error(`[submit] Task ${taskId} failed:`, error);
        });
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
    }
  );
}

/**
 * Process task with Firebase - creates task record first, then generates images
 * This runs completely in background after response is sent
 */
async function processTaskWithFirebase(
  taskId: string,
  params: SubmitInput
): Promise<void> {
  console.error(`[submit] Starting background processing for task ${taskId}`);

  try {
    // Step 1: Create task in Firebase (now in background, won't block response)
    await createTaskWithId(taskId, {
      prompt: params.prompt,
      mode: params.mode,
      size: params.size,
      strength: params.strength,
      expectedCount: params.count,
    });
    console.error(`[submit] Task ${taskId} created in Firebase`);

    // Step 2: Update status to generating
    await updateTaskStatus(taskId, "generating");

    // Step 3: Generate images
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

    // Step 4: Process and save each image
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

      // Build TaskImage object, excluding undefined fields (Firestore rejects undefined)
      const taskImage: TaskImage = {
        id: imageId,
        url: img.url,
        size: img.size,
        status: "ready",
        processedAt: Date.now(),
      };
      // Only add storageUrl if it exists
      if (storageUrl) {
        taskImage.storageUrl = storageUrl;
      }

      await addTaskImage(taskId, taskImage);
    }

    // Step 5: Mark task as completed
    await updateTaskStatus(taskId, "completed", {
      usage: result.usage,
    });

    console.error(`[submit] Task ${taskId} completed with ${result.images.length} images`);
  } catch (error) {
    console.error(`[submit] Task ${taskId} failed:`, error);
    // Try to update task status if Firebase is available
    try {
      await updateTaskStatus(taskId, "failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    } catch {
      // Ignore Firebase errors during error handling
    }
  }
}
