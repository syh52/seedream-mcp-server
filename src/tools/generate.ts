/**
 * Text-to-Image generation tool
 * Optimized with outputSchema, performance metrics, and progress notifications
 */

import {
  GenerateInputSchema,
  GenerateInput,
  GenerateOutputSchema,
  ResponseFormat
} from "../schemas/index.js";
import { generateImages } from "../services/seedream.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ProgressReporter,
  ErrorReporter,
  formatTime,
} from "../utils/progress.js";

export function registerGenerateTool(server: McpServer): void {
  server.registerTool(
    "seedream_generate",
    {
      title: "Generate Image from Text",
      description: `Generate images from a text description using SeeDream 4.5.

This is the primary tool for creating images from scratch.
**Default: Generates 4 images per prompt** using streaming for fast response.

Args:
  - prompt (string, required): Detailed description of the image to generate
  - size (string): '2K' (default), '4K', or aspect ratios: '1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'
  - watermark (boolean): Add 'AI generated' watermark (default: false)
  - download (boolean): Save to local directory (default: true)
  - download_dir (string): Local save directory (default: ./generated_images)
  - response_format ('markdown' | 'json'): Output format

Returns:
  Generated image URL(s), local file path(s) if downloaded, and performance timing.

Prompt Best Practices (per official docs):
  - Structure: Subject + Action + Environment
  - For aesthetics add: Style, Color, Lighting, Composition
  - For text in images: use double quotes - 'poster with title "Hello World"'
  - Specify application context: "Design a logo for...", "Create a poster for..."
  - Keep under 600 English words; concise is better than verbose

Examples:
  - "A girl in a lavish dress walking under a parasol along a tree-lined path, in the style of a Monet oil painting"
  - "Design a logo for a gaming company. The logo features a dog playing with a game controller. The company name 'PITBULL' is written on it."
  - "Vibrant close-up editorial portrait, model with piercing gaze, wearing a sculptural hat, rich color blocking, Vogue magazine aesthetic"
  - "A cluttered office desk with an open laptop showing green code, a mug with the word 'Developer' on it, sunlight from the right"

Tips:
  - Be specific: "golden retriever puppy" > "dog"
  - Use natural language, not keyword lists
  - Include style keywords: "oil painting style", "anime art", "photorealistic"
  - Specify composition: "close-up portrait", "bird's eye view", "cinematic wide shot"`,
      inputSchema: GenerateInputSchema,
      outputSchema: GenerateOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (params: GenerateInput, extra: any) => {
      // Initialize progress and error reporters
      const progress = new ProgressReporter(extra);
      const errorReporter = new ErrorReporter();

      // Add context for error reporting
      errorReporter.addContext("prompt", params.prompt.slice(0, 100) + (params.prompt.length > 100 ? "..." : ""));
      errorReporter.addContext("size", params.size);
      errorReporter.addContext("download", params.download);

      // Define operation stages
      progress.setStages([
        "Validating input",
        "Calling SeeDream API",
        "Generating images (30-60s)",
        "Downloading images",
        "Syncing to Firebase",
        "Formatting response",
      ]);

      try {
        // Stage 1: Validating input
        await progress.nextStage("Validating input parameters...");
        errorReporter.recordStage("Input validation");

        // Stage 2: Calling API
        await progress.nextStage("Connecting to SeeDream API...");
        errorReporter.recordStage("API connection initiated");

        // Stage 3: Generating (this is where most time is spent)
        await progress.nextStage("Generating images (this may take 30-60 seconds)...");

        const result = await generateImages(
          {
            prompt: params.prompt,
            size: params.size,
            watermark: params.watermark,
          },
          params.download,
          params.download_dir || "./generated_images"
        );

        if (!result.success) {
          errorReporter.recordFailedStage("Image generation");
          errorReporter.addContext("apiError", result.error);

          const errorText = errorReporter.formatError(
            new Error(result.error || "Unknown generation error"),
            "seedream_generate"
          );

          return {
            content: [{ type: "text", text: errorText }],
            structuredContent: errorReporter.formatErrorJson(
              new Error(result.error || "Unknown generation error"),
              "seedream_generate"
            ),
            isError: true,
          };
        }

        errorReporter.recordStage("Image generation");
        errorReporter.addContext("imagesGenerated", result.images.length);

        // Stage 4-5: Download and Firebase sync are handled in generateImages
        await progress.nextStage("Processing images...");
        errorReporter.recordStage("Image processing");

        // Stage 6: Formatting response
        await progress.nextStage("Formatting response...");
        await progress.complete(`Generated ${result.images.length} images successfully`);

      // Format output with timing
      const output = {
        success: true,
        images: result.images,
        usage: result.usage,
        timing: result.timing,
        prompt: params.prompt,
      };

      let textContent: string;
      if (params.response_format === ResponseFormat.MARKDOWN) {
        const lines = [
          "# Image Generated Successfully",
          "",
          `**Prompt:** ${params.prompt}`,
          `**Size:** ${params.size}`,
          "",
          "## Generated Images",
          "",
        ];

        for (let i = 0; i < result.images.length; i++) {
          const img = result.images[i];
          lines.push(`### Image ${i + 1}`);
          lines.push(`- **URL:** ${img.url}`);
          if (img.localPath) {
            lines.push(`- **Local:** \`${img.localPath}\``);
          }
          lines.push(`- **Size:** ${img.size}`);
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
        // Record failure and format detailed error
        errorReporter.recordFailedStage("Unexpected error");

        const errorText = errorReporter.formatError(error, "seedream_generate");
        const errorJson = errorReporter.formatErrorJson(error, "seedream_generate");

        return {
          content: [{ type: "text", text: errorText }],
          structuredContent: errorJson,
          isError: true,
        };
      }
    }
  );
}
