import { randomInt } from "node:crypto";

const token = process.env.VK_TOKEN;
if (!token) {
  console.error("Missing required GitHub Actions secret: VK_TOKEN");
  process.exit(1);
}

const params = new URLSearchParams({
  access_token: token,
  v: "5.199",
  peer_id: "2000000289",
  random_id: String(randomInt(1, 2_147_483_647)),
  message: "Я тебя люблю",
});

const response = await fetch("https://api.vk.com/method/messages.send", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: params,
});

if (!response.ok) {
  console.error(`VK HTTP error: ${response.status}`);
  process.exit(1);
}

const result = await response.json();
if (result.error) {
  console.error(`VK API error ${result.error.error_code}: ${result.error.error_msg}`);
  process.exit(1);
}

console.log(`VK message sent successfully. Message ID: ${result.response}`);
