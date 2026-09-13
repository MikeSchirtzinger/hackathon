// Bound each synchronous synthesis call and retain every word of a response.
export function speechChunks(text, limit = 240) {
  if (!Number.isInteger(limit) || limit < 32 || limit > 500) throw Error('Speech chunks require a limit between 32 and 500 characters.');
  const words = String(text).replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const chunks = [];
  let chunk = '';
  for (let word of words) {
    if (chunk.length + word.length + 1 > limit && chunk) { chunks.push(chunk); chunk = ''; }
    while (word.length > limit) { if (chunk) { chunks.push(chunk); chunk = ''; } chunks.push(word.slice(0, limit)); word = word.slice(limit); }
    chunk = chunk ? `${chunk} ${word}` : word;
    if (/[.!?]$/.test(chunk) && chunk.length >= limit / 2) { chunks.push(chunk); chunk = ''; }
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}
