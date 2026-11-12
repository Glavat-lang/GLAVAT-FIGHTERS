import { randomInt } from "node:crypto";

const CONFIG = Object.freeze({
  apiVersion: "5.199",
  groupId: "243224791",
  peerId: "2000000289",
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

  if (!response.ok) {
    throw new Error(`VK HTTP error ${response.status} calling ${method}`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`VK returned a non-JSON response for ${method}`);
  }

  if (payload.error) {
    const { error_code: code, error_msg: message } = payload.error;
    throw new Error(`VK API error ${code} calling ${method}: ${message}`);
  }

  if (!Object.hasOwn(payload, "response")) {
    throw new Error(`VK response for ${method} did not contain a response field`);
  }

  return payload.response;
}

function extractConversations(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.items)) return result.items;
  return [];
}

console.log("Checking community token and target conversation...");

try {
  const groupsResult = await vkCall("groups.getById", {
    group_ids: CONFIG.groupId,
  });
  const groups = Array.isArray(groupsResult)
    ? groupsResult
    : (groupsResult?.groups ?? []);
  const community = groups.find((group) => String(group.id) === CONFIG.groupId);

  if (!community) {
    throw new Error(`The supplied token cannot verify community ${CONFIG.groupId}`);
  }

  console.log(`Community token verified: ${community.name ?? CONFIG.groupId} (ID ${community.id}).`);

  const lookup = await vkCall("messages.getConversationsById", {
    peer_ids: CONFIG.peerId,
    group_id: CONFIG.groupId,
  });
  const conversations = extractConversations(lookup);
  const target = conversations.find(
    (item) => String(item.conversation?.peer?.id ?? item.peer?.id ?? "") === CONFIG.peerId,
  );

  if (!target) {
    throw new Error(
      `VK did not return target conversation ${CONFIG.peerId} for this community token. No message was sent.`,
    );
  }

  console.log(`Target conversation access confirmed: peer_id ${CONFIG.peerId}.`);
} catch (error) {
  console.error(`Pre-send access check failed: ${error.message}`);
  process.exit(1);
}

// Do not automatically retry this write request: a timeout can happen after VK
// has accepted a message, and retrying could create a duplicate.
try {
  const messageId = await vkCall("messages.send", {
    peer_id: CONFIG.peerId,
    group_id: CONFIG.groupId,
    random_id: String(randomInt(1, 2_147_483_647)),
    message: CONFIG.message,
  });

  console.log(`VK message sent successfully. Message ID: ${messageId}`);
} catch (error) {
  console.error(`VK message send failed: ${error.message}`);
  process.exit(1);
}
