chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  if (msg.type === "GET_PAGE_INFO") {
    sendResponse({
      url: location.href,
      title: document.title,
      bodyText: document.body.innerText.slice(0, 3000)
    });
  }

  if (msg.type === "CLICK") {
    document.querySelector(msg.selector)?.click();
  }

  if (msg.type === "INPUT") {
    const el = document.querySelector(msg.selector);
    if (el) el.value = msg.value;
  }

  if (msg.type === "EXTRACT") {
    const el = document.querySelector(msg.selector);
    sendResponse(el?.innerText || "");
  }

  return true;
});