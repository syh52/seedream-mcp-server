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

// MCP public user identity
const MCP_USER = {
  userId: "mcp-public",
  userName: "MCP Generator",
};

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

  const docRef = await db.collection(IMAGES_COLLECTION).add({
    ...MCP_USER,
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
