/**
 * Image-to-Image editing tool
 * Optimized with outputSchema, performance metrics, and progress notifications
 */

import {
  EditInputSchema,
  EditInput,
  EditOutputSchema,
  ResponseFormat
} from "../schemas/index.js";
import { generateImages } from "../services/seedream.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ProgressReporter,
  ErrorReporter,
  formatTime,
} from "../utils/progress.js";

export function registerEditTool(server: McpServer): void {
  server.registerTool(
    "seedream_edit",
    {
      title: "Edit Image",
      description: `Edit an existing image based on text instructions using SeeDream 4.5.

Use this tool to modify, enhance, or transform an existing image. Supports:
- **Addition**: Add elements (accessories, objects, background elements)
- **Deletion**: Remove unwanted elements
- **Replacement**: Swap one element for another
- **Modification**: Change colors, styles, lighting, expressions
- **Style transfer**: Apply artistic styles to photos

Args:
  - prompt (string, required): Edit instruction describing the changes
  - image (string, required): Source image URL or local file path
  - size (string): Output size (default: '2K')
  - strength (number): Reference strength 0-1 (default: 0.7)
  - watermark (boolean): Add watermark (default: false)
  - download (boolean): Save locally (default: true)
  - download_dir (string): Local save directory

Returns:
  Edited image URL, local path if downloaded, and performance timing.

Edit Instruction Best Practices (per official docs):
  - Use concise, unambiguous instructions
  - Be specific: "the person's shirt" not "it"
  - Specify what should remain unchanged: "keeping the pose unchanged"
  - For targeted edits: draw arrows/boxes on image and reference them
    Example: "Insert a TV where the red area is marked"

Supported Operations:
  - Addition: "Add matching silver earrings and a necklace to the girl"
  - Deletion: "Remove the girl's hat"
  - Replacement: "Replace the largest bread man with a croissant man"
  - Modification: "Turn the robots into transparent crystal, colored red, yellow and green"

Examples:
  - "Add sunglasses to the person, keeping everything else unchanged"
  - "Change the background to a beach sunset"
  - "Apply Van Gogh oil painting style to this photo"
  - "Remove the text from the image"
  - "Dress the tallest panda in pink Peking Opera costume, keeping its pose unchanged"`,
      inputSchema: EditInputSchema,
      outputSchema: EditOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (params: EditInput, extra: any) => {
      const progress = new ProgressReporter(extra);
      const errorReporter = new ErrorReporter();

      errorReporter.addContext("prompt", params.prompt.slice(0, 100));
      errorReporter.addContext("sourceImage", params.image.slice(0, 100));
      errorReporter.addContext("strength", params.strength);

      progress.setStages([
        "Loading source image",
        "Calling SeeDream API",
        "Editing image (20-40s)",
        "Downloading result",
        "Formatting response",
      ]);

      try {
        await progress.nextStage("Loading and validating source image...");
        errorReporter.recordStage("Input validation");

        await progress.nextStage("Connecting to SeeDream API...");
        errorReporter.recordStage("API connection");

        await progress.nextStage("Editing image (this may take 20-40 seconds)...");

        const result = await generateImages(
        {
          prompt: params.prompt,
          size: params.size,
          images: [params.image],
          strength: params.strength,
          watermark: params.watermark,
        },
        params.download,
        params.download_dir || "./generated_images"
      );

      if (!result.success) {
        errorReporter.recordFailedStage("Image editing");
        errorReporter.addContext("apiError", result.error);

        return {
          content: [{ type: "text", text: errorReporter.formatError(new Error(result.error || "Unknown error"), "seedream_edit") }],
          structuredContent: errorReporter.formatErrorJson(new Error(result.error || "Unknown error"), "seedream_edit"),
          isError: true,
        };
      }

      errorReporter.recordStage("Image editing");
      await progress.nextStage("Processing result...");
      await progress.complete("Image edited successfully");

      const output = {
        success: true,
        images: result.images,
        usage: result.usage,
        timing: result.timing,
        prompt: params.prompt,
        source_image: params.image,
        strength: params.strength,
      };

      let textContent: string;
      if (params.response_format === ResponseFormat.MARKDOWN) {
        const lines = [
          "# Image Edited Successfully",
          "",
          `**Edit instruction:** ${params.prompt}`,
          `**Source image:** ${params.image}`,
          `**Strength:** ${params.strength} (${params.strength! < 0.5 ? "creative" : params.strength! > 0.7 ? "subtle" : "balanced"})`,
          "",
          "## Result",
          "",
        ];

        for (const img of result.images) {
          lines.push(`- **URL:** ${img.url}`);
          if (img.localPath) {
            lines.push(`- **Local:** \`${img.localPath}\``);
          }
        }

        // Add timing metrics
        if (result.timing) {
          lines.push("");
          lines.push("## Performance");
          lines.push(`- Generation: ${formatTime(result.timing.generation_ms)}`);
          lines.push(`- Download: ${formatTime(result.timing.download_ms)}`);
          lines.push(`- **Total: ${formatTime(result.timing.total_ms)}**`);
        }

        textContent = lines.join("\n");
      } else {
        textContent = JSON.stringify(output, null, 2);
      }

      return {
        content: [{ type: "text", text: textContent }],
        structuredContent: output,
      };
      } catch (error) {
        errorReporter.recordFailedStage("Unexpected error");
        return {
          content: [{ type: "text", text: errorReporter.formatError(error, "seedream_edit") }],
          structuredContent: errorReporter.formatErrorJson(error, "seedream_edit"),
          isError: true,
        };
      }
    }
  );
}
