import { randomInt } from "node:crypto";

const CONFIG = Object.freeze({
  apiVersion: "5.199",
  groupId: "243224791",
  screenName: "glavatt",
  chatTitle: "Тест бота Аркаша",
  message: "Я тебя люблю",
});

const token = process.env.VK_TOKEN?.trim();
if (!token) {
  console.error("Configuration error: GitHub Actions secret VK_TOKEN is missing or empty.");
  process.exit(1);
}

async function vkCall(method, values = {}) {
  const params = new URLSearchParams({
    access_token: token,
    v: CONFIG.apiVersion,
    ...values,
  });

  let response;
  try {
    response = await fetch(`https://api.vk.com/method/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new Error(`Network error calling ${method}: ${error.message}`);
  }

  if (!response.ok) throw new Error(`VK HTTP error ${response.status} calling ${method}`);

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`VK returned a non-JSON response for ${method}`);
  }

  if (payload.error) {
    throw new Error(`VK API error ${payload.error.error_code} calling ${method}: ${payload.error.error_msg}`);
  }
  if (!Object.hasOwn(payload, "response")) {
    throw new Error(`VK response for ${method} did not contain a response field`);
  }
  return payload.response;
}

try {
  console.log(`Verifying community token for group ${CONFIG.groupId}...`);
  const groupResult = await vkCall("groups.getById", {
    group_ids: CONFIG.groupId,
  });
  const groups = Array.isArray(groupResult) ? groupResult : (groupResult?.groups ?? []);
  const group = groups.find((item) => String(item.id) === CONFIG.groupId);
  if (!group) throw new Error("VK token does not resolve to the expected community.");
  console.log(`Community verified: ${group.name} (${group.id}).`);

  console.log(`Resolving VK profile @${CONFIG.screenName}...`);
  const resolved = await vkCall("utils.resolveScreenName", {
    screen_name: CONFIG.screenName,
  });
  if (!resolved || resolved.type !== "user" || !resolved.object_id) {
    throw new Error("VK did not resolve glavatt to a user profile. No chat was created.");
  }
  const userId = String(resolved.object_id);
  console.log(`Profile resolved to numeric user ID ${userId}.`);

  console.log("Creating a separate test chat with the community...");
  const created = await vkCall("messages.createChat", {
    user_ids: userId,
    title: CONFIG.chatTitle,
    group_id: CONFIG.groupId,
  });

  const chatId = Number(created?.chat_id ?? created);
  if (!Number.isSafeInteger(chatId) || chatId <= 0) {
    throw new Error("VK did not return a valid chat_id. The test message was not sent.");
  }

  const peerId = String(2_000_000_000 + chatId);
  console.log(`Test chat created. chat_id: ${chatId}; peer_id: ${peerId}.`);

  const messageId = await vkCall("messages.send", {
    peer_id: peerId,
    group_id: CONFIG.groupId,
    random_id: String(randomInt(1, 2_147_483_647)),
    message: CONFIG.message,
  });

  console.log(`Test message sent successfully. Message ID: ${messageId}. Test chat peer_id: ${peerId}.`);
} catch (error) {
  console.error(`VK test-chat operation failed: ${error.message}`);
  process.exit(1);
}
