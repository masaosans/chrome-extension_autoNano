const statusEl = document.getElementById("status");
const logEl = document.getElementById("log");

document.getElementById("run").onclick = async () => {
  const prompt = document.getElementById("prompt").value.trim();
  if (!prompt) return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  chrome.runtime.sendMessage({
    type: "START_AGENT",
    tabId: tab.id,
    prompt
  });
};

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "LOG") {
    logEl.textContent += msg.data + "\n";
    logEl.scrollTop = logEl.scrollHeight;
  }

  if (msg.type === "AI_STATUS") {
    statusEl.textContent = "AI状態: " + msg.data;
  }
});