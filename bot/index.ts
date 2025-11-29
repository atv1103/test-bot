import { Bot } from "grammy";
import axios from "axios";
import dotenv from "dotenv";
import fs from "fs";
import FormData from "form-data";
import cron from "node-cron";
import { autoRetry } from "@grammyjs/auto-retry";
import { limit } from "@grammyjs/ratelimiter";

dotenv.config();

// ✅ Валидация ENV переменных
const BOT_TOKEN = process.env.BOT_TOKEN;
const WHISPER_URL = process.env.WHISPER_URL;
const OCR_URL = process.env.OCR_URL;
const ADMIN_ID = process.env.ADMIN_ID;

if (!BOT_TOKEN || !WHISPER_URL || !OCR_URL) {
  console.error("❌ Missing required ENV variables");
  process.exit(1);
}

const bot = new Bot(BOT_TOKEN);

// --------------------
// Функция уведомления
// --------------------
async function notifyAdmin(msg: string): Promise<void> {
  if (!ADMIN_ID) return;
  try {
    await bot.api.sendMessage(ADMIN_ID, `⚠️ Ошибка:\n${msg}`);
  } catch (e) {
    console.error("Failed to notify admin:", e);
  }
}

// --------------------
// Очистка временных файлов
// --------------------
function cleanupTmp(): void {
  const tmpDir = "./tmp";
  if (!fs.existsSync(tmpDir)) return;

  const now = Date.now();
  const maxAge = 30 * 60 * 1000; // 30 минут
  
  try {
    fs.readdirSync(tmpDir).forEach(f => {
      const p = `${tmpDir}/${f}`;
      try {
        const stats = fs.statSync(p);
        if (now - stats.mtimeMs > maxAge) {
          fs.unlinkSync(p);
        }
      } catch (err) {
        console.error(`Error cleaning up ${p}:`, err);
      }
    });
  } catch (err) {
    notifyAdmin(`Ошибка cron очистки: ${err}`);
  }
}

// Запускаем cron каждые 15 минут
cron.schedule("*/15 * * * *", () => {
  cleanupTmp();
});

// ------------------------------
// ✅ Исправленная очередь задач
// ------------------------------
interface QueueTask {
  id: string;
  task: () => Promise<void>;
}

const taskQueue: QueueTask[] = [];
const QUEUE_LIMIT = 5;
let isProcessing = false;

async function addToQueue(task: () => Promise<void>): Promise<boolean> {
  if (taskQueue.length >= QUEUE_LIMIT) {
    await notifyAdmin(`⚠️ Переполнение очереди: ${taskQueue.length}/${QUEUE_LIMIT}`);
    return false;
  }

  const queueTask: QueueTask = {
    id: `task_${Date.now()}_${Math.random()}`,
    task
  };

  taskQueue.push(queueTask);
  processQueue();
  return true;
}

async function processQueue(): Promise<void> {
  if (isProcessing || taskQueue.length === 0) return;
  
  isProcessing = true;

  while (taskQueue.length > 0) {
    const queueTask = taskQueue.shift();
    if (!queueTask) continue;

    try {
      await queueTask.task();
    } catch (err) {
      console.error(`Queue task ${queueTask.id} failed:`, err);
      await notifyAdmin(`Ошибка задачи ${queueTask.id}: ${err}`);
    }
  }

  isProcessing = false;
}

// ===========================
// Voice handler
// ===========================
bot.on("message:voice", async (ctx) => {
  await ctx.reply("⏳ Распознаю речь...");

  const added = await addToQueue(async () => {
    const tmpDir = "./tmp";
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    let tmpPath: string | null = null;

    try {
      const file = await ctx.api.getFile(ctx.message.voice.file_id);
      const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;

      tmpPath = `${tmpDir}/voice_${Date.now()}.ogg`;

      // ✅ Добавлен timeout
      const audio = await axios.get(url, { 
        responseType: "arraybuffer",
        timeout: 30000 // 30 секунд
      });
      
      fs.writeFileSync(tmpPath, audio.data);

      const form = new FormData();
      form.append("file", fs.createReadStream(tmpPath));

      // ✅ Добавлен timeout
      const r = await axios.post(WHISPER_URL, form, { 
        headers: form.getHeaders(),
        timeout: 120000 // 2 минуты
      });

      if (!r.data.text) {
        throw new Error("Whisper вернул пустой текст");
      }

      await ctx.reply(`📝 Расшифровка:\n${r.data.text}`);

    } catch (e: any) {
      console.error("Voice recognition error:", e);
      await notifyAdmin(`Ошибка распознавания голоса: ${e.message}`);
      await ctx.reply("❌ Ошибка распознавания речи.");
    } finally {
      // ✅ Гарантированная очистка
      if (tmpPath && fs.existsSync(tmpPath)) {
        try {
          fs.unlinkSync(tmpPath);
        } catch (err) {
          console.error("Failed to cleanup temp file:", err);
        }
      }
    }
  });

  if (!added) {
    await ctx.reply("⚠️ Очередь переполнена, попробуйте позже.");
  }
});

// ===========================
// "следующий"
// ===========================
bot.hears(/следующий/i, async (ctx) => {
  await ctx.reply("<b>========== СЛЕДУЮЩЕЕ ВИДЕО ==========</b>", {
    parse_mode: "HTML",
  });
});

// ===========================
// Обработка фото
// ===========================
bot.on("message:photo", async (ctx) => {
  await ctx.reply("🖼 Распознаю текст на фото...");

  const tmpDir = "./tmp";
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  let tmpPath: string | null = null;
  let outPath: string | null = null;

  try {
    const photoSizes = ctx.message.photo;
    const fileId = photoSizes[photoSizes.length - 1].file_id;
    const file = await ctx.api.getFile(fileId);
    const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;

    tmpPath = `${tmpDir}/img_${Date.now()}.jpg`;

    // ✅ Добавлен timeout
    const img = await axios.get(url, { 
      responseType: "arraybuffer",
      timeout: 30000 
    });
    
    fs.writeFileSync(tmpPath, img.data);

    const form = new FormData();
    form.append("file", fs.createReadStream(tmpPath));

    // ✅ Добавлен timeout
    const r = await axios.post(OCR_URL, form, { 
      headers: form.getHeaders(), 
      timeout: 120000 
    });

    if (r.data && r.data.error) {
      await notifyAdmin(`OCR error: ${r.data.error}`);
      return await ctx.reply("❗ Ошибка OCR сервера.");
    }

    const text = r.data.text?.trim() || "";
    const lang = r.data.lang || "txt";

    if (!text) {
      await ctx.reply("❗ Текст не найден на изображении.");
      return;
    }

    const MAX_INLINE = 4000;
    if (text.length <= MAX_INLINE) {
      const esc = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      await ctx.reply(`<pre>${esc}</pre>`, { parse_mode: "HTML" });
      return;
    }

    // Длинный текст → файл
    let ext = lang || "txt";
    if (!/^[a-z0-9]{1,5}$/.test(ext)) ext = "txt";

    const filename = `code_${Date.now()}.${ext}`;
    outPath = `${tmpDir}/${filename}`;
    fs.writeFileSync(outPath, text);

    await ctx.reply("📄 Текст слишком длинный — отправляю файл:");
    await ctx.replyWithDocument({ 
      source: fs.createReadStream(outPath), 
      filename 
    });

  } catch (e: any) {
    console.error("OCR error:", e);
    await notifyAdmin(`OCR bot error: ${e.message}`);
    await ctx.reply("❌ Ошибка распознавания текста с фото.");
  } finally {
    // ✅ Гарантированная очистка
    [tmpPath, outPath].forEach(path => {
      if (path && fs.existsSync(path)) {
        try {
          fs.unlinkSync(path);
        } catch (err) {
          console.error("Failed to cleanup:", err);
        }
      }
    });
  }
});

// ===========================
// Health check для Whisper
// ===========================
async function checkWhisperHealth(): Promise<void> {
  try {
    const r = await axios.get(`${WHISPER_URL.replace('/stt', '')}/health`, {
      timeout: 5000
    });
    if (r.status !== 200) {
      throw new Error("Whisper не отвечает");
    }
  } catch (e) {
    await notifyAdmin("⚠️ Whisper сервис недоступен!");
  }
}

// Проверяем каждые 60 секунд
setInterval(checkWhisperHealth, 60000);

async function checkOcrHealth(): Promise<void> {
  try {
    const r = await axios.get(`${OCR_URL.replace('/ocr', '')}/health`, {
      timeout: 5000
    });
    if (r.status !== 200) throw new Error("OCR не отвечает");
  } catch (e) {
    await notifyAdmin("⚠️ OCR сервис недоступен!");
  }
}

setInterval(checkOcrHealth, 60000);

// ===========================
// Graceful shutdown
// ===========================
async function shutdown(): Promise<void> {
  console.log("Shutting down bot...");
  await bot.stop();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// ===========================
// Запуск
// ===========================

bot.api.config.use(autoRetry());
bot.use(limit({
  timeFrame: 2000,  
  limit: 1,         
}));

bot.start().then(() => {
  console.log("✅ Bot started successfully");
}).catch((err) => {
  console.error("❌ Failed to start bot:", err);
  process.exit(1);
});
