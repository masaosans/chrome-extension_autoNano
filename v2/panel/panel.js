const logArea = document.getElementById("logArea");
const statusDiv = document.getElementById("status");
const memoryList = document.getElementById("memoryList");
const copyBtn = document.getElementById("copyLogs");

//ログコピー
copyBtn.onclick = async () => {
  await navigator.clipboard.writeText(logArea.textContent);

  copyBtn.classList.add("copied");

  setTimeout(() => {
    copyBtn.classList.remove("copied");
  }, 1000);
};

//スタートボタン
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
    // ★ 追加
    icon.title = m.content;

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

    icon.onmouseenter = (e) => {
      const tooltip = document.createElement("div");
      tooltip.className = "memory-tooltip";
      tooltip.textContent = m.content;

      document.body.appendChild(tooltip);

      const rect = icon.getBoundingClientRect();
      tooltip.style.top = rect.bottom + 5 + "px";
      tooltip.style.left = rect.left + "px";

      icon._tooltip = tooltip;
    };

    icon.onmouseleave = () => {
      if (icon._tooltip) {
        icon._tooltip.remove();
        icon._tooltip = null;
      }
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