import Tesseract from "node-tesseract-ocr";

const config = {
  lang: "eng", // Language: English
  oem: 1, // OCR Engine Mode
  psm: 3, // Page Segmentation Mode
};

async function recognizeTextFromImage(imageBuffer: Buffer): Promise<string> {
  try {
    const text = await Tesseract.recognize(imageBuffer, config);
    return text;
  } catch (error) {
    console.error("OCR Error:", error);
    throw new Error("Failed to recognize text from image.");
  }
}

export { recognizeTextFromImage };