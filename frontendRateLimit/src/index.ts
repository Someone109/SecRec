import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { rateLimiter, type Store } from "hono-rate-limiter";
import RedisStore from "rate-limit-redis";
import client from "./redis.js";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import fs from "fs";
import https from "https";
import axios from "axios";

const app = new Hono();

const BACKEND_HOST = process.env.BACKEND_HOST || "backendai-app";
const BACKEND_PORT = process.env.BACKEND_PORT || "3000";

// Create HTTPS agent with client certificates for mTLS
const httpsAgent = new https.Agent({
  key: fs.readFileSync("/run/secrets/frontend_client.key"),
  cert: fs.readFileSync("/run/secrets/frontend_client.crt"),
  ca: fs.readFileSync("/run/secrets/backend_ca.crt"),
  rejectUnauthorized: true,
  keepAlive: false, // Disable keep-alive to avoid connection issues
});

console.log("mTLS client certificates loaded successfully");

const axiosInstance = axios.create({
  baseURL: `https://${BACKEND_HOST}:${BACKEND_PORT}`, // HTTPS for mTLS
  httpsAgent,
  timeout: 10000, // 10 seconds
  headers: {
    Connection: "close", // Force close connection after each request
  },
});

// Add request/response interceptors for debugging
axiosInstance.interceptors.request.use(
  (config) => {
    console.log(
      `Making request to: ${config.method?.toUpperCase()} ${config.baseURL}${
        config.url
      }`
    );
    return config;
  },
  (error) => {
    console.error("Request setup error:", error.message);
    return Promise.reject(error);
  }
);

axiosInstance.interceptors.response.use(
  (response) => {
    console.log(`Response received: ${response.status} ${response.statusText}`);
    return response;
  },
  (error) => {
    if (error.response) {
      console.error(
        `Backend error: ${error.response.status} ${error.response.statusText}`
      );
    } else if (error.request) {
      console.error(`No response from backend: ${error.message}`);
      console.error("Error code:", error.code);
    } else {
      console.error("Request setup error:", error.message);
    }
    return Promise.reject(error);
  }
);

// Apply rate limiter middleware
app.use(
  "*",
  rateLimiter({
    windowMs: 15 * 60 * 1000, //15 minutes
    limit: 100,
    standardHeaders: "draft-6",
    keyGenerator: (c) => {
      return (
        c.req.header("x-forwarded-for") ||
        c.req.header("cf-connecting-ip") ||
        c.req.header("x-real-ip") ||
        "unknown"
      );
    },
    store: new RedisStore({
      sendCommand: (...args: string[]) => client.sendCommand(args),
    }) as unknown as Store,
  })
);

app.get("/", (c) => {
  return c.text("Hello Hono with Redis rate limiting and mTLS!");
});

app.get("/session", async (c) => {
  try {
    console.log(
      `Attempting to connect to backend: https://${BACKEND_HOST}:${BACKEND_PORT}/session`
    );

    const response = await axiosInstance.get("/session");
    console.log("Session request successful");
    return c.json(response.data, 200);
  } catch (err: any) {
    console.error("Session request failed:", err.message);

    return c.json(
      {
        error: "Failed to fetch from backend",
        details: err.message,
        code: err.code,
        status: err.response?.status,
        statusText: err.response?.statusText,
      },
      err.response?.status || 500
    );
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
    } = body ?? {};

    const isBuffer = (data: any) => {
      return (
        data &&
        typeof data === "object" &&
        data.type === "Buffer" &&
        Array.isArray(data.data)
      );
    };

    const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5 MB
    const MIN_IV_LENGTH = 16; // 16 bytes for AES
    const MIN_ENCRYPTED_KEY_LENGTH = 32; // 32 bytes minimum for encrypted symmetric key

    // Check required fields exist
    if (
      !image ||
      !encryptedKey ||
      !iv ||
      !clientPublicKey ||
      !clientEncryptionKey ||
      !clientSignature
    ) {
      return c.json({ error: "Missing required fields." }, { status: 400 });
    }

    // Validate that binary fields are buffers
    if (!isBuffer(image)) {
      return c.json(
        { error: "Image must be a valid buffer." },
        { status: 400 }
      );
    }
    if (!isBuffer(encryptedKey)) {
      return c.json(
        { error: "Encrypted key must be a valid buffer." },
        { status: 400 }
      );
    }
    if (!isBuffer(iv)) {
      return c.json({ error: "IV must be a valid buffer." }, { status: 400 });
    }

    // Validate string fields
    if (typeof clientPublicKey !== "string") {
      return c.json({ error: "Public must be a string." }, { status: 400 });
    }

    // Size validation for buffers
    const imageSize = image.data.length;
    if (imageSize > MAX_IMAGE_SIZE) {
      return c.json({ error: "Image exceeds 5MB limit." }, { status: 413 }); // 413 Payload Too Large
    }

    const ivSize = iv.data.length;
    if (ivSize < MIN_IV_LENGTH) {
      return c.json(
        { error: `IV is too short. Minimum ${MIN_IV_LENGTH} bytes required.` },
        { status: 400 }
      );
    }

    const encryptedKeySize = encryptedKey.data.length;
    if (encryptedKeySize < MIN_ENCRYPTED_KEY_LENGTH) {
      return c.json(
        {
          error: `Encrypted key is too short. Minimum ${MIN_ENCRYPTED_KEY_LENGTH} bytes required.`,
        },
        { status: 400 }
      );
    }

    const MAX_IV_LENGTH = 32; // Reasonable upper bound for IV
    const MAX_ENCRYPTED_KEY_LENGTH = 1024; // Reasonable upper bound for encrypted key

    if (ivSize > MAX_IV_LENGTH) {
      return c.json(
        { error: `IV is too long. Maximum ${MAX_IV_LENGTH} bytes allowed.` },
        { status: 400 }
      );
    }

    if (encryptedKeySize > MAX_ENCRYPTED_KEY_LENGTH) {
      return c.json(
        {
          error: `Encrypted key is too long. Maximum ${MAX_ENCRYPTED_KEY_LENGTH} bytes allowed.`,
        },
        { status: 400 }
      );
    }

    // Forward to backend
    console.log(`Forwarding image upload to backend`);
    const response = await axiosInstance.post("/imageup", body, {
      headers: { "Content-Type": "application/json" },
    });

    return c.json(response.data, { status: 200 });
  } catch (err) {
    if (axios.isAxiosError(err)) {
      if (err.response) {
        // Backend responded with an error (e.g. 400, 500)
        return c.json(
          {
            error: "Backend responded with error",
            status: err.response.status,
            data: err.response.data,
          },
          { status: err.response.status as ContentfulStatusCode }
        );
      } else if (err.request) {
        // No response received (network/TLS timeout, etc.)
        return c.json(
          {
            error: "No response received from backend",
            details: err.message,
            code: err.code,
          },
          { status: 502 } // Bad Gateway
        );
      }
    }

    // Request config/setup error
    return c.json(
      {
        error: "Error setting up request to backend",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
});

serve(
  {
    fetch: app.fetch,
    port: 8080,
  },
  (info) => {
    console.log(`Frontend server running on http://localhost:${info.port}`);
  }
);
