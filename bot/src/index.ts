import { Bot } from "grammy";
import { autoRetry } from "@grammyjs/auto-retry";
import { limit } from "@grammyjs/ratelimiter";
import { config } from "./config.js";
import { Notifier } from "./services/notifier.js";
import { CleanupService } from "./services/cleanup.js";
import { TaskQueue } from "./services/queue.js";
import { APIClient } from "./services/apiClient.js";
import { HealthMonitor } from "./services/healthMonitor.js";
import { registerHandlers } from "./handlers/index.js";

async function main(): Promise<void> {
  console.log("🚀 Starting Telegram Bot...");

  // Инициализация бота
  const bot = new Bot(config.BOT_TOKEN);

  // Инициализация сервисов
  const notifier = new Notifier(bot);
  const cleanupService = new CleanupService(notifier);
  const taskQueue = new TaskQueue(notifier);
  const apiClient = new APIClient();
  const healthMonitor = new HealthMonitor(apiClient, notifier);

  // Настройка middleware
  bot.api.config.use(autoRetry());
  bot.use(
    limit({
      timeFrame: 2000,
      limit: 1,
    })
  );

  // Регистрация обработчиков
  registerHandlers({
    bot,
    taskQueue,
    apiClient,
    notifier,
    cleanupService,
  });

  // Запуск фоновых задач
  cleanupService.startScheduler();
  healthMonitor.startMonitoring(60);

  // Graceful shutdown
  const shutdown = async (): Promise<void> => {
    console.log("🛑 Shutting down bot...");
    await bot.stop();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  // Запуск бота
  try {
    await bot.start();
    console.log("✅ Bot started successfully");
  } catch (error) {
    console.error("❌ Failed to start bot:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("❌ Unhandled error:", error);
  process.exit(1);
});
