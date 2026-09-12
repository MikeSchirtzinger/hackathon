chrome.action.onClicked.addListener(async (tab) => {
  if (tab.url && /^https:\/\/([\w-]+\.)?zoom\.us\//.test(tab.url)) {
    await chrome.storage.session.set({zoomSourceTab:tab.id});
  }
  chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.type !== 'capture-zoom') return;
  (async () => {
    const {zoomSourceTab} = await chrome.storage.session.get('zoomSourceTab');
    if (!zoomSourceTab) throw Error('Click the extension icon on your Zoom meeting tab first.');
    const consumer = sender.tab?.id ?? message.consumerTabId;
    if (!Number.isInteger(consumer)) throw Error('Open this panel as an extension tab.');
    const streamId = await chrome.tabCapture.getMediaStreamId({targetTabId:zoomSourceTab,consumerTabId:consumer});
    respond({streamId});
  })().catch(error=>respond({error:error.message}));
  return true;
});
