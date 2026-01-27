/**
 * Progress notification utilities for MCP tools
 *
 * Provides helpers for:
 * - Sending progress updates during long-running operations
 * - Formatting detailed error messages
 * - Tracking operation stages
 */

// Progress token type from MCP protocol
export type ProgressToken = string | number;

// Extra context passed to tool handlers (simplified interface compatible with SDK)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ToolExtra {
  _meta?: {
    progressToken?: ProgressToken;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sendNotification?: (notification: any) => Promise<void>;
  signal?: AbortSignal;
}

/**
 * Progress reporter for long-running tool operations
 */
export class ProgressReporter {
  private progressToken?: ProgressToken;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private sendNotification?: (notification: any) => Promise<void>;
  private stages: string[] = [];
  private currentStage = 0;
  private startTime = Date.now();
  private lastNotifyTime = 0;
  private minNotifyInterval = 1000; // Minimum 1 second between notifications

  constructor(extra?: ToolExtra) {
    this.progressToken = extra?._meta?.progressToken;
    this.sendNotification = extra?.sendNotification;
  }

  /**
   * Check if progress reporting is available
   */
  get isEnabled(): boolean {
    return !!(this.progressToken && this.sendNotification);
  }

  /**
   * Set the stages for the operation
   */
  setStages(stages: string[]): void {
    this.stages = stages;
    this.currentStage = 0;
  }

  /**
   * Report progress to the client
   */
  async report(progress: number, total: number, message?: string): Promise<void> {
    if (!this.isEnabled) return;

    // Throttle notifications to avoid flooding
    const now = Date.now();
    if (now - this.lastNotifyTime < this.minNotifyInterval) {
      return;
    }
    this.lastNotifyTime = now;

    try {
      await this.sendNotification!({
        method: "notifications/progress",
        params: {
          progressToken: this.progressToken!,
          progress,
          total,
          message,
        },
      });
    } catch (error) {
      // Silently ignore notification failures
      console.error("[progress] Failed to send notification:", error);
    }
  }

  /**
   * Report moving to the next stage
   */
  async nextStage(message?: string): Promise<void> {
    if (this.stages.length > 0) {
      const stageName = this.stages[this.currentStage] || "Processing";
      const msg = message || stageName;
      await this.report(this.currentStage, this.stages.length, msg);
      this.currentStage++;
    }
  }

  /**
   * Report completion
   */
  async complete(message?: string): Promise<void> {
    const elapsed = Date.now() - this.startTime;
    const msg = message || `Completed in ${(elapsed / 1000).toFixed(1)}s`;
    await this.report(this.stages.length || 100, this.stages.length || 100, msg);
  }

  /**
   * Get elapsed time in milliseconds
   */
  getElapsedTime(): number {
    return Date.now() - this.startTime;
  }
}

/**
 * Error detail collector for comprehensive error reporting
 */
export class ErrorReporter {
  private context: Record<string, unknown> = {};
  private stages: string[] = [];

  /**
   * Add context information
   */
  addContext(key: string, value: unknown): void {
    this.context[key] = value;
  }

  /**
   * Record a completed stage
   */
  recordStage(stage: string): void {
    this.stages.push(`✓ ${stage}`);
  }

  /**
   * Record a failed stage
   */
  recordFailedStage(stage: string): void {
    this.stages.push(`✗ ${stage}`);
  }

  /**
   * Format a detailed error message
   */
  formatError(error: unknown, operation: string): string {
    const lines: string[] = [
      `## Error in ${operation}`,
      "",
    ];

    // Error message
    if (error instanceof Error) {
      lines.push(`**Error:** ${error.message}`);
      lines.push("");

      // Error type
      lines.push(`**Type:** ${error.name}`);

      // Check for specific error types
      if ("code" in error) {
        lines.push(`**Code:** ${(error as { code: string }).code}`);
      }
      if ("status" in error) {
        lines.push(`**HTTP Status:** ${(error as { status: number }).status}`);
      }
      if ("response" in error) {
        const response = (error as { response?: { data?: unknown } }).response;
        if (response?.data) {
          lines.push(`**API Response:** ${JSON.stringify(response.data, null, 2)}`);
        }
      }
    } else {
      lines.push(`**Error:** ${String(error)}`);
    }

    // Completed stages
    if (this.stages.length > 0) {
      lines.push("");
      lines.push("### Progress");
      lines.push(...this.stages);
    }

    // Context information
    if (Object.keys(this.context).length > 0) {
      lines.push("");
      lines.push("### Context");
      for (const [key, value] of Object.entries(this.context)) {
        const valueStr = typeof value === "object"
          ? JSON.stringify(value, null, 2)
          : String(value);
        lines.push(`- **${key}:** ${valueStr}`);
      }
    }

    // Stack trace
    if (error instanceof Error && error.stack) {
      lines.push("");
      lines.push("### Stack Trace");
      lines.push("```");
      lines.push(error.stack);
      lines.push("```");
    }

    return lines.join("\n");
  }

  /**
   * Format error for JSON output
   */
  formatErrorJson(error: unknown, operation: string): Record<string, unknown> {
    const result: Record<string, unknown> = {
      success: false,
      operation,
      error: error instanceof Error ? error.message : String(error),
      errorType: error instanceof Error ? error.name : "Unknown",
      stages: this.stages,
      context: this.context,
    };

    if (error instanceof Error) {
      if ("code" in error) result.errorCode = (error as { code: string }).code;
      if ("status" in error) result.httpStatus = (error as { status: number }).status;
      if ("response" in error) {
        const response = (error as { response?: { data?: unknown } }).response;
        if (response?.data) result.apiResponse = response.data;
      }
      result.stack = error.stack;
    }

    return result;
  }
}

/**
 * Format milliseconds to human-readable string
 */
export function formatTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}
