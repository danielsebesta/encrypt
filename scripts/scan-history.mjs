// Redacted heuristic scan of all reachable git blobs; never prints matching credentials.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const patterns = {
  'private-key': /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----\s+[A-Za-z0-9+/=\r\n]{64,}/,
  'github-token': /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/,
  'aws-access-key': /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  'slack-token': /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
};
const MAX_BLOB = 2_000_000;

const objects = execFileSync('git', ['rev-list', '--objects', '--all'], { maxBuffer: 1 << 30 })
  .toString('utf8').split('\n').filter(Boolean)
  .map((line) => { const i = line.indexOf(' '); return i < 0 ? { oid: line, path: '' } : { oid: line.slice(0, i), path: line.slice(i + 1) }; });

const batch = execFileSync('git', ['cat-file', '--batch'], {
  input: objects.map((o) => o.oid).join('\n') + '\n',
  maxBuffer: 1 << 30,
});

const findings = [];
let scanned = 0;
let pos = 0;
for (const { oid, path } of objects) {
  const eol = batch.indexOf(10, pos);
  const header = batch.subarray(pos, eol).toString('latin1').split(' ');
  pos = eol + 1;
  if (header.length < 3) continue;
  const size = Number(header[2]);
  const content = batch.subarray(pos, pos + size);
  pos += size + 1;
  if (header[1] !== 'blob' || size > MAX_BLOB || content.includes(0)) continue;
  scanned++;
  const text = content.toString('latin1');
  for (const [rule, pattern] of Object.entries(patterns)) {
    if (pattern.test(text)) findings.push({ rule, object: oid, path });
  }
}

const result = {
  kind: 'heuristic git history credential scan',
  textBlobsScanned: scanned,
  rules: Object.keys(patterns),
  findings,
  limitations: 'Not a complete secret detector. Does not scan remote branches absent from this clone, provider settings or runtime secrets.',
};
writeFileSync('audit-history.json', JSON.stringify(result, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ textBlobsScanned: scanned, findings: findings.length }));
process.exit(findings.length ? 1 : 0);
