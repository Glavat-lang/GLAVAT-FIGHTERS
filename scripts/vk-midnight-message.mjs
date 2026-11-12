const CONFIG = Object.freeze({
  apiVersion: "5.199",
  expectedUserId: "290172143",
  peerId: "2000000291",
  testMessage: "Я тебя люблю ❤️",
});

const token = process.env.VK_USER_TOKEN?.trim();
if (!token) {
  console.error("Configuration error: GitHub Actions secret VK_USER_TOKEN is missing.");
  console.error("Add your personal VK access token as a GitHub Actions secret. Never print or commit it.");
  process.exit(1);
}

async function vkCall(method, values = {}) {
  const params = new URLSearchParams({
    access_token: token,
    v: CONFIG.apiVersion,
    ...values,
  });

  const response = await fetch(`https://api.vk.com/method/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) throw new Error(`VK HTTP error ${response.status} calling ${method}`);
  const payload = await response.json();

  if (payload.error) {
    throw new Error(`VK API error ${payload.error.error_code} calling ${method}: ${payload.error.error_msg}`);
  }
  if (!Object.hasOwn(payload, "response")) {
    throw new Error(`VK response for ${method} did not contain a response field`);
  }
  return payload.response;
}

try {
  console.log("Verifying personal VK authorization...");
  const users = await vkCall("users.get");
  const user = users?.[0];
  if (!user || String(user.id) !== CONFIG.expectedUserId) {
    throw new Error(`Wrong VK account. Expected user ID ${CONFIG.expectedUserId}; received ${user?.id ?? "none"}.`);
  }
  console.log(`Personal account verified: user ${user.id}.`);

  console.log(`Sending one-time test message to peer_id ${CONFIG.peerId}...`);
  const result = await vkCall("messages.send", {
    peer_id: CONFIG.peerId,
    random_id: String(Date.now()),
    message: CONFIG.testMessage,
  });

  if (!result || Number(result) === 0) {
    throw new Error("VK returned message ID 0. Delivery is not confirmed.");
  }
  console.log(`VK accepted the test message. Message ID: ${result}`);
  console.log("Now verify that the message is visible in the target VK chat.");
} catch (error) {
  console.error(`VK personal-account test failed: ${error.message}`);
  process.exit(1);
}
