import { Bot, InputFile } from "grammy";
import fs from "fs";
import path from "path";
import { BOT_TOKEN, TMP_DIR, ADMIN_CHAT_ID } from "./config";
import { addTask } from "./queue";
import { ocrImage } from "./ocr";
import { transcribe } from "./whisper";
import { initCleanup } from "./cleanup";

const bot = new Bot(BOT_TOKEN);

const notify = (msg: string) => bot.api.sendMessage(ADMIN_CHAT_ID, msg);

// Init cleanup cron
initCleanup(notify);

bot.on("message:voice", async ctx => {
    const file = await ctx.getFile();
    const local = `${TMP_DIR}/${Date.now()}.ogg`;
    await ctx.api.getFile(file.file_id).then(f => f.download(local));

    addTask(async () => {
        try {
            const text = await transcribe(local);
            await ctx.reply(text);
        } catch (e: any) {
            notify("❗ Ошибка whisper: " + e.message);
            await ctx.reply("Произошла ошибка распознавания.");
        }
    });
});

bot.on("message:photo", async ctx => {
    const file = await ctx.getFile();
    const local = `${TMP_DIR}/${Date.now()}.jpg`;

    await ctx.api.getFile(file.file_id).then(f => f.download(local));

    addTask(async () => {
        try {
            const text = await ocrImage(local);
            await ctx.reply("```\n" + text + "\n```", { parse_mode: "MarkdownV2" });
        } catch (e: any) {
            notify("❗ Ошибка OCR: " + e.message);
            await ctx.reply("Не удалось прочитать фото.");
        }
    });
});

bot.hears("следующий", ctx =>
    ctx.reply("**========== СЛЕДУЮЩЕЕ ВИДЕО==========**", {
        parse_mode: "Markdown"
    })
);

bot.start();
