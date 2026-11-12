const CONFIG = Object.freeze({
  message: "Я тебя люблю ❤️",
});

const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
if (!token) {
  console.error("Configuration error: GitHub Actions secret TELEGRAM_BOT_TOKEN is missing.");
  process.exit(1);
}

async function telegramCall(method, values = {}) {
  let response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new Error(`Network error calling Telegram ${method}: ${error.message}`);
  }

  if (!response.ok) throw new Error(`Telegram HTTP error ${response.status} calling ${method}`);
  const payload = await response.json();
  if (!payload.ok) {
    throw new Error(`Telegram API error calling ${method}: ${payload.description ?? "unknown error"}`);
  }
  return payload.result;
}

try {
  console.log("Finding the private chat that started this bot...");
  const updates = await telegramCall("getUpdates", { limit: 100, timeout: 0 });
  const privateMessages = updates
    .filter((update) => update.message?.chat?.type === "private")
    .sort((a, b) => b.update_id - a.update_id);
  const chatId = privateMessages[0]?.message?.chat?.id;

  if (!chatId) {
    throw new Error('No private chat found. Open your bot in Telegram, press "Start", and send it a message, then rerun this workflow.');
  }

  console.log("Private chat found. Sending the message...");
  const sent = await telegramCall("sendMessage", {
    chat_id: chatId,
    text: CONFIG.message,
  });

  if (!sent?.message_id) {
    throw new Error("Telegram did not confirm message delivery.");
  }

  console.log(`Telegram accepted the message. Message ID: ${sent.message_id}`);
} catch (error) {
  console.error(`Telegram daily message failed: ${error.message}`);
  process.exit(1);
}
