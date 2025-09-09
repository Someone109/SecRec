// src/redis.ts
import { createClient } from "redis";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);
var client = createClient({
  url: "rediss://127.0.0.1:16379",
  socket: {
    tls: true,
    ca: fs.readFileSync("/run/secrets/redisKeyStore_ca.crt"),
    key: fs.readFileSync("/run/secrets/redisKeyStore-client.key"),
    cert: fs.readFileSync("/run/secrets/redisKeyStore-client.crt"),
    rejectUnauthorized: true
  }
});
client.connect().then(() => console.log("Connected to Redis over TLS")).catch((err) => {
  console.error("Redis connection error:", err);
});
var redis_default = client;

// src/crypto.ts
var PRIVATE_KEY_PASSPHRASE = "your-secure-passphrase";
function decryptData(encryptedData, privateKeyPem) {
  const decrypted = crypto.privateDecrypt(
    {
      key: privateKeyPem,
      passphrase: PRIVATE_KEY_PASSPHRASE,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256"
    },
    encryptedData
  );
  return decrypted;
}
import crypto, { generateKeyPairSync } from "crypto";
import fs2 from "fs";
var privateKey = fs2.readFileSync(
  "/run/secrets/backendai_private.pem",
  "utf8"
);
function signData(data) {
  const signature = crypto.sign("sha256", Buffer.from(data), {
    key: privateKey,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING
  });
  return signature;
}
function GenerateKeyPair() {
  const { publicKey, privateKey: privateKey2 } = generateKeyPairSync("rsa", {
    modulusLength: 4096,
    publicKeyEncoding: {
      type: "spki",
      format: "pem"
    },
    privateKeyEncoding: {
      type: "pkcs8",
      format: "pem",
      cipher: "aes-256-cbc",
      passphrase: PRIVATE_KEY_PASSPHRASE
    }
  });
  return { publicKey, privateKey: privateKey2 };
}
function encryptData(data, publicKeyPem) {
  const bufferData = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");
  const encrypted = crypto.publicEncrypt(
    {
      key: publicKeyPem,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256"
    },
    bufferData
  );
  return encrypted;
}
function decryptWithAes(data, key, iv) {
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted;
}
function hashBuffer(data) {
  const bufferData = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");
  return crypto.createHash("sha256").update(bufferData).digest("hex");
}

// src/ocr.ts
import Tesseract from "node-tesseract-ocr";
var config = {
  lang: "eng",
  // Language: English
  oem: 1,
  // OCR Engine Mode
  psm: 3
  // Page Segmentation Mode
};
async function recognizeTextFromImage(imageBuffer) {
  try {
    const text = await Tesseract.recognize(imageBuffer, config);
    return text;
  } catch (error) {
    console.error("OCR Error:", error);
    throw new Error("Failed to recognize text from image.");
  }
}

// src/index.ts
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { fileTypeFromBuffer } from "file-type";
import { logger } from "hono/logger";
import crypto2 from "crypto";
var ENABLE_LOGGING = true;
var REDIS_TTL = 60 * 5;
var app = new Hono();
app.get("/", (c) => {
  return c.text("Hono app is running!");
});
if (ENABLE_LOGGING) {
  app.use(logger());
}
app.get("/session", async (c) => {
  try {
    const { publicKey, privateKey: privateKey2 } = GenerateKeyPair();
    await redis_default.set(`key:${publicKey}`, privateKey2, { EX: REDIS_TTL });
    const signature = signData(publicKey);
    return c.json({ publicKey, signature });
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
      signature: clientSignature
    } = body;
    if (!image || !encryptedKey || !iv || !clientPublicKey || !clientEncryptionKey) {
      return c.json({ error: "Missing required fields." }, 400);
    }
    let encryptedImageBuffer;
    let encryptedAesKeyBuffer;
    let ivBuffer;
    let privateKey2;
    let aesKey;
    let decryptedImage;
    try {
      encryptedImageBuffer = Buffer.from(image);
      encryptedAesKeyBuffer = Buffer.from(encryptedKey);
      ivBuffer = Buffer.from(iv);
    } catch {
      return c.json({ error: "Invalid encoding in one or more fields." }, 400);
    }
    privateKey2 = await redis_default.get(`key:${clientPublicKey}`);
    if (!privateKey2) {
      return c.json({ error: "Invalid or expired public key." }, 400);
    }
    try {
      aesKey = decryptData(encryptedAesKeyBuffer, privateKey2);
    } catch (e) {
      return c.json({ error: "Failed to decrypt AES key." }, 400);
    }
    try {
      decryptedImage = decryptWithAes(encryptedImageBuffer, aesKey, ivBuffer);
    } catch (e) {
      return c.json({ error: "Failed to decrypt image with AES key." }, 400);
    }
    const fileType = await fileTypeFromBuffer(decryptedImage);
    if (!fileType || !fileType.mime.startsWith("image/")) {
      return c.json({ error: "Uploaded file is not a valid image." }, 400);
    }
    try {
      const hashedImageAndKey = crypto2.createHash("sha256").update(decryptedImage + clientEncryptionKey).digest("hex");
      const decryptedSignature = decryptData(
        Buffer.from(clientSignature),
        privateKey2
      );
      if (hashedImageAndKey !== decryptedSignature.toString()) {
        return c.json({ error: "Data integrity check failed." }, 400);
      }
    } catch (e) {
      return c.json({ error: "Data integrity check failed." }, 400);
    }
    try {
      const recognizedText = await recognizeTextFromImage(decryptedImage);
      const encryptedText = encryptData(recognizedText, clientEncryptionKey);
      const signature = signData(encryptedText);
      return c.json({
        text: encryptedText,
        signature
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
    port: 3e3
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
  }
);
