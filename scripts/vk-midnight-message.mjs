const CONFIG = Object.freeze({
  apiVersion: "5.199",
  groupId: "243224791",
  peerId: "2000000291",
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
    const error = payload.error;
    throw new Error(`VK API error ${error.error_code} calling ${method}: ${error.error_msg}`);
  }
  if (!Object.hasOwn(payload, "response")) {
    throw new Error(`VK response for ${method} did not contain a response field`);
  }
  return payload.response;
}

try {
  console.log(`Verifying community token for group ${CONFIG.groupId}...`);
  const groupResult = await vkCall("groups.getById", { group_ids: CONFIG.groupId });
  const groups = Array.isArray(groupResult) ? groupResult : (groupResult?.groups ?? []);
  const group = groups.find((item) => String(item.id) === CONFIG.groupId);
  if (!group) throw new Error("VK token does not resolve to the expected community.");
  console.log(`Community verified: ${group.name} (${group.id}).`);

  console.log(`Read-only diagnostic: requesting conversation ${CONFIG.peerId} via messages.getConversationsById...`);
  const result = await vkCall("messages.getConversationsById", {
    peer_ids: CONFIG.peerId,
    group_id: CONFIG.groupId,
    extended: "1",
  });

  console.log(`Conversation lookup result: ${JSON.stringify(result)}`);
  const items = result.items ?? [];
  if (items.length === 0) {
    console.log("VK returned no conversation for this community token. No message was sent.");
  } else {
    const conversation = items[0];
    console.log(`Conversation details: ${JSON.stringify({
      peer: conversation.conversation?.peer,
      chat_settings: conversation.conversation?.chat_settings,
      can_write: conversation.conversation?.can_write,
      last_message_id: conversation.last_message?.id,
      last_conversation_message_id: conversation.conversation?.last_conversation_message_id,
    })}`);
    console.log("Read-only diagnostic complete. No message was sent.");
  }
} catch (error) {
  console.error(`VK conversation diagnostic failed: ${error.message}`);
  process.exit(1);
}
