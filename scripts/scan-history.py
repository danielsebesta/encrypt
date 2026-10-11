"""Redacted heuristic scan of all reachable git blobs; never prints matching credentials."""
import subprocess, re, json
from pathlib import Path

patterns = {
    'private-key': re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----\s+[A-Za-z0-9+/=\r\n]{64,}'),
    'github-token': re.compile(rb'\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b'),
    'aws-access-key': re.compile(rb'\b(?:AKIA|ASIA)[A-Z0-9]{16}\b'),
    'slack-token': re.compile(rb'\bxox[baprs]-[A-Za-z0-9-]{20,}\b'),
}
objects = subprocess.check_output(['git', 'rev-list', '--objects', '--all']).splitlines()
process = subprocess.Popen(['git', 'cat-file', '--batch'], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
findings=[]; scanned=0
for line in objects:
    parts=line.split(b' ',1); oid=parts[0]
    process.stdin.write(oid+b'\n'); process.stdin.flush()
    header=process.stdout.readline().split()
    if len(header)<3: continue
    size=int(header[2]); content=process.stdout.read(size); process.stdout.read(1)
    if header[1]!=b'blob' or b'\0' in content or size>2000000: continue
    scanned+=1
    for name,pattern in patterns.items():
        if pattern.search(content): findings.append({'rule':name,'object':oid.decode(),'path':parts[1].decode(errors='replace') if len(parts)>1 else ''})
process.stdin.close(); process.wait()
result={'kind':'heuristic git history credential scan','textBlobsScanned':scanned,'rules':list(patterns),'findings':findings,
        'limitations':'Not a complete secret detector. Does not scan remote branches absent from this clone, provider settings or runtime secrets.'}
Path('audit-history.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'textBlobsScanned':scanned,'findings':len(findings)}))
raise SystemExit(1 if findings else 0)
