//画面描画が完了したかどうかを判断するJS
function waitForStableDOM(timeout = 5000, idle = 800) {
  return new Promise(resolve => {
    let idleTimer = null;
    let timeoutTimer = null;

    const observer = new MutationObserver(() => {
      if (idleTimer) clearTimeout(idleTimer);

      idleTimer = setTimeout(() => {
        observer.disconnect();
        resolve(true);
      }, idle);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true
    });

    // 念のため最大待機時間
    timeoutTimer = setTimeout(() => {
      observer.disconnect();
      resolve(false);
    }, timeout);
  });
}

(async () => {
  await waitForStableDOM();
  chrome.runtime.sendMessage({ type: "DOM_STABLE" });
})();