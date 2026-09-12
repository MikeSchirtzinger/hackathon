(() => {
  if (window.__zoomVoiceCaptions) return;
  window.__zoomVoiceCaptions = true;
  let previous = '', timer;
  function scan() {
    // Zoom changes these selectors. Never scrape the entire meeting DOM.
    const selectors = ['.closed-caption-container', '.closed-caption-window', '.live-transcription-subtitle', '.transcript-list', '[class*="transcript-list"]', '[class*="caption-message"]'];
    const nodes = [...new Set(selectors.flatMap(s => [...document.querySelectorAll(s)]))];
    const text = nodes.map(n => n.innerText?.trim()).filter(Boolean).join('\n').slice(-20000);
    if (text === previous) return;
    previous = text;
    chrome.runtime.sendMessage({type:'zoom-captions', text, title:document.title}).catch(()=>{});
  }
  new MutationObserver(() => {clearTimeout(timer);timer=setTimeout(scan,350);}).observe(document.body,{subtree:true,childList:true,characterData:true});
  scan();
})();
