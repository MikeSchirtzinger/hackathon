import { all, get, put } from './db';
import type { ContextSnapshot, Meeting } from './types';
import type { SurfaceAuthorization, SurfaceCard, SurfaceLease } from './surface-types';
const authKey = (id: number) => `surface-auth:${id}`;
const leaseKey = (nonce: string) => `surface-lease:${nonce}`;
const presentations = new Map<string, Promise<boolean>>();
const waiters = new Map<string, (shown: boolean) => void>();
async function stored<T>(key: string): Promise<T | undefined> { return (await chrome.storage.session.get(key))[key] as T | undefined; }
async function currentDocument(tabId: number) {
  const [result] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, func: () => location.href });
  return result;
}
export async function authorizeSurface(tab: chrome.tabs.Tab) {
  if (typeof tab.id !== 'number' || !tab.url || !/^https?:/.test(tab.url)) return;
  try {
    const result = await currentDocument(tab.id);
    if (!result.documentId || result.result !== tab.url) return;
    await chrome.storage.session.set({ [authKey(tab.id)]: { tabId: tab.id, documentId: result.documentId, url: tab.url } satisfies SurfaceAuthorization });
  } catch { /* Restricted pages retain capture status and native reminder delivery. */ }
}
async function matchesDocument(auth: SurfaceAuthorization, active = false) {
  try {
    const tab = await chrome.tabs.get(auth.tabId);
    if (active && (!tab.active || !(await chrome.windows.get(tab.windowId)).focused)) return false;
    const result = await currentDocument(auth.tabId);
    return result.documentId === auth.documentId && result.result === auth.url;
  } catch { return false; }
}
// This function is serialized by Chrome into the ISOLATED world. It never communicates with page JS.
function mountFrame(nonce: string, url: string, listening: boolean, expiresAt: number) {
  type Mount = { node: HTMLElement; timer: number; nonce: string };
  const scope = globalThis as unknown as { sparkMounts?: Record<string, Mount> };
  scope.sparkMounts ??= {};
  const slot = listening ? 'listening' : 'card';
  const previous = scope.sparkMounts[slot];
  if (previous) { clearTimeout(previous.timer); previous.node.remove(); }
  const host = document.createElement('div'); host.dataset.sparkSurface = slot;
  const style = (node: HTMLElement, values: Record<string,string>) => { for (const [key,value] of Object.entries(values)) node.style.setProperty(key,value,'important'); };
  style(host,{all:'initial',position:'fixed',display:'block','z-index':'2147483647',width:listening?'244px':'min(380px, calc(100vw - 32px))',height:listening?'38px':'238px',...(listening?{left:'24px',bottom:'24px'}:{right:'28px',top:'28px'}),'pointer-events':'none',visibility:'visible',opacity:'1',transform:'none'});
  const shadow = host.attachShadow({mode:'closed'}), frame = document.createElement('iframe');
  frame.src = `${url}#${nonce}`; frame.title = listening ? 'Spark listening status' : 'Spark saved context and reminder card';
  frame.tabIndex = -1; frame.referrerPolicy = 'no-referrer';
  style(frame,{all:'initial',display:'block',width:'100%',height:'100%',border:'0','color-scheme':'dark','pointer-events':listening?'none':'auto'});
  shadow.append(frame); document.documentElement.append(host);
  const timer = window.setTimeout(() => { host.remove(); if(scope.sparkMounts?.[slot]?.node === host) delete scope.sparkMounts[slot]; },Math.max(0,expiresAt-Date.now())+500);
  scope.sparkMounts[slot] = { node:host,timer,nonce };
  return { visible: host.getBoundingClientRect().width > 0 && getComputedStyle(host).visibility === 'visible' && document.visibilityState === 'visible' };
}
async function removeLease(lease: SurfaceLease) {
  waiters.get(lease.nonce)?.(false); waiters.delete(lease.nonce);
  await chrome.storage.session.remove(leaseKey(lease.nonce));
  try { await chrome.scripting.executeScript({ target: { tabId: lease.tabId, documentIds: [lease.documentId] }, func: (nonce: string) => {
    const scope = globalThis as unknown as { sparkMounts?: Record<string,{node:HTMLElement;timer:number;nonce:string}> };
    for (const [slot,mount] of Object.entries(scope.sparkMounts ?? {})) if (mount.nonce === nonce) { clearTimeout(mount.timer); mount.node.remove(); delete scope.sparkMounts![slot]; }
  }, args:[lease.nonce] }); } catch { /* Navigation already removed this surface. */ }
}
function present(auth: SurfaceAuthorization, payload: SurfaceCard, link: {meetingId?: string;signalId?: string} = {}): Promise<boolean> {
  const key = `${auth.tabId}:${payload.listening ? 'listening' : 'card'}`;
  const previous = presentations.get(key) ?? Promise.resolve(false);
  const current = previous.catch(() => false).then(() => presentNext(auth, payload, link));
  presentations.set(key, current);
  void current.finally(() => { if (presentations.get(key) === current) presentations.delete(key); }).catch(() => undefined);
  return current;
}
async function presentNext(auth: SurfaceAuthorization, payload: SurfaceCard, link: {meetingId?: string;signalId?: string}): Promise<boolean> {
  if (!await matchesDocument(auth,true)) return false;
  const sameSlot = (await leases()).filter(lease => lease.tabId === auth.tabId && !!lease.payload.listening === !!payload.listening);
  if (payload.kind === 'quiet' && sameSlot.some(lease => lease.payload.kind === 'interrupt' && lease.payload.expiresAt > Date.now())) return false;
  for (const lease of sameSlot) await removeLease(lease);
  const lease: SurfaceLease = {...auth,nonce:crypto.randomUUID(),payload,...link};
  await chrome.storage.session.set({[leaseKey(lease.nonce)]:lease});
  let finish!: (value: boolean) => void;
  const shown = new Promise<boolean>(resolve => { finish = resolve; }); waiters.set(lease.nonce,finish);
  const timeout = setTimeout(() => { waiters.delete(lease.nonce); finish(false); },1800);
  try {
    const [result] = await chrome.scripting.executeScript({target:{tabId:auth.tabId,documentIds:[auth.documentId]},func:mountFrame,args:[lease.nonce,chrome.runtime.getURL('surface.html'),!!payload.listening,payload.expiresAt]});
    if (!result.result?.visible) { await removeLease(lease); return false; }
    const received = await shown;
    if (!received) await removeLease(lease);
    return received;
  } catch { await removeLease(lease); return false; }
  finally { clearTimeout(timeout); waiters.delete(lease.nonce); }
}
async function activeAuthorization() {
  const [tab] = await chrome.tabs.query({active:true,lastFocusedWindow:true});
  return typeof tab?.id === 'number' ? stored<SurfaceAuthorization>(authKey(tab.id)) : undefined;
}
export async function acknowledgeCapture(context: ContextSnapshot, note = false) {
  if (typeof context.tabId !== 'number') return false;
  const auth = await stored<SurfaceAuthorization>(authKey(context.tabId));
  if (!auth || context.url !== auth.url) return false;
  return present(auth,{kind:'quiet',title:note?'Note saved':'Context saved',body:note?'Your note is linked to this page.':'Page context captured. Pick it up when you return.',meta:`${new URL(context.url).hostname} · ${context.availability === 'available' ? 'page text captured' : 'page text unavailable'} · saved locally`,actions:[],expiresAt:Date.now()+3400});
}
export async function presentReminder(meeting: Meeting, signalId: string): Promise<boolean> {
  const auth = await activeAuthorization();
  if (!auth) return false;
  // Never project a private cross-site title, URL, note or record ID into a page surface.
  return present(auth,{kind:'interrupt',title:'Your meeting starts soon',body:'Your saved reminder is due. Join now or review it in Spark.',meta:'Saved deadline · one interruption',actions:['join','review'],expiresAt:Date.now()+30000},{meetingId:meeting.id,signalId});
}
async function leases(): Promise<SurfaceLease[]> { return Object.entries(await chrome.storage.session.get(null)).filter(([key])=>key.startsWith('surface-lease:')).map(([,value])=>value as SurfaceLease); }
export async function listeningNow() {
  const owners = await chrome.runtime.getContexts({contextTypes:['TAB']});
  return (await all('audioSessions')).some(s=>s.source!=='sample'&&s.captureStatus==='listening'&&s.inputActive===true&&owners.some(o=>o.tabId===s.tabId&&o.documentId===s.ownerDocumentId&&o.documentUrl?.split(/[?#]/)[0]===chrome.runtime.getURL('index.html')));
}
export async function refreshListeningSurface() {
  const live = await listeningNow(), auth = await activeAuthorization();
  for (const lease of await leases()) if (lease.payload.listening && (!live || lease.tabId !== auth?.tabId || lease.documentId !== auth.documentId)) await removeLease(lease);
  if (!live || !auth || (await leases()).some(l=>l.payload.listening&&l.tabId===auth.tabId&&l.payload.expiresAt>Date.now())) return;
  await present(auth,{kind:'quiet',title:'',body:'',actions:[],listening:true,expiresAt:Date.now()+3600000});
}
export async function revokeTabSurfaces(tabId: number) {
  await chrome.storage.session.remove(authKey(tabId));
  for (const lease of await leases()) if (lease.tabId===tabId) await removeLease(lease);
}
export async function surfaceMessage(message: Record<string,unknown>, sender: chrome.runtime.MessageSender, action: (meetingId:string, action:'join'|'review')=>Promise<void>) {
  if (sender.id!==chrome.runtime.id || !sender.url || sender.url.split('#')[0]!==chrome.runtime.getURL('surface.html') || typeof sender.tab?.id!=='number' || !sender.documentId || !sender.frameId || typeof message.nonce!=='string' || sender.url.split('#')[1]!==message.nonce) throw new Error('Unrecognized page surface.');
  const lease = await stored<SurfaceLease>(leaseKey(message.nonce));
  if (!lease || lease.tabId!==sender.tab.id || lease.payload.expiresAt<=Date.now() || lease.frameDocumentId && lease.frameDocumentId!==sender.documentId || !await matchesDocument(lease,message.type!=='surface-dismiss'&&message.type!=='surface-poll')) throw new Error('Page surface expired or its owner changed.');
  if (message.type==='surface-ready') {
    if (!lease.frameDocumentId) await chrome.storage.session.set({[leaseKey(lease.nonce)]:{...lease,frameId:sender.frameId,frameDocumentId:sender.documentId}});
    return lease.payload;
  }
  if (lease.frameDocumentId!==sender.documentId || lease.frameId!==sender.frameId) throw new Error('Page surface does not own this action.');
  if (message.type==='surface-size' && typeof message.height==='number' && Number.isFinite(message.height)) {
    const height = Math.max(34,Math.min(300,Math.ceil(message.height)));
    await chrome.scripting.executeScript({target:{tabId:lease.tabId,documentIds:[lease.documentId]},func:(nonce:string,height:number)=>{
      const scope=globalThis as unknown as {sparkMounts?:Record<string,{node:HTMLElement;nonce:string}>};
      for(const mount of Object.values(scope.sparkMounts??{})) if(mount.nonce===nonce)mount.node.style.setProperty('height',`${height}px`,'important');
    },args:[lease.nonce,height]}); return true;
  }
  if (message.type==='surface-shown') {
    const finish = waiters.get(lease.nonce);
    if (!finish) throw new Error('Page surface delivery expired.');
    finish(true); waiters.delete(lease.nonce);
    await chrome.storage.session.set({[leaseKey(lease.nonce)]:{...lease,shown:true}}); return true;
  }
  if (message.type==='surface-dismiss') { await removeLease(lease); return true; }
  if (message.type==='surface-poll' && lease.payload.listening) return {listening:await listeningNow()};
  if (message.type==='surface-action' && lease.shown && lease.meetingId && lease.signalId && (message.action==='join'||message.action==='review') && lease.payload.actions.includes(message.action)) {
    const signal = await get('attention',lease.signalId), meeting = await get('meetings',lease.meetingId);
    if (!signal || signal.sourceId!==meeting?.id || signal.mode!=='interrupt' || meeting.status!=='scheduled') throw new Error('The saved reminder is no longer actionable.');
    await removeLease(lease);
    await action(meeting.id,message.action);
    await put('attention',{...signal,surfacedAt:Date.now(),revision:signal.revision+1});
    return true;
  }
  throw new Error('Unsupported page surface action.');
}
