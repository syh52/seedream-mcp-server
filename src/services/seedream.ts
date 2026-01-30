/**
 * SeeDream API client for image generation
 *
 * Optimized for performance:
 * - **Streaming API**: Images returned as they're generated (not waiting for all)
 * - Parallel image downloads
 * - Base64 encoding cache
 * - Configurable timeouts
 * - Retry mechanism for transient failures
 */

import axios, { AxiosError } from "axios";
import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import * as http from "http";
import { syncImageToFirebase, isFirebaseConfigured } from "./firebase.js";

// SeeDream API configuration
const API_ENDPOINT = "https://ark.ap-southeast.bytepluses.com/api/v3/images/generations";
const MODEL_ID = "seedream-4-5-251128"; // Latest Seedream 4.5 model

// Performance configuration
// Note: Keep concurrency low to avoid OOM on Railway (512MB memory limit)
const CONFIG = {
  API_TIMEOUT: 180000,           // 3 minutes for streaming generation
  DOWNLOAD_TIMEOUT: 30000,       // 30 seconds per image download
  MAX_PARALLEL_DOWNLOADS: 4,     // Concurrent download limit
  MAX_PARALLEL_API_CALLS: 2,     // Concurrent API calls (low to avoid OOM)
  RETRY_ATTEMPTS: 2,             // Retry failed downloads
  RETRY_DELAY: 1000,             // 1 second between retries
  DEFAULT_BATCH_COUNT: 4,        // Default images per prompt
} as const;

// Progress callback for streaming updates
export type ProgressCallback = (event: {
  type: 'image' | 'error' | 'completed' | 'progress';
  index?: number;
  url?: string;
  message?: string;
  generated?: number;
  total?: number;
}) => void;

// Map user-friendly size names to API format
// Reference: https://docs.byteplus.com/en/docs/ModelArk/1541523
// Note: "1K" is only supported by Seedream 4.0, not 4.5
const SIZE_MAP: Record<string, string> = {
  // Preset resolutions (recommended)
  "2K": "2K",      // Recommended default
  "4K": "4K",      // High resolution (50-100% slower)
  // Aspect ratios with optimal pixel dimensions
  "1:1": "2048x2048",
  "4:3": "2304x1728",
  "3:4": "1728x2304",
  "16:9": "2560x1440",
  "9:16": "1440x2560",
  "3:2": "2496x1664",
  "2:3": "1664x2496",
  "21:9": "3024x1296",  // Ultra-wide
};

// Simple LRU cache for base64 encoded images
const base64Cache = new Map<string, { data: string; timestamp: number }>();
const CACHE_MAX_SIZE = 10;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export interface GenerationOptions {
  prompt: string;
  size?: string;
  images?: string[];
  strength?: number;
  batchCount?: number;
  watermark?: boolean;
}

export interface GeneratedImage {
  url: string;
  size: string;
  localPath?: string;
  downloadTime?: number; // Time taken to download in ms
}

export interface GenerationResult {
  success: boolean;
  images: GeneratedImage[];
  error?: string;
  usage?: {
    generated_images: number;
    total_tokens: number;
  };
  timing?: {
    generation_ms: number;
    download_ms: number;
    total_ms: number;
  };
}

/**
 * Clean expired entries from cache
 */
function cleanCache(): void {
  const now = Date.now();
  for (const [key, value] of base64Cache) {
    if (now - value.timestamp > CACHE_TTL) {
      base64Cache.delete(key);
    }
  }
  // Evict oldest entries if cache is too large
  while (base64Cache.size > CACHE_MAX_SIZE) {
    const oldestKey = base64Cache.keys().next().value;
    if (oldestKey) base64Cache.delete(oldestKey);
  }
}

/**
 * Convert local file path to base64 data URL with caching
 */
async function fileToBase64(filePath: string): Promise<string> {
  const absolutePath = path.resolve(filePath);

  // Check cache first
  const cached = base64Cache.get(absolutePath);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  const buffer = await fs.promises.readFile(absolutePath);
  const ext = path.extname(filePath).toLowerCase().slice(1);
  const mimeType = ext === "jpg" ? "jpeg" : ext;
  const base64Data = `data:image/${mimeType};base64,${buffer.toString("base64")}`;

  // Store in cache
  cleanCache();
  base64Cache.set(absolutePath, { data: base64Data, timestamp: Date.now() });

  return base64Data;
}

/**
 * Process image input - convert local paths to base64 (with parallel processing)
 */
async function processImageInput(image: string): Promise<string> {
  // If it's already a URL or data URL, return as-is
  if (image.startsWith("http://") || image.startsWith("https://") || image.startsWith("data:")) {
    return image;
  }
  // Otherwise, treat as local file path
  return await fileToBase64(image);
}

/**
 * Sleep utility for retry delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Download image from URL to local directory with retry
 */
async function downloadImage(
  url: string,
  downloadDir: string,
  index: number,
  retryAttempts = CONFIG.RETRY_ATTEMPTS
): Promise<{ localPath: string; downloadTime: number }> {
  const startTime = Date.now();

  // Ensure download directory exists (cached after first call)
  await fs.promises.mkdir(downloadDir, { recursive: true });

  // Generate filename with timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `seedream_${timestamp}_${index}.jpg`;
  const localPath = path.join(downloadDir, filename);

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retryAttempts; attempt++) {
    try {
      // Download the image with timeout
      const response = await axios.get(url, {
        responseType: "arraybuffer",
        timeout: CONFIG.DOWNLOAD_TIMEOUT,
      });
      await fs.promises.writeFile(localPath, response.data);

      return {
        localPath,
        downloadTime: Date.now() - startTime,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < retryAttempts) {
        await sleep(CONFIG.RETRY_DELAY * (attempt + 1)); // Exponential backoff
      }
    }
  }

  throw lastError || new Error("Download failed after retries");
}

/**
 * Download multiple images in parallel with concurrency limit
 */
async function downloadImagesParallel(
  images: Array<{ url: string; size: string }>,
  downloadDir: string
): Promise<GeneratedImage[]> {
  const results: GeneratedImage[] = [];
  const queue = [...images.map((img, i) => ({ ...img, index: i + 1 }))];
  const inProgress: Promise<void>[] = [];

  while (queue.length > 0 || inProgress.length > 0) {
    // Fill up to max parallel downloads
    while (queue.length > 0 && inProgress.length < CONFIG.MAX_PARALLEL_DOWNLOADS) {
      const item = queue.shift()!;
      const promise = (async () => {
        try {
          const { localPath, downloadTime } = await downloadImage(
            item.url,
            downloadDir,
            item.index
          );
          results.push({
            url: item.url,
            size: item.size,
            localPath,
            downloadTime,
          });
        } catch (error) {
          // Log but don't fail - include image without local path
          console.error(`Failed to download image ${item.index}:`, error);
          results.push({
            url: item.url,
            size: item.size,
          });
        }
      })();
      inProgress.push(promise);
    }

    // Wait for at least one to complete
    if (inProgress.length > 0) {
      await Promise.race(inProgress);
      // Remove completed promises
      for (let i = inProgress.length - 1; i >= 0; i--) {
        const status = await Promise.race([
          inProgress[i].then(() => "fulfilled"),
          Promise.resolve("pending"),
        ]);
        if (status === "fulfilled") {
          inProgress.splice(i, 1);
        }
      }
    }
  }

  // Sort by index to maintain order
  return results;
}

/**
 * Parse SSE stream and yield events
 */
async function* parseSSEStream(
  response: http.IncomingMessage
): AsyncGenerator<Record<string, unknown>> {
  let buffer = "";

  for await (const chunk of response) {
    buffer += chunk.toString();

    // Parse SSE events (data: {...}\n\n format)
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6).trim();
        if (!data || data === "[DONE]") continue;

        try {
          yield JSON.parse(data);
        } catch {
          // Ignore JSON parse errors
        }
      }
    }
  }
}

/**
 * Debug logging (writes to stderr to avoid interfering with MCP stdout)
 */
function debug(message: string, data?: unknown): void {
  const timestamp = new Date().toISOString();
  if (data !== undefined) {
    console.error(`[${timestamp}] [seedream] ${message}:`, JSON.stringify(data, null, 2));
  } else {
    console.error(`[${timestamp}] [seedream] ${message}`);
  }
}

/**
 * Make streaming HTTP request to SeeDream API
 */
function makeStreamingRequest(
  payload: Record<string, unknown>,
  apiKey: string
): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const url = new URL(API_ENDPOINT);
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      timeout: CONFIG.API_TIMEOUT,
    };

    debug("Making streaming request to API", {
      endpoint: API_ENDPOINT,
      model: payload.model,
      promptLength: (payload.prompt as string)?.length,
      hasImages: !!payload.image,
      batchCount: payload.sequential_image_generation_options,
    });

    const req = https.request(options, (res) => {
      debug(`Response status: ${res.statusCode}`);

      if (res.statusCode !== 200) {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          debug("API error response", { statusCode: res.statusCode, body });
          try {
            const error = JSON.parse(body);
            reject(new Error(`API Error (${res.statusCode}): ${error.error?.message || body}`));
          } catch {
            reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 500)}`));
          }
        });
        return;
      }
      resolve(res);
    });

    req.on("error", (err) => {
      debug("Request error", { code: (err as NodeJS.ErrnoException).code, message: err.message });
      reject(new Error(`Network error: ${err.message} (code: ${(err as NodeJS.ErrnoException).code})`));
    });

    req.on("timeout", () => {
      debug("Request timeout");
      req.destroy();
      reject(new Error(`Request timed out after ${CONFIG.API_TIMEOUT / 1000}s`));
    });

    req.write(JSON.stringify(payload));
    req.end();
  });
}

/**
 * Generate a single image and immediately download it (pipeline processing)
 * Returns the complete GeneratedImage with local path
 */
async function generateAndDownloadImage(
  payload: Record<string, unknown>,
  apiKey: string,
  index: number,
  downloadDir: string,
  shouldDownload: boolean,
  onProgress?: ProgressCallback
): Promise<GeneratedImage | null> {
  try {
    const response = await makeStreamingRequest(payload, apiKey);

    for await (const event of parseSSEStream(response)) {
      if (event.type === "image_generation.partial_succeeded") {
        const url = event.url as string;
        const size = (event.size as string) || "2K";

        onProgress?.({
          type: "image",
          index,
          url,
          message: `Image ${index} generated`,
        });

        // Pipeline: immediately download after generation
        if (shouldDownload) {
          try {
            const { localPath, downloadTime } = await downloadImage(url, downloadDir, index);
            debug(`Image ${index} downloaded in ${downloadTime}ms`);
            return { url, size, localPath, downloadTime };
          } catch {
            return { url, size };
          }
        }

        return { url, size };
      } else if (event.type === "image_generation.partial_failed") {
        onProgress?.({
          type: "error",
          index,
          message: (event.error as { message?: string })?.message || "Image generation failed",
        });
        return null;
      }
    }

    return null;
  } catch (error) {
    debug(`Image ${index} generation failed`, { error: (error as Error).message });
    onProgress?.({
      type: "error",
      index,
      message: (error as Error).message,
    });
    return null;
  }
}

/**
 * Generate images using SeeDream API
 * Uses parallel API calls for batch generation (each call generates 1 image)
 */
export async function generateImages(
  options: GenerationOptions,
  download: boolean = true,
  downloadDir: string = "./generated_images",
  onProgress?: ProgressCallback,
  skipFirebaseSync: boolean = false
): Promise<GenerationResult> {
  const totalStartTime = Date.now();
  const apiKey = process.env.ARK_API_KEY;

  if (!apiKey) {
    debug("ERROR: ARK_API_KEY not set");
    return {
      success: false,
      images: [],
      error: "ARK_API_KEY environment variable is not set. Please set it before using this tool.",
    };
  }

  debug("Starting image generation", { prompt: options.prompt?.slice(0, 100), size: options.size });

  try {
    const { prompt, size = "2K", images, strength, batchCount = CONFIG.DEFAULT_BATCH_COUNT, watermark = false } = options;

    // Build API payload with streaming enabled
    const payload: Record<string, unknown> = {
      model: MODEL_ID,
      prompt,
      size: SIZE_MAP[size] || size,
      response_format: "url",
      watermark,
      stream: true,  // Enable streaming for real-time progress
    };

    // Handle image inputs (for editing/blending) - process in parallel
    // Reference: https://docs.byteplus.com/en/docs/ModelArk/1824121
    if (images && images.length > 0) {
      const processedImages = await Promise.all(images.map(processImageInput));

      if (processedImages.length === 1) {
        // Single image: Image-to-Image editing
        payload.image = processedImages[0];
      } else {
        // Multiple images: Multi-Image blending
        // Per docs: disable sequential generation for multi-image blending
        payload.image = processedImages;
        payload.sequential_image_generation = "disabled";
      }

      // Note: strength parameter is not officially documented for Seedream 4.5
      // but may work for controlling reference image influence
      if (strength !== undefined) {
        payload.strength = Math.max(0, Math.min(1, strength));
      }
    }

    // Parallel API calls for batch generation
    const generationStartTime = Date.now();
    const generatedImages: GeneratedImage[] = [];
    let usage: { generated_images: number; total_tokens: number } | undefined;

    // Determine how many API calls to make
    const numCalls = (!images || images.length === 0) ? Math.min(batchCount, 15) : 1;

    debug(`Making ${numCalls} parallel API calls`, { prompt: prompt.slice(0, 50), size });

    // Create API call tasks (each task generates + downloads one image)
    const apiTasks = Array.from({ length: numCalls }, (_, i) => ({
      index: i + 1,
      payload: { ...payload }, // Clone payload for each call
    }));

    // Pipeline processing: generate + download in parallel with concurrency limit
    // Each task completes generation then immediately downloads (no waiting for others)
    const queue = [...apiTasks];
    const inProgress: Promise<void>[] = [];

    while (queue.length > 0 || inProgress.length > 0) {
      // Fill up to max parallel API calls
      while (queue.length > 0 && inProgress.length < CONFIG.MAX_PARALLEL_API_CALLS) {
        const task = queue.shift()!;
        const promise = (async () => {
          // Pipeline: generate → download (immediate)
          const result = await generateAndDownloadImage(
            task.payload,
            apiKey,
            task.index,
            downloadDir,
            download,
            onProgress
          );
          if (result) {
            generatedImages.push(result);
          }
        })();
        inProgress.push(promise);
      }

      // Wait for at least one to complete
      if (inProgress.length > 0) {
        await Promise.race(inProgress);
        // Remove completed promises
        for (let i = inProgress.length - 1; i >= 0; i--) {
          const status = await Promise.race([
            inProgress[i].then(() => "fulfilled"),
            Promise.resolve("pending"),
          ]);
          if (status === "fulfilled") {
            inProgress.splice(i, 1);
          }
        }
      }
    }

    // Calculate usage
    usage = {
      generated_images: generatedImages.length,
      total_tokens: generatedImages.length * 4096, // Estimate
    };

    onProgress?.({
      type: "completed",
      generated: generatedImages.length,
      total: numCalls,
    });

    const generationTime = Date.now() - generationStartTime;
    debug(`Generation completed: ${generatedImages.length}/${numCalls} images in ${generationTime}ms`);

    // Sort by index (downloads may complete out of order)
    generatedImages.sort((a, b) => {
      const idxA = a.localPath ? parseInt(a.localPath.match(/_(\d+)\.jpg$/)?.[1] || "0") : 0;
      const idxB = b.localPath ? parseInt(b.localPath.match(/_(\d+)\.jpg$/)?.[1] || "0") : 0;
      return idxA - idxB;
    });

    // Sync to Firebase if configured (for Web App integration)
    // Skip if caller will handle sync separately (e.g., submit.ts)
    if (isFirebaseConfigured() && !skipFirebaseSync) {
      debug("Syncing images to Firebase...");
      const syncPromises = generatedImages
        .filter((img) => img.localPath) // Only sync images that were downloaded
        .map(async (img) => {
          const result = await syncImageToFirebase(
            img.url,
            img.localPath!,
            prompt,
            img.size,
            images && images.length > 0 ? (images.length > 1 ? "multi" : "image") : "text"
          );
          if (result) {
            debug(`Synced image to Firebase: ${result.docId}`);
          }
        });
      await Promise.all(syncPromises);
      debug("Firebase sync completed");
    } else if (skipFirebaseSync) {
      debug("Skipping Firebase sync (caller will handle)");
    }

    return {
      success: true,
      images: generatedImages,
      usage,
      timing: {
        generation_ms: generationTime,
        download_ms: 0, // Downloads included in generation time (parallel)
        total_ms: Date.now() - totalStartTime,
      },
    };
  } catch (error) {
    const errorMsg = handleApiError(error);
    debug("Generation failed", {
      error: errorMsg,
      stack: error instanceof Error ? error.stack : undefined
    });
    return {
      success: false,
      images: [],
      error: errorMsg,
    };
  }
}

/**
 * Handle API errors with helpful messages
 */
function handleApiError(error: unknown): string {
  if (error instanceof AxiosError) {
    if (error.response) {
      const status = error.response.status;
      const message = error.response.data?.error?.message || error.message;

      switch (status) {
        case 400:
          return `Invalid request: ${message}. Check your prompt and parameters.`;
        case 401:
          return "Authentication failed. Please check your ARK_API_KEY.";
        case 403:
          return "Access denied. Your API key may not have permission for this operation.";
        case 429:
          return "Rate limit exceeded. Please wait a moment before trying again.";
        case 500:
          return `Server error: ${message}. The image may have been flagged by content filters.`;
        default:
          return `API error (${status}): ${message}`;
      }
    } else if (error.code === "ECONNABORTED") {
      return "Request timed out. Image generation can take up to 2 minutes for complex prompts.";
    } else if (error.code === "ECONNREFUSED") {
      return "Could not connect to SeeDream API. Please check your network connection.";
    }
  }

  return `Unexpected error: ${error instanceof Error ? error.message : String(error)}`;
}
