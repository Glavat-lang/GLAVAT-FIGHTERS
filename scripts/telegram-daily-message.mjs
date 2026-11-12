const CONFIG = Object.freeze({
  message: "Я тебя люблю ❤️",
  relationshipStartDate: "2023-10-15",
  timeZone: "Asia/Yekaterinburg",
});

function getPermDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CONFIG.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function getDaysTogether() {
  const start = Date.parse(`${CONFIG.relationshipStartDate}T00:00:00Z`);
  const today = Date.parse(`${getPermDate()}T00:00:00Z`);
  return Math.floor((today - start) / 86_400_000);
}

function getDailyMessage() {
  const days = getDaysTogether();
  return `${CONFIG.message}\\n\\nМы вместе уже ${days} дней ❤️`;
}

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
  let chatId = process.env.TELEGRAM_CHAT_ID?.trim();

  if (!chatId) {
    console.log("TELEGRAM_CHAT_ID is not configured. Detecting the most recent private chat without sending a message...");
    const updates = await telegramCall("getUpdates", { limit: 100, timeout: 0 });
    const privateMessages = updates
      .filter((update) => update.message?.chat?.type === "private")
      .sort((a, b) => b.update_id - a.update_id);
    chatId = privateMessages[0]?.message?.chat?.id?.toString();

    if (!chatId) {
      throw new Error('No private chat found. Ask the recipient to open the bot, press "Start", and send it a message.');
    }

    console.log(`Detected private chat ID: ${chatId}`);
    console.log("For safety, no message was sent. Save this value as the GitHub Actions secret TELEGRAM_CHAT_ID, then run the workflow again.");
    process.exit(2);
  }

  if (!/^\d+$/.test(chatId)) {
    throw new Error("TELEGRAM_CHAT_ID must contain only digits.");
  }

  console.log("Sending the scheduled message to the fixed Telegram recipient...");
  const sent = await telegramCall("sendMessage", {
    chat_id: chatId,
    text: getDailyMessage(),
  });

  if (!sent?.message_id) {
    throw new Error("Telegram did not confirm message delivery.");
  }

  console.log(`Telegram accepted the message. Message ID: ${sent.message_id}`);
} catch (error) {
  console.error(`Telegram daily message failed: ${error.message}`);
  process.exit(1);
}
