import dotenv from "dotenv";

dotenv.config();

export interface Config {
  BOT_TOKEN: string;
  WHISPER_URL: string;
  OCR_URL: string;
  ADMIN_ID?: string;
  TMP_DIR: string;
  CLEANUP_INTERVAL_MINUTES: number;
  FILE_MAX_AGE_MINUTES: number;
  QUEUE_LIMIT: number;
}

function validateEnv(): Config {
  const BOT_TOKEN = process.env.BOT_TOKEN;
  const WHISPER_URL = process.env.WHISPER_URL;
  const OCR_URL = process.env.OCR_URL;
  const ADMIN_ID = process.env.ADMIN_ID;

  if (!BOT_TOKEN || !WHISPER_URL || !OCR_URL) {
    console.error("❌ Missing required ENV variables:");
    if (!BOT_TOKEN) console.error("  - BOT_TOKEN");
    if (!WHISPER_URL) console.error("  - WHISPER_URL");
    if (!OCR_URL) console.error("  - OCR_URL");
    process.exit(1);
  }

  return {
    BOT_TOKEN,
    WHISPER_URL,
    OCR_URL,
    ADMIN_ID,
    TMP_DIR: "./tmp",
    CLEANUP_INTERVAL_MINUTES: 15,
    FILE_MAX_AGE_MINUTES: 30,
    QUEUE_LIMIT: 5,
  };
}

export const config = validateEnv();
