import fs from "fs";
import crypto from "crypto";

const PRIVATE_KEY_PASSPHRASE = "your-secure-passphrase";

const publicKeyPem = fs.readFileSync(
  "../backendai/backendai_public.pem",
  "utf8"
);

function encryptSymmetricKey(symmetricKey, publicKeyPem) {
  return crypto.publicEncrypt(
    {
      key: publicKeyPem,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    symmetricKey
  );
}

function verifySignature(data, signature) {
  const isVerified = crypto.verify(
    "sha256",
    data,
    {
      key: publicKeyPem,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
    },
    signature
  );
  return isVerified;
}

function encryptWithAes(data, key, iv) {
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  return encrypted;
}

function decryptData(encryptedData, privateKeyPem, passphrase) {
  const decrypted = crypto.privateDecrypt(
    {
      key: privateKeyPem,
      passphrase: passphrase,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    encryptedData
  );
  return decrypted;
}

function GenerateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
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

const image = fs.readFileSync(`./test.jpg`);

const response = await fetch("http://localhost:3000/session");
const sessionData = await response.json();

const publicKey = sessionData.publicKey;
const sessionSignature = sessionData.signature;

// Verify the session signature
const isSessionValid = verifySignature(
  Buffer.from(publicKey, "utf8"),
  Buffer.from(sessionSignature)
);

if (!isSessionValid) {
  throw new Error("Invalid session signature");
}

console.log("Session signature verified.");

// 1. Generate random AES key and IV
const aesKey = crypto.randomBytes(32); // 256 bits
const iv = crypto.randomBytes(16); // 128 bits

// 2. Encrypt the image with AES
const encryptedImage = encryptWithAes(image, aesKey, iv);

// 3. Encrypt the AES key with RSA public key
const encryptedAesKey = encryptSymmetricKey(aesKey, publicKey);

const { publicKey: clientPublicKey, privateKey: clientPrivateKey } =
  GenerateKeyPair();

// Hash the image and client public key
const hashedImageAndKey = crypto
  .createHash("sha256")
  .update(image + clientPublicKey)
  .digest("hex");

// Encrypt the hash with server's public key to create a signature that can be verified by the backend server
const clientKeySignature = encryptSymmetricKey(hashedImageAndKey, publicKey);

const imageResponse = await fetch("http://localhost:3000/imageup", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    image: encryptedImage, // AES-encrypted image
    encryptedKey: encryptedAesKey, // RSA-encrypted AES key
    iv: iv, // IV for AES
    publicKey: publicKey,
    encryptionKey: clientPublicKey,
    signature: clientKeySignature,
  }),
});

const imageResult = await imageResponse.json();
//console.log("Image Upload Result:", imageResult);

const encryptedText = imageResult.text;
const imageSignature = imageResult.signature;

// Decrypt the recognized text with client's private key
const decryptedText = decryptData(
  Buffer.from(encryptedText),
  clientPrivateKey,
  PRIVATE_KEY_PASSPHRASE
);

//verify signature
const isTextValid = verifySignature(
  Buffer.from(encryptedText, "utf-8"),
  Buffer.from(imageSignature)
);

if (!isTextValid) {
  console.log("Invalid text signature");
  throw new Error("Invalid text signature");
}

console.log("Text signature verified.");

console.log("Decrypted Recognized Text:", decryptedText.toString("utf8"));
