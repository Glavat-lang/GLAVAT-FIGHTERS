const token = process.env.VK_TOKEN;
if (!token) {
  console.error("Missing required GitHub Actions secret: VK_TOKEN");
  process.exit(1);
}

async function vkCall(method, values = {}) {
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

// Read-only diagnostic: verify which community this token belongs to.
// No messages are sent.
try {
  const result = await vkCall("groups.getById", {
    group_ids: "243224791",
  });

  const groups = Array.isArray(result) ? result : (result.groups ?? []);
  const target = groups.find((group) => String(group.id) === "243224791");

  if (target) {
    console.log(`Token can access target community. Returned group ID: ${target.id}. Name: ${target.name ?? "unknown"}.`);
  } else {
    console.log("Token lookup did not return community 243224791.");
    console.log(`Returned communities: ${groups.length}.`);
  }
} catch (error) {
  console.error(`Community token identity check failed: ${error.message}`);
  process.exit(1);
}

console.log("Read-only diagnostic complete. No messages were sent.");
