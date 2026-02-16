// utils.js
// DOM安定待機処理（SPA対策）

export async function waitForDomStable(tabId, log) {

  log("DOM: 安定待機開始");

  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => new Promise(resolve => {

      let timer;

      const obs = new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          obs.disconnect();
          resolve(true);
        }, 500);
      });

      obs.observe(document.body, { childList: true, subtree: true });

      setTimeout(() => {
        obs.disconnect();
        resolve(true);
      }, 3000);
    })
  });

  log("DOM: 安定確認完了");
}