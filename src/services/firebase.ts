/**
 * Firebase Admin SDK integration for MCP
 *
 * Uploads generated images to Firebase Storage and saves records to Firestore,
 * making them visible in the Web App's shared gallery.
 */

import { initializeApp, cert, getApps, App } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import * as fs from "fs";
import * as path from "path";

// Firebase configuration
const STORAGE_BUCKET = "seedream-gallery.firebasestorage.app";
const IMAGES_COLLECTION = "images";

/**
 * Get MCP user identity from environment variables
 * If not configured, falls back to "mcp-public" user
 *
 * To sync images to your personal gallery, set these env vars:
 *   FIREBASE_USER_ID=<your-firebase-uid>
 *   FIREBASE_USER_NAME=<your-display-name>
 */
function getMcpUser(): { userId: string; userName: string } {
  return {
    userId: process.env.FIREBASE_USER_ID || "mcp-public",
    userName: process.env.FIREBASE_USER_NAME || "MCP Generator",
  };
}

let firebaseApp: App | null = null;

/**
 * Initialize Firebase Admin SDK
 * Supports multiple authentication methods:
 * 1. GOOGLE_APPLICATION_CREDENTIALS env var (path to service account JSON)
 * 2. FIREBASE_SERVICE_ACCOUNT env var (JSON string)
 * 3. FIREBASE_SERVICE_ACCOUNT_PATH env var (path to JSON file)
 */
function initFirebase(): App {
  if (firebaseApp) return firebaseApp;

  // Check if already initialized
  if (getApps().length > 0) {
    firebaseApp = getApps()[0];
    return firebaseApp;
  }

  let credential;

  // Method 1: GOOGLE_APPLICATION_CREDENTIALS (standard GCP approach)
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    // Firebase Admin SDK will automatically use this
    firebaseApp = initializeApp({
      storageBucket: STORAGE_BUCKET,
    });
    console.error("[firebase] Initialized with GOOGLE_APPLICATION_CREDENTIALS");
    return firebaseApp;
  }

  // Method 2: FIREBASE_SERVICE_ACCOUNT (JSON string)
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      credential = cert(serviceAccount);
      console.error("[firebase] Initialized with FIREBASE_SERVICE_ACCOUNT env var");
    } catch (e) {
      throw new Error(`Failed to parse FIREBASE_SERVICE_ACCOUNT: ${e}`);
    }
  }

  // Method 3: FIREBASE_SERVICE_ACCOUNT_PATH (path to JSON file)
  if (!credential && process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    const saPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    if (!fs.existsSync(saPath)) {
      throw new Error(`Service account file not found: ${saPath}`);
    }
    const serviceAccount = JSON.parse(fs.readFileSync(saPath, "utf-8"));
    credential = cert(serviceAccount);
    console.error("[firebase] Initialized with FIREBASE_SERVICE_ACCOUNT_PATH");
  }

  if (!credential) {
    throw new Error(
      "Firebase credentials not configured. Set one of:\n" +
      "  - GOOGLE_APPLICATION_CREDENTIALS (path to service account JSON)\n" +
      "  - FIREBASE_SERVICE_ACCOUNT (JSON string)\n" +
      "  - FIREBASE_SERVICE_ACCOUNT_PATH (path to JSON file)"
    );
  }

  firebaseApp = initializeApp({
    credential,
    storageBucket: STORAGE_BUCKET,
  });

  return firebaseApp;
}

/**
 * Upload image buffer to Firebase Storage
 * Returns the public download URL
 */
export async function uploadImageToStorage(
  imageBuffer: Buffer,
  filename: string
): Promise<string> {
  const app = initFirebase();
  const bucket = getStorage(app).bucket();

  const destination = `mcp-images/${filename}`;
  const file = bucket.file(destination);

  await file.save(imageBuffer, {
    metadata: {
      contentType: "image/jpeg",
      metadata: {
        source: "mcp",
        uploadedAt: new Date().toISOString(),
      },
    },
  });

  // Make file publicly accessible
  await file.makePublic();

  // Return public URL
  const publicUrl = `https://storage.googleapis.com/${STORAGE_BUCKET}/${destination}`;
  return publicUrl;
}

/**
 * Save image record to Firestore
 */
export async function saveImageToFirestore(data: {
  prompt: string;
  imageUrl: string;
  originalUrl: string;
  size: string;
  mode?: string;
}): Promise<string> {
  const app = initFirebase();
  const db = getFirestore(app);
  const mcpUser = getMcpUser();

  const docRef = await db.collection(IMAGES_COLLECTION).add({
    ...mcpUser,
    prompt: data.prompt,
    imageUrl: data.imageUrl,
    originalUrl: data.originalUrl,
    size: data.size,
    mode: data.mode || "text",
    source: "mcp",
    liked: false,
    deleted: false,
    createdAt: FieldValue.serverTimestamp(),
  });

  console.error(`[firebase] Saved for user: ${mcpUser.userId}`);
  return docRef.id;
}

/**
 * Upload image and save record in one operation
 * Downloads from URL, uploads to Storage, saves to Firestore
 */
export async function syncImageToFirebase(
  imageUrl: string,
  localPath: string,
  prompt: string,
  size: string,
  mode: string = "text"
): Promise<{ storageUrl: string; docId: string } | null> {
  try {
    // Read the downloaded image
    const imageBuffer = await fs.promises.readFile(localPath);

    // Generate unique filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `seedream_${timestamp}_${Math.random().toString(36).slice(2, 8)}.jpg`;

    // Upload to Firebase Storage
    const storageUrl = await uploadImageToStorage(imageBuffer, filename);
    console.error(`[firebase] Uploaded to Storage: ${storageUrl}`);

    // Save to Firestore
    const docId = await saveImageToFirestore({
      prompt,
      imageUrl: storageUrl,
      originalUrl: imageUrl,
      size,
      mode,
    });
    console.error(`[firebase] Saved to Firestore: ${docId}`);

    return { storageUrl, docId };
  } catch (error) {
    console.error("[firebase] Failed to sync image:", error);
    return null;
  }
}

/**
 * Check if Firebase is configured
 */
export function isFirebaseConfigured(): boolean {
  return !!(
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    process.env.FIREBASE_SERVICE_ACCOUNT ||
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH
  );
}

// ==================== Task Queue Functions ====================

const TASKS_COLLECTION = "tasks";

export type TaskStatus = "pending" | "generating" | "processing" | "completed" | "failed" | "cancelled";
export type GenerateMode = "text" | "image" | "multi";

export interface TaskImage {
  id: string;
  url: string;
  storageUrl?: string;
  size: string;
  status: "pending" | "ready" | "error";
  error?: string;
  processedAt?: number;
}

export interface TaskRecord {
  id: string;
  userId: string;
  userName: string;
  status: TaskStatus;
  prompt: string;
  mode: GenerateMode;
  size: string;
  strength?: number;
  expectedCount: number;
  images: TaskImage[];
  createdAt: number;
  completedAt?: number;
  error?: string;
  usage?: { generated_images: number; total_tokens: number };
  source: "mcp";
  retryCount: number;
  maxRetries: number;
}

/**
 * Create a new task in Firestore
 * Returns the task ID for tracking
 */
export async function createTask(data: {
  prompt: string;
  mode: GenerateMode;
  size: string;
  strength?: number;
  expectedCount: number;
}): Promise<string> {
  const app = initFirebase();
  const db = getFirestore(app);
  const mcpUser = getMcpUser();

  const taskData: Record<string, unknown> = {
    userId: mcpUser.userId,
    userName: mcpUser.userName,
    status: "pending",
    prompt: data.prompt,
    mode: data.mode,
    size: data.size,
    expectedCount: data.expectedCount,
    images: [],
    createdAt: Date.now(),
    source: "mcp",
    retryCount: 0,
    maxRetries: 2,
  };

  // Only include strength if defined (Firestore doesn't allow undefined values)
  if (data.strength !== undefined) {
    taskData.strength = data.strength;
  }

  const docRef = await db.collection(TASKS_COLLECTION).add(taskData);
  console.error(`[firebase] Created task: ${docRef.id}`);
  return docRef.id;
}

/**
 * Create a task with a specific ID (for optimistic task creation)
 * Used when we need to return the task ID immediately before Firebase confirms
 */
export async function createTaskWithId(
  taskId: string,
  data: {
    prompt: string;
    mode: GenerateMode;
    size: string;
    strength?: number;
    expectedCount: number;
    referenceImageUrls?: string[];
  }
): Promise<void> {
  const app = initFirebase();
  const db = getFirestore(app);
  const mcpUser = getMcpUser();

  const taskData: Record<string, unknown> = {
    userId: mcpUser.userId,
    userName: mcpUser.userName,
    status: "pending",
    prompt: data.prompt,
    mode: data.mode,
    size: data.size,
    expectedCount: data.expectedCount,
    images: [],
    createdAt: Date.now(),
    source: "mcp",
    retryCount: 0,
    maxRetries: 2,
  };

  // Only include optional fields if defined (Firestore doesn't allow undefined values)
  if (data.strength !== undefined) {
    taskData.strength = data.strength;
  }
  if (data.referenceImageUrls && data.referenceImageUrls.length > 0) {
    taskData.referenceImageUrls = data.referenceImageUrls;
  }

  await db.collection(TASKS_COLLECTION).doc(taskId).set(taskData);
  console.error(`[firebase] Created task with ID: ${taskId}`);
}

/**
 * Get a task by ID
 */
export async function getTask(taskId: string): Promise<TaskRecord | null> {
  const app = initFirebase();
  const db = getFirestore(app);

  const doc = await db.collection(TASKS_COLLECTION).doc(taskId).get();
  if (!doc.exists) {
    return null;
  }

  return { id: doc.id, ...doc.data() } as TaskRecord;
}

/**
 * Update task status
 */
export async function updateTaskStatus(
  taskId: string,
  status: TaskStatus,
  updates?: Partial<TaskRecord>
): Promise<void> {
  const app = initFirebase();
  const db = getFirestore(app);

  const data: Record<string, unknown> = { status, ...updates };
  if (status === "completed" || status === "failed") {
    data.completedAt = Date.now();
  }

  await db.collection(TASKS_COLLECTION).doc(taskId).update(data);
  console.error(`[firebase] Updated task ${taskId} to ${status}`);
}

/**
 * Add an image to a task
 */
export async function addTaskImage(
  taskId: string,
  image: TaskImage
): Promise<void> {
  const app = initFirebase();
  const db = getFirestore(app);

  await db.collection(TASKS_COLLECTION).doc(taskId).update({
    images: FieldValue.arrayUnion(image),
  });
  console.error(`[firebase] Added image to task ${taskId}: ${image.id}`);
}

/**
 * Get user ID for task ownership verification
 */
export function getFirebaseUserId(): string {
  return process.env.FIREBASE_USER_ID || "mcp-public";
}
