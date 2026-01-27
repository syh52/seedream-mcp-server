/**
 * Multi-image blending tool
 * Optimized with outputSchema, performance metrics, and progress notifications
 */

import {
  BlendInputSchema,
  BlendInput,
  BlendOutputSchema,
  ResponseFormat
} from "../schemas/index.js";
import { generateImages } from "../services/seedream.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ProgressReporter,
  ErrorReporter,
  formatTime,
} from "../utils/progress.js";

export function registerBlendTool(server: McpServer): void {
  server.registerTool(
    "seedream_blend",
    {
      title: "Blend Multiple Images",
      description: `Combine elements from multiple images using SeeDream 4.5.

Use this tool to blend 2-14 reference images together. Perfect for:
- **Virtual try-on**: Dress person from image 1 in clothes from image 2
- **Face/Subject swap**: Put face/subject from image 1 onto body/scene in image 2
- **Style transfer**: Apply style of image 2 to content of image 1
- **Product visualization**: Put product from image 1 into scene from image 2
- **Character consistency**: Combine character traits from multiple references

Args:
  - prompt (string, required): Blending instruction referencing images by number
  - images (string[], required): Array of 2-14 image URLs or local paths
  - size (string): Output size (default: '2K')
  - strength (number): Reference strength 0-1 (default: 0.7)
  - watermark (boolean): Add watermark (default: false)
  - download (boolean): Save locally (default: true)
  - download_dir (string): Local save directory

Returns:
  Blended image URL, local path if downloaded, and performance timing.

Prompt Structure (per official docs):
  - Reference Target: Clearly specify what to extract from each reference image
  - Scene Description: Describe the output scene layout and composition
  - Always reference images by number: "image 1", "image 2", etc.

Common Use Cases:
  - Virtual try-on: "Dress the character in Image 1 with the outfit from Image 2"
  - Subject replacement: "Replace the subject in Image 1 with the subject from Image 2"
  - Style transfer: "Apply the style of Image 2 to Image 1"
  - Product placement: "Place the product from Image 1 on the table in Image 2"

Examples:
  - "Replace the clothing in image 1 with the outfit from image 2"
  - "Put the face from image 1 onto the body in image 2, maintaining natural lighting"
  - "Apply the linear minimalist style of image 2 to design icons based on image 1"
  - "Generate four tops in different materials, based on the clothing style worn by the girl in the reference images"

Tips:
  - Be specific about which elements to take from each image
  - For best results, use similar aspect ratios for inputs
  - Higher strength preserves more details from reference images
  - Using 10+ reference images significantly impacts generation speed`,
      inputSchema: BlendInputSchema,
      outputSchema: BlendOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (params: BlendInput, extra: any) => {
      const progress = new ProgressReporter(extra);
      const errorReporter = new ErrorReporter();

      errorReporter.addContext("prompt", params.prompt.slice(0, 100));
      errorReporter.addContext("imageCount", params.images.length);
      errorReporter.addContext("strength", params.strength);

      progress.setStages([
        "Loading source images",
        "Encoding images",
        "Calling SeeDream API",
        "Blending images (30-60s)",
        "Downloading result",
        "Formatting response",
      ]);

      try {
        await progress.nextStage(`Loading ${params.images.length} source images...`);
        errorReporter.recordStage("Input validation");

        await progress.nextStage("Encoding images for API...");
        errorReporter.recordStage("Image encoding");

        await progress.nextStage("Connecting to SeeDream API...");
        errorReporter.recordStage("API connection");

        await progress.nextStage(`Blending ${params.images.length} images (this may take 30-60 seconds)...`);

        const result = await generateImages(
        {
          prompt: params.prompt,
          size: params.size,
          images: params.images,
          strength: params.strength,
          watermark: params.watermark,
        },
        params.download,
        params.download_dir || "./generated_images"
      );

      if (!result.success) {
        errorReporter.recordFailedStage("Image blending");
        errorReporter.addContext("apiError", result.error);

        return {
          content: [{ type: "text", text: errorReporter.formatError(new Error(result.error || "Unknown error"), "seedream_blend") }],
          structuredContent: errorReporter.formatErrorJson(new Error(result.error || "Unknown error"), "seedream_blend"),
          isError: true,
        };
      }

      errorReporter.recordStage("Image blending");
      await progress.nextStage("Processing result...");
      await progress.complete("Images blended successfully");

      const output = {
        success: true,
        images: result.images,
        usage: result.usage,
        timing: result.timing,
        prompt: params.prompt,
        source_images: params.images,
        image_count: params.images.length,
        strength: params.strength,
      };

      let textContent: string;
      if (params.response_format === ResponseFormat.MARKDOWN) {
        const lines = [
          "# Images Blended Successfully",
          "",
          `**Instruction:** ${params.prompt}`,
          `**Source images:** ${params.images.length} images`,
          `**Strength:** ${params.strength}`,
          "",
          "### Source Images",
        ];

        params.images.forEach((img, i) => {
          lines.push(`${i + 1}. ${img}`);
        });

        lines.push("");
        lines.push("## Result");
        lines.push("");

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
          content: [{ type: "text", text: errorReporter.formatError(error, "seedream_blend") }],
          structuredContent: errorReporter.formatErrorJson(error, "seedream_blend"),
          isError: true,
        };
      }
    }
  );
}
