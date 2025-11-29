import { Bot } from "grammy";
import axios from "axios";
import dotenv from "dotenv";
import fs from "fs";
import FormData from "form-data";
import cron from "node-cron";

dotenv.config();

const bot = new Bot(process.env.BOT_TOKEN);
const WHISPER_URL = process.env.WHISPER_URL;
const ADMIN_ID = process.env.ADMIN_ID;

// --------------------
// Функция уведомления
// --------------------
async function notifyAdmin(msg) {
    if (!ADMIN_ID) return;
    try {
      await bot.api.sendMessage(ADMIN_ID, `⚠️ Ошибка:\n${msg}`);
    } catch (e) {}
}


// --------------------
// Очистка временных файлов
// --------------------
function cleanupTmp() {
  const tmpDir = "./tmp";
  if (!fs.existsSync(tmpDir)) return;

  const now = Date.now();
  const maxAge = 30 * 60 * 1000; // 30 минут
  fs.readdirSync(tmpDir).forEach(f => {
    const p = `${tmpDir}/${f}`;
    try {
      if (now - fs.statSync(p).mtimeMs > maxAge) fs.unlinkSync(p);
    } catch {}
  });
}

// --------------------
// Запускаем cron каждые 10 минут
// --------------------
cron.schedule("*/10 * * * *", () => {
  cleanupTmp();
});

// ------------------------------
//  Очередь задач для аудио
// ------------------------------

// let queue = Promise.resolve();

// function enqueue(task) {
//   queue = queue.then(task).catch(console.error);
//   return queue;
// }

// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!! 
// Обработай ошибку переполнения очереди задач
// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!! 
let queue = [];
const QUEUE_LIMIT = 5;

async function processAudioTask(task) {
  if (queue.length >= QUEUE_LIMIT) {
    notifyAdmin(`Переполнение очереди задач: ${queue.length}/${QUEUE_LIMIT}`);
    return { error: "queue_overflow" };
  }
  queue.push(task);
  try {
    return await task();
  } finally {
    queue.shift();
  }
}

// ===========================
//   Voice handler
// ===========================
bot.on("voice", async (ctx) => {
  await ctx.reply("⏳ Распознаю речь...");

  // enqueue(async () => {
  processAudioTask(async () => {
    try {

      // версия 1
      // const fileId = ctx.message.voice.file_id;

      // URL файла
      // const file = await ctx.api.getFile(fileId);
      // const url = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;

      
      // Скачиваем 
      // const audio = await axios.get(url, { responseType: "arraybuffer" });
      // const tmp = `voice_${Date.now()}.ogg`;
      // fs.writeFileSync(tmp, audio.data);

      // Отправляем в whisper API
      // const form = new FormData();
      // form.append("file", fs.createReadStream(tmp));

      // const response = await axios.post(WHISPER_URL, form, {
      //   headers: form.getHeaders(),
      // });

      // fs.unlinkSync(tmp);

      // const text = response.data.text?.trim();
      // await ctx.reply(text || "Не удалось распознать.");

      // версия 2
      const file = await ctx.api.getFile(ctx.message.voice.file_id);
      const url = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;

      const tmpDir = "./tmp";
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);
      const tmpPath = `${tmpDir}/voice_${Date.now()}.ogg`;

      const audio = await axios.get(url, { responseType: "arraybuffer" });
      fs.writeFileSync(tmpPath, audio);

      const form = new FormData();
      form.append("file", fs.createReadStream(tmpPath));

      const r = await axios.post(WHISPER_URL, form, { headers: form.getHeaders() });
      fs.unlinkSync(tmpPath);

      if (!r.data.text) throw new Error("Whisper вернул пустой текст");
      await ctx.reply(`Расшифровка:\n${r.data.text}`);


    } catch (e) {
        console.error(e);
        await notifyAdmin(`Ошибка распознавания: ${e.message}`);
        await ctx.reply("Ошибка распознавания.");
    }
  });
});

// ===========================
//   "следующий"
// ===========================
bot.hears(/следующий/i, async (ctx) => {
  await ctx.reply("<b>========== СЛЕДУЮЩЕЕ ВИДЕО ==========</b>", {
    parse_mode: "HTML",
  });
});

// ===========================
//    Обработка фото
// ===========================
// --------- обработка фото (OCR -> code) -----------
bot.on("photo", async ctx => {
  await ctx.reply("🖼 Распознаю текст на фото...");

  try {
    const photoSizes = ctx.message.photo;
    const fileId = photoSizes[photoSizes.length - 1].file_id; // наибольшее разрешение
    const file = await ctx.api.getFile(fileId);
    const url = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;

    const tmpDir = "./tmp";
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);
    const tmpPath = `${tmpDir}/img_${Date.now()}.jpg`;

    const img = await axios.get(url, { responseType: "arraybuffer" });
    fs.writeFileSync(tmpPath, img.data);

    // отправляем в OCR сервис
    const form = new FormData();
    form.append("file", fs.createReadStream(tmpPath));

    const r = await axios.post(process.env.OCR_URL, form, { headers: form.getHeaders(), timeout: 120000 });

    // удаляем временный
    try { fs.unlinkSync(tmpPath); } catch {}

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

    // Если короткий текст — отправляем как форматированный блок (HTML <pre>)
    const MAX_INLINE = 4000;
    if (text.length <= MAX_INLINE) {
      // экранируем для HTML
      const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      // поместим в <pre>
      await ctx.reply(`<pre>${esc}</pre>`, { parse_mode: "HTML" });
      return;
    }

    // Иначе отправляем как файл с расширением по detected lang
    let ext = lang || "txt";
    // нормализуем ext: если не короткая строка, сделаем txt
    if (!/^[a-z0-9]{1,5}$/.test(ext)) ext = "txt";

    const filename = `code_${Date.now()}.${ext}`;
    const outPath = `${tmpDir}/${filename}`;
    fs.writeFileSync(outPath, text);

    await ctx.reply("📄 Текст слишком длинный — отправляю файл:");
    await ctx.replyWithDocument({ source: fs.createReadStream(outPath), filename });

    try { fs.unlinkSync(outPath); } catch {}

  } catch (e) {
    console.error(e);
    await notifyAdmin(`OCR bot error: ${e.message}`);
    await ctx.reply("Ошибка распознавания текста с фото.");
  }
});



// ===========================
//    Ошибки
// ===========================

// Проверка ошибок скачивания аудио node.js
try {
    const file = await ctx.getFile();
    if (!file) throw new Error("Файл не найден");

    const oggPath = await downloadOgg(file);
} catch (e) {
    await notifyAdmin(`Ошибка скачивания аудио: ${e.message}`);
    return ctx.reply("Не удалось скачать аудио.");
}

// Ошибки отправки в Whisper
try {
    const result = await transcribe(oggPath);
    if (!result.text) throw new Error("Whisper вернул пустой текст");
} catch (e) {
    await notifyAdmin(`Ошибка Whisper API: ${e.message}`);
    return ctx.reply("Whisper недоступен.");
}

async function checkWhisperHealth() {
    try {
        const r = await fetch(`${process.env.WHISPER_HOST}/health`);
        if (!r.ok) throw new Error("Не отвечает");
    } catch (e) {
        notifyAdmin("Whisper недоступен! Сервер не отвечает.");
    }
}
// проверяем каждые 30 сек
setInterval(checkWhisperHealth, 30000);



bot.start();
console.log("Bot started");





