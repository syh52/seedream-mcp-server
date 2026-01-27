/**
 * Batch variation generation tool
 * Optimized with outputSchema, performance metrics, and progress notifications
 */

import {
  VariationsInputSchema,
  VariationsInput,
  VariationsOutputSchema,
  ResponseFormat
} from "../schemas/index.js";
import { generateImages } from "../services/seedream.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ProgressReporter,
  ErrorReporter,
  formatTime,
} from "../utils/progress.js";

export function registerVariationsTool(server: McpServer): void {
  server.registerTool(
    "seedream_variations",
    {
      title: "Generate Image Variations",
      description: `Generate multiple variations of an image concept using SeeDream 4.5.

Use this tool to create 2-15 coherent variations based on a prompt. Great for:
- **A/B testing**: Generate multiple options to compare
- **Storyboards**: Create a series of related images
- **Product variations**: Same product in different colors/styles
- **Exploration**: See different interpretations of your concept
- **Social media**: Multiple posts from one concept

Args:
  - prompt (string, required): Base concept for generating variations.
    Include batch keywords like "a series", "a set", "Generate X images" for best results.
  - count (number): Number of variations to generate (2-15, default: 4)
  - base_image (string, optional): Reference image to create variations from
  - size (string): Output size (default: '2K')
  - watermark (boolean): Add watermark (default: false)
  - download (boolean): Save locally (default: true)
  - download_dir (string): Local save directory

Returns:
  Array of variation image URLs, local paths if downloaded, and performance timing.

Prompt Best Practices (per official docs):
  - Include batch keywords: "a series of", "a set of", "Generate X images"
  - Describe variations explicitly: "4 seasonal versions", "different color schemes"
  - For storyboards: describe each panel's content in sequence
  - Keep prompts under 600 English words for best results

Examples:
  - "Generate a series of 4 seasonal variations of a cozy coffee shop interior"
  - "Create a set of 6 color variations of this minimalist logo design"
  - "Generate 4 different poses of this anime character in action"
  - "Create a 4-panel storyboard: morning coffee, commute, work, evening relaxation"

Tips:
  - The model maintains consistency across variations automatically
  - Use count=4 for quick comparisons, higher for more options
  - Adding a base_image helps maintain visual consistency
  - Note: base_image cannot be combined with batch generation (API limitation)`,
      inputSchema: VariationsInputSchema,
      outputSchema: VariationsOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (params: VariationsInput, extra: any) => {
      const progress = new ProgressReporter(extra);
      const errorReporter = new ErrorReporter();

      errorReporter.addContext("prompt", params.prompt.slice(0, 100));
      errorReporter.addContext("count", params.count);
      errorReporter.addContext("hasBaseImage", !!params.base_image);

      progress.setStages([
        "Validating parameters",
        "Calling SeeDream API",
        `Generating ${params.count} variations (30-90s)`,
        "Downloading images",
        "Formatting response",
      ]);

      try {
        await progress.nextStage("Validating input parameters...");
        errorReporter.recordStage("Input validation");

        await progress.nextStage("Connecting to SeeDream API...");
        errorReporter.recordStage("API connection");

        await progress.nextStage(`Generating ${params.count} variations (this may take 30-90 seconds)...`);

        const result = await generateImages(
        {
          prompt: params.prompt,
          size: params.size,
          images: params.base_image ? [params.base_image] : undefined,
          batchCount: params.count,
          watermark: params.watermark,
        },
        params.download,
        params.download_dir || "./generated_images"
      );

      if (!result.success) {
        errorReporter.recordFailedStage("Variation generation");
        errorReporter.addContext("apiError", result.error);

        return {
          content: [{ type: "text", text: errorReporter.formatError(new Error(result.error || "Unknown error"), "seedream_variations") }],
          structuredContent: errorReporter.formatErrorJson(new Error(result.error || "Unknown error"), "seedream_variations"),
          isError: true,
        };
      }

      errorReporter.recordStage("Variation generation");
      await progress.nextStage("Processing results...");
      await progress.complete(`Generated ${result.images.length} variations successfully`);

      const output = {
        success: true,
        images: result.images,
        usage: result.usage,
        timing: result.timing,
        prompt: params.prompt,
        requested_count: params.count,
        generated_count: result.images.length,
        base_image: params.base_image,
      };

      let textContent: string;
      if (params.response_format === ResponseFormat.MARKDOWN) {
        const lines = [
          "# Variations Generated Successfully",
          "",
          `**Prompt:** ${params.prompt}`,
          `**Requested:** ${params.count} variations`,
          `**Generated:** ${result.images.length} images`,
        ];

        if (params.base_image) {
          lines.push(`**Base image:** ${params.base_image}`);
        }

        lines.push("");
        lines.push("## Generated Variations");
        lines.push("");

        for (let i = 0; i < result.images.length; i++) {
          const img = result.images[i];
          lines.push(`### Variation ${i + 1}`);
          lines.push(`- **URL:** ${img.url}`);
          if (img.localPath) {
            lines.push(`- **Local:** \`${img.localPath}\``);
          }
          lines.push("");
        }

        if (result.usage) {
          lines.push("## Usage");
          lines.push(`- Generated images: ${result.usage.generated_images}`);
          lines.push(`- Tokens used: ${result.usage.total_tokens}`);
          lines.push("");
        }

        // Add timing metrics
        if (result.timing) {
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
          content: [{ type: "text", text: errorReporter.formatError(error, "seedream_variations") }],
          structuredContent: errorReporter.formatErrorJson(error, "seedream_variations"),
          isError: true,
        };
      }
    }
  );
}
