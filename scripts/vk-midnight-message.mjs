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

const peerId = "2000000289";
const groupId = "243224791";

// Diagnostic only: check whether VK can resolve this exact conversation
// for the community token. No message is sent by this script.
try {
  const conversations = await vkCall("messages.getConversationsById", {
    peer_ids: peerId,
    group_id: groupId,
  });

  const items = conversations.items ?? [];
  const found = items.some((item) => item.conversation?.peer?.id === Number(peerId));

  console.log(`getConversationsById succeeded. Returned items: ${items.length}. Target conversation visible: ${found ? "YES" : "NO"}.`);

  if (found) {
    console.log("VK resolved the target peer for this community token.");
  } else {
    console.log("VK did not return the target peer for this community token.");
  }
} catch (error) {
  console.error(`Conversation lookup failed: ${error.message}`);
  process.exit(1);
}

// Compare with the member-list method that previously returned error 927.
try {
  const members = await vkCall("messages.getConversationMembers", {
    peer_id: peerId,
    group_id: groupId,
    count: "100",
  });

  console.log(`getConversationMembers succeeded. Members returned: ${members.items?.length ?? 0}.`);
} catch (error) {
  console.error(`Conversation members check failed: ${error.message}`);
  process.exit(1);
}

console.log("Diagnostic run complete. Message sending is intentionally disabled.");
