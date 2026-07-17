// Dumb raw SSE tape recorder. NO JSON parsing — a schema bug must never corrupt the tape.
// Appends `${recvMs}\t${rawLine}\n` per SSE line; logs connects/disconnects/gaps to a .log file.
// Run: node --env-file=.env --env-file=.env.txline scripts/recorder.mjs <odds|scores> [outDir]
import { createWriteStream, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const stream = process.argv[2];
if (!['odds', 'scores'].includes(stream)) { console.error('usage: recorder.mjs <odds|scores> [outDir]'); process.exit(1); }
const outDir = process.argv[3] ?? fileURLToPath(new URL('../tapes', import.meta.url));
mkdirSync(outDir, { recursive: true });

const BASE = process.env.TXLINE_BASE ?? 'https://txline-dev.txodds.com/api';
const JWT = process.env.TXLINE_JWT;
const API_TOKEN = process.env.TXLINE_API_TOKEN;
if (!JWT || !API_TOKEN) { console.error('missing TXLINE_JWT / TXLINE_API_TOKEN'); process.exit(1); }

const day = new Date().toISOString().slice(0, 10);
const tape = createWriteStream(`${outDir}/${stream}-${day}.tape`, { flags: 'a' });
const log = createWriteStream(`${outDir}/${stream}-${day}.log`, { flags: 'a' });
const note = (m) => { const line = `${new Date().toISOString()} ${m}\n`; log.write(line); process.stderr.write(line); };

let lastByteAt = Date.now();
let attempt = 0;

async function run() {
  for (;;) {
    const backoff = Math.min(30000, 1000 * 2 ** Math.min(attempt, 5));
    try {
      note(`connecting attempt=${attempt}`);
      const res = await fetch(`${BASE}/${stream}/stream`, {
        headers: {
          authorization: `Bearer ${JWT}`,
          'x-api-token': API_TOKEN,
          accept: 'text/event-stream',
          'accept-encoding': 'deflate',
        },
      });
      if (!res.ok) { note(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`); throw new Error(`status ${res.status}`); }
      note(`connected status=${res.status}`);
      attempt = 0;
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) { note('stream ended by server'); break; }
        lastByteAt = Date.now();
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).replace(/\r$/, '');
          buf = buf.slice(nl + 1);
          tape.write(`${Date.now()}\t${line}\n`);
        }
      }
    } catch (e) {
      note(`error: ${e.message}`);
    }
    attempt++;
    note(`reconnecting in ${backoff}ms (gap since last byte: ${Date.now() - lastByteAt}ms)`);
    await new Promise(r => setTimeout(r, backoff));
  }
}

// heartbeat so silent-dead connections are visible in the log
setInterval(() => note(`heartbeat lastByteAgo=${Date.now() - lastByteAt}ms`), 60000).unref?.();
process.on('SIGTERM', () => { note('SIGTERM'); tape.end(); log.end(); process.exit(0); });
run();
