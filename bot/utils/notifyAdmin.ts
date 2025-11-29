import fetch from "node-fetch";

export async function notifyAdmin(text) {
    const admin = process.env.ADMIN_ID;
    const token = process.env.BOT_TOKEN;
    if (!admin || !token) return;

    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            chat_id: admin,
            text: `⚠️ ${text}`
        })
    }).catch(() => {});
}
