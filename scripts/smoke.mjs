// Smoke test: connect to the local server WS, create a session, send a prompt,
// stream the agent reply, exit when prompt_done arrives.
// Uses Node 22's built-in WebSocket — no extra deps.

const ws = new WebSocket("ws://127.0.0.1:4000/ws");

let sessionId = null;
let buffer = "";

ws.addEventListener("open", () => {
  console.log("[ws] open");
  ws.send(JSON.stringify({ type: "create_session", cwd: "/root/agents" }));
});

ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(typeof ev.data === "string" ? ev.data : ev.data.toString("utf8"));
  if (msg.type === "session_created") {
    sessionId = msg.sessionId;
    console.log("[session] created", sessionId, "cwd=", msg.cwd);
    ws.send(JSON.stringify({
      type: "prompt",
      sessionId,
      text: "Reply with the single word 'pong'. No punctuation, no extra text.",
    }));
  } else if (msg.type === "session_update") {
    const u = msg.update;
    if (u.sessionUpdate === "agent_message_chunk" && u.content?.type === "text") {
      buffer += u.content.text;
      process.stdout.write(u.content.text);
    } else {
      console.log("\n[update]", u.sessionUpdate, JSON.stringify(u).slice(0, 200));
    }
  } else if (msg.type === "prompt_done") {
    console.log("\n[done] stopReason=", msg.stopReason);
    console.log("[full agent reply]:", JSON.stringify(buffer));
    ws.close();
    process.exit(0);
  } else if (msg.type === "error") {
    console.error("\n[error]", msg.message);
    ws.close();
    process.exit(1);
  } else {
    console.log("[other]", msg);
  }
});

ws.addEventListener("close", () => console.log("[ws] close"));
ws.addEventListener("error", (e) => { console.error("[ws] error", e); process.exit(1); });

setTimeout(() => { console.error("[timeout] no prompt_done in 120s"); process.exit(2); }, 120_000);
