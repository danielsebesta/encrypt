import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const langs = ['en', 'de', 'es', 'fr', 'sk', 'pl'] as const;

function shardFiles(lang: string): string[] {
  const dir = path.join(root, 'data', `chat-cipher-${lang}`, 'shards');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(dir, f));
}

const hasCorpus = existsSync(path.join(root, 'data', 'chat-cipher-en'));

test('each language corpus has at least one shard with valid JSONL bursts', { skip: !hasCorpus && 'the corpus lives outside the repository' }, () => {
  for (const lang of langs) {
    const files = shardFiles(lang);
    assert.ok(files.length > 0, `${lang} missing shards`);
    let count = 0;
    for (const file of files) {
      for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
        if (!line.trim()) continue;
        const row = JSON.parse(line) as {
          id: string;
          topic: string;
          messages: string[];
          worker: string;
          model: string;
          created_at: string;
        };
        assert.equal(typeof row.id, 'string');
        assert.ok(Array.isArray(row.messages));
        assert.ok(row.messages.length >= 4 && row.messages.length <= 20);
        count += 1;
      }
    }
    assert.ok(count >= 40, `${lang} expected >=40 bursts, got ${count}`);
  }
});

test('QUALITY_REPORT.json exists after filter for languages that have been cleaned', () => {
  // Soft check: if clean/all.clean.jsonl exists, report must exist and kept>=0
  for (const lang of langs) {
    const clean = path.join(root, 'data', `chat-cipher-${lang}`, 'clean', 'all.clean.jsonl');
    const reportPath = path.join(root, 'data', `chat-cipher-${lang}`, 'QUALITY_REPORT.json');
    if (!existsSync(clean)) continue;
    assert.ok(existsSync(reportPath), `${lang} clean without QUALITY_REPORT`);
    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as { kept: number; total: number };
    assert.ok(report.total >= report.kept);
  }
});
