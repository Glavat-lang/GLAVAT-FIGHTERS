const token = process.env.VK_TOKEN;
if (!token) {
  console.error("Missing required GitHub Actions secret: VK_TOKEN");
  process.exit(1);
}

async function vkCall(method, values) {
  const params = new URLSearchParams({
    access_token: token,
    v: "5.199",
    ...values,
  });

  const response = await fetch(`https://api.vk.com/method/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });

  if (!response.ok) {
    throw new Error(`VK HTTP error: ${response.status}`);
  }

  const result = await response.json();
  if (result.error) {
    throw new Error(`VK API error ${result.error.error_code}: ${result.error.error_msg}`);
  }
  return result.response;
}

const peerId = 2000000289;
const groupId = "243224791";

// Diagnostic only. Do not send any messages.
console.log("Checking direct access to the target chat...");
try {
  const chat = await vkCall("messages.getChat", {
    chat_id: "289",
    group_id: groupId,
  });
  console.log(`messages.getChat succeeded. Chat ID: ${chat.id ?? "unknown"}.`);
} catch (error) {
  console.log(`messages.getChat failed: ${error.message}`);
}

console.log("Checking the community's conversation list...");
try {
  const result = await vkCall("messages.getConversations", {
    group_id: groupId,
    count: "200",
    filter: "all",
  });

  const items = result.items ?? [];
  const found = items.some((item) => item.conversation?.peer?.id === peerId);

  console.log(`getConversations succeeded. Total returned: ${items.length}. Target peer visible: ${found ? "YES" : "NO"}.`);
  if (found) {
    console.log("The target conversation is present in the community's conversation list.");
  } else {
    console.log("The target conversation is absent from the first 200 conversations returned for the community.");
  }
} catch (error) {
  console.error(`getConversations failed: ${error.message}`);
  process.exit(1);
}

console.log("Diagnostic run complete. Message sending is intentionally disabled.");
