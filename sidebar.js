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
    const log = document.getElementById("log");
    log.textContent += msg.data + "\n";
    log.scrollTop = log.scrollHeight;
  }
});