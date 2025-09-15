import express from "express";
import client from "./redis.ts";
import {
  GenerateKeyPair,
  signData,
  decryptData,
  encryptData,
  decryptWithAes,
} from "./crypto.ts";
import { recognizeTextFromImage } from "./ocr.ts";
import { fileTypeFromBuffer } from "file-type";
import fs from "fs";
import https from "https";
import crypto from "crypto";
import type { TLSSocket } from "tls";

const REDIS_TTL = 60; // 1 minute

const app = express();

// Parse JSON bodies
app.use(express.json());

// mTLS validation middleware
app.use((req, res, next) => {
  const socket = req.socket as TLSSocket; // tell TS it's a TLSSocket
  const cert = socket.getPeerCertificate?.(true);
  const authorized = socket.authorized;

  console.log("mTLS validation:", {
    authorized,
    hasClientCert: cert && Object.keys(cert).length > 0,
    clientCN: cert?.subject?.CN || "none",
  });

  if (!authorized || !cert || Object.keys(cert).length === 0) {
    return res.status(401).json({ error: "Valid client certificate required" });
  }

  // Store cert info in request
  (req as any).clientCert = cert;
  (req as any).clientAuthorized = authorized;
  next();
});

// Logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

app.get("/session", async (req, res) => {
  try {
    console.log("Session endpoint hit");
    const { publicKey, privateKey } = GenerateKeyPair();
    await client.set(`key:${publicKey}`, privateKey, { EX: REDIS_TTL });
    const signature = signData(publicKey);

    res.json({ publicKey, signature });
  } catch (err) {
    console.error("Session error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/imageup", async (req, res) => {
  try {
    const body = req.body;
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
      return res.status(400).json({ error: "Missing required fields." });
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
      return res
        .status(400)
        .json({ error: "Invalid encoding in one or more fields." });
    }

    // Retrieve private key for decrypting AES key
    privateKey = await client.get(`key:${clientPublicKey}`);
    if (!privateKey) {
      return res.status(400).json({ error: "Invalid or expired public key." });
    }

    // Decrypt AES key with RSA private key
    try {
      aesKey = decryptData(encryptedAesKeyBuffer, privateKey);
    } catch (e) {
      return res.json({ error: "Failed to decrypt AES key." }).status(400);
    }

    // Decrypt image with AES key
    try {
      decryptedImage = decryptWithAes(encryptedImageBuffer, aesKey, ivBuffer);
    } catch (e) {
      return res
        .json({ error: "Failed to decrypt image with AES key." })
        .status(400);
    }

    // Validate image type using file-type
    const fileType = await fileTypeFromBuffer(decryptedImage);
    if (!fileType || !fileType.mime.startsWith("image/")) {
      return res
        .json({ error: "Uploaded file is not a valid image." })
        .status(400);
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
        return res.json({ error: "Data integrity check failed." }).status(400);
      }
    } catch (e) {
      return res.json({ error: "Data integrity check failed." }).status(400);
    }

    // OCR and response
    try {
      const recognizedText = await recognizeTextFromImage(decryptedImage);
      // Encrypt recognizedText with clientKey
      const encryptedText = encryptData(recognizedText, clientEncryptionKey);
      const signature = signData(encryptedText);
      return res
        .json({
          text: encryptedText,
          signature: signature,
        })
        .status(200);
    } catch (e) {
      return res.json({ error: "Failed to process image." }).status(500);
    }
  } catch (err) {
    console.error("Image upload error:", err);
    return res.json({ error: "Failed to upload image." }).status(500);
  }
});

// Create HTTPS server with mTLS
const tlsOptions: https.ServerOptions = {
  key: fs.readFileSync("/run/secrets/backend_server.key"),
  cert: fs.readFileSync("/run/secrets/backend_server.crt"),
  ca: fs.readFileSync("/run/secrets/frontend_clients_ca.crt"),
  requestCert: true,
  rejectUnauthorized: true,
};

const server = https.createServer(tlsOptions, app);

// Add error handlers for better debugging
server.on("error", (err) => {
  console.error("Server error:", err);
});

server.on("clientError", (err, socket) => {
  console.error("Client error:", err.message);
  socket.destroy();
});

server.on("tlsClientError", (err, tlsSocket) => {
  console.error("TLS Client error:", err.message);
});

server.listen(3000, "0.0.0.0", () => {
  console.log("mTLS server running on https://0.0.0.0:3000");
});
