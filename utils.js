// DOMが安定するまで待機する関数
export async function waitForDomStable(tabId) {
  return chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      return new Promise(resolve => {
        let timer;
        const observer = new MutationObserver(() => {
          clearTimeout(timer);
          timer = setTimeout(() => {
            observer.disconnect();
            resolve(true);
          }, 500);
        });

        observer.observe(document.body, {
          childList: true,
          subtree: true
        });

        setTimeout(() => {
          observer.disconnect();
          resolve(true);
        }, 3000);
      });
    }
  });
}

// リトライ処理を行う関数
export async function retryAction(tabId, action, executeFn) {
  for (let i = 0; i < 3; i++) {
    const result = await executeFn(tabId, action);

    if (!isFailure(result)) return result;

    await waitForDomStable(tabId);
  }
  return { error: true };
}

// 失敗を判定する関数
function isFailure(result) {
  if (!result) return true;
  if (result.error) return true;
  if (result[0]?.result === "not found") return true;
  return false;
}

// ループ検出を行う関数
export function detectLoop(memory) {
  const recent = memory.history.slice(-6);
  const signatures = recent.map(
    h => h.action.type + (h.action.selector || "")
  );
  return new Set(signatures).size <= 2;
}