import { serve } from "@hono/node-server";
import { Hono } from "hono";
import client from "./redis.ts";
import {
  GenerateKeyPair,
  signData,
  decryptData,
  encryptData,
  decryptWithAes,
  hashBuffer,
} from "./crypto.ts";
import { recognizeTextFromImage } from "./ocr.ts";
import { fileTypeFromBuffer } from "file-type";
import { logger } from "hono/logger";

import crypto from "crypto";

const ENABLE_LOGGING = true;

const REDIS_TTL = 60 * 5; // 5 minutes

const app = new Hono();

app.get("/", (c) => {
  return c.text("Hono app is running!");
});

if (ENABLE_LOGGING) {
  app.use(logger());
}

app.get("/session", async (c) => {
  try {
    const { publicKey, privateKey } = GenerateKeyPair();
    await client.set(`key:${publicKey}`, privateKey, { EX: REDIS_TTL }); // Store private key with expiration
    const signature = signData(publicKey);

    return c.json({ publicKey: publicKey, signature: signature });
  } catch (err) {
    console.error("Session error:", err);
  }
});

app.post("/imageup", async (c) => {
  try {
    const body = await c.req.json();
    const {
      image,
      encryptedKey,
      iv,
      publicKey: clientPublicKey,
      encryptionKey: clientEncryptionKey,
      signature: clientSignature,
    } = body;

    if (
      !image ||
      !encryptedKey ||
      !iv ||
      !clientPublicKey ||
      !clientEncryptionKey
    ) {
      return c.json({ error: "Missing required fields." }, 400);
    }
    // Declare variables once
    let encryptedImageBuffer: Buffer;
    let encryptedAesKeyBuffer: Buffer;
    let ivBuffer: Buffer;
    let privateKey: string | null;
    let aesKey: Buffer;
    let decryptedImage: Buffer;

    // Decode base64 fields
    try {
      encryptedImageBuffer = Buffer.from(image);
      encryptedAesKeyBuffer = Buffer.from(encryptedKey);
      ivBuffer = Buffer.from(iv);
    } catch {
      return c.json({ error: "Invalid encoding in one or more fields." }, 400);
    }

    // Retrieve private key for decrypting AES key
    privateKey = await client.get(`key:${clientPublicKey}`);
    if (!privateKey) {
      return c.json({ error: "Invalid or expired public key." }, 400);
    }

    // Decrypt AES key with RSA private key
    try {
      aesKey = decryptData(encryptedAesKeyBuffer, privateKey);
    } catch (e) {
      return c.json({ error: "Failed to decrypt AES key." }, 400);
    }

    // Decrypt image with AES key
    try {
      decryptedImage = decryptWithAes(encryptedImageBuffer, aesKey, ivBuffer);
    } catch (e) {
      return c.json({ error: "Failed to decrypt image with AES key." }, 400);
    }

    // Validate image type using file-type
    const fileType = await fileTypeFromBuffer(decryptedImage);
    if (!fileType || !fileType.mime.startsWith("image/")) {
      return c.json({ error: "Uploaded file is not a valid image." }, 400);
    }

  

    try {
      const hashedImageAndKey = crypto
        .createHash("sha256")
        .update(decryptedImage + clientEncryptionKey)
        .digest("hex");


      const decryptedSignature = decryptData(
        Buffer.from(clientSignature),
        privateKey
      );

      if (hashedImageAndKey !== decryptedSignature.toString()) {
        return c.json({ error: "Data integrity check failed." }, 400);
      }
    } catch (e) {
      return c.json({ error: "Data integrity check failed." }, 400);
    }

    // OCR and response
    try {
      const recognizedText = await recognizeTextFromImage(decryptedImage);
      // Encrypt recognizedText with clientKey
      const encryptedText = encryptData(recognizedText, clientEncryptionKey);
      const signature = signData(encryptedText);
      return c.json({
        text: encryptedText,
        signature: signature,
      });
    } catch (e) {
      return c.json({ error: "Failed to process image." }, 400);
    }
  } catch (err) {
    console.error("Image upload error:", err);
    return c.json({ error: "Failed to upload image." }, 500);
  }
});

serve(
  {
    fetch: app.fetch,
    port: 3000,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
  }
);
