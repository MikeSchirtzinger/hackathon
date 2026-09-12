import { base, type ContextSnapshot } from './types';
import { writeBatch } from './db';
export async function captureContext(tab: chrome.tabs.Tab, source: ContextSnapshot['source']): Promise<ContextSnapshot> {
  const context: ContextSnapshot = { ...base(), capturedAt: Date.now(), tabId: tab.id, url: tab.url ?? '', title: tab.title ?? 'Untitled page', selection: '', visibleText: '', source, trust: 'untrusted-page', availability: 'unavailable' };
  if (tab.id && /^https?:/.test(context.url)) {
    try {
      const result = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => ({
        url: location.href, title: document.title,
        selection: (window.getSelection()?.toString() ?? '').slice(0, 12000),
        visibleText: (document.body?.innerText ?? '').slice(0, 24000), capturedAt: Date.now()
      }) });
      const snapshot = result[0]?.result;
      if (!snapshot) throw new Error('No page content returned.');
      if (snapshot.url !== context.url) throw new Error('The page navigated before its content could be captured.');
      Object.assign(context, snapshot, { availability: 'available' });
    } catch { context.reason = 'Page content could not be accessed. Use the capture hotkey on a permitted page.'; }
  } else { context.availability = 'restricted'; context.reason = 'Chrome does not allow access to this page.'; }
  await writeBatch([{ store: 'contexts', value: context }, { store: 'settings', value: { id: 'currentContext', value: context.id } }]);
  return context;
}
