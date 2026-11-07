
const fs = require("fs");

const env = fs.readFileSync(".env.local", "utf8");

for (const line of env.split(/\r?\n/)) {
  const match = line.match(/^([^#=\s]+)=(.*)$/);
  if (match) process.env[match[1]] = match[2].trim();
}

async function main() {
  const response = await fetch(
    `${process.env.NVIDIA_BASE_URL}/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.NVIDIA_MODEL_ID,
        messages: [
          {
            role: "user",
            content: "Reply with exactly: RES-Q by B7 is connected."
          }
        ],
        max_tokens: 1024,
temperature: 0.2,
stream: false,
chat_template_kwargs: {
  enable_thinking: false
}
      })
    }
  );

  const data = await response.json();

  if (!response.ok) {
    console.log("API request failed.");
    console.log("HTTP status:", response.status);
    console.log("Error:", data.error?.message || "Unknown error");
    return;
  }

  console.log("MODEL:", data.model);
  console.log("RESPONSE:", data.choices?.[0]?.message?.content);
}

main().catch(error => {
  console.error("Connection error:", error.message);
});
