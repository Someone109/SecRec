import { createClient } from "redis";
import fs from "fs";
import path from "path";

// Allow configuration via environment variables
const REDIS_HOST = process.env.REDIS_HOST || "redisKeyStore";
const REDIS_PORT = process.env.REDIS_PORT || "16379";
const REDIS_URL =
  process.env.REDIS_URL || `rediss://${REDIS_HOST}:${REDIS_PORT}`;

const CA_PATH = process.env.REDIS_CA || "/run/secrets/redisKeyStore_ca.crt";
const KEY_PATH =
  process.env.REDIS_KEY || "/run/secrets/redisKeyStore_client.key";
const CERT_PATH =
  process.env.REDIS_CERT || "/run/secrets/redisKeyStore_client.crt";

function safeReadFileSync(filePath: string) {
  try {
    return fs.readFileSync(filePath);
  } catch (err) {
    console.error(`Failed to read file: ${filePath}`);
    throw err;
  }
}

console.log("[Redis] Connecting with:", {
  url: REDIS_URL,
  ca: CA_PATH,
  key: KEY_PATH,
  cert: CERT_PATH,
});

const client = createClient({
  url: REDIS_URL,
  socket: {
    tls: true,
    ca: safeReadFileSync(CA_PATH),
    key: safeReadFileSync(KEY_PATH),
    cert: safeReadFileSync(CERT_PATH),
    rejectUnauthorized: true,
  },
});

await client.connect();
console.log("Connected to Redis server");

export default client;
