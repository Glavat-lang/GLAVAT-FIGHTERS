import { randomInt } from "node:crypto";

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

// Verify that VK exposes the conversation to this community token.
try {
  const members = await vkCall("messages.getConversationMembers", {
    peer_id: "2000000289",
    count: "100",
  });
  console.log(`Conversation access confirmed. Members returned: ${members.items?.length ?? 0}`);
} catch (error) {
  console.error(`Conversation access check failed: ${error.message}`);
  process.exit(1);
}

try {
  const messageId = await vkCall("messages.send", {
    peer_id: "2000000289",
    random_id: String(randomInt(1, 2_147_483_647)),
    message: "Я тебя люблю",
  });
  console.log(`VK message sent successfully. Message ID: ${messageId}`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
