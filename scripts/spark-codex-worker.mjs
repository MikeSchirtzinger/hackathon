import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { reasoningPrompt, resultSchema, validateResult } from './spark-agent-schema.mjs';

export async function runCodex(job, { signal, model = 'gpt-6-astra', timeoutMs = 120000, executable = 'codex' } = {}) {
  if (signal?.aborted) throw new Error('Reasoning was cancelled before the agent started.');
  const directory = await mkdtemp(path.join(tmpdir(), 'spark-reasoning-'));
  const schemaPath = path.join(directory, 'result.schema.json');
  const outputPath = path.join(directory, 'result.json');
  await writeFile(schemaPath, JSON.stringify(resultSchema), { mode: 0o600 });
  const disabled = ['shell_tool', 'unified_exec', 'apps', 'browser_use', 'browser_use_external', 'browser_use_full_cdp_access', 'computer_use', 'plugins', 'hooks', 'multi_agent', 'view_image', 'image_generation', 'skill_search', 'skill_mcp_dependency_install', 'code_mode', 'code_mode_host', 'in_app_browser', 'in_app_local_automation', 'memories', 'remote_plugin', 'multi_agent_v2', 'workspace_dependencies'];
  const args = ['exec', '--ignore-user-config', '--ephemeral', '--sandbox', 'read-only', '--skip-git-repo-check', '-C', directory, '--model', model, '--json', '--output-schema', schemaPath, '--output-last-message', outputPath,
    '-c', 'approval_policy="never"', '-c', 'web_search="disabled"', '-c', 'project_doc_max_bytes=0', '--enable', 'skip_host_skill_discovery', ...disabled.flatMap(name => ['--disable', name]), '-'];
  const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => /^(PATH|HOME|USER|LOGNAME|SHELL|LANG|LC_.+|TMPDIR|TERM|COLORTERM|CODEX_HOME|HTTPS?_PROXY|NO_PROXY|NODE_EXTRA_CA_CERTS)$/.test(name)));
  const startedAt = Date.now();
  let toolActivity = 0, diagnosticItems = 0, outputBytes = 0, pendingLine = '', stopReason, turnFailed = false, turnCompleted = false;
  let timer, killTimer, child;
  const eventTypes = new Set();
  const signalGroup = name => {
    if (!child?.pid) return;
    try { if (process.platform === 'win32') child.kill(name); else process.kill(-child.pid, name); } catch (error) { if (error.code !== 'ESRCH') child.kill(name); }
  };
  const stop = reason => {
    if (stopReason) return;
    stopReason = reason;
    signalGroup('SIGTERM');
    killTimer = setTimeout(() => signalGroup('SIGKILL'), 2000);
    killTimer.unref();
  };
  const cancel = () => stop('Reasoning was cancelled. No result was accepted.');
  try {
    const exitCode = await new Promise((resolve, reject) => {
      child = spawn(executable, args, { cwd: directory, env: environment, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
      child.once('error', reject);
      child.once('close', code => { inspect(pendingLine); resolve(code); });
      const inspect = line => {
        if (!line.trim()) return;
        let event;
        try { event = JSON.parse(line); } catch { stop('The agent returned malformed event output.'); return; }
        if (!event || typeof event !== 'object' || Array.isArray(event) || !['thread.started', 'turn.started', 'turn.completed', 'turn.failed', 'item.started', 'item.updated', 'item.completed', 'error'].includes(event.type)) { stop('The agent returned an invalid event.'); return; }
        if (event.type.startsWith('item.') && (!event.item || typeof event.item.type !== 'string')) { stop('The agent returned an invalid item event.'); return; }
        eventTypes.add(event.type);
        if (event.type === 'turn.failed' || event.type === 'error') turnFailed = true;
        if (event.type === 'turn.completed') turnCompleted = true;
        const type = event.item?.type;
        if (type === 'error') diagnosticItems++;
        if (type && !['agent_message', 'reasoning', 'error'].includes(type)) {
          toolActivity += 1;
          stop(`Unexpected agent event type ${/^[a-z_]{1,60}$/.test(type) ? type : 'unknown'}. The result was rejected.`);
        }
      };
      child.stdout.on('data', chunk => {
        outputBytes += chunk.length;
        if (outputBytes > 2_000_000) { stop('Agent output exceeded the allowed size.'); return; }
        pendingLine += chunk.toString('utf8');
        const lines = pendingLine.split('\n'); pendingLine = lines.pop();
        for (const line of lines) inspect(line);
      });
      // Do not retain stderr, prompts, reasoning events, credentials, or authentication diagnostics.
      child.stderr.on('data', chunk => { outputBytes += chunk.length; if (outputBytes > 2_000_000) stop('Agent output exceeded the allowed size.'); });
      child.stdin.on('error', () => {});
      timer = setTimeout(() => stop('The reasoning request timed out. No automatic retry was sent.'), timeoutMs);
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) cancel();
      else child.stdin.end(reasoningPrompt(job));
    });
    if (stopReason || signal?.aborted) throw new Error(stopReason ?? 'Reasoning was cancelled.');
    if (turnFailed || !turnCompleted) throw new Error('Codex did not complete its reasoning turn. No result was accepted.');
    if (exitCode !== 0) throw new Error(`Codex exited with code ${exitCode ?? 'unknown'}. Check its login and model availability in your terminal.`);
    if ((await stat(outputPath)).size > 65536) throw new Error('The agent result exceeded the allowed size.');
    let result;
    try { result = validateResult(JSON.parse(await readFile(outputPath, 'utf8')), job.evidenceIds); }
    catch { throw new Error('The agent result violated the reasoning contract. No result was accepted.'); }
    return { result, receipt: { provider: 'codex', model, processing: 'hosted', elapsedMs: Date.now() - startedAt, toolActivity, diagnosticItems, eventTypes: [...eventTypes] } };
  } finally {
    clearTimeout(timer); clearTimeout(killTimer); signal?.removeEventListener('abort', cancel);
    await rm(directory, { recursive: true, force: true });
  }
}
