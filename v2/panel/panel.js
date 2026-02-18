const logArea = document.getElementById("logArea");
const statusDiv = document.getElementById("status");
const memoryList = document.getElementById("memoryList");

document.getElementById("startBtn").onclick = async () => {
  await chrome.runtime.sendMessage({
    type: "START_AGENT",
    userInput: document.getElementById("userInput").value
  });
};


chrome.runtime.onMessage.addListener((msg) => {
  //ステータス変更時
  if (msg.type === "AGENT_STATUS") {
      statusDiv.textContent = msg.status;
  }

  //ログ取得時
  if (msg.type === "AGENT_LOG") {
    const line = `[${msg.payload.level}] ${msg.payload.message}\n`;
    logArea.textContent += line;
    logArea.scrollTop = logArea.scrollHeight;
  }
});

// 追加：storage変更監視
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.agentMemory) {
    renderMemory();
  }
});

async function renderMemory() {
  const { agentMemory = [] } = await chrome.storage.local.get("agentMemory");

  memoryList.innerHTML = "";

  agentMemory.forEach(m => {
    const div = document.createElement("div");
    div.className = "memory-item";

    const icon = document.createElement("span");
    icon.textContent = "📄 " + m.title;

    const download = document.createElement("button");
    download.textContent = "Download";
    download.onclick = () => {
      const blob = new Blob([m.content], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${m.title}.txt`;
      a.click();
    };

    const del = document.createElement("button");
    del.textContent = "Delete";
    del.onclick = async () => {
      await chrome.runtime.sendMessage({
        type: "DELETE_MEMORY",
        id: m.id
      });
    };

    div.appendChild(icon);
    div.appendChild(download);
    div.appendChild(del);

    memoryList.appendChild(div);
  });
}

//停止指示ボタン
document.getElementById("stopBtn").onclick = async () => {
  await chrome.runtime.sendMessage({
    type: "STOP_AGENT"
  });
};

renderMemory();