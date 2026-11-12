const CONFIG = Object.freeze({
  apiVersion: "5.199",
  groupId: "243224791",
  chatId: "3",
  peerId: "2000000003",
  userId: "290172143",
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

  console.log(`Attempting to add user ${CONFIG.userId} to existing chat ${CONFIG.chatId}...`);
  try {
    const addResult = await vkCall("messages.addChatUser", {
      chat_id: CONFIG.chatId,
      user_id: CONFIG.userId,
      group_id: CONFIG.groupId,
    });
    console.log(`messages.addChatUser response: ${JSON.stringify(addResult)}`);
  } catch (error) {
    console.log(`messages.addChatUser failed: ${error.message}`);
  }

  console.log("Checking chat members after add attempt...");
  const members = await vkCall("messages.getConversationMembers", {
    peer_id: CONFIG.peerId,
    group_id: CONFIG.groupId,
    count: "100",
    extended: "1",
  });
  console.log(`Final member list: ${JSON.stringify(members)}`);

  const ids = (members.items ?? []).map((member) => Number(member.member_id));
  if (ids.includes(Number(CONFIG.userId))) {
    console.log("SUCCESS: the personal VK account is now a chat member.");
  } else {
    console.log("The personal VK account is still not a chat member. No message was sent.");
  }
} catch (error) {
  console.error(`VK add-user diagnostic failed: ${error.message}`);
  process.exit(1);
}
