const cron = require("node-cron");
const fs = require("fs");
const path = require("path");

module.exports = function setupCron(notifyAdmin) {
  const tmpDir = "./tmp";

  cron.schedule("*/15 * * * *", () => {
    try {
      if (!fs.existsSync(tmpDir)) return;

      const now = Date.now();
      const files = fs.readdirSync(tmpDir);

      for (const f of files) {
        const full = path.join(tmpDir, f);
        const stat = fs.statSync(full);
        if (now - stat.mtimeMs > 30 * 60 * 1000) fs.unlinkSync(full);
      }
    } catch (e) {
      notifyAdmin("Cron error: " + e.message);
    }
  });
};
