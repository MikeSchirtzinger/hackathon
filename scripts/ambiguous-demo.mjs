import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { parseEnv } from 'node:util';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const localEnv = path.join(root, '.agents/.env');
const shared = parseEnv(await readFile(path.join(homedir(), 'ADA/.agents/.env'), 'utf8'));
const config = JSON.parse(await readFile(path.join(root, '.agents/demo-agents.json'), 'utf8'));
if (!shared.AMBIGUOUS_API_KEY) throw new Error('Missing Ambiguous key in the shared .agents environment.');
if (shared.AMBIGUOUS_BASE_URL && shared.AMBIGUOUS_BASE_URL.replace(/\/$/, '') !== 'https://app.ambiguous.ai') throw new Error('Unexpected Ambiguous origin.');
await mkdir(path.join(root, '.evidence/ambiguous'), { recursive: true });

async function api(route, method = 'GET', body, token = shared.AMBIGUOUS_API_KEY) {
  const response = await fetch(`https://app.ambiguous.ai/api${route}`, {
    method, redirect: 'error', signal: AbortSignal.timeout(30000),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'API-Version': '1' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const failure = await response.json().catch(() => ({}));
    const detail = typeof failure.error === 'string' ? failure.error : failure.error?.message ?? failure.message ?? '';
    const safeDetail = String(detail).replace(/ak_[A-Za-z0-9_-]+/g, '[redacted]');
    throw new Error(`${method} ${route}: HTTP ${response.status} ${safeDetail}. Inspect remote state before retrying writes.`);
  }
  const result = response.status === 204 ? {} : await response.json();
  if (result.success === false) throw new Error(`${method} ${route}: service reported failure (status ${result.status ?? 'unknown'}).`);
  return result;
}

async function agentSecrets() {
  try { return parseEnv(await readFile(localEnv, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
}

async function saveSecret(name, value) {
  if (typeof value !== 'string' || !value) throw new Error('Agent provisioning did not return a key.');
  const current = await agentSecrets();
  current[name] = value;
  await writeFile(localEnv, Object.entries(current).map(([key, val]) => `${key}=${JSON.stringify(val)}`).join('\n') + '\n', { mode: 0o600 });
  await chmod(localEnv, 0o600);
}

function rows(result) {
  if (result.has_more === true || result.next_cursor) throw new Error('Incomplete collection lookup. Inspect remote state before repeating setup writes.');
  if (Array.isArray(result)) return result;
  if (Array.isArray(result.data)) return result.data;
  if (Array.isArray(result.data?.playbooks)) return result.data.playbooks;
  if (Array.isArray(result.playbooks)) return result.playbooks;
  throw new Error('Unexpected collection response. Inspect remote state before repeating setup writes.');
}

const command = process.argv[2] ?? 'inspect';
const me = await api('/users/me');
const users = rows(await api('/users?limit=100'));
if (command === 'inspect') {
  console.log(JSON.stringify({ identity: { id: me.id, type: me.type }, agents: users.filter(item => item.type === 'agent').map(({ id, username, display_name }) => ({ id, username, display_name })), managedCoworkersAvailable: me.can_provision_coworkers === true }, null, 2));
} else if (command === 'setup') {
  const receipt = { configuredAt: new Date().toISOString(), workspace: config.workspace, managerId: me.id, managedCoworkersAvailable: me.can_provision_coworkers === true, agents: [] };
  for (const role of config.agents) {
    let agent = users.find(item => item.type === 'agent' && item.display_name === role.displayName);
    if (!agent) {
      const created = await api('/admin/users/provision-agent', 'POST', { display_name: role.displayName, username: `recall-${role.slug}`, role: 'member', manager_user_id: me.id });
      if (created.api_key) await saveSecret(role.keyVariable, created.api_key);
      agent = created.user;
      if (!agent?.id) throw new Error('Provisioned agent identifier is missing. Inspect before retry.');
      console.log(JSON.stringify({ provisioned: role.displayName, userId: agent.id }));
    }
    await api(`/agents/${agent.id}/subscriptions`, 'PUT', { mentions: false, dms: false, tasks_assigned: false, docs_shared: false, emails: false, thread_replies: false, watched_channel_ids: [], keywords: [] });
    let keys = await agentSecrets();
    if (!keys[role.keyVariable]) {
      const created = await api(`/agents/${agent.id}/api-keys`, 'POST', { name: `hackathon-${role.slug}` });
      await saveSecret(role.keyVariable, created.raw_key);
      keys = await agentSecrets();
    }
    const key = keys[role.keyVariable];
    const identity = await api('/users/me', 'GET', undefined, key);
    if (identity.type !== 'agent' || identity.id !== agent.id) throw new Error('Agent key identity does not match its configured account.');
    const ownDocuments = rows(await api('/documents?limit=200', 'GET', undefined, key));
    const title = `${role.displayName}: operating brief`;
    let brief = ownDocuments.find(item => item.title === title);
    if (!brief) brief = await api('/documents', 'POST', { type: 'doc', title, content: `# ${role.displayName}\n\n${role.persona}\n\n## ${role.playbook.title}\n\n${role.playbook.instructions}\n\nMeeting source document: ${config.meetingDocumentId}\n\nRuntime: externally invoked API identity. Managed coworker runtime is unavailable for this account.\n\nConfiguration marker: hackathon-agent-${role.slug}`, visibility: 'restricted' }, key);
    await api(`/documents/${brief.id}/permissions`, 'POST', { user_id: me.id, role: 'viewer' }, key);
    await api(`/documents/${config.meetingDocumentId}/permissions`, 'POST', { user_id: agent.id, role: 'viewer' });
    const document = await api(`/documents/${config.meetingDocumentId}`, 'GET', undefined, key);
    const briefReadback = await api(`/documents/${brief.id}`, 'GET', undefined, key);
    if (document.id !== config.meetingDocumentId || !briefReadback.content?.includes(`hackathon-agent-${role.slug}`)) throw new Error('Agent document readback mismatch.');
    const entry = { slug: role.slug, displayName: role.displayName, userId: agent.id, operatingBriefId: brief.id, identityVerified: true, meetingDocumentReadable: true, managedRuntimeAvailable: false };
    receipt.agents.push(entry);
    await writeFile(path.join(root, '.agents/demo-state.json'), JSON.stringify(receipt, null, 2) + '\n');
    console.log(JSON.stringify(entry));
  }
  await writeFile(path.join(root, '.evidence/ambiguous/agent-setup.json'), JSON.stringify(receipt, null, 2) + '\n');
} else {
  throw new Error('Usage: node scripts/ambiguous-demo.mjs inspect|setup');
}
