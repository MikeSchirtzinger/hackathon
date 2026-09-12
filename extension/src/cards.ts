export type CardKind = 'quiet' | 'digest' | 'queue' | 'interrupt' | 'agent' | 'tracked';
export const chipLabels: Record<CardKind,string> = { quiet: 'Quiet status', digest: 'Return digest', queue: 'Review queue', interrupt: 'Interrupt', agent: 'Agent speech', tracked: 'Tracked' };
export function card(kind: CardKind, title: string, body: string, meta?: string) {
  const node = document.createElement('article'); node.className = 'spark-card'; node.dataset.kind = kind;
  const heading = document.createElement('h3'), dot = document.createElement('span'); dot.className = 'spark-dot'; dot.setAttribute('aria-hidden','true'); heading.append(dot, document.createTextNode(title)); node.append(heading);
  if (body) { const p = document.createElement('p'); p.textContent = body; node.append(p); }
  if (meta) { const p = document.createElement('p'); p.className = 'spark-meta'; p.textContent = meta; node.append(p); }
  const chip = document.createElement('span'); chip.className = 'spark-chip'; chip.textContent = chipLabels[kind]; node.append(chip);
  return node;
}
