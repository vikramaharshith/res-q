
const fs = require("fs");

const env = fs.readFileSync(".env.local", "utf8");

for (const line of env.split(/\r?\n/)) {
  const match = line.match(/^([^#=\s]+)=(.*)$/);
  if (match) process.env[match[1]] = match[2].trim();
}

// Fictional disaster data, not real emergencies.
function get_incident_context({ incident_id }) {
  console.log("TOOL EXECUTED: get_incident_context");

  return {
    incident_id,
    simulation: true,
    situation: "Flooding in a fictional apartment building",
    people_reported: 4,
    water_level: "Rising",
    location: "Demo City, Zone 7",
    available_responder: "RESCUE-01"
  };
}

async function callNemotron(messages, tools, toolChoice) {
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
        messages,
        tools,
        tool_choice: toolChoice,
        max_tokens: 2048,
        temperature: 0.2,
        chat_template_kwargs: {
          enable_thinking: false
        },
        stream: false
      })
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status}: ${data.error?.message || "API error"}`
    );
  }

  return data.choices?.[0]?.message;
}

async function main() {
  const tools = [{
    type: "function",
    function: {
      name: "get_incident_context",
      description: "Retrieve details of a fictional emergency incident.",
      parameters: {
        type: "object",
        properties: {
          incident_id: { type: "string" }
        },
        required: ["incident_id"]
      }
    }
  }];

  const messages = [
    {
      role: "system",
      content: "You are RES-Q by B7, a simulated disaster response assistant. Use the supplied tool to retrieve incident facts. Provide advisory recommendations only. Human approval is required for all assignments."
    },
    {
      role: "user",
      content: "Investigate fictional incident INC-007 using the available tool. Then summarize the situation and suggest the next step."
    }
  ];

  console.log("STEP 1: Asking Nemotron to call a tool...");

  const first = await callNemotron(messages, tools, "required");
  const calls = first?.tool_calls || [];

  if (!calls.length) {
    console.log("FAIL: No tool call received.");
    console.log("Finish reason/content:", first);
    return;
  }

  console.log("Tool requested:", calls[0].function.name);
  messages.push(first);

  for (const call of calls) {
    if (call.function.name !== "get_incident_context") {
      throw new Error("Unexpected tool requested");
    }

    const args = JSON.parse(call.function.arguments);
    if (args.incident_id !== "INC-007") {
      throw new Error("Unexpected incident ID");
    }

    const result = get_incident_context(args);

    messages.push({
      role: "tool",
      tool_call_id: call.id,
      content: JSON.stringify(result)
    });
  }

  console.log("STEP 2: Returning tool results to Nemotron...");

  const second = await callNemotron(messages, tools, "none");

  console.log("\nFINAL NEMOTRON RESPONSE:");
  console.log(second?.content || "(No text returned)");
  console.log("\nTool round trip completed.");
}

main().catch(error => {
  console.error("TEST FAILED:", error.message);
});
