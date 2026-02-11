/**
 * Firebase Admin SDK integration for MCP
 *
 * Uploads generated images to Firebase Storage and saves records to Firestore
 * using the unified `entries` collection.
 */

import { initializeApp, cert, getApps, App } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import * as fs from "fs";

// Firebase configuration
const STORAGE_BUCKET = "seedream-gallery.firebasestorage.app";
const ENTRIES_COLLECTION = "entries";

/**
 * Get MCP user identity from environment variables
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
 */
function initFirebase(): App {
  if (firebaseApp) return firebaseApp;

  if (getApps().length > 0) {
    firebaseApp = getApps()[0];
    return firebaseApp;
  }

  let credential;

  // Method 1: GOOGLE_APPLICATION_CREDENTIALS
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    firebaseApp = initializeApp({ storageBucket: STORAGE_BUCKET });
    return firebaseApp;
  }

  // Method 2: FIREBASE_SERVICE_ACCOUNT (JSON string)
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      credential = cert(serviceAccount);
    } catch (e) {
      throw new Error(`Failed to parse FIREBASE_SERVICE_ACCOUNT: ${e}`);
    }
  }

  // Method 3: FIREBASE_SERVICE_ACCOUNT_PATH
  if (!credential && process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    const saPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    if (!fs.existsSync(saPath)) {
      throw new Error(`Service account file not found: ${saPath}`);
    }
    const serviceAccount = JSON.parse(fs.readFileSync(saPath, "utf-8"));
    credential = cert(serviceAccount);
  }

  if (!credential) {
    throw new Error(
      "Firebase credentials not configured. Set one of:\n" +
      "  - GOOGLE_APPLICATION_CREDENTIALS\n" +
      "  - FIREBASE_SERVICE_ACCOUNT\n" +
      "  - FIREBASE_SERVICE_ACCOUNT_PATH"
    );
  }

  firebaseApp = initializeApp({ credential, storageBucket: STORAGE_BUCKET });
  return firebaseApp;
}

/**
 * Upload image buffer to Firebase Storage
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

  await file.makePublic();
  return `https://storage.googleapis.com/${STORAGE_BUCKET}/${destination}`;
}

/**
 * Create an entry from sync (for generate/edit/blend tools that process locally)
 * Creates a 'done' entry directly with completed images.
 */
export async function createEntryFromSync(data: {
  prompt: string;
  imageUrl: string;
  originalUrl: string;
  size: string;
  mode?: string;
}): Promise<string> {
  const app = initFirebase();
  const db = getFirestore(app);
  const mcpUser = getMcpUser();

  // Parse dimensions from size
  const [w, h] = (data.size || "0x0").split("x").map(Number);

  const entryId = `mcp_sync_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  await db.collection(ENTRIES_COLLECTION).doc(entryId).set({
    id: entryId,
    userId: mcpUser.userId,
    userName: mcpUser.userName,
    status: "done",
    prompt: data.prompt,
    mode: data.mode || "text",
    size: data.size,
    images: [{
      id: "img-0",
      url: data.imageUrl,
      originalUrl: data.originalUrl,
      width: w || 0,
      height: h || 0,
      status: "done",
    }],
    createdAt: Date.now(),
    completedAt: Date.now(),
    liked: false,
    deleted: false,
    source: "mcp",
  });

  console.error(`[firebase] Created sync entry: ${entryId}`);
  return entryId;
}

/**
 * Upload image and create entry in one operation
 * Downloads from URL, uploads to Storage, saves to entries collection
 */
export async function syncImageToFirebase(
  imageUrl: string,
  localPath: string,
  prompt: string,
  size: string,
  mode: string = "text"
): Promise<{ storageUrl: string; docId: string } | null> {
  try {
    const imageBuffer = await fs.promises.readFile(localPath);

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `seedream_${timestamp}_${Math.random().toString(36).slice(2, 8)}.jpg`;

    const storageUrl = await uploadImageToStorage(imageBuffer, filename);
    console.error(`[firebase] Uploaded to Storage: ${storageUrl}`);

    const docId = await createEntryFromSync({
      prompt,
      imageUrl: storageUrl,
      originalUrl: imageUrl,
      size,
      mode,
    });
    console.error(`[firebase] Created entry: ${docId}`);

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

// ==================== Entry Queue Functions ====================

export type GenerateMode = "text" | "image" | "multi";

/**
 * Create an entry for Cloud Function processing (for submit tool)
 * Creates an 'active' entry that Cloud Function will pick up.
 */
export async function createEntryForProcessing(
  entryId: string,
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

  // Build pending images array
  const images = [];
  for (let i = 0; i < data.expectedCount; i++) {
    images.push({
      id: `img-${i}`,
      url: "",
      width: 0,
      height: 0,
      status: "pending",
    });
  }

  const entryData: Record<string, unknown> = {
    id: entryId,
    userId: mcpUser.userId,
    userName: mcpUser.userName,
    status: "active",
    prompt: data.prompt,
    mode: data.mode,
    size: data.size,
    images,
    createdAt: Date.now(),
    liked: false,
    deleted: false,
    source: "mcp",
    _cf: {
      retryCount: 0,
      maxRetries: 2,
    },
  };

  // Only include optional fields if defined
  if (data.strength !== undefined) {
    entryData.strength = data.strength;
  }
  if (data.referenceImageUrls && data.referenceImageUrls.length > 0) {
    entryData.referenceImageUrls = data.referenceImageUrls;
  }

  await db.collection(ENTRIES_COLLECTION).doc(entryId).set(entryData);
  console.error(`[firebase] Created entry for processing: ${entryId}`);
}

/**
 * Get an entry by ID
 */
export async function getEntry(entryId: string): Promise<Record<string, unknown> | null> {
  const app = initFirebase();
  const db = getFirestore(app);

  const doc = await db.collection(ENTRIES_COLLECTION).doc(entryId).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

/**
 * Get user ID for entry ownership verification
 */
export function getFirebaseUserId(): string {
  return process.env.FIREBASE_USER_ID || "mcp-public";
}
