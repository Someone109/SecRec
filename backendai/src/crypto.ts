// Decrypt data using private key and passphrase
const PRIVATE_KEY_PASSPHRASE = "your-secure-passphrase";

export function decryptData(
  encryptedData: Buffer,
  privateKeyPem: string
): Buffer {
  const decrypted = crypto.privateDecrypt(
    {
      key: privateKeyPem,
      passphrase: PRIVATE_KEY_PASSPHRASE,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    encryptedData
  );
  return decrypted;
}
import crypto, { generateKeyPairSync } from "crypto";
import fs from "fs";

// load private key

const privateKey = fs.readFileSync(
  "/run/secrets/backendai_private.pem",
  "utf8"
);

export function signData(data: string | Buffer): Buffer {
  const signature = crypto.sign("sha256", Buffer.from(data), {
    key: privateKey,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
  });
  return signature;
}

/*
Verify on client

const publicKey = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A...
-----END PUBLIC KEY-----`;

function verifySignature(data, signatureBase64) {
  const isValid = crypto.verify(
    'sha256',
    Buffer.from(data),
    {
      key: publicKey,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    },
    Buffer.from(signatureBase64, 'base64')
  );
  return isValid;
}



*/
export function GenerateKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 4096,
    publicKeyEncoding: {
      type: "spki",
      format: "pem",
    },
    privateKeyEncoding: {
      type: "pkcs8",
      format: "pem",
      cipher: "aes-256-cbc",
      passphrase: PRIVATE_KEY_PASSPHRASE,
    },
  });

  return { publicKey, privateKey };
}

export function encryptData(
  data: Buffer | string,
  publicKeyPem: string
): Buffer {
  const bufferData = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");
  const encrypted = crypto.publicEncrypt(
    {
      key: publicKeyPem,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    bufferData
  );
  return encrypted;
}

export function decryptWithAes(
  data: NodeJS.ArrayBufferView<ArrayBufferLike>,
  key: crypto.CipherKey,
  iv: crypto.BinaryLike | null
) {
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted;
}

export function hashBuffer(data: Buffer | string): string {
  const bufferData = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");
  return crypto.createHash("sha256").update(bufferData).digest("hex");
}
