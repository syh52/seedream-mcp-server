/**
 * Zod schemas for SeeDream MCP server input validation
 * Includes both input schemas and output schemas for structured responses
 */

import { z } from "zod";

// Supported image sizes for Seedream 4.5
// Reference: https://docs.byteplus.com/en/docs/ModelArk/1541523
// Note: "1K" is only supported by Seedream 4.0, not 4.5
export const ImageSize = z.enum([
  "2K",      // Recommended (default)
  "4K",      // High resolution (50-100% slower)
  "1:1",     // 2048x2048 - Square
  "4:3",     // 2304x1728 - Landscape
  "3:4",     // 1728x2304 - Portrait
  "16:9",    // 2560x1440 - Widescreen
  "9:16",    // 1440x2560 - Vertical/Mobile
  "3:2",     // 2496x1664 - Classic photo
  "2:3",     // 1664x2496 - Portrait photo
  "21:9",    // 3024x1296 - Ultra-wide
]).default("2K");

// Response format
export enum ResponseFormat {
  MARKDOWN = "markdown",
  JSON = "json"
}

// Base schema for common fields
// Note: download defaults to true to enable Firebase sync (images are uploaded to Firebase Storage)
const BaseInputSchema = z.object({
  response_format: z.nativeEnum(ResponseFormat)
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format: 'markdown' for human-readable or 'json' for structured data"),
  download: z.boolean()
    .default(true)
    .describe("Whether to download generated images to local directory"),
  download_dir: z.string()
    .optional()
    .describe("Local directory to save images (defaults to ./generated_images)"),
});

// ==================== Output Schemas ====================

// Generated image output schema
const GeneratedImageSchema = z.object({
  url: z.string().describe("URL of the generated image (valid for 24 hours)"),
  size: z.string().describe("Image dimensions or size preset"),
  localPath: z.string().optional().describe("Local file path if downloaded"),
  downloadTime: z.number().optional().describe("Download time in milliseconds"),
});

// Timing metrics schema
const TimingSchema = z.object({
  generation_ms: z.number().describe("API generation time in milliseconds"),
  download_ms: z.number().describe("Total download time in milliseconds"),
  total_ms: z.number().describe("Total operation time in milliseconds"),
});

// Usage metrics schema
const UsageSchema = z.object({
  generated_images: z.number().describe("Number of images generated"),
  total_tokens: z.number().describe("Total tokens consumed"),
});

// Base output schema for all generation tools
export const GenerateOutputSchema = z.object({
  success: z.boolean().describe("Whether the generation was successful"),
  images: z.array(GeneratedImageSchema).describe("Array of generated images"),
  usage: UsageSchema.optional().describe("API usage metrics"),
  timing: TimingSchema.optional().describe("Performance timing metrics"),
  prompt: z.string().describe("The prompt used for generation"),
});

export const EditOutputSchema = GenerateOutputSchema.extend({
  source_image: z.string().describe("The source image that was edited"),
  strength: z.number().describe("The strength value used for editing"),
});

export const BlendOutputSchema = GenerateOutputSchema.extend({
  source_images: z.array(z.string()).describe("Array of source images used"),
  image_count: z.number().describe("Number of images blended"),
  strength: z.number().describe("The strength value used for blending"),
});

export const VariationsOutputSchema = GenerateOutputSchema.extend({
  requested_count: z.number().describe("Number of variations requested"),
  generated_count: z.number().describe("Number of variations actually generated"),
  base_image: z.string().optional().describe("Base image used for variations"),
});

export type GenerateOutput = z.infer<typeof GenerateOutputSchema>;
export type EditOutput = z.infer<typeof EditOutputSchema>;
export type BlendOutput = z.infer<typeof BlendOutputSchema>;
export type VariationsOutput = z.infer<typeof VariationsOutputSchema>;

// Text-to-Image generation
export const GenerateInputSchema = BaseInputSchema.extend({
  prompt: z.string()
    .min(1, "Prompt is required")
    .max(2000, "Prompt must not exceed 2000 characters")
    .describe("Text description of the image to generate. Be specific about subject, style, lighting, composition."),
  size: ImageSize
    .describe("Output image size: '2K' (recommended), '4K' (high-res), or aspect ratios like '16:9', '9:16', '1:1'"),
  watermark: z.boolean()
    .default(false)
    .describe("Whether to add 'AI generated' watermark"),
}).strict();

export type GenerateInput = z.infer<typeof GenerateInputSchema>;

// Image-to-Image editing
export const EditInputSchema = BaseInputSchema.extend({
  prompt: z.string()
    .min(1, "Edit instruction is required")
    .max(2000, "Prompt must not exceed 2000 characters")
    .describe("Edit instruction describing what to change. Examples: 'Add sunglasses', 'Change background to beach', 'Make it look like oil painting'"),
  image: z.string()
    .min(1, "Image URL or path is required")
    .describe("Source image URL or local file path to edit"),
  size: ImageSize
    .describe("Output image size"),
  strength: z.number()
    .min(0)
    .max(1)
    .default(0.7)
    .describe("How much to preserve the original image (0=ignore original, 1=strongly preserve). Lower values allow more creative changes."),
  watermark: z.boolean()
    .default(false)
    .describe("Whether to add 'AI generated' watermark"),
}).strict();

export type EditInput = z.infer<typeof EditInputSchema>;

// Multi-image blending
export const BlendInputSchema = BaseInputSchema.extend({
  prompt: z.string()
    .min(1, "Blend instruction is required")
    .max(2000, "Prompt must not exceed 2000 characters")
    .describe("Instruction for combining images. Reference images by number: 'Dress the person in image 1 with outfit from image 2'"),
  images: z.array(z.string())
    .min(2, "At least 2 images required for blending")
    .max(14, "Maximum 14 images allowed")
    .describe("Array of image URLs or local file paths to blend"),
  size: ImageSize
    .describe("Output image size"),
  strength: z.number()
    .min(0)
    .max(1)
    .default(0.7)
    .describe("Reference strength (0-1). Higher values preserve more from reference images."),
  watermark: z.boolean()
    .default(false)
    .describe("Whether to add 'AI generated' watermark"),
}).strict();

export type BlendInput = z.infer<typeof BlendInputSchema>;

// Batch variation generation
export const VariationsInputSchema = BaseInputSchema.extend({
  prompt: z.string()
    .min(1, "Prompt is required")
    .max(2000, "Prompt must not exceed 2000 characters")
    .describe("Base prompt for generating variations. The model will create coherent variations based on this."),
  count: z.number()
    .int()
    .min(2, "Minimum 2 variations")
    .max(15, "Maximum 15 variations")
    .default(4)
    .describe("Number of variations to generate (2-15)"),
  base_image: z.string()
    .optional()
    .describe("Optional base image to create variations from"),
  size: ImageSize
    .describe("Output image size"),
  watermark: z.boolean()
    .default(false)
    .describe("Whether to add 'AI generated' watermark"),
}).strict();

export type VariationsInput = z.infer<typeof VariationsInputSchema>;

// ==================== Async Task Schemas ====================

// Submit task input (for Claude.ai compatibility - avoids timeout)
export const SubmitInputSchema = z.object({
  prompt: z.string()
    .min(1, "Prompt is required")
    .max(2000, "Prompt must not exceed 2000 characters")
    .describe("Text description of the image to generate"),
  mode: z.enum(["text", "image", "multi"])
    .default("text")
    .describe("Generation mode: 'text' for text-to-image, 'image' for editing (requires images), 'multi' for blending (requires 2+ images)"),
  size: ImageSize
    .describe("Output image size"),
  count: z.number()
    .int()
    .min(1)
    .max(15)
    .default(4)
    .describe("Number of images to generate (1-15)"),
  strength: z.number()
    .min(0)
    .max(1)
    .optional()
    .describe("Reference strength for image/multi modes (0-1, default 0.7)"),
  images: z.array(z.string())
    .optional()
    .describe("Reference image URLs for 'image' mode (1 image) or 'multi' mode (2-14 images). Required when mode is not 'text'."),
}).strict();

export type SubmitInput = z.infer<typeof SubmitInputSchema>;

// Submit task output
export const SubmitOutputSchema = z.object({
  success: z.boolean().describe("Whether the task was submitted successfully"),
  task_id: z.string().describe("Task ID for internal tracking"),
  status: z.enum(["submitted", "error"]).describe("Task status: 'submitted' on success, 'error' on failure"),
  message: z.string().describe("Confirmation message or error description"),
});

export type SubmitOutput = z.infer<typeof SubmitOutputSchema>;
