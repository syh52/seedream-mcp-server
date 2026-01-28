/**
 * Task result query tool
 * Check the status and results of a submitted task
 */

import {
  ResultInputSchema,
  ResultInput,
  ResultOutputSchema,
} from "../schemas/index.js";
import { getTask, isFirebaseConfigured, getFirebaseUserId } from "../services/firebase.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerResultTool(server: McpServer): void {
  server.registerTool(
    "seedream_result",
    {
      title: "Get Task Result",
      description: `Check the status and retrieve results of a submitted generation task.

Use this after calling seedream_submit to check if images are ready.

Args:
  - task_id (string, required): Task ID from seedream_submit

Returns:
  - status: "pending" | "generating" | "processing" | "completed" | "failed"
  - images: Array of generated images (when completed)
  - progress: Number of images completed / total expected
  - error: Error message (if failed)

Status meanings:
  - pending: Task queued, not started yet
  - generating: API is generating images
  - processing: Images being uploaded to storage
  - completed: All images ready ✓
  - failed: Error occurred

Example:
  Call with task_id="abc123" to check status.
  If status is "completed", the images array will contain URLs.
  If status is "generating", check again in 10-15 seconds.`,
      inputSchema: ResultInputSchema,
      outputSchema: ResultOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: ResultInput) => {
      // Check Firebase configuration
      if (!isFirebaseConfigured()) {
        return {
          content: [{
            type: "text",
            text: "## Error: Firebase Not Configured\n\nThe async task system requires Firebase."
          }],
          structuredContent: {
            success: false,
            task_id: params.task_id,
            status: "failed" as const,
            prompt: "",
            images: [],
            error: "Firebase not configured",
            created_at: 0,
          },
          isError: true,
        };
      }

      try {
        const task = await getTask(params.task_id);

        if (!task) {
          return {
            content: [{
              type: "text",
              text: `## Task Not Found\n\nNo task found with ID: \`${params.task_id}\`\n\nMake sure you're using the correct task_id from seedream_submit.`
            }],
            structuredContent: {
              success: false,
              task_id: params.task_id,
              status: "failed" as const,
              prompt: "",
              images: [],
              error: "Task not found",
              created_at: 0,
            },
            isError: true,
          };
        }

        // Check ownership (MCP user can only see their own tasks)
        const currentUserId = getFirebaseUserId();
        if (task.userId !== currentUserId) {
          return {
            content: [{
              type: "text",
              text: `## Access Denied\n\nThis task belongs to a different user.`
            }],
            structuredContent: {
              success: false,
              task_id: params.task_id,
              status: "failed" as const,
              prompt: "",
              images: [],
              error: "Access denied",
              created_at: 0,
            },
            isError: true,
          };
        }

        const output = {
          success: true,
          task_id: task.id,
          status: task.status,
          prompt: task.prompt,
          images: task.images.map(img => ({
            id: img.id,
            url: img.url,
            storageUrl: img.storageUrl,
            size: img.size,
            status: img.status,
            error: img.error,
          })),
          progress: {
            completed: task.images.filter(i => i.status === "ready").length,
            total: task.expectedCount,
          },
          usage: task.usage,
          error: task.error,
          created_at: task.createdAt,
          completed_at: task.completedAt,
        };

        // Format text response based on status
        let textContent: string;

        switch (task.status) {
          case "pending":
            textContent = [
              "# Task Status: Pending",
              "",
              `**Task ID:** \`${task.id}\``,
              `**Prompt:** ${task.prompt}`,
              "",
              "Task is queued and will start shortly.",
              "Check again in a few seconds.",
            ].join("\n");
            break;

          case "generating":
          case "processing":
            const progress = output.progress;
            textContent = [
              `# Task Status: ${task.status === "generating" ? "Generating" : "Processing"}`,
              "",
              `**Task ID:** \`${task.id}\``,
              `**Progress:** ${progress.completed}/${progress.total} images`,
              `**Prompt:** ${task.prompt}`,
              "",
              "Images are being generated. Check again in 10-15 seconds.",
            ].join("\n");
            break;

          case "completed":
            const lines = [
              "# Task Completed!",
              "",
              `**Task ID:** \`${task.id}\``,
              `**Prompt:** ${task.prompt}`,
              `**Images:** ${task.images.length}`,
              "",
              "## Generated Images",
              "",
            ];

            for (let i = 0; i < task.images.length; i++) {
              const img = task.images[i];
              lines.push(`### Image ${i + 1}`);
              lines.push(`- **URL:** ${img.url}`);
              if (img.storageUrl) {
                lines.push(`- **Storage URL:** ${img.storageUrl}`);
              }
              lines.push("");
            }

            if (task.usage) {
              lines.push("## Usage");
              lines.push(`- Generated: ${task.usage.generated_images} images`);
              lines.push(`- Tokens: ${task.usage.total_tokens}`);
            }

            textContent = lines.join("\n");
            break;

          case "failed":
            textContent = [
              "# Task Failed",
              "",
              `**Task ID:** \`${task.id}\``,
              `**Error:** ${task.error || "Unknown error"}`,
              `**Prompt:** ${task.prompt}`,
              "",
              "You can try submitting a new task with seedream_submit.",
            ].join("\n");
            break;

          case "cancelled":
            textContent = [
              "# Task Cancelled",
              "",
              `**Task ID:** \`${task.id}\``,
              `**Prompt:** ${task.prompt}`,
            ].join("\n");
            break;

          default:
            textContent = `Task status: ${task.status}`;
        }

        return {
          content: [{ type: "text", text: textContent }],
          structuredContent: output,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          content: [{
            type: "text",
            text: `## Error Querying Task\n\n${errorMsg}`
          }],
          structuredContent: {
            success: false,
            task_id: params.task_id,
            status: "failed" as const,
            prompt: "",
            images: [],
            error: errorMsg,
            created_at: 0,
          },
          isError: true,
        };
      }
    }
  );
}
