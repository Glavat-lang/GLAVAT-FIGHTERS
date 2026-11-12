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

// Test the actual send method with the community ID.
// This sends the intended message once if VK permits it.
try {
  const messageId = await vkCall("messages.send", {
    peer_id: "2000000289",
    group_id: "243224791",
    random_id: String(randomInt(1, 2_147_483_647)),
    message: "Я тебя люблю",
  });
  console.log(`VK message sent successfully. Message ID: ${messageId}`);
} catch (error) {
  console.error(`VK message send failed: ${error.message}`);
  process.exit(1);
}
