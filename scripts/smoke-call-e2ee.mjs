import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';

// Usage: node scripts/smoke-call-e2ee.mjs <browser executable>... Runs real loopback calls through the call frame
// encryption in each browser (Chromium-based or Firefox, headless) and checks that media only decodes with the right key.
const browsers = process.argv.slice(2);
if (!browsers.length) {
  console.error('Pass at least one Chromium or Firefox executable.');
  process.exit(2);
}

const CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'";

const bundle = async (entry, format) => (await build({ entryPoints: [entry], bundle: true, format, write: false, target: 'es2022', logLevel: 'silent' })).outputFiles[0].text;

const page = `
import { CallFrameEncryption, frameTransformMode } from '/callTransform.js';
import { createMediaKey } from '/callCrypto.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function media() {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 240;
  document.body.append(canvas);
  const ctx = canvas.getContext('2d');
  let n = 0;
  const timer = setInterval(() => {
    ctx.fillStyle = 'hsl(' + ((n += 7) % 360) + ' 80% 50%)';
    ctx.fillRect(0, 0, 320, 240);
    ctx.fillStyle = '#000';
    ctx.fillText(String(n), 10, 20);
  }, 33);
  const context = new AudioContext();
  const osc = context.createOscillator();
  const dest = context.createMediaStreamDestination();
  osc.connect(dest);
  osc.start();
  return {
    video: canvas.captureStream(30).getVideoTracks()[0],
    audio: dest.stream.getAudioTracks()[0],
    stop() { clearInterval(timer); canvas.remove(); osc.stop(); context.close(); },
  };
}

async function inbound(pc) {
  const out = { codecs: [] };
  (await pc.getStats()).forEach((report) => {
    if (report.type === 'inbound-rtp' || report.type === 'outbound-rtp') out[report.kind] = report;
    if (report.type === 'codec') out.codecs.push(report.mimeType);
  });
  return out;
}

function level(stream) {
  const element = new Audio();
  element.srcObject = stream;
  element.muted = true;
  element.play().catch(() => {});
  const context = new AudioContext();
  const analyser = context.createAnalyser();
  context.createMediaStreamSource(stream).connect(analyser);
  const data = new Float32Array(analyser.fftSize);
  return {
    read() {
      analyser.getFloatTimeDomainData(data);
      return Math.sqrt(data.reduce((sum, v) => sum + v * v, 0) / data.length);
    },
    stop() { context.close(); element.srcObject = null; },
  };
}

async function call(sendMode, recvMode, receiverKey, rotate = false) {
  const events = { missing: 0, errors: 0 };
  const handlers = { onMissingKey: () => events.missing++, onError: () => events.errors++ };
  const a = new CallFrameEncryption(sendMode, handlers);
  const b = new CallFrameEncryption(recvMode, handlers);
  const pcA = new RTCPeerConnection(a.peerConfig());
  const pcB = new RTCPeerConnection(b.peerConfig());
  pcA.onicecandidate = (e) => e.candidate && pcB.addIceCandidate(e.candidate).catch(() => {});
  pcB.onicecandidate = (e) => e.candidate && pcA.addIceCandidate(e.candidate).catch(() => {});
  const m = media();
  pcA.addTransceiver(m.audio, { direction: 'sendonly' });
  const videoSender = pcA.addTransceiver(m.video, { direction: 'sendonly' }).sender;
  a.secure(pcA, 'b');
  const remote = new MediaStream();
  pcB.ontrack = (event) => { b.secure(pcB, 'a'); remote.addTrack(event.track); };
  const key = createMediaKey();
  a.setSendKey(key);
  const recv = receiverKey(key);
  b.setReceiveKey('a', recv.id, recv.raw);
  await pcA.setLocalDescription();
  await pcB.setRemoteDescription(pcA.localDescription);
  b.secure(pcB, 'a');
  await pcB.setLocalDescription();
  await pcA.setRemoteDescription(pcB.localDescription);
  const meter = level(remote);
  let reconfigure = 'ok';
  for (const [pc, enc] of [[pcA, a], [pcB, b]]) {
    try { pc.setConfiguration({ ...pc.getConfiguration(), iceServers: [], ...enc.peerConfig() }); } catch (error) { reconfigure = String(error); }
  }
  await sleep(3500);
  const first = await inbound(pcB);
  const sent = await inbound(pcA);
  const rms = meter.read();
  let rotated = null;
  let replacement = null;
  if (rotate) {
    replacement = media();
    await videoSender.replaceTrack(replacement.video);
    const next = createMediaKey(key);
    b.setReceiveKey('a', next.id, next.raw.slice());
    await sleep(300);
    a.setSendKey(next);
    await sleep(2500);
    rotated = (await inbound(pcB)).video?.framesDecoded ?? 0;
  }
  meter.stop();
  m.stop();
  replacement?.stop();
  pcA.close();
  pcB.close();
  a.close();
  b.close();
  return {
    sendMode, recvMode,
    framesDecoded: first.video?.framesDecoded ?? 0,
    video: ['framesReceived', 'framesDropped', 'keyFramesDecoded', 'pliCount', 'nackCount', 'freezeCount'].map((k) => k + '=' + first.video?.[k]).join(' '),
    sender: ['framesEncoded', 'framesSent', 'keyFramesEncoded', 'pliCount', 'qualityLimitationReason', 'encoderImplementation'].map((k) => k + '=' + sent.video?.[k]).join(' '),
    audioPackets: first.audio?.packetsReceived ?? 0,
    audioRms: Number(rms.toFixed(4)),
    videoCodecs: first.codecs.filter((c) => c.startsWith('video/')),
    missing: events.missing,
    errors: events.errors,
    framesDecodedAfterRotation: rotated,
    reconfigure,
  };
}

const same = (key) => ({ id: key.id, raw: key.raw.slice() });
const wrongKey = (key) => ({ id: key.id, raw: createMediaKey().raw });
const wrongId = (key) => ({ id: (key.id + 1) & 255, raw: key.raw.slice() });

const report = { userAgent: navigator.userAgent, detected: frameTransformMode(), checks: [] };
const check = (name, ok, detail) => report.checks.push({ name, ok: Boolean(ok), detail });
try {
  const mode = report.detected;
  if (!mode) throw new Error('no frame transform API');
  const good = await call(mode, mode, same, true);
  check('right key decodes video with VP8 only', good.framesDecoded > 10 && good.videoCodecs.every((c) => /vp8|vp9|rtx|red|ulpfec|flexfec/i.test(c)) && !good.errors, good);
  check('track replacement and key rotation keep video decoding', good.framesDecodedAfterRotation > good.framesDecoded + 10, good);
  check('right key plays audio', good.audioRms > 0.01, good);
  check('connections take new ICE servers', good.reconfigure === 'ok', good);
  const bad = await call(mode, mode, wrongKey);
  check('wrong key decodes nothing', bad.framesDecoded === 0 && bad.audioRms < 0.001 && bad.audioPackets > 0, bad);
  const unknown = await call(mode, mode, wrongId);
  check('unknown key id decodes nothing and asks for the key', unknown.framesDecoded === 0 && unknown.missing > 0, unknown);
  const legacy = typeof RTCRtpSender.prototype.createEncodedStreams === 'function';
  if (mode === 'script' && legacy) {
    const cross = await call('streams', 'script', same);
    check('legacy sender to script receiver', cross.framesDecoded > 10, cross);
    const back = await call('script', 'streams', same);
    check('script sender to legacy receiver', back.framesDecoded > 10, back);
    const both = await call('streams', 'streams', same);
    check('legacy sender to legacy receiver', both.framesDecoded > 10, both);
    check('legacy connections take new ICE servers', both.reconfigure === 'ok' && cross.reconfigure === 'ok', both);
  }
} catch (error) {
  check('run', false, String(error && error.stack || error));
}
await fetch('/result' + location.search, { method: 'POST', body: JSON.stringify(report) });
`;

const files = {
  '/': ['text/html; charset=utf-8', '<!doctype html><meta charset="utf-8"><title>call e2ee smoke</title><body><script type="module" src="/smoke.js"></script></body>'],
  '/smoke.js': ['text/javascript', page],
  '/callTransform.js': ['text/javascript', await bundle('src/lib/callTransform.ts', 'esm')],
  '/callCrypto.js': ['text/javascript', await bundle('src/lib/callCrypto.ts', 'esm')],
  '/callFrameWorker.ts': ['text/javascript', await bundle('src/lib/callFrameWorker.ts', 'iife')],
};

const results = new Map();
let finish;
const done = new Promise((resolve) => { finish = resolve; });
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (req.method === 'POST' && url.pathname === '/result') {
    let body = '';
    for await (const chunk of req) body += chunk;
    results.set(url.searchParams.get('browser'), JSON.parse(body));
    res.end('ok');
    if (results.size === browsers.length) finish();
    return;
  }
  const file = files[url.pathname];
  if (!file) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Type': file[0], 'Content-Security-Policy': CSP, 'Cache-Control': 'no-store' }).end(file[1]);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

const launched = [];
for (const [index, exe] of browsers.entries()) {
  const dir = await mkdtemp(path.join(tmpdir(), 'call-e2ee-'));
  const url = `http://127.0.0.1:${port}/?browser=${index}`;
  const firefox = /firefox/i.test(path.basename(exe));
  if (firefox) {
    await writeFile(path.join(dir, 'user.js'), [
      'user_pref("media.autoplay.default", 0);',
      'user_pref("media.autoplay.block-webaudio", false);',
      'user_pref("media.peerconnection.ice.obfuscate_host_addresses", false);',
      'user_pref("browser.shell.checkDefaultBrowser", false);',
    ].join('\n'));
  }
  const args = firefox
    ? ['-headless', '-no-remote', '-profile', dir, url]
    : ['--headless=new', `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required', '--disable-features=WebRtcHideLocalIpsWithMdns', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', url];
  launched.push({ exe, dir, child: spawn(exe, args, { stdio: 'ignore' }) });
}

const timer = setTimeout(finish, 120_000);
await done;
clearTimeout(timer);

let failed = false;
for (const [index, { exe }] of launched.entries()) {
  const report = results.get(String(index));
  console.log(`\n${exe}`);
  if (!report) {
    console.log('FAIL no result');
    failed = true;
    continue;
  }
  console.log(`  ${report.userAgent}\n  frame transform: ${report.detected}`);
  for (const item of report.checks) {
    console.log(`  ${item.ok ? 'ok  ' : 'FAIL'} ${item.name}`);
    if (!item.ok || process.env.VERBOSE) console.log(`       ${JSON.stringify(item.detail)}`);
    failed ||= !item.ok;
  }
}

for (const { child, dir } of launched) {
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGKILL');
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }).catch(() => {});
}
server.close();
process.exit(failed ? 1 : 0);
