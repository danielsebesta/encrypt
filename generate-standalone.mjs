/**
 * Standalone HTML Generator for encrypt.click tools
 * Generates single-file HTML tools with full functionality and trilingual support (EN/CS/DE)
 * 
 * Can be used in two ways:
 *   1. Directly: node generate-standalone.mjs         (outputs to ./standalone/)
 *   2. As module: import { generateAll } from './generate-standalone.mjs'
 *                 generateAll('/path/to/dist/standalone')
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.join(__dirname, 'src');

// Load translations and dictionary from source
const en = JSON.parse(fs.readFileSync(path.join(SRC_DIR, 'locales/en.json'), 'utf8'));
const cs = JSON.parse(fs.readFileSync(path.join(SRC_DIR, 'locales/cs.json'), 'utf8'));
const de = JSON.parse(fs.readFileSync(path.join(SRC_DIR, 'locales/de.json'), 'utf8'));
const dictionary = JSON.parse(fs.readFileSync(path.join(SRC_DIR, 'lib/dictionary.json'), 'utf8'));

// Load pre-bundled tlock-js for Time Capsule (esbuild IIFE bundle)
const tlockBundlePath = path.join(SRC_DIR, 'lib/tlock-bundle.js');
const tlockBundle = fs.existsSync(tlockBundlePath) ? fs.readFileSync(tlockBundlePath, 'utf8') : '';

// Load LZ-String minified for Time Capsule cross-compatibility with website
const lzStringMinPath = path.join(__dirname, 'node_modules/lz-string/libs/lz-string.min.js');
const lzStringMin = fs.existsSync(lzStringMinPath) ? fs.readFileSync(lzStringMinPath, 'utf8') : '';

// ── Shared CSS (minimal Tailwind-like styles matching encrypt.click) ──
const SHARED_CSS = `
*,::after,::before{box-sizing:border-box;margin:0;padding:0}
:root{--brand:#10b981;--bg:#fff;--bg2:#fafafa;--bg3:#f4f4f5;--border:#e4e4e7;--text:#18181b;--text2:#71717a;--text3:#a1a1aa;--card-bg:#fff;--card-border:rgba(228,228,231,0.7);--input-bg:#fff;--mono:"SFMono-Regular",Consolas,"Liberation Mono",Menlo,monospace;--sans:system-ui,-apple-system,sans-serif}
.dark{--bg:#09090b;--bg2:#18181b;--bg3:#27272a;--border:#27272a;--text:#e4e4e7;--text2:#a1a1aa;--text3:#71717a;--card-bg:rgba(24,24,27,0.7);--card-border:rgba(39,39,42,0.8);--input-bg:rgba(24,24,27,0.7)}
html{font-family:var(--sans);background:var(--bg);color:var(--text);line-height:1.5;-webkit-font-smoothing:antialiased;transition:background .3s,color .3s}
body{min-height:100vh;display:flex;flex-direction:column}
a{color:var(--brand);text-decoration:none}a:hover{text-decoration:underline}
.header{display:flex;align-items:center;justify-content:space-between;padding:12px 20px;border-bottom:1px solid var(--border);background:var(--card-bg);backdrop-filter:blur(8px);position:sticky;top:0;z-index:50}
.logo{display:flex;align-items:center;gap:8px;font-weight:800;font-size:14px;letter-spacing:-0.5px;color:var(--text);text-decoration:none}
.logo:hover{text-decoration:none}
.logo svg{width:20px;height:20px}
.header-actions{display:flex;align-items:center;gap:8px}
.btn-icon{width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:none;background:transparent;color:var(--text2);cursor:pointer;transition:background .15s}
.btn-icon:hover{background:var(--bg3)}
.main{flex:1;max-width:672px;margin:0 auto;padding:48px 20px;width:100%;text-align:center}
h1{font-size:clamp(1.5rem,4vw,2.25rem);font-weight:800;letter-spacing:-0.025em;margin-bottom:12px}
h1 span{color:var(--brand)}
.subtitle{color:var(--text2);font-size:14px;line-height:1.6;margin-bottom:32px}
.card{border-radius:24px;background:var(--card-bg);border:1px solid var(--card-border);box-shadow:0 4px 24px rgba(16,185,129,0.05);backdrop-filter:blur(8px);padding:32px;text-align:left}
.label{display:block;font-size:11px;color:var(--text2);font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px}
.input,.select,textarea.input{width:100%;border-radius:16px;border:1px solid var(--border);background:var(--input-bg);padding:8px 12px;font-size:14px;color:var(--text);outline:none;transition:box-shadow .15s}
.input:focus,textarea.input:focus,.select:focus{box-shadow:0 0 0 2px var(--brand)}
textarea.input{resize:vertical;font-family:var(--mono);min-height:100px}
select.input{appearance:auto}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border-radius:9999px;border:1px solid transparent;background:var(--brand);color:#fff;font-size:13px;font-weight:700;padding:10px 20px;cursor:pointer;transition:all .15s;box-shadow:0 2px 8px rgba(16,185,129,0.2)}
.btn:hover{filter:brightness(1.1)}.btn:active{transform:scale(0.97)}.btn:disabled{opacity:0.5;cursor:not-allowed}
.btn-outline{display:inline-flex;align-items:center;justify-content:center;gap:8px;border-radius:9999px;border:1px solid var(--brand);background:transparent;color:var(--brand);font-size:13px;font-weight:700;padding:10px 20px;cursor:pointer;transition:all .15s}
.btn-outline:hover{background:var(--brand);color:#fff}
.btn-w{width:100%}
.result-box{padding:24px;background:rgba(16,185,129,0.05);border:1px solid rgba(16,185,129,0.15);border-radius:16px;font-family:var(--mono);font-size:14px;word-break:break-all;text-align:center;color:#047857;min-height:60px}
.dark .result-box{color:#34d399}
.output-box{padding:16px;background:var(--bg2);border:1px solid var(--border);border-radius:16px;font-family:var(--mono);font-size:13px;word-break:break-all;min-height:60px;color:var(--text);user-select:all}
.link-copy{font-size:10px;color:var(--brand);font-weight:700;cursor:pointer;background:none;border:none;padding:0}
.link-copy:hover{text-decoration:underline}
.row{display:flex;justify-content:space-between;align-items:flex-end}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.space-y>*+*{margin-top:16px}
.space-y-sm>*+*{margin-top:8px}
.error{padding:12px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);border-radius:12px;color:#dc2626;font-size:13px}
.dark .error{color:#f87171}
.success{padding:24px;background:rgba(16,185,129,0.08);border:2px solid rgba(16,185,129,0.15);border-radius:16px;text-align:center}
.success .big{font-size:20px;font-weight:900;font-style:italic;color:var(--brand)}
.fail{padding:24px;background:rgba(239,68,68,0.08);border:2px solid rgba(239,68,68,0.15);border-radius:16px;text-align:center}
.fail .big{font-size:20px;font-weight:900;font-style:italic;color:#dc2626}
.tab-bar{display:flex;padding:4px;background:var(--bg3);border-radius:8px;margin-bottom:16px}
.tab-btn{flex:1;padding:8px;font-size:12px;font-weight:700;border-radius:6px;border:none;cursor:pointer;transition:all .15s;background:transparent;color:var(--text3)}
.tab-btn.active{background:var(--card-bg);color:var(--brand);box-shadow:0 1px 4px rgba(0,0,0,0.08)}
.drop-zone{border:3px dashed var(--border);border-radius:24px;padding:48px;text-align:center;cursor:pointer;transition:border-color .2s;position:relative}
.drop-zone:hover{border-color:var(--brand)}
.drop-zone input[type=file]{position:absolute;inset:0;opacity:0;cursor:pointer}
pre.key-output{padding:16px;background:var(--bg2);border:1px solid var(--border);border-radius:12px;font-family:var(--mono);font-size:10px;overflow:auto;max-height:160px;word-break:break-all;white-space:pre-wrap;user-select:all}
pre.key-private{color:#b45309}.dark pre.key-private{color:#f59e0b}
.info-section{margin-top:48px;text-align:left}
.info-title{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.1em;color:var(--text3);margin-bottom:8px}
.info-text{font-size:12px;color:var(--text2);line-height:1.7}
.range-circle{width:192px;height:192px;border-radius:50%;border:4px solid var(--bg2);display:flex;align-items:center;justify-content:center;margin:0 auto;position:relative;background:rgba(244,244,245,0.2)}
.dark .range-circle{background:rgba(24,24,27,0.2)}
.range-circle .val{font-size:3.5rem;font-weight:900;color:var(--brand);font-variant-numeric:tabular-nums}
.range-circle input[type=range]{position:absolute;bottom:-4px;width:140px;accent-color:var(--brand)}
.range-circle .range-label{position:absolute;top:-24px;font-size:10px;font-weight:900;color:var(--text3);text-transform:uppercase;letter-spacing:0.1em}
.morse-output{padding:32px;background:rgba(16,185,129,0.04);border:1px solid rgba(16,185,129,0.12);border-radius:16px;min-height:80px;font-size:1.5rem;letter-spacing:0.3em;font-family:var(--mono);word-break:break-all;display:flex;align-items:center;justify-content:center;text-align:center;color:#065f46}
.dark .morse-output{color:#34d399}
.hidden{display:none!important}
.word-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
@media(min-width:640px){.word-grid{grid-template-columns:repeat(4,1fr)}}
.word-card{padding:12px;background:rgba(16,185,129,0.06);border:1px solid rgba(16,185,129,0.12);border-radius:12px;text-align:center}
.word-card .num{font-size:9px;color:rgba(16,185,129,0.5);font-weight:700;text-transform:uppercase;display:block;margin-bottom:2px}
.word-card .word{font-family:var(--mono);font-size:14px;font-weight:700;color:#065f46}
.dark .word-card .word{color:#34d399}
.warning-box{padding:16px;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.2);border-radius:12px;display:flex;gap:12px;align-items:flex-start}
.warning-box .icon{font-size:20px;flex-shrink:0}
.warning-box .text{font-size:10px;color:#92400e;font-weight:500;line-height:1.6;text-transform:uppercase;letter-spacing:0.05em}
.dark .warning-box .text{color:#f59e0b}
.stego-grid{display:grid;grid-template-columns:1fr;gap:32px}
@media(min-width:640px){.stego-grid{grid-template-columns:1fr 1fr}}
.img-preview{width:100%;border:2px dashed var(--border);border-radius:12px;padding:32px;text-align:center;cursor:pointer;aspect-ratio:16/9;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;transition:border-color .2s;position:relative;background:var(--card-bg)}
.img-preview:hover{border-color:var(--brand)}
.img-preview img{max-width:100%;max-height:100%;object-fit:contain}
.img-preview input{position:absolute;inset:0;opacity:0;cursor:pointer}
.footer{text-align:center;padding:24px 20px;font-size:11px;color:var(--text3);border-top:1px solid var(--border)}
.lang-btn{font-size:11px;font-weight:700;padding:4px 10px;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--text2);cursor:pointer;transition:all .15s}
.lang-btn:hover{border-color:var(--brand);color:var(--brand)}
.enigma-rotors{display:flex;justify-content:center;gap:24px;padding:16px 0}
.enigma-rotor{text-align:center}
.enigma-rotor .rotor-label{font-size:10px;color:var(--text3);text-transform:uppercase;font-weight:700;margin-bottom:8px}
.enigma-rotor .rotor-box{width:64px;height:80px;background:var(--bg2);border:1px solid var(--border);border-radius:12px;display:flex;align-items:center;justify-content:center}
.enigma-rotor input{background:transparent;color:var(--text);font-size:1.8rem;font-weight:700;width:100%;text-align:center;border:none;outline:none}
.rotor-info{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.rotor-info-card{padding:16px;background:var(--bg2);border-radius:12px;border:1px solid var(--border)}
.rotor-info-card .ri-label{font-size:10px;color:var(--text3);text-transform:uppercase;font-weight:900}
.rotor-info-card .ri-value{font-weight:700;font-size:12px;color:var(--text)}
@media(max-width:639px){.grid2{grid-template-columns:1fr}.enigma-rotors{gap:16px}}
`;

// ── Shared header/footer HTML generators ──
function headerHTML() {
  return `<div class="header">
    <a href="https://encrypt.click" class="logo" target="_blank" rel="noopener">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
      encrypt.click
    </a>
    <div class="header-actions">
      <button class="lang-btn" onclick="toggleLang()" id="langBtn">CS</button>
      <button class="btn-icon" onclick="toggleTheme()" title="Toggle theme">
        <svg id="themeIcon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
      </button>
    </div>
  </div>`;
}

function footerHTML() {
  return `<div class="footer">encrypt.click &middot; standalone offline tool &middot; <a href="https://encrypt.click" target="_blank">encrypt.click</a></div>`;
}

// ── Shared JS for theme + i18n ──
function sharedJS(toolTranslationKeys) {
  // Extract only the keys needed for this tool from en/cs/de
  const enFiltered = {};
  const csFiltered = {};
  const deFiltered = {};
  for (const key of toolTranslationKeys) {
    if (en[key]) enFiltered[key] = en[key];
    if (cs[key]) csFiltered[key] = cs[key];
    if (de[key]) deFiltered[key] = de[key];
  }
  
  return `
<script>
const EN=${JSON.stringify(enFiltered)};
const CS=${JSON.stringify(csFiltered)};
const DE=${JSON.stringify(deFiltered)};
const LANGS=['en','cs','de'];
const LANG_LABELS={en:'EN',cs:'CS',de:'DE'};
let lang=localStorage.getItem('ec-lang')||'en';
if(!LANGS.includes(lang))lang='en';
let dict=lang==='cs'?CS:lang==='de'?DE:EN;

function t(k){return dict[k]||EN[k]||k}
function toggleLang(){
  const i=(LANGS.indexOf(lang)+1)%LANGS.length;
  lang=LANGS[i];
  dict=lang==='cs'?CS:lang==='de'?DE:EN;
  localStorage.setItem('ec-lang',lang);
  document.getElementById('langBtn').textContent=LANG_LABELS[LANGS[(i+1)%LANGS.length]];
  updateUI();
}
function toggleTheme(){
  document.documentElement.classList.toggle('dark');
  localStorage.setItem('ec-theme',document.documentElement.classList.contains('dark')?'dark':'light');
}
(function(){
  const th=localStorage.getItem('ec-theme');
  if(th==='dark'||(th==null&&matchMedia('(prefers-color-scheme:dark)').matches))document.documentElement.classList.add('dark');
  const l=localStorage.getItem('ec-lang');
  if(l&&LANGS.includes(l)){lang=l;dict=lang==='cs'?CS:lang==='de'?DE:EN;}
  document.addEventListener('DOMContentLoaded',()=>{
    const nextIdx=(LANGS.indexOf(lang)+1)%LANGS.length;
    document.getElementById('langBtn').textContent=LANG_LABELS[LANGS[nextIdx]];
    updateUI();
  });
})();
function $(id){return document.getElementById(id)}
function copyText(text){navigator.clipboard.writeText(text).catch(()=>{})}
</script>`;
}

// ── Generate HTML wrapper ──
function buildHTML(title, toolCSS, bodyContent, toolJS, translationKeys) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — encrypt.click (offline)</title>
<style>${SHARED_CSS}${toolCSS || ''}</style>
</head>
<body>
${headerHTML()}
${bodyContent}
${footerHTML()}
${sharedJS(translationKeys)}
${toolJS}
</body>
</html>`;
}

// ═══════════════════════════════════════════════════════════
// TOOL GENERATORS
// ═══════════════════════════════════════════════════════════

function generateCaesar() {
  const keys = ['tools.caesar.meta.title','tools.caesar.h1','tools.caesar.h1Highlight','tools.caesar.subtitle','tools.caesar.rotationOffset','tools.caesar.originalText','tools.caesar.placeholder','tools.caesar.cipheredResult','tools.caesar.info.title','tools.caesar.info.text'];
  const body = `<div class="main">
  <div style="margin-bottom:32px"><h1 id="h1"></h1><p class="subtitle" id="sub"></p></div>
  <div class="card space-y">
    <div style="display:flex;flex-direction:column;align-items:center;gap:32px">
      <div class="range-circle">
        <div class="range-label" id="lOffset"></div>
        <div class="val" id="shiftVal">13</div>
        <input type="range" min="1" max="25" value="13" id="shift" oninput="doShift()">
      </div>
    </div>
    <div><label class="label" id="lOrig"></label><textarea class="input" id="inp" oninput="doShift()"></textarea></div>
    <div><label class="label" id="lRes"></label><div class="result-box" style="font-size:1.5rem" id="out">...</div></div>
  </div>
  <div class="info-section"><h3 class="info-title" id="iTitle"></h3><p class="info-text" id="iText"></p></div>
</div>`;
  const js = `<script>
function rot13(text,shift){
  const a='abcdefghijklmnopqrstuvwxyz',A=a.toUpperCase();
  return text.split('').map(c=>{
    let i=a.indexOf(c);if(i!==-1)return a[(i+shift)%26];
    i=A.indexOf(c);if(i!==-1)return A[(i+shift)%26];
    return c;
  }).join('');
}
function doShift(){
  const s=parseInt($('shift').value);
  $('shiftVal').textContent=s;
  $('out').textContent=rot13($('inp').value,s)||'...';
}
function updateUI(){
  $('h1').innerHTML=t('tools.caesar.h1')+' <span>'+t('tools.caesar.h1Highlight')+'</span>';
  $('sub').textContent=t('tools.caesar.subtitle');
  $('lOffset').textContent=t('tools.caesar.rotationOffset');
  $('lOrig').textContent=t('tools.caesar.originalText');
  $('inp').placeholder=t('tools.caesar.placeholder');
  $('lRes').textContent=t('tools.caesar.cipheredResult');
  $('iTitle').textContent=t('tools.caesar.info.title');
  $('iText').textContent=t('tools.caesar.info.text');
  document.title=t('tools.caesar.meta.title')+' — encrypt.click (offline)';
}
</script>`;
  return buildHTML('Caesar Cipher', '', body, js, keys);
}

function generateBase64() {
  const keys = ['tools.base64.meta.title','tools.base64.h1','tools.base64.h1Highlight','tools.base64.subtitle','tools.base64.encode','tools.base64.decode','tools.base64.inputText','tools.base64.encodePlaceholder','tools.base64.decodePlaceholder','tools.base64.outputResult','tools.base64.copy','tools.base64.errorInvalid','tools.base64.errorInvalidEncode','tools.base64.info.title','tools.base64.info.text'];
  const body = `<div class="main">
  <div style="margin-bottom:32px"><h1 id="h1"></h1><p class="subtitle" id="sub"></p></div>
  <div class="card space-y">
    <div class="tab-bar"><button class="tab-btn active" id="tabEnc" onclick="setMode('encode')"></button><button class="tab-btn" id="tabDec" onclick="setMode('decode')"></button></div>
    <div><label class="label" id="lInp"></label><textarea class="input" id="inp" oninput="process()"></textarea></div>
    <div><div class="row"><label class="label" id="lOut"></label><button class="link-copy" id="copyBtn" onclick="copyText($('out').textContent)"></button></div><div class="output-box" id="out"></div></div>
  </div>
  <div class="info-section"><h3 class="info-title" id="iTitle"></h3><p class="info-text" id="iText"></p></div>
</div>`;
  const js = `<script>
let mode='encode';
function b64Enc(s){const b=new TextEncoder().encode(s);let r='';for(let i=0;i<b.length;i++)r+=String.fromCharCode(b[i]);return btoa(r)}
function b64Dec(s){const b=atob(s);const a=new Uint8Array(b.length);for(let i=0;i<b.length;i++)a[i]=b.charCodeAt(i);return new TextDecoder().decode(a)}
function setMode(m){mode=m;$('tabEnc').classList.toggle('active',m==='encode');$('tabDec').classList.toggle('active',m==='decode');$('inp').value='';$('out').textContent='';updateUI();}
function process(){
  const v=$('inp').value;if(!v){$('out').textContent='';return;}
  try{$('out').textContent=mode==='encode'?b64Enc(v):b64Dec(v);}
  catch(e){$('out').textContent=mode==='encode'?t('tools.base64.errorInvalidEncode'):t('tools.base64.errorInvalid');}
}
function updateUI(){
  $('h1').innerHTML=t('tools.base64.h1')+' <span>'+t('tools.base64.h1Highlight')+'</span>';
  $('sub').textContent=t('tools.base64.subtitle');
  $('tabEnc').textContent=t('tools.base64.encode');
  $('tabDec').textContent=t('tools.base64.decode');
  $('lInp').textContent=t('tools.base64.inputText');
  $('inp').placeholder=mode==='encode'?t('tools.base64.encodePlaceholder'):t('tools.base64.decodePlaceholder');
  $('lOut').textContent=t('tools.base64.outputResult');
  $('copyBtn').textContent=t('tools.base64.copy');
  $('iTitle').textContent=t('tools.base64.info.title');
  $('iText').textContent=t('tools.base64.info.text');
  document.title=t('tools.base64.meta.title')+' — encrypt.click (offline)';
}
</script>`;
  return buildHTML('Base64', '', body, js, keys);
}

function generateVigenere() {
  const keys = ['tools.vigenere.meta.title','tools.vigenere.h1','tools.vigenere.h1Highlight','tools.vigenere.subtitle','tools.vigenere.secretKeyphrase','tools.vigenere.keyPlaceholder','tools.vigenere.encrypt','tools.vigenere.decrypt','tools.vigenere.inputText','tools.vigenere.messagePlaceholder','tools.vigenere.result','tools.vigenere.info.title','tools.vigenere.info.text'];
  const body = `<div class="main">
  <div style="margin-bottom:32px"><h1 id="h1"></h1><p class="subtitle" id="sub"></p></div>
  <div class="card space-y">
    <div><label class="label" id="lKey"></label><input class="input" id="key" value="SECRET" oninput="doVig()" style="font-weight:700;letter-spacing:0.1em;color:var(--brand)"></div>
    <div class="tab-bar" style="max-width:240px;margin:0 auto"><button class="tab-btn active" id="tabEnc" onclick="decMode=false;$('tabEnc').classList.add('active');$('tabDec').classList.remove('active');doVig()"></button><button class="tab-btn" id="tabDec" onclick="decMode=true;$('tabDec').classList.add('active');$('tabEnc').classList.remove('active');doVig()"></button></div>
    <div><label class="label" id="lInp"></label><textarea class="input" id="inp" oninput="doVig()"></textarea></div>
    <div><label class="label" id="lRes"></label><div class="result-box" style="font-size:1.5rem;font-weight:700" id="out">...</div></div>
  </div>
  <div class="info-section"><h3 class="info-title" id="iTitle"></h3><p class="info-text" id="iText"></p></div>
</div>`;
  const js = `<script>
let decMode=false;
function vigenere(text,key,dec){
  const a='abcdefghijklmnopqrstuvwxyz';const len=26;
  const ck=key.toLowerCase().replace(/[^a-z]/g,'');if(!ck)return text;
  let ki=0;
  return text.split('').map(c=>{
    const u=c===c.toUpperCase()&&c!==c.toLowerCase();
    const lc=c.toLowerCase();const ai=a.indexOf(lc);
    if(ai!==-1){const s=a.indexOf(ck[ki%ck.length]);const ni=dec?(ai-s+len)%len:(ai+s)%len;ki++;const nc=a[ni];return u?nc.toUpperCase():nc;}
    return c;
  }).join('');
}
function doVig(){$('out').textContent=vigenere($('inp').value,$('key').value,decMode)||'...';}
function updateUI(){
  $('h1').innerHTML=t('tools.vigenere.h1')+' <span>'+t('tools.vigenere.h1Highlight')+'</span>';
  $('sub').textContent=t('tools.vigenere.subtitle');
  $('lKey').textContent=t('tools.vigenere.secretKeyphrase');
  $('key').placeholder=t('tools.vigenere.keyPlaceholder');
  $('tabEnc').textContent=t('tools.vigenere.encrypt');
  $('tabDec').textContent=t('tools.vigenere.decrypt');
  $('lInp').textContent=t('tools.vigenere.inputText');
  $('inp').placeholder=t('tools.vigenere.messagePlaceholder');
  $('lRes').textContent=t('tools.vigenere.result');
  $('iTitle').textContent=t('tools.vigenere.info.title');
  $('iText').textContent=t('tools.vigenere.info.text');
  document.title=t('tools.vigenere.meta.title')+' — encrypt.click (offline)';
}
</script>`;
  return buildHTML('Vigenere', '', body, js, keys);
}

function generateMorse() {
  const keys = ['tools.morse.meta.title','tools.morse.h1','tools.morse.h1Highlight','tools.morse.subtitle','tools.morse.textToMorse','tools.morse.morseToText','tools.morse.sourceInput','tools.morse.textPlaceholder','tools.morse.morsePlaceholder','tools.morse.translatedOutput','tools.morse.playAudio','tools.morse.copy','tools.morse.info.title','tools.morse.info.text'];
  const body = `<div class="main">
  <div style="margin-bottom:32px"><h1 id="h1"></h1><p class="subtitle" id="sub"></p></div>
  <div class="card space-y">
    <div class="tab-bar"><button class="tab-btn active" id="tabT2M" onclick="setDir(true)"></button><button class="tab-btn" id="tabM2T" onclick="setDir(false)"></button></div>
    <div><label class="label" id="lSrc"></label><textarea class="input" id="inp" oninput="doMorse()" style="font-family:var(--mono)"></textarea></div>
    <div><div class="row"><label class="label" id="lOut"></label><div style="display:flex;gap:16px"><button class="link-copy" onclick="playMorse()" id="playBtn" style="display:flex;align-items:center;gap:4px"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg><span></span></button><button class="link-copy" id="copyBtn" onclick="copyText($('out').textContent)"></button></div></div><div class="morse-output" id="out">...</div></div>
  </div>
  <div class="info-section"><h3 class="info-title" id="iTitle"></h3><p class="info-text" id="iText"></p></div>
</div>`;
  const js = `<script>
const MM={'A':'.-','B':'-...','C':'-.-.','D':'-..','E':'.','F':'..-.','G':'--.','H':'....','I':'..','J':'.---','K':'-.-','L':'.-..','M':'--','N':'-.','O':'---','P':'.--.','Q':'--.-','R':'.-.','S':'...','T':'-','U':'..-','V':'...-','W':'.--','X':'-..-','Y':'-.--','Z':'--..','1':'.----','2':'..---','3':'...--','4':'....-','5':'.....','6':'-....','7':'--...','8':'---..','9':'----.','0':'-----',' ':'/'};
const RM=Object.fromEntries(Object.entries(MM).map(([k,v])=>[v,k]));
let t2m=true;
function toMorse(s){return s.toUpperCase().split('').map(c=>MM[c]||c).join(' ')}
function fromMorse(s){return s.split(' ').map(c=>RM[c]||c).join('')}
function setDir(d){t2m=d;$('tabT2M').classList.toggle('active',d);$('tabM2T').classList.toggle('active',!d);$('inp').value='';$('out').textContent='...';updateUI();}
function doMorse(){$('out').textContent=(t2m?toMorse($('inp').value):fromMorse($('inp').value))||'...';}
function playMorse(){
  const out=$('out').textContent;const ctx=new(window.AudioContext||window.webkitAudioContext)();
  const osc=ctx.createOscillator();const gain=ctx.createGain();osc.connect(gain);gain.connect(ctx.destination);
  osc.type='sine';osc.frequency.setValueAtTime(600,ctx.currentTime);
  let time=ctx.currentTime;const dot=0.1,dash=0.3;
  out.split('').forEach(c=>{
    if(c==='.'){gain.gain.setValueAtTime(0.2,time);gain.gain.setValueAtTime(0,time+dot);time+=dot+dot;}
    else if(c==='-'){gain.gain.setValueAtTime(0.2,time);gain.gain.setValueAtTime(0,time+dash);time+=dash+dot;}
    else if(c===' '||c==='/'){time+=dot*2;}
  });
  osc.start();osc.stop(time+0.1);
}
function updateUI(){
  $('h1').innerHTML=t('tools.morse.h1')+' <span>'+t('tools.morse.h1Highlight')+'</span>';
  $('sub').textContent=t('tools.morse.subtitle');
  $('tabT2M').textContent=t('tools.morse.textToMorse');
  $('tabM2T').textContent=t('tools.morse.morseToText');
  $('lSrc').textContent=t('tools.morse.sourceInput');
  $('inp').placeholder=t2m?t('tools.morse.textPlaceholder'):t('tools.morse.morsePlaceholder');
  $('lOut').textContent=t('tools.morse.translatedOutput');
  $('playBtn').querySelector('span').textContent=t('tools.morse.playAudio');
  $('copyBtn').textContent=t('tools.morse.copy');
  $('iTitle').textContent=t('tools.morse.info.title');
  $('iText').textContent=t('tools.morse.info.text');
  document.title=t('tools.morse.meta.title')+' — encrypt.click (offline)';
}
</script>`;
  return buildHTML('Morse Code', '', body, js, keys);
}

function generateTokenGen() {
  const keys = ['tools.token.meta.title','tools.token.h1','tools.token.h1Highlight','tools.token.subtitle','tools.token.entropyLength','tools.token.encoding','tools.token.hex','tools.token.base64Enc','tools.token.urlSafe','tools.token.generatedToken','tools.token.copy','tools.token.refreshToken','tools.token.info.title','tools.token.info.text'];
  const body = `<div class="main">
  <div style="margin-bottom:32px"><h1 id="h1"></h1><p class="subtitle" id="sub"></p></div>
  <div class="card space-y">
    <div class="grid2">
      <div><label class="label" id="lLen"></label><input type="number" class="input" id="len" value="32" min="8" max="128" oninput="gen()"></div>
      <div><label class="label" id="lEnc"></label><select class="input" id="enc" onchange="gen()"><option value="hex" id="optHex"></option><option value="base64" id="optB64"></option><option value="url-safe" id="optUrl"></option></select></div>
    </div>
    <div><div class="row"><label class="label" id="lToken"></label><button class="link-copy" id="copyBtn" onclick="copyText($('out').textContent)"></button></div><div class="result-box" id="out"></div></div>
    <button class="btn btn-w" onclick="gen()" id="refreshBtn"></button>
  </div>
  <div class="info-section"><h3 class="info-title" id="iTitle"></h3><p class="info-text" id="iText"></p></div>
</div>`;
  const js = `<script>
function genToken(len,type){
  const b=crypto.getRandomValues(new Uint8Array(len));
  if(type==='hex')return Array.from(b).map(x=>x.toString(16).padStart(2,'0')).join('');
  if(type==='base64')return btoa(String.fromCharCode(...b));
  return btoa(String.fromCharCode(...b)).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');
}
function gen(){$('out').textContent=genToken(parseInt($('len').value)||32,$('enc').value);}
function updateUI(){
  $('h1').innerHTML=t('tools.token.h1')+' <span>'+t('tools.token.h1Highlight')+'</span>';
  $('sub').textContent=t('tools.token.subtitle');
  $('lLen').textContent=t('tools.token.entropyLength');
  $('lEnc').textContent=t('tools.token.encoding');
  $('optHex').textContent=t('tools.token.hex');
  $('optB64').textContent=t('tools.token.base64Enc');
  $('optUrl').textContent=t('tools.token.urlSafe');
  $('lToken').textContent=t('tools.token.generatedToken');
  $('copyBtn').textContent=t('tools.token.copy');
  $('refreshBtn').textContent=t('tools.token.refreshToken');
  $('iTitle').textContent=t('tools.token.info.title');
  $('iText').textContent=t('tools.token.info.text');
  document.title=t('tools.token.meta.title')+' — encrypt.click (offline)';
  if(!$('out').textContent)gen();
}
</script>`;
  return buildHTML('Token Generator', '', body, js, keys);
}

function generateUUID() {
  const keys = ['tools.uuidUlid.meta.title','tools.uuidUlid.h1','tools.uuidUlid.h1Highlight','tools.uuidUlid.subtitle','tools.uuidUlid.ulidFull','tools.uuidUlid.copy','tools.uuidUlid.generateNew','tools.uuidUlid.info1.title','tools.uuidUlid.info1.text','tools.uuidUlid.info2.title','tools.uuidUlid.info2.text'];
  const body = `<div class="main">
  <div style="margin-bottom:32px"><h1 id="h1"></h1><p class="subtitle" id="sub"></p></div>
  <div class="card space-y">
    <div><div class="row"><label class="label">UUID v4</label><button class="link-copy" id="cpUUID" onclick="copyText($('uuid').textContent)"></button></div><div class="output-box" id="uuid"></div></div>
    <div><div class="row"><label class="label" id="lUlid"></label><button class="link-copy" id="cpULID" onclick="copyText($('ulid').textContent)"></button></div><div class="output-box" id="ulid"></div></div>
    <button class="btn btn-w" onclick="gen()" id="genBtn"></button>
  </div>
  <div class="info-section space-y"><div><h3 class="info-title" id="i1Title"></h3><p class="info-text" id="i1Text"></p></div><div><h3 class="info-title" id="i2Title"></h3><p class="info-text" id="i2Text"></p></div></div>
</div>`;
  const js = `<script>
function uuidv4(){return([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g,c=>(c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>c/4).toString(16));}
function ulid(){const CHARS='0123456789ABCDEFGHJKMNPQRSTVWXYZ';const t=Date.now();let r='';for(let i=9;i>=0;i--)r+=CHARS[Math.floor(t/Math.pow(32,i))%32];for(let i=0;i<16;i++)r+=CHARS[crypto.getRandomValues(new Uint8Array(1))[0]%32];return r;}
function gen(){$('uuid').textContent=uuidv4();$('ulid').textContent=ulid();}
function updateUI(){
  $('h1').innerHTML=t('tools.uuidUlid.h1')+' <span>'+t('tools.uuidUlid.h1Highlight')+'</span>';
  $('sub').textContent=t('tools.uuidUlid.subtitle');
  $('lUlid').textContent=t('tools.uuidUlid.ulidFull');
  $('cpUUID').textContent=t('tools.uuidUlid.copy');$('cpULID').textContent=t('tools.uuidUlid.copy');
  $('genBtn').textContent=t('tools.uuidUlid.generateNew');
  $('i1Title').textContent=t('tools.uuidUlid.info1.title');$('i1Text').textContent=t('tools.uuidUlid.info1.text');
  $('i2Title').textContent=t('tools.uuidUlid.info2.title');$('i2Text').textContent=t('tools.uuidUlid.info2.text');
  document.title=t('tools.uuidUlid.meta.title')+' — encrypt.click (offline)';
  if(!$('uuid').textContent)gen();
}
</script>`;
  return buildHTML('UUID & ULID', '', body, js, keys);
}

function generateHMAC() {
  const keys = ['tools.hmac.meta.title','tools.hmac.h1','tools.hmac.h1Highlight','tools.hmac.subtitle','tools.hmac.messageData','tools.hmac.payloadPlaceholder','tools.hmac.secretKey','tools.hmac.secretPlaceholder','tools.hmac.generateBtn','tools.hmac.macSignature','tools.hmac.info.title','tools.hmac.info.text'];
  const body = `<div class="main">
  <div style="margin-bottom:32px"><h1 id="h1"></h1><p class="subtitle" id="sub"></p></div>
  <div class="card space-y">
    <div><label class="label" id="lMsg"></label><textarea class="input" id="msg"></textarea></div>
    <div><label class="label" id="lKey"></label><input type="password" class="input" id="key"></div>
    <button class="btn btn-w" onclick="gen()" id="genBtn"></button>
    <div id="resWrap" class="hidden"><label class="label" id="lSig" style="font-size:9px;color:var(--text3)"></label><div class="result-box" id="out" style="user-select:all"></div></div>
  </div>
  <div class="info-section"><h3 class="info-title" id="iTitle"></h3><p class="info-text" id="iText"></p></div>
</div>`;
  const js = `<script>
async function gen(){
  const m=$('msg').value,k=$('key').value;if(!m||!k)return;
  const enc=new TextEncoder();
  const ck=await crypto.subtle.importKey('raw',enc.encode(k),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const sig=await crypto.subtle.sign('HMAC',ck,enc.encode(m));
  $('out').textContent=Array.from(new Uint8Array(sig)).map(b=>b.toString(16).padStart(2,'0')).join('');
  $('resWrap').classList.remove('hidden');
}
function updateUI(){
  $('h1').innerHTML=t('tools.hmac.h1')+' <span>'+t('tools.hmac.h1Highlight')+'</span>';
  $('sub').textContent=t('tools.hmac.subtitle');
  $('lMsg').textContent=t('tools.hmac.messageData');$('msg').placeholder=t('tools.hmac.payloadPlaceholder');
  $('lKey').textContent=t('tools.hmac.secretKey');$('key').placeholder=t('tools.hmac.secretPlaceholder');
  $('genBtn').textContent=t('tools.hmac.generateBtn');
  $('lSig').textContent=t('tools.hmac.macSignature');
  $('iTitle').textContent=t('tools.hmac.info.title');$('iText').textContent=t('tools.hmac.info.text');
  document.title=t('tools.hmac.meta.title')+' — encrypt.click (offline)';
}
</script>`;
  return buildHTML('HMAC', '', body, js, keys);
}

function generateRSA() {
  const keys = ['tools.rsa.meta.title','tools.rsa.h1','tools.rsa.h1Highlight','tools.rsa.subtitle','tools.rsa.keyBitLength','tools.rsa.bit1024','tools.rsa.bit2048','tools.rsa.bit4096','tools.rsa.generateBtn','tools.rsa.publicKey','tools.rsa.privateKey','tools.rsa.copy','tools.rsa.info.title','tools.rsa.info.text'];
  const body = `<div class="main">
  <div style="margin-bottom:32px"><h1 id="h1"></h1><p class="subtitle" id="sub"></p></div>
  <div class="card space-y">
    <div><label class="label" id="lBits"></label><select class="input" id="bits"><option value="1024" id="o1"></option><option value="2048" selected id="o2"></option><option value="4096" id="o3"></option></select></div>
    <button class="btn btn-w" onclick="gen()" id="genBtn"></button>
    <div id="keys" class="hidden space-y">
      <div><div class="row"><label class="label" id="lPub" style="font-size:10px"></label><button class="link-copy" id="cpPub" onclick="copyText($('pub').textContent)"></button></div><pre class="key-output" id="pub"></pre></div>
      <div><div class="row"><label class="label" id="lPrv" style="font-size:10px;color:#b45309"></label><button class="link-copy" id="cpPrv" onclick="copyText($('prv').textContent)"></button></div><pre class="key-output key-private" id="prv"></pre></div>
    </div>
  </div>
  <div class="info-section"><h3 class="info-title" id="iTitle"></h3><p class="info-text" id="iText"></p></div>
</div>`;
  const js = `<script>
function ab2b64(buf){const b=new Uint8Array(buf);let s='';for(let i=0;i<b.length;i++)s+=String.fromCharCode(b[i]);return btoa(s)}
function wrapPem(b64,label){const lines=b64.match(/.{1,64}/g)||[];return '-----BEGIN '+label+'-----\\n'+lines.join('\\n')+'\\n-----END '+label+'-----'}
async function gen(){
  $('genBtn').disabled=true;$('genBtn').textContent='Generating...';
  try{
    const kp=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:parseInt($('bits').value),publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
    const[spki,pkcs8]=await Promise.all([crypto.subtle.exportKey('spki',kp.publicKey),crypto.subtle.exportKey('pkcs8',kp.privateKey)]);
    $('pub').textContent=wrapPem(ab2b64(spki),'PUBLIC KEY');
    $('prv').textContent=wrapPem(ab2b64(pkcs8),'PRIVATE KEY');
    $('keys').classList.remove('hidden');
  }finally{$('genBtn').disabled=false;updateUI();}
}
function updateUI(){
  $('h1').innerHTML=t('tools.rsa.h1')+' <span>'+t('tools.rsa.h1Highlight')+'</span>';
  $('sub').textContent=t('tools.rsa.subtitle');$('lBits').textContent=t('tools.rsa.keyBitLength');
  $('o1').textContent=t('tools.rsa.bit1024');$('o2').textContent=t('tools.rsa.bit2048');$('o3').textContent=t('tools.rsa.bit4096');
  $('genBtn').textContent=t('tools.rsa.generateBtn');
  $('lPub').textContent=t('tools.rsa.publicKey');$('lPrv').textContent=t('tools.rsa.privateKey');
  $('cpPub').textContent=t('tools.rsa.copy');$('cpPrv').textContent=t('tools.rsa.copy');
  $('iTitle').textContent=t('tools.rsa.info.title');$('iText').textContent=t('tools.rsa.info.text');
  document.title=t('tools.rsa.meta.title')+' — encrypt.click (offline)';
}
</script>`;
  return buildHTML('RSA Keys', '', body, js, keys);
}

function generateSSHKeys() {
  const keys = ['tools.sshKeys.meta.title','tools.sshKeys.h1','tools.sshKeys.h1Highlight','tools.sshKeys.subtitle','tools.sshKeys.keyType','tools.sshKeys.keyBitLength','tools.sshKeys.bit2048','tools.sshKeys.bit4096','tools.sshKeys.generatingKeys','tools.sshKeys.generateBtn','tools.sshKeys.publicKey','tools.sshKeys.privateKey','tools.sshKeys.copy','tools.sshKeys.info.title','tools.sshKeys.info.text'];
  const body = `<div class="main">
  <div style="margin-bottom:32px"><h1 id="h1"></h1><p class="subtitle" id="sub"></p></div>
  <div class="card space-y">
    <div><label class="label" id="lType"></label><div style="font-size:12px;color:var(--text2)">RSA (OpenSSH <code style="font-size:10px;padding:2px 6px;background:var(--bg3);border-radius:4px">ssh-rsa</code> format)</div></div>
    <div><label class="label" id="lBits"></label><select class="input" id="bits"><option value="2048" id="o1"></option><option value="4096" selected id="o2"></option></select></div>
    <button class="btn btn-w" onclick="gen()" id="genBtn"></button>
    <div id="keys" class="hidden space-y">
      <div><div class="row"><label class="label" id="lPub" style="font-size:10px"></label><button class="link-copy" id="cpPub" onclick="copyText($('pub').textContent)"></button></div><pre class="key-output" id="pub"></pre></div>
      <div><div class="row"><label class="label" id="lPrv" style="font-size:10px;color:#b45309"></label><button class="link-copy" id="cpPrv" onclick="copyText($('prv').textContent)"></button></div><pre class="key-output key-private" id="prv"></pre></div>
    </div>
  </div>
  <div class="info-section"><h3 class="info-title" id="iTitle"></h3><p class="info-text" id="iText"></p></div>
</div>`;
  const js = `<script>
function ab2b64(buf){const b=new Uint8Array(buf);let s='';for(let i=0;i<b.length;i++)s+=String.fromCharCode(b[i]);return btoa(s)}
function wrapPem(b64,label){const lines=b64.match(/.{1,64}/g)||[];return '-----BEGIN '+label+'-----\\n'+lines.join('\\n')+'\\n-----END '+label+'-----'}
function b64UrlToBytes(b){const s=b.replace(/-/g,'+').replace(/_/g,'/');const p='='.repeat((4-s.length%4)%4);const d=atob(s+p);const r=new Uint8Array(d.length);for(let i=0;i<d.length;i++)r[i]=d.charCodeAt(i);return r}
function sshStr(d){const o=new Uint8Array(4+d.length);new DataView(o.buffer).setUint32(0,d.length);o.set(d,4);return o}
function sshMpint(v){if(v[0]&0x80){const p=new Uint8Array(v.length+1);p.set(v,1);return sshStr(p)}return sshStr(v)}
function concat(...a){const t=a.reduce((s,x)=>s+x.length,0);const r=new Uint8Array(t);let o=0;for(const x of a){r.set(x,o);o+=x.length}return r}
async function gen(){
  $('genBtn').disabled=true;$('genBtn').textContent=t('tools.sshKeys.generatingKeys');
  try{
    const kp=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:parseInt($('bits').value),publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
    const[jwk,pkcs8]=await Promise.all([crypto.subtle.exportKey('jwk',kp.publicKey),crypto.subtle.exportKey('pkcs8',kp.privateKey)]);
    const kt=new TextEncoder().encode('ssh-rsa');
    const e=b64UrlToBytes(jwk.e);const n=b64UrlToBytes(jwk.n);
    const wire=concat(sshStr(kt),sshMpint(e),sshMpint(n));
    $('pub').textContent='ssh-rsa '+ab2b64(wire.buffer);
    $('prv').textContent=wrapPem(ab2b64(pkcs8),'PRIVATE KEY');
    $('keys').classList.remove('hidden');
  }finally{$('genBtn').disabled=false;updateUI();}
}
function updateUI(){
  $('h1').innerHTML=t('tools.sshKeys.h1')+' <span>'+t('tools.sshKeys.h1Highlight')+'</span>';
  $('sub').textContent=t('tools.sshKeys.subtitle');$('lType').textContent=t('tools.sshKeys.keyType');$('lBits').textContent=t('tools.sshKeys.keyBitLength');
  $('o1').textContent=t('tools.sshKeys.bit2048');$('o2').textContent=t('tools.sshKeys.bit4096');
  $('genBtn').textContent=t('tools.sshKeys.generateBtn');$('lPub').textContent=t('tools.sshKeys.publicKey');$('lPrv').textContent=t('tools.sshKeys.privateKey');
  $('cpPub').textContent=t('tools.sshKeys.copy');$('cpPrv').textContent=t('tools.sshKeys.copy');
  $('iTitle').textContent=t('tools.sshKeys.info.title');$('iText').textContent=t('tools.sshKeys.info.text');
  document.title=t('tools.sshKeys.meta.title')+' — encrypt.click (offline)';
}
</script>`;
  return buildHTML('SSH Keys', '', body, js, keys);
}

function generateJWT() {
  const keys = ['tools.jwt.meta.title','tools.jwt.h1','tools.jwt.h1Highlight','tools.jwt.subtitle','tools.jwt.encodedToken','tools.jwt.invalidJwt','tools.jwt.header','tools.jwt.payload','tools.jwt.signatureStatus','tools.jwt.decodedLocally','tools.jwt.info.title','tools.jwt.info.text'];
  const body = `<div class="main">
  <div style="margin-bottom:32px"><h1 id="h1"></h1><p class="subtitle" id="sub"></p></div>
  <div class="card space-y" style="text-align:left">
    <div><label class="label" id="lToken"></label><textarea class="input" id="inp" oninput="decode()" placeholder="eyJhbGciOiJIUzI1NiIsInR5..."></textarea></div>
    <div id="result" class="hidden space-y">
      <div id="errBox" class="error hidden"></div>
      <div id="okBox" class="hidden space-y">
        <div class="grid2"><div><label class="label" id="lHead" style="font-size:10px;letter-spacing:0.2em"></label><div style="padding:12px;background:var(--bg2);border:1px solid var(--border);border-radius:12px;overflow:auto"><pre id="head" style="font-size:10px;color:#db2777;font-family:var(--mono)"></pre></div></div><div><label class="label" id="lPay" style="font-size:10px;letter-spacing:0.2em"></label><div style="padding:12px;background:var(--bg2);border:1px solid var(--border);border-radius:12px;overflow:auto"><pre id="pay" style="font-size:10px;color:#7c3aed;font-family:var(--mono)"></pre></div></div></div>
        <div style="padding:16px;background:rgba(16,185,129,0.06);border:1px solid rgba(16,185,129,0.12);border-radius:12px"><div style="font-size:9px;font-weight:900;color:#065f46;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px" id="lSigStat"></div><div style="display:flex;align-items:center;gap:8px;color:var(--brand);font-weight:700;font-size:12px"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg><span id="lDecLocal"></span></div></div>
      </div>
    </div>
  </div>
  <div class="info-section"><h3 class="info-title" id="iTitle"></h3><p class="info-text" id="iText"></p></div>
</div>`;
  const js = `<script>
function jwtDec(token){
  const parts=token.split('.');if(parts.length!==3)throw new Error('Invalid');
  function decPart(s){const b=s.replace(/-/g,'+').replace(/_/g,'/');const p=b+'='.repeat((4-b.length%4)%4);return JSON.parse(atob(p))}
  return{header:decPart(parts[0]),payload:decPart(parts[1])};
}
function decode(){
  const v=$('inp').value.trim();
  if(!v){$('result').classList.add('hidden');return;}
  $('result').classList.remove('hidden');
  try{
    const r=jwtDec(v);
    $('errBox').classList.add('hidden');$('okBox').classList.remove('hidden');
    $('head').textContent=JSON.stringify(r.header,null,2);
    $('pay').textContent=JSON.stringify(r.payload,null,2);
  }catch(e){$('errBox').classList.remove('hidden');$('okBox').classList.add('hidden');$('errBox').textContent=t('tools.jwt.invalidJwt');}
}
function updateUI(){
  $('h1').innerHTML=t('tools.jwt.h1')+' <span>'+t('tools.jwt.h1Highlight')+'</span>';
  $('sub').textContent=t('tools.jwt.subtitle');$('lToken').textContent=t('tools.jwt.encodedToken');
  $('lHead').textContent=t('tools.jwt.header');$('lPay').textContent=t('tools.jwt.payload');
  $('lSigStat').textContent=t('tools.jwt.signatureStatus');$('lDecLocal').textContent=t('tools.jwt.decodedLocally');
  $('iTitle').textContent=t('tools.jwt.info.title');$('iText').textContent=t('tools.jwt.info.text');
  document.title=t('tools.jwt.meta.title')+' — encrypt.click (offline)';
}
</script>`;
  return buildHTML('JWT Debugger', '', body, js, keys);
}

function generateEnigma() {
  const keys = ['tools.enigma.meta.title','tools.enigma.h1','tools.enigma.h1Highlight','tools.enigma.subtitle','tools.enigma.rotor','tools.enigma.inputStream','tools.enigma.streamPlaceholder','tools.enigma.scrambledOutput','tools.enigma.reflector','tools.enigma.reflectorValue','tools.enigma.model','tools.enigma.modelValue','tools.enigma.info.title','tools.enigma.info.text'];
  const body = `<div class="main">
  <div style="margin-bottom:32px"><h1 id="h1"></h1><p class="subtitle" id="sub"></p></div>
  <div class="card space-y">
    <div class="enigma-rotors">
      <div class="enigma-rotor"><div class="rotor-label" id="r0l"></div><div class="rotor-box"><input type="text" maxlength="1" value="A" id="p0" oninput="this.value=this.value.toUpperCase();doEnigma()"></div></div>
      <div class="enigma-rotor"><div class="rotor-label" id="r1l"></div><div class="rotor-box"><input type="text" maxlength="1" value="A" id="p1" oninput="this.value=this.value.toUpperCase();doEnigma()"></div></div>
      <div class="enigma-rotor"><div class="rotor-label" id="r2l"></div><div class="rotor-box"><input type="text" maxlength="1" value="A" id="p2" oninput="this.value=this.value.toUpperCase();doEnigma()"></div></div>
    </div>
    <div><label class="label" id="lInp"></label><textarea class="input" id="inp" oninput="doEnigma()" style="text-transform:uppercase"></textarea></div>
    <div><label class="label" id="lOut"></label><div class="result-box" style="font-size:1.2rem" id="out"></div></div>
    <div class="rotor-info"><div class="rotor-info-card"><div class="ri-label" id="lRef"></div><div class="ri-value" id="vRef"></div></div><div class="rotor-info-card"><div class="ri-label" id="lMod"></div><div class="ri-value" id="vMod"></div></div></div>
  </div>
  <div class="info-section"><h3 class="info-title" id="iTitle"></h3><p class="info-text" id="iText"></p></div>
</div>`;
  const js = `<script>
const ROTORS={I:'EKMFLGDQVZNTOWYHXUSPAIBRCJ',II:'AJDKSIRUXBLHWTMCQGZNPYFVOE',III:'BDFHJLCPRTXVZNYEIWGAKMUSQO'};
const REFLB='YRUHQSLDPXNGOKMIEBFZCWVJAT';
const NOTCH={I:'Q',II:'E',III:'V'};
function enigmaProcess(text,pos){
  const rotors=[ROTORS.I,ROTORS.II,ROTORS.III];
  const positions=[pos[0].charCodeAt(0)-65,pos[1].charCodeAt(0)-65,pos[2].charCodeAt(0)-65];
  const rings=[0,0,0];
  let result='';
  for(const ch of text.toUpperCase()){
    if(!/[A-Z]/.test(ch)){result+=ch;continue;}
    const n1=NOTCH.I.charCodeAt(0)-65,n2=NOTCH.II.charCodeAt(0)-65;
    if(positions[1]===n2){positions[0]=(positions[0]+1)%26;positions[1]=(positions[1]+1)%26;}
    else if(positions[2]===n1){positions[1]=(positions[1]+1)%26;}
    positions[2]=(positions[2]+1)%26;
    let v=ch.charCodeAt(0)-65;
    for(let i=2;i>=0;i--)v=(rotors[i].charCodeAt((v+positions[i]-rings[i]+26)%26)-65-positions[i]+rings[i]+26)%26;
    v=REFLB.charCodeAt(v)-65;
    for(let i=0;i<=2;i++){const c=String.fromCharCode(((v+positions[i]-rings[i]+26)%26)+65);v=(rotors[i].indexOf(c)-positions[i]+rings[i]+26)%26;}
    result+=String.fromCharCode(v+65);
  }
  return result;
}
function doEnigma(){
  const pos=[$('p0').value||'A',$('p1').value||'A',$('p2').value||'A'];
  $('out').textContent=enigmaProcess($('inp').value,pos);
}
function updateUI(){
  $('h1').innerHTML=t('tools.enigma.h1')+' <span>'+t('tools.enigma.h1Highlight')+'</span>';
  $('sub').textContent=t('tools.enigma.subtitle');
  $('r0l').textContent=t('tools.enigma.rotor')+' I';$('r1l').textContent=t('tools.enigma.rotor')+' II';$('r2l').textContent=t('tools.enigma.rotor')+' III';
  $('lInp').textContent=t('tools.enigma.inputStream');$('inp').placeholder=t('tools.enigma.streamPlaceholder');
  $('lOut').textContent=t('tools.enigma.scrambledOutput');
  $('lRef').textContent=t('tools.enigma.reflector');$('vRef').textContent=t('tools.enigma.reflectorValue');
  $('lMod').textContent=t('tools.enigma.model');$('vMod').textContent=t('tools.enigma.modelValue');
  $('iTitle').textContent=t('tools.enigma.info.title');$('iText').textContent=t('tools.enigma.info.text');
  document.title=t('tools.enigma.meta.title')+' — encrypt.click (offline)';
}
</script>`;
  return buildHTML('Enigma M3', '', body, js, keys);
}

function generateWatermark() {
  const keys = ['tools.watermark.meta.title','tools.watermark.h1','tools.watermark.h1Highlight','tools.watermark.subtitle','tools.watermark.sourceDocument','tools.watermark.loaded','tools.watermark.protectionText','tools.watermark.placeholder','tools.watermark.saveSecure','tools.watermark.verificationNote','tools.watermark.info.title','tools.watermark.info.text'];
  const body = `<div class="main">
  <div style="margin-bottom:32px"><h1 id="h1"></h1><p class="subtitle" id="sub"></p></div>
  <div class="card space-y">
    <div><label class="label" id="lSrc"></label><div style="position:relative"><input type="file" accept="image/*" class="input" id="fileInp" style="cursor:pointer"><div id="loadedBadge" class="hidden" style="position:absolute;right:12px;top:8px;font-size:10px;background:var(--brand);color:#fff;padding:2px 8px;border-radius:4px;font-weight:700"></div></div></div>
    <div><label class="label" id="lText"></label><input class="input" id="wmText" value="FOR IDENTITY VERIFICATION ONLY" oninput="apply()"></div>
    <div id="preview" class="hidden space-y">
      <div style="border-radius:24px;overflow:hidden;border:1px solid var(--border);box-shadow:0 8px 32px rgba(0,0,0,0.1)"><img id="result" style="width:100%;height:auto;max-height:500px;object-fit:contain"></div>
      <a id="dlLink" download="protected-identity.jpg" class="btn btn-w" style="display:block;text-align:center;text-decoration:none"></a>
      <p style="font-size:10px;color:var(--text3);text-align:center;font-weight:500" id="note"></p>
    </div>
  </div>
  <div class="info-section"><h3 class="info-title" id="iTitle"></h3><p class="info-text" id="iText"></p></div>
</div>`;
  const js = `<script>
let file=null;
$('fileInp').addEventListener('change',e=>{file=e.target.files[0]||null;if(file){$('loadedBadge').classList.remove('hidden');$('loadedBadge').textContent=t('tools.watermark.loaded');apply();}});
function apply(){
  if(!file)return;
  const img=new Image();img.src=URL.createObjectURL(file);
  img.onload=()=>{
    const c=document.createElement('canvas');c.width=img.width;c.height=img.height;
    const ctx=c.getContext('2d');ctx.drawImage(img,0,0);
    const d=Math.sqrt(c.width**2+c.height**2);ctx.save();ctx.translate(c.width/2,c.height/2);ctx.rotate(-Math.PI/4);ctx.translate(-d/2,-d/2);
    const fs=Math.floor(c.width/25);ctx.font='bold '+fs+'px system-ui,sans-serif';ctx.fillStyle='rgba(255,255,255,0.4)';ctx.textAlign='center';
    const sx=c.width/3,sy=c.height/8;
    for(let x=-d;x<d*2;x+=sx)for(let y=-d;y<d*2;y+=sy)ctx.fillText($('wmText').value,x,y);
    ctx.restore();
    const url=c.toDataURL('image/jpeg',0.9);
    $('result').src=url;$('dlLink').href=url;$('preview').classList.remove('hidden');
  };
}
function updateUI(){
  $('h1').innerHTML=t('tools.watermark.h1')+' <span>'+t('tools.watermark.h1Highlight')+'</span>';
  $('sub').textContent=t('tools.watermark.subtitle');$('lSrc').textContent=t('tools.watermark.sourceDocument');
  $('lText').textContent=t('tools.watermark.protectionText');$('wmText').placeholder=t('tools.watermark.placeholder');
  $('dlLink').textContent=t('tools.watermark.saveSecure');$('note').textContent=t('tools.watermark.verificationNote');
  $('iTitle').textContent=t('tools.watermark.info.title');$('iText').textContent=t('tools.watermark.info.text');
  if($('loadedBadge').textContent)$('loadedBadge').textContent=t('tools.watermark.loaded');
  document.title=t('tools.watermark.meta.title')+' — encrypt.click (offline)';
}
</script>`;
  return buildHTML('ID Watermarker', '', body, js, keys);
}

function generateExifScrub() {
  const keys = ['tools.exifScrub.meta.title','tools.exifScrub.h1','tools.exifScrub.h1Highlight','tools.exifScrub.subtitle','tools.exifScrub.dropImage','tools.exifScrub.metadataRemoved','tools.exifScrub.imageTooLarge','tools.exifScrub.redrawing','tools.exifScrub.privacySafeResult','tools.exifScrub.downloadJpeg','tools.exifScrub.newFileGenerated','tools.exifScrub.info.title','tools.exifScrub.info.text'];
  const body = `<div class="main">
  <div style="margin-bottom:32px"><h1 id="h1"></h1><p class="subtitle" id="sub"></p></div>
  <div class="card space-y">
    <div class="drop-zone"><input type="file" accept="image/*" id="fileInp"><div><p style="font-weight:700" id="dropText"></p><p style="font-size:12px;color:var(--text2);margin-top:4px;text-transform:uppercase;letter-spacing:0.05em" id="dropSub"></p></div></div>
    <div id="status" class="hidden" style="text-align:center;padding:16px"><span style="font-size:12px;font-weight:700;color:var(--brand)" id="statusText"></span></div>
    <div id="resultWrap" class="hidden space-y">
      <div><label class="label" id="lResult" style="color:var(--brand)"></label><div style="border-radius:16px;overflow:hidden;border:1px solid var(--border);box-shadow:0 8px 32px rgba(0,0,0,0.1);position:relative"><img id="result" style="width:100%;height:auto"><div style="position:absolute;inset:0;background:rgba(0,0,0,0.4);opacity:0;display:flex;align-items:center;justify-content:center;transition:opacity .2s" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0"><a id="dlLink" download="scrubbed.jpg" class="btn"></a></div></div></div>
      <p style="font-size:9px;color:var(--text3);text-align:center;font-style:italic" id="note"></p>
    </div>
  </div>
  <div class="info-section"><h3 class="info-title" id="iTitle"></h3><p class="info-text" id="iText"></p></div>
</div>`;
  const js = `<script>
$('fileInp').addEventListener('change',async e=>{
  const f=e.target.files[0];if(!f)return;
  if(f.size>10*1024*1024){alert(t('tools.exifScrub.imageTooLarge'));return;}
  $('status').classList.remove('hidden');$('statusText').textContent=t('tools.exifScrub.redrawing');
  $('resultWrap').classList.add('hidden');
  const img=new Image();img.src=URL.createObjectURL(f);
  img.onload=()=>{
    const c=document.createElement('canvas');c.width=img.width;c.height=img.height;
    const ctx=c.getContext('2d');ctx.drawImage(img,0,0);
    const url=c.toDataURL('image/jpeg',0.9);
    $('result').src=url;$('dlLink').href=url;
    $('status').classList.add('hidden');$('resultWrap').classList.remove('hidden');
  };
});
function updateUI(){
  $('h1').innerHTML=t('tools.exifScrub.h1')+' <span>'+t('tools.exifScrub.h1Highlight')+'</span>';
  $('sub').textContent=t('tools.exifScrub.subtitle');$('dropText').textContent=t('tools.exifScrub.dropImage');
  $('dropSub').textContent=t('tools.exifScrub.metadataRemoved');
  $('lResult').textContent=t('tools.exifScrub.privacySafeResult');
  $('dlLink').textContent=t('tools.exifScrub.downloadJpeg');$('note').textContent=t('tools.exifScrub.newFileGenerated');
  $('iTitle').textContent=t('tools.exifScrub.info.title');$('iText').textContent=t('tools.exifScrub.info.text');
  document.title=t('tools.exifScrub.meta.title')+' — encrypt.click (offline)';
}
</script>`;
  return buildHTML('EXIF Scrubber', '', body, js, keys);
}

function generateSteganography() {
  const keys = ['tools.steganography.meta.title','tools.steganography.h1','tools.steganography.h1Highlight','tools.steganography.subtitle','tools.steganography.encode','tools.steganography.decode','tools.steganography.sourceImage','tools.steganography.pngRecommended','tools.steganography.secretMessage','tools.steganography.messagePlaceholder','tools.steganography.securityPassword','tools.steganography.encPasswordPlaceholder','tools.steganography.injectPixels','tools.steganography.downloadEncrypted','tools.steganography.decPasswordPlaceholder','tools.steganography.scanPixels','tools.steganography.foundMessage','tools.steganography.imageTooLarge','tools.steganography.imageLoaded','tools.steganography.encryptingMessage','tools.steganography.encryptionFailed','tools.steganography.messageTooLong','tools.steganography.messageHidden','tools.steganography.pleaseProvide','tools.steganography.pleaseProvideImage','tools.steganography.noHiddenMessage','tools.steganography.corrupted','tools.steganography.decryptingMessage','tools.steganography.decryptSuccess','tools.steganography.decryptFailed','tools.steganography.info.title','tools.steganography.info1.title','tools.steganography.info1.text','tools.steganography.info2.title','tools.steganography.info2.text'];
  const body = `<div class="main" style="max-width:900px">
  <div style="margin-bottom:32px"><h1 id="h1"></h1><p class="subtitle" id="sub"></p></div>
  <div class="card space-y">
    <div class="tab-bar"><button class="tab-btn active" id="tabEnc" onclick="setMode('encode')"></button><button class="tab-btn" id="tabDec" onclick="setMode('decode')"></button></div>
    <div class="stego-grid">
      <div class="space-y"><div class="img-preview" id="imgArea"><input type="file" accept="image/*" id="fileInp"><div id="imgPlaceholder"><div style="font-size:14px;color:var(--text2)" id="lSrcImg"></div><div style="font-size:12px;color:var(--text3);font-style:italic" id="lPng"></div></div><img id="preview" class="hidden" style="max-width:100%;max-height:100%;object-fit:contain"></div><div style="font-size:12px;font-style:italic;color:var(--brand)" id="status"></div></div>
      <div class="space-y" id="controls"></div>
    </div>
    <canvas id="canvas" class="hidden"></canvas>
  </div>
  <div class="info-section space-y"><div><h3 class="info-title" id="i1t"></h3><p class="info-text" id="i1x"></p></div><div><h3 class="info-title" id="i2t"></h3><p class="info-text" id="i2x"></p></div></div>
</div>`;
  // This is a complex tool - include the full AES-256-GCM encrypt/decrypt + LSB steganography
  const js = `<script>
const PBKDF2_ITER=100000,SALT_SZ=16,IV_SZ=12;
async function deriveKey(pw,salt){const e=new TextEncoder();const k=await crypto.subtle.importKey('raw',e.encode(pw),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:PBKDF2_ITER,hash:'SHA-256'},k,{name:'AES-GCM',length:256},false,['encrypt','decrypt'])}
async function aesEncrypt(text,pw){const e=new TextEncoder();const salt=crypto.getRandomValues(new Uint8Array(SALT_SZ));const iv=crypto.getRandomValues(new Uint8Array(IV_SZ));const key=await deriveKey(pw,salt);const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,e.encode(text));const r=new Uint8Array(SALT_SZ+IV_SZ+ct.byteLength);r.set(salt,0);r.set(iv,SALT_SZ);r.set(new Uint8Array(ct),SALT_SZ+IV_SZ);return r}
async function aesDecrypt(data,pw){const salt=data.slice(0,SALT_SZ);const iv=data.slice(SALT_SZ,SALT_SZ+IV_SZ);const ct=data.slice(SALT_SZ+IV_SZ);const key=await deriveKey(pw,salt);const pt=await crypto.subtle.decrypt({name:'AES-GCM',iv},key,ct);return new TextDecoder().decode(pt)}

let mode='encode',imageUrl=null,encodedUrl=null;
$('fileInp').addEventListener('change',e=>{
  const f=e.target.files[0];if(!f)return;
  if(f.size>10*1024*1024){$('status').textContent=t('tools.steganography.imageTooLarge');return;}
  imageUrl=URL.createObjectURL(f);encodedUrl=null;
  $('preview').src=imageUrl;$('preview').classList.remove('hidden');$('imgPlaceholder').classList.add('hidden');
  $('status').textContent=t('tools.steganography.imageLoaded');
});
function setMode(m){mode=m;$('tabEnc').classList.toggle('active',m==='encode');$('tabDec').classList.toggle('active',m==='decode');updateControls()}
function updateControls(){
  const c=$('controls');
  if(mode==='encode'){
    c.innerHTML='<div><label class="label">'+t('tools.steganography.secretMessage')+'</label><textarea class="input" id="msg" placeholder="'+t('tools.steganography.messagePlaceholder')+'"></textarea></div><div><label class="label">'+t('tools.steganography.securityPassword')+'</label><input type="password" class="input" id="pw" placeholder="'+t('tools.steganography.encPasswordPlaceholder')+'"></div><button class="btn btn-w" onclick="encode()">'+t('tools.steganography.injectPixels')+'</button><div id="dlWrap" class="hidden"><button class="btn-outline btn-w" onclick="downloadEnc()">'+t('tools.steganography.downloadEncrypted')+'</button></div>';
  }else{
    c.innerHTML='<div><label class="label">'+t('tools.steganography.securityPassword')+'</label><input type="password" class="input" id="pw" placeholder="'+t('tools.steganography.decPasswordPlaceholder')+'"></div><button class="btn-outline btn-w" onclick="decode()">'+t('tools.steganography.scanPixels')+'</button><div id="foundWrap" class="hidden"><label class="label">'+t('tools.steganography.foundMessage')+'</label><div class="result-box" id="foundMsg" style="text-align:left;font-size:13px"></div></div>';
  }
}
async function encode(){
  const cv=$('canvas'),pw=$('pw').value,msg=$('msg').value;
  if(!imageUrl||!msg||!pw){$('status').textContent=t('tools.steganography.pleaseProvide');return;}
  const ctx=cv.getContext('2d');const img=new Image();img.onload=async()=>{
    cv.width=img.width;cv.height=img.height;ctx.drawImage(img,0,0);
    const id=ctx.getImageData(0,0,cv.width,cv.height);const d=id.data;
    $('status').textContent=t('tools.steganography.encryptingMessage');
    let mb;try{mb=await aesEncrypt(msg,pw)}catch(e){$('status').textContent=t('tools.steganography.encryptionFailed');return}
    const MAGIC=new TextEncoder().encode('ECMD');const len=mb.length;
    const total=(MAGIC.length+4+mb.length)*8;
    if(total>d.length*0.75){$('status').textContent=t('tools.steganography.messageTooLong');return}
    const full=new Uint8Array(MAGIC.length+4+mb.length);full.set(MAGIC,0);full[4]=(len>>24)&0xff;full[5]=(len>>16)&0xff;full[6]=(len>>8)&0xff;full[7]=len&0xff;full.set(mb,8);
    let bi=0;for(let i=0;i<full.length;i++)for(let bit=7;bit>=0;bit--){const pi=Math.floor(bi/3);const ci=bi%3;const byteIdx=pi*4+ci;d[byteIdx]=(d[byteIdx]&0xfe)|((full[i]>>bit)&1);d[pi*4+3]=255;bi++}
    ctx.putImageData(id,0,0);encodedUrl=cv.toDataURL('image/png');
    $('preview').src=encodedUrl;$('status').textContent=t('tools.steganography.messageHidden');
    const dl=document.getElementById('dlWrap');if(dl)dl.classList.remove('hidden');
  };img.src=imageUrl;
}
function downloadEnc(){if(!encodedUrl)return;const a=document.createElement('a');a.download='secret-image.png';a.href=encodedUrl;a.click()}
async function decode(){
  const cv=$('canvas'),pw=$('pw').value;
  if(!imageUrl||!pw){$('status').textContent=t('tools.steganography.pleaseProvideImage');return}
  const ctx=cv.getContext('2d');const img=new Image();img.crossOrigin='anonymous';
  img.onload=async()=>{
    cv.width=img.width;cv.height=img.height;ctx.drawImage(img,0,0);
    const id=ctx.getImageData(0,0,cv.width,cv.height);const d=id.data;
    let bi=0;function readBits(count){const bytes=new Uint8Array(Math.ceil(count/8));for(let i=0;i<count;i++){const pi=Math.floor(bi/3);const ci=bi%3;const byteIdx=pi*4+ci;const bv=d[byteIdx]&1;const bp=Math.floor(i/8);const bpos=7-(i%8);bytes[bp]|=(bv<<bpos);bi++}return bytes}
    try{
      const magic=new TextDecoder().decode(readBits(32));if(magic!=='ECMD'){$('status').textContent=t('tools.steganography.noHiddenMessage');return}
      const lb=readBits(32);const len=(lb[0]<<24)|(lb[1]<<16)|(lb[2]<<8)|lb[3];
      if(len<=0||len>(d.length/8)){$('status').textContent=t('tools.steganography.corrupted');return}
      const mb=readBits(len*8);$('status').textContent=t('tools.steganography.decryptingMessage');
      const msg=await aesDecrypt(mb,pw);$('status').textContent=t('tools.steganography.decryptSuccess');
      const fw=document.getElementById('foundWrap');const fm=document.getElementById('foundMsg');
      if(fw&&fm){fw.classList.remove('hidden');fm.textContent=msg}
    }catch(e){$('status').textContent=t('tools.steganography.decryptFailed')}
  };img.src=imageUrl;
}
function updateUI(){
  $('h1').innerHTML=t('tools.steganography.h1')+' <span>'+t('tools.steganography.h1Highlight')+'</span>';
  $('sub').textContent=t('tools.steganography.subtitle');
  $('tabEnc').textContent=t('tools.steganography.encode');$('tabDec').textContent=t('tools.steganography.decode');
  $('lSrcImg').textContent=t('tools.steganography.sourceImage');$('lPng').textContent=t('tools.steganography.pngRecommended');
  $('i1t').textContent=t('tools.steganography.info1.title');$('i1x').textContent=t('tools.steganography.info1.text');
  $('i2t').textContent=t('tools.steganography.info2.title');$('i2x').textContent=t('tools.steganography.info2.text');
  document.title=t('tools.steganography.meta.title')+' — encrypt.click (offline)';
  updateControls();
}
</script>`;
  return buildHTML('Steganography', '', body, js, keys);
}

function generatePDFUnlock() {
  const keys = ['tools.pdfUnlock.meta.title','tools.pdfUnlock.h1','tools.pdfUnlock.h1Highlight','tools.pdfUnlock.subtitle','tools.pdfUnlock.lockedPdf','tools.pdfUnlock.ownerPassword','tools.pdfUnlock.decryptionPlaceholder','tools.pdfUnlock.decryptingDoc','tools.pdfUnlock.removeProtection','tools.pdfUnlock.failedToUnlock','tools.pdfUnlock.decryptionSuccessful','tools.pdfUnlock.docUnlocked','tools.pdfUnlock.downloadUnlocked','tools.pdfUnlock.pdfTooLarge','tools.pdfUnlock.info.title','tools.pdfUnlock.info.text'];
  const body = `<div class="main">
  <div style="margin-bottom:32px"><h1 id="h1"></h1><p class="subtitle" id="sub"></p></div>
  <div class="card space-y">
    <div><label class="label" id="lFile"></label><input type="file" accept=".pdf" class="input" id="fileInp"></div>
    <div><label class="label" id="lPw"></label><input type="password" class="input" id="pw"></div>
    <button class="btn btn-w" onclick="unlock()" id="unlockBtn" disabled></button>
    <div id="errBox" class="error hidden"></div>
    <div id="successBox" class="hidden space-y">
      <div class="success"><div class="big" id="sTitle"></div><div style="font-size:10px;opacity:0.6;text-transform:uppercase;font-weight:700;letter-spacing:0.1em;margin-top:4px" id="sSub"></div></div>
      <a id="dlLink" download="unlocked-document.pdf" class="btn-outline btn-w" style="display:block;text-align:center;text-decoration:none"></a>
    </div>
  </div>
  <div class="info-section"><h3 class="info-title" id="iTitle"></h3><p class="info-text" id="iText"></p></div>
</div>
<script src="https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js"><\/script>`;
  const js = `<script>
let file=null;
$('fileInp').addEventListener('change',e=>{file=e.target.files[0]||null;$('unlockBtn').disabled=!file;$('successBox').classList.add('hidden');$('errBox').classList.add('hidden')});
async function unlock(){
  if(!file||!$('pw').value)return;
  if(file.size>5*1024*1024){$('errBox').textContent=t('tools.pdfUnlock.pdfTooLarge');$('errBox').classList.remove('hidden');return}
  $('errBox').classList.add('hidden');$('unlockBtn').disabled=true;$('unlockBtn').textContent=t('tools.pdfUnlock.decryptingDoc');
  try{
    const buf=await file.arrayBuffer();
    const pdf=await PDFLib.PDFDocument.load(buf,{password:$('pw').value});
    const bytes=await pdf.save();
    const blob=new Blob([bytes],{type:'application/pdf'});
    $('dlLink').href=URL.createObjectURL(blob);
    $('successBox').classList.remove('hidden');
  }catch(e){$('errBox').textContent=t('tools.pdfUnlock.failedToUnlock');$('errBox').classList.remove('hidden')}
  finally{$('unlockBtn').disabled=false;updateUI()}
}
function updateUI(){
  $('h1').innerHTML=t('tools.pdfUnlock.h1')+' <span>'+t('tools.pdfUnlock.h1Highlight')+'</span>';
  $('sub').textContent=t('tools.pdfUnlock.subtitle');$('lFile').textContent=t('tools.pdfUnlock.lockedPdf');
  $('lPw').textContent=t('tools.pdfUnlock.ownerPassword');$('pw').placeholder=t('tools.pdfUnlock.decryptionPlaceholder');
  $('unlockBtn').textContent=t('tools.pdfUnlock.removeProtection');
  $('sTitle').textContent=t('tools.pdfUnlock.decryptionSuccessful');$('sSub').textContent=t('tools.pdfUnlock.docUnlocked');
  $('dlLink').textContent=t('tools.pdfUnlock.downloadUnlocked');
  $('iTitle').textContent=t('tools.pdfUnlock.info.title');$('iText').textContent=t('tools.pdfUnlock.info.text');
  document.title=t('tools.pdfUnlock.meta.title')+' — encrypt.click (offline)';
}
</script>`;
  return buildHTML('PDF Unlock', '', body, js, keys);
}

function generateQRGen() {
  const keys = ['tools.qrGen.meta.title','tools.qrGen.h1','tools.qrGen.h1Highlight','tools.qrGen.subtitle','tools.qrGen.qrContent','tools.qrGen.placeholder','tools.qrGen.dotsColor','tools.qrGen.resolution','tools.qrGen.downloadPng','tools.qrGen.info.title','tools.qrGen.info.text'];
  const body = `<div class="main">
  <div style="margin-bottom:32px"><h1 id="h1"></h1><p class="subtitle" id="sub"></p></div>
  <div class="card space-y">
    <div><label class="label" id="lContent"></label><textarea class="input" id="inp" oninput="gen()" style="min-height:100px;font-family:var(--mono)"></textarea></div>
    <div class="grid2">
      <div><label class="label" id="lColor"></label><div style="display:flex;gap:8px;align-items:center"><input type="color" id="color" value="#10b981" oninput="gen()" style="width:40px;height:40px;border-radius:8px;cursor:pointer;background:transparent;border:none;padding:0"><input class="input" id="colorText" value="#10b981" oninput="$('color').value=this.value;gen()" style="font-family:var(--mono);font-size:12px;padding:6px 10px"></div></div>
      <div><label class="label" id="lRes"></label><input type="number" class="input" id="size" value="400" min="100" max="2000" oninput="gen()"></div>
    </div>
    <div id="qrWrap" class="hidden" style="display:flex;flex-direction:column;align-items:center;gap:24px;padding:24px 0">
      <div style="padding:24px;background:#fff;border-radius:2rem;box-shadow:0 8px 32px rgba(0,0,0,0.1)"><canvas id="qrCanvas" style="width:256px;height:256px"></canvas></div>
      <div style="display:flex;gap:12px;width:100%;max-width:320px"><button class="btn" style="flex:1" onclick="dlQR()" id="dlBtn"></button><button class="btn-outline" onclick="$('inp').value='';gen()" style="padding:10px 20px"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg></button></div>
    </div>
  </div>
  <div class="info-section"><h3 class="info-title" id="iTitle"></h3><p class="info-text" id="iText"></p></div>
</div>
<script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.4/build/qrcode.min.js"><\/script>`;
  const js = `<script>
function gen(){
  const text=$('inp').value;
  if(!text){$('qrWrap').classList.add('hidden');$('qrWrap').style.display='none';return;}
  const size=parseInt($('size').value)||400;
  const color=$('color').value||'#10b981';
  QRCode.toCanvas($('qrCanvas'),text,{width:size,margin:2,color:{dark:color,light:'#00000000'}},function(err){
    if(!err){$('qrWrap').classList.remove('hidden');$('qrWrap').style.display='flex';}
  });
}
function dlQR(){
  const a=document.createElement('a');a.download='qr-code.png';a.href=$('qrCanvas').toDataURL('image/png');a.click();
}
function updateUI(){
  $('h1').innerHTML=t('tools.qrGen.h1')+' <span>'+t('tools.qrGen.h1Highlight')+'</span>';
  $('sub').textContent=t('tools.qrGen.subtitle');$('lContent').textContent=t('tools.qrGen.qrContent');
  $('inp').placeholder=t('tools.qrGen.placeholder');$('lColor').textContent=t('tools.qrGen.dotsColor');
  $('lRes').textContent=t('tools.qrGen.resolution');$('dlBtn').textContent=t('tools.qrGen.downloadPng');
  $('iTitle').textContent=t('tools.qrGen.info.title');$('iText').textContent=t('tools.qrGen.info.text');
  document.title=t('tools.qrGen.meta.title')+' — encrypt.click (offline)';
}
</script>`;
  return buildHTML('QR Generator', '', body, js, keys);
}

function generateBIP39() {
  // Inline a minimal BIP39 implementation using Web Crypto
  const keys = ['tools.bip39.meta.title','tools.bip39.h1','tools.bip39.h1Highlight','tools.bip39.subtitle','tools.bip39.recoveryPhrase','tools.bip39.warning','tools.bip39.generateNew','tools.bip39.copyPhrase','tools.bip39.info.title','tools.bip39.info.text'];
  const body = `<div class="main">
  <div style="margin-bottom:32px"><h1 id="h1"></h1><p class="subtitle" id="sub"></p></div>
  <div class="card space-y">
    <div><label class="label" id="lPhrase" style="text-align:center"></label><div class="word-grid" id="words"></div></div>
    <div class="warning-box"><span class="icon">⚠️</span><div class="text" id="warnText"></div></div>
    <div style="display:flex;gap:12px"><button class="btn" style="flex:1" onclick="gen()" id="genBtn"></button><button class="btn-outline" style="flex:1" onclick="copyText(mnemonic)" id="copyBtn"></button></div>
  </div>
  <div class="info-section"><h3 class="info-title" id="iTitle"></h3><p class="info-text" id="iText"></p></div>
</div>`;
  // We need the BIP39 English wordlist (~11KB gzipped). We'll load it from CDN.
  const js = `<script>
let mnemonic='';let BIP39_WORDS=null;
async function loadWordlist(){
  if(BIP39_WORDS)return;
  const res=await fetch('https://raw.githubusercontent.com/bitcoin/bips/master/bip-0039/english.txt');
  const text=await res.text();
  BIP39_WORDS=text.trim().split('\\n');
}
async function generateMnemonic(){
  await loadWordlist();
  const ent=crypto.getRandomValues(new Uint8Array(16));
  const hash=await crypto.subtle.digest('SHA-256',ent);
  const hashBits=new Uint8Array(hash);
  const bits=[];
  for(const b of ent)for(let i=7;i>=0;i--)bits.push((b>>i)&1);
  const csLen=ent.length*8/32;
  for(let i=0;i<csLen;i++)bits.push((hashBits[Math.floor(i/8)]>>(7-(i%8)))&1);
  const words=[];
  for(let i=0;i<bits.length;i+=11){let idx=0;for(let j=0;j<11;j++)idx=(idx<<1)|bits[i+j];words.push(BIP39_WORDS[idx]);}
  return words.join(' ');
}
async function gen(){
  mnemonic=await generateMnemonic();
  const words=mnemonic.split(' ');
  $('words').innerHTML=words.map((w,i)=>'<div class="word-card"><span class="num">'+(i+1)+'</span><span class="word">'+w+'</span></div>').join('');
}
function updateUI(){
  $('h1').innerHTML=t('tools.bip39.h1')+' <span>'+t('tools.bip39.h1Highlight')+'</span>';
  $('sub').textContent=t('tools.bip39.subtitle');$('lPhrase').textContent=t('tools.bip39.recoveryPhrase');
  $('warnText').textContent=t('tools.bip39.warning');$('genBtn').textContent=t('tools.bip39.generateNew');
  $('copyBtn').textContent=t('tools.bip39.copyPhrase');
  $('iTitle').textContent=t('tools.bip39.info.title');$('iText').textContent=t('tools.bip39.info.text');
  document.title=t('tools.bip39.meta.title')+' — encrypt.click (offline)';
  if(!mnemonic)gen();
}
</script>`;
  return buildHTML('BIP39 Mnemonic', '', body, js, keys);
}

function generateBcrypt() {
  const keys = ['tools.bcrypt.meta.title','tools.bcrypt.h1','tools.bcrypt.h1Highlight','tools.bcrypt.subtitle','tools.bcrypt.generateHash','tools.bcrypt.cleartextInput','tools.bcrypt.hashPlaceholder','tools.bcrypt.generateBtn','tools.bcrypt.costRounds','tools.bcrypt.verifyHashTitle','tools.bcrypt.hashToCompare','tools.bcrypt.pasteHash','tools.bcrypt.computing','tools.bcrypt.verifyMatch','tools.bcrypt.matchConfirmed','tools.bcrypt.matchText','tools.bcrypt.invalidMatch','tools.bcrypt.invalidText','tools.bcrypt.info.title','tools.bcrypt.info.text'];
  const body = `<div class="main">
  <div style="margin-bottom:32px"><h1 id="h1"></h1><p class="subtitle" id="sub"></p></div>
  <div class="card space-y">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><div style="width:8px;height:8px;border-radius:50%;background:var(--brand)"></div><h3 style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:var(--text2)" id="sHash"></h3></div>
    <div><label class="label" id="lInput"></label><input class="input" id="inp" oninput=""></div>
    <div style="display:flex;gap:12px"><button class="btn" style="flex:1" onclick="doHash()" id="hashBtn"></button><div><input type="number" class="input" id="cost" value="10" min="4" max="15" style="width:80px;text-align:center" title="Cost rounds"></div></div>
    <div id="hashResult" class="hidden"><div class="output-box" id="hashOut" style="font-size:11px"></div></div>
    <div style="border-top:1px solid var(--border);padding-top:24px;margin-top:16px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px"><div style="width:8px;height:8px;border-radius:50%;background:#3b82f6"></div><h3 style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:var(--text2)" id="sVerify"></h3></div>
      <div class="space-y">
        <div><label class="label" id="lHash"></label><input class="input" id="verHash" style="font-family:var(--mono);font-size:11px"></div>
        <button class="btn-outline btn-w" onclick="doVerify()" id="verBtn"></button>
        <div id="verResult" class="hidden"></div>
      </div>
    </div>
  </div>
  <div class="info-section"><h3 class="info-title" id="iTitle"></h3><p class="info-text" id="iText"></p></div>
</div>
<script src="https://cdn.jsdelivr.net/npm/hash-wasm@4.11.0/dist/index.umd.min.js"><\/script>`;
  const js = `<script>
async function doHash(){
  const text=$('inp').value;if(!text)return;
  $('hashBtn').disabled=true;$('hashBtn').textContent=t('tools.bcrypt.computing');
  try{
    const salt=crypto.getRandomValues(new Uint8Array(16));
    const hash=await hashwasm.bcrypt({password:text,salt,costFactor:parseInt($('cost').value)||10,outputType:'encoded'});
    $('hashOut').textContent=hash;$('hashResult').classList.remove('hidden');
  }catch(e){$('hashOut').textContent='Error: '+e.message;$('hashResult').classList.remove('hidden')}
  finally{$('hashBtn').disabled=false;updateUI();}
}
async function doVerify(){
  const text=$('inp').value,hash=$('verHash').value;if(!text||!hash)return;
  $('verBtn').disabled=true;$('verBtn').textContent=t('tools.bcrypt.computing');
  try{
    const ok=await hashwasm.bcryptVerify({password:text,hash:hash});
    if(ok){$('verResult').innerHTML='<div class="success"><div class="big">'+t('tools.bcrypt.matchConfirmed')+'</div><div style="font-size:10px;opacity:0.6;text-transform:uppercase;font-weight:700;letter-spacing:0.1em;margin-top:4px">'+t('tools.bcrypt.matchText')+'</div></div>';
    }else{$('verResult').innerHTML='<div class="fail"><div class="big">'+t('tools.bcrypt.invalidMatch')+'</div><div style="font-size:10px;opacity:0.6;text-transform:uppercase;font-weight:700;letter-spacing:0.1em;margin-top:4px">'+t('tools.bcrypt.invalidText')+'</div></div>';}
    $('verResult').classList.remove('hidden');
  }catch(e){$('verResult').innerHTML='<div class="error">'+e.message+'</div>';$('verResult').classList.remove('hidden')}
  finally{$('verBtn').disabled=false;updateUI();}
}
function updateUI(){
  $('h1').innerHTML=t('tools.bcrypt.h1')+' <span>'+t('tools.bcrypt.h1Highlight')+'</span>';
  $('sub').textContent=t('tools.bcrypt.subtitle');$('sHash').textContent=t('tools.bcrypt.generateHash');
  $('lInput').textContent=t('tools.bcrypt.cleartextInput');$('inp').placeholder=t('tools.bcrypt.hashPlaceholder');
  $('hashBtn').textContent=t('tools.bcrypt.generateBtn');$('sVerify').textContent=t('tools.bcrypt.verifyHashTitle');
  $('lHash').textContent=t('tools.bcrypt.hashToCompare');$('verHash').placeholder=t('tools.bcrypt.pasteHash');
  $('verBtn').textContent=t('tools.bcrypt.verifyMatch');
  $('iTitle').textContent=t('tools.bcrypt.info.title');$('iText').textContent=t('tools.bcrypt.info.text');
  document.title=t('tools.bcrypt.meta.title')+' — encrypt.click (offline)';
}
</script>`;
  return buildHTML('Bcrypt Hash', '', body, js, keys);
}

function generatePGPKeys() {
  const keys = ['tools.pgpKeys.meta.title','tools.pgpKeys.h1','tools.pgpKeys.h1Highlight','tools.pgpKeys.subtitle','tools.pgpKeys.name','tools.pgpKeys.email','tools.pgpKeys.namePlaceholder','tools.pgpKeys.emailPlaceholder','tools.pgpKeys.keyPassphrase','tools.pgpKeys.passphrasePlaceholder','tools.pgpKeys.rsaStrength','tools.pgpKeys.bit2048','tools.pgpKeys.bit4096','tools.pgpKeys.generatingKeys','tools.pgpKeys.generateBtn','tools.pgpKeys.publicKey','tools.pgpKeys.privateKey','tools.pgpKeys.copy','tools.pgpKeys.nameEmailRequired','tools.pgpKeys.failedToGenerate','tools.pgpKeys.info.title','tools.pgpKeys.info.text'];
  const body = `<div class="main">
  <div style="margin-bottom:32px"><h1 id="h1"></h1><p class="subtitle" id="sub"></p></div>
  <div class="card space-y">
    <div class="grid2">
      <div><label class="label" id="lName"></label><input class="input" id="name"></div>
      <div><label class="label" id="lEmail"></label><input class="input" type="email" id="email"></div>
    </div>
    <div class="grid2">
      <div><label class="label" id="lPass"></label><input class="input" type="password" id="pass" autocomplete="new-password"></div>
      <div><label class="label" id="lBits"></label><select class="input" id="bits"><option value="2048" id="o1"></option><option value="4096" selected id="o2"></option></select></div>
    </div>
    <button class="btn btn-w" onclick="gen()" id="genBtn"></button>
    <div id="errBox" class="error hidden"></div>
    <div id="keys" class="hidden space-y">
      <div><div class="row"><label class="label" id="lPub" style="font-size:10px"></label><button class="link-copy" id="cpPub" onclick="copyText($('pub').textContent)"></button></div><pre class="key-output" id="pub"></pre></div>
      <div><div class="row"><label class="label" id="lPrv" style="font-size:10px;color:#b45309"></label><button class="link-copy" id="cpPrv" onclick="copyText($('prv').textContent)"></button></div><pre class="key-output key-private" id="prv"></pre></div>
    </div>
  </div>
  <div class="info-section"><h3 class="info-title" id="iTitle"></h3><p class="info-text" id="iText"></p></div>
</div>
<script src="https://cdn.jsdelivr.net/npm/openpgp@5.11.2/dist/openpgp.min.js"><\/script>`;
  const js = `<script>
async function gen(){
  $('errBox').classList.add('hidden');$('keys').classList.add('hidden');
  const name=$('name').value.trim(),email=$('email').value.trim();
  if(!name||!email){$('errBox').textContent=t('tools.pgpKeys.nameEmailRequired');$('errBox').classList.remove('hidden');return}
  $('genBtn').disabled=true;$('genBtn').textContent=t('tools.pgpKeys.generatingKeys');
  try{
    const pass=$('pass').value;const bits=parseInt($('bits').value);
    const opts={type:'rsa',rsaBits:bits,userIDs:[{name:name,email:email}]};
    if(pass&&pass.length>0)opts.passphrase=pass;
    const{privateKey,publicKey}=await openpgp.generateKey(opts);
    $('pub').textContent=publicKey;$('prv').textContent=privateKey;
    $('keys').classList.remove('hidden');
  }catch(e){$('errBox').textContent=e.message||t('tools.pgpKeys.failedToGenerate');$('errBox').classList.remove('hidden')}
  finally{$('genBtn').disabled=false;updateUI()}
}
function updateUI(){
  $('h1').innerHTML=t('tools.pgpKeys.h1')+' <span>'+t('tools.pgpKeys.h1Highlight')+'</span>';
  $('sub').textContent=t('tools.pgpKeys.subtitle');$('lName').textContent=t('tools.pgpKeys.name');
  $('name').placeholder=t('tools.pgpKeys.namePlaceholder');$('lEmail').textContent=t('tools.pgpKeys.email');
  $('email').placeholder=t('tools.pgpKeys.emailPlaceholder');$('lPass').textContent=t('tools.pgpKeys.keyPassphrase');
  $('pass').placeholder=t('tools.pgpKeys.passphrasePlaceholder');$('lBits').textContent=t('tools.pgpKeys.rsaStrength');
  $('o1').textContent=t('tools.pgpKeys.bit2048');$('o2').textContent=t('tools.pgpKeys.bit4096');
  $('genBtn').textContent=t('tools.pgpKeys.generateBtn');$('lPub').textContent=t('tools.pgpKeys.publicKey');
  $('lPrv').textContent=t('tools.pgpKeys.privateKey');$('cpPub').textContent=t('tools.pgpKeys.copy');$('cpPrv').textContent=t('tools.pgpKeys.copy');
  $('iTitle').textContent=t('tools.pgpKeys.info.title');$('iText').textContent=t('tools.pgpKeys.info.text');
  document.title=t('tools.pgpKeys.meta.title')+' — encrypt.click (offline)';
}
</script>`;
  return buildHTML('PGP Keys', '', body, js, keys);
}

function generateAESWords() {
  const keys = ['tools.aesWords.meta.title','tools.aesWords.h1','tools.aesWords.h1Highlight','tools.aesWords.subtitle','tools.aesWords.encrypt','tools.aesWords.decrypt','tools.aesWords.secretPassword','tools.aesWords.passwordPlaceholder','tools.aesWords.inputText','tools.aesWords.wordsToDecrypt','tools.aesWords.encryptPlaceholder','tools.aesWords.decryptPlaceholder','tools.aesWords.generateWords','tools.aesWords.recoverText','tools.aesWords.ciphertextWords','tools.aesWords.decryptedOutput','tools.aesWords.errorBoth','tools.aesWords.errorGeneric','tools.aesWords.info.title','tools.aesWords.info.text'];
  // Inline the dictionary as JSON
  const dictJSON = JSON.stringify(dictionary);
  const body = `<div class="main">
  <div style="margin-bottom:32px"><h1 id="h1"></h1><p class="subtitle" id="sub"></p></div>
  <div class="card space-y">
    <div class="tab-bar"><button class="tab-btn active" id="tabEnc" onclick="setMode('encrypt')"></button><button class="tab-btn" id="tabDec" onclick="setMode('decrypt')"></button></div>
    <div><label class="label" id="lPw"></label><input type="password" class="input" id="pw" autocomplete="new-password" spellcheck="false"></div>
    <div><label class="label" id="lInp"></label><textarea class="input" id="inp" style="min-height:140px;resize:none" spellcheck="false" autocomplete="off"></textarea></div>
    <button class="btn btn-w" onclick="process()" id="procBtn"></button>
    <div id="errBox" class="error hidden"></div>
    <div id="resWrap" class="hidden"><label class="label" id="lRes"></label><div class="result-box" id="out" style="text-align:left;font-size:13px;line-height:1.8"></div></div>
  </div>
  <div class="info-section"><h3 class="info-title" id="iTitle"></h3><p class="info-text" id="iText"></p></div>
</div>`;
  const js = `<script>
const DICT=${dictJSON};
const SALT_SZ=16,IV_SZ=12,PBKDF2_ITER=100000;
let aesMode='encrypt';
async function deriveKey(pw,salt){const e=new TextEncoder();const k=await crypto.subtle.importKey('raw',e.encode(pw),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:PBKDF2_ITER,hash:'SHA-256'},k,{name:'AES-GCM',length:256},false,['encrypt','decrypt'])}
async function aesEnc(text,pw){const e=new TextEncoder();const salt=crypto.getRandomValues(new Uint8Array(SALT_SZ));const iv=crypto.getRandomValues(new Uint8Array(IV_SZ));const key=await deriveKey(pw,salt);const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,e.encode(text));const r=new Uint8Array(SALT_SZ+IV_SZ+ct.byteLength);r.set(salt,0);r.set(iv,SALT_SZ);r.set(new Uint8Array(ct),SALT_SZ+IV_SZ);return r}
async function aesDec(data,pw){const salt=data.slice(0,SALT_SZ);const iv=data.slice(SALT_SZ,SALT_SZ+IV_SZ);const ct=data.slice(SALT_SZ+IV_SZ);const key=await deriveKey(pw,salt);const pt=await crypto.subtle.decrypt({name:'AES-GCM',iv},key,ct);return new TextDecoder().decode(pt)}
function to14Bit(data){const len=data.byteLength;const c=new Uint8Array(len+2);c[0]=(len>>8)&0xff;c[1]=len&0xff;c.set(data,2);const chunks=[];let cv=0,cb=0;for(const b of c){cv=(cv<<8)|b;cb+=8;while(cb>=14){cb-=14;chunks.push((cv>>cb)&0x3fff);cv&=(1<<cb)-1}}if(cb>0)chunks.push((cv<<(14-cb))&0x3fff);return chunks}
function from14Bit(chunks){const bytes=[];let cv=0,cb=0;for(const ch of chunks){cv=(cv<<14)|(ch&0x3fff);cb+=14;while(cb>=8){cb-=8;bytes.push((cv>>cb)&0xff);cv&=(1<<cb)-1}}if(bytes.length<2)return new Uint8Array(0);const len=(bytes[0]<<8)|bytes[1];return new Uint8Array(bytes.slice(2,2+len))}
function setMode(m){aesMode=m;$('tabEnc').classList.toggle('active',m==='encrypt');$('tabDec').classList.toggle('active',m==='decrypt');$('inp').value='';$('errBox').classList.add('hidden');$('resWrap').classList.add('hidden');updateUI()}
async function process(){
  $('errBox').classList.add('hidden');$('resWrap').classList.add('hidden');
  const text=$('inp').value,pw=$('pw').value;
  if(!text||!pw){$('errBox').textContent=t('tools.aesWords.errorBoth');$('errBox').classList.remove('hidden');return}
  try{
    if(aesMode==='encrypt'){
      const enc=await aesEnc(text,pw);const chunks=to14Bit(enc);
      const words=chunks.map(i=>DICT[i]);$('out').textContent=words.join(' ');
    }else{
      const words=text.trim().split(/\\s+/);
      const chunks=words.map(w=>{const i=DICT.indexOf(w.toLowerCase());if(i===-1)throw new Error('Word not in dictionary: '+w);return i});
      const enc=from14Bit(chunks);$('out').textContent=await aesDec(enc,pw);
    }
    $('resWrap').classList.remove('hidden');
  }catch(e){$('errBox').textContent=e.message||t('tools.aesWords.errorGeneric');$('errBox').classList.remove('hidden')}
}
function updateUI(){
  $('h1').innerHTML=t('tools.aesWords.h1')+' <span>'+t('tools.aesWords.h1Highlight')+'</span>';
  $('sub').textContent=t('tools.aesWords.subtitle');
  $('tabEnc').textContent=t('tools.aesWords.encrypt');$('tabDec').textContent=t('tools.aesWords.decrypt');
  $('lPw').textContent=t('tools.aesWords.secretPassword');$('pw').placeholder=t('tools.aesWords.passwordPlaceholder');
  $('lInp').textContent=aesMode==='encrypt'?t('tools.aesWords.inputText'):t('tools.aesWords.wordsToDecrypt');
  $('inp').placeholder=aesMode==='encrypt'?t('tools.aesWords.encryptPlaceholder'):t('tools.aesWords.decryptPlaceholder');
  $('procBtn').textContent=aesMode==='encrypt'?t('tools.aesWords.generateWords'):t('tools.aesWords.recoverText');
  $('lRes').textContent=aesMode==='encrypt'?t('tools.aesWords.ciphertextWords'):t('tools.aesWords.decryptedOutput');
  $('iTitle').textContent=t('tools.aesWords.info.title');$('iText').textContent=t('tools.aesWords.info.text');
  document.title=t('tools.aesWords.meta.title')+' — encrypt.click (offline)';
}
</script>`;
  return buildHTML('AES Words', '', body, js, keys);
}

function generatePhotoCipher() {
  const keys = ['tools.photoCipher.meta.title','tools.photoCipher.h1','tools.photoCipher.h1Highlight','tools.photoCipher.subtitle','tools.photoCipher.encode','tools.photoCipher.decode','tools.photoCipher.sourceImage','tools.photoCipher.anyFormat','tools.photoCipher.secretMessage','tools.photoCipher.messagePlaceholder','tools.photoCipher.securityPassword','tools.photoCipher.encPasswordPlaceholder','tools.photoCipher.burnIntoPixels','tools.photoCipher.downloadEncoded','tools.photoCipher.decPasswordPlaceholder','tools.photoCipher.extractFromPixels','tools.photoCipher.foundMessage','tools.photoCipher.imageTooLarge','tools.photoCipher.imageLoadFailed','tools.photoCipher.imageLoaded','tools.photoCipher.encrypting','tools.photoCipher.encryptionFailed','tools.photoCipher.messageTooLong','tools.photoCipher.embedding','tools.photoCipher.messageHidden','tools.photoCipher.pleaseProvide','tools.photoCipher.pleaseProvideImage','tools.photoCipher.noHiddenMessage','tools.photoCipher.corrupted','tools.photoCipher.extracting','tools.photoCipher.decrypting','tools.photoCipher.decryptSuccess','tools.photoCipher.decryptFailed','tools.photoCipher.imageTooSmall','tools.photoCipher.capacityLabel','tools.photoCipher.chars','tools.photoCipher.robustBadge','tools.photoCipher.info.title','tools.photoCipher.info.text'];
  const body = `<div class="main" style="max-width:900px">
  <div style="margin-bottom:32px"><h1 id="h1"></h1><p class="subtitle" id="sub"></p></div>
  <div class="card space-y">
    <div class="tab-bar"><button class="tab-btn active" id="tabEnc" onclick="setMode('encode')"></button><button class="tab-btn" id="tabDec" onclick="setMode('decode')"></button></div>
    <div class="stego-grid">
      <div class="space-y">
        <div class="img-preview" id="imgArea"><input type="file" accept="image/*" id="fileInp" onchange="handleImage(event)"><div id="imgPlaceholder"><div style="font-size:14px;color:var(--text2)" id="lSrcImg"></div><div style="font-size:12px;color:var(--text3);font-style:italic" id="lFmt"></div></div><img id="preview" class="hidden" style="max-width:100%;max-height:100%;object-fit:contain"><img id="encPreview" class="hidden" style="max-width:100%;max-height:100%;object-fit:contain"></div>
        <div id="capLine" class="hidden" style="display:flex;align-items:center;gap:8px;font-size:12px"><span style="color:var(--text3)" id="lCap"></span><span style="font-family:var(--mono);color:var(--brand)" id="capVal"></span><span style="color:var(--text3)" id="lChars"></span></div>
        <div style="font-size:12px;font-style:italic;color:var(--brand)" id="status"></div>
        <div style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:9999px;background:rgba(16,185,129,0.06);border:1px solid rgba(16,185,129,0.15);font-size:10px;font-weight:500;color:#065f46;text-transform:uppercase;letter-spacing:0.05em" id="badge"></div>
      </div>
      <div class="space-y" id="controls"></div>
    </div>
    <canvas id="canvas" class="hidden"></canvas>
  </div>
  <div class="info-section"><h3 class="info-title" id="iTitle"></h3><p class="info-text" id="iText"></p></div>
</div>`;
  const js = `<script>
const BLOCK=8,DELTA=24,REP=7,MAGIC_STR='PCPH',HDR_SZ=8,CRYPTO_OH=44,MAX_FILE=10*1024*1024,MIN_DIM=800,MAX_DIM=2048;
const SALT_SZ=16,IV_SZ=12,PBKDF2_ITER=100000;
let pcMode='encode',imgUrl=null,encUrl=null,pcCap=0,pcW=0,pcH=0;

async function deriveKey(pw,salt){const e=new TextEncoder();const k=await crypto.subtle.importKey('raw',e.encode(pw),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:PBKDF2_ITER,hash:'SHA-256'},k,{name:'AES-GCM',length:256},false,['encrypt','decrypt'])}
async function aesEnc(text,pw){const e=new TextEncoder();const salt=crypto.getRandomValues(new Uint8Array(SALT_SZ));const iv=crypto.getRandomValues(new Uint8Array(IV_SZ));const key=await deriveKey(pw,salt);const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,e.encode(text));const r=new Uint8Array(SALT_SZ+IV_SZ+ct.byteLength);r.set(salt,0);r.set(iv,SALT_SZ);r.set(new Uint8Array(ct),SALT_SZ+IV_SZ);return r}
async function aesDec(data,pw){const salt=data.slice(0,SALT_SZ);const iv=data.slice(SALT_SZ,SALT_SZ+IV_SZ);const ct=data.slice(SALT_SZ+IV_SZ);const key=await deriveKey(pw,salt);const pt=await crypto.subtle.decrypt({name:'AES-GCM',iv},key,ct);return new TextDecoder().decode(pt)}

function xorshift32(seed){let s=seed||1;return()=>{s^=s<<13;s^=s>>17;s^=s<<5;return s>>>0}}
async function getSeed(pw){const h=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(pw));return new DataView(h).getUint32(0)||1}
function shuffledOrder(n,seed){const a=Array.from({length:n},(_,i)=>i);const rng=xorshift32(seed);for(let i=a.length-1;i>0;i--){const j=rng()%(i+1);[a[i],a[j]]=[a[j],a[i]]}return a}
function blockLum(d,bx,by,w){let s=0;for(let dy=0;dy<BLOCK;dy++)for(let dx=0;dx<BLOCK;dx++){const i=((by*BLOCK+dy)*w+bx*BLOCK+dx)*4;s+=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2]}return s/(BLOCK*BLOCK)}
function qimEmbed(d,bx,by,w,bit){const L=blockLum(d,bx,by,w);let q=Math.round(L/DELTA);if((q&1)!==bit){const u=q+1,dn=q-1;q=Math.abs(u*DELTA-L)<=Math.abs(dn*DELTA-L)?u:dn}const adj=q*DELTA-L;for(let dy=0;dy<BLOCK;dy++)for(let dx=0;dx<BLOCK;dx++){const i=((by*BLOCK+dy)*w+bx*BLOCK+dx)*4;d[i]=Math.max(0,Math.min(255,Math.round(d[i]+adj)));d[i+1]=Math.max(0,Math.min(255,Math.round(d[i+1]+adj)));d[i+2]=Math.max(0,Math.min(255,Math.round(d[i+2]+adj)))}}
function qimExtract(d,bx,by,w){return Math.round(blockLum(d,bx,by,w)/DELTA)&1}
function bytesToBits(bytes){const bits=[];for(const b of bytes)for(let i=7;i>=0;i--)bits.push((b>>i)&1);return bits}
function bitsToBytes(bits){const out=new Uint8Array(Math.ceil(bits.length/8));for(let i=0;i<bits.length;i++)out[i>>3]|=(bits[i]&1)<<(7-(i&7));return out}
function maxChars(w,h){const total=Math.floor(w/BLOCK)*Math.floor(h/BLOCK);return Math.max(0,Math.floor(total/(8*REP))-HDR_SZ-CRYPTO_OH)}

function normCanvas(img,forEnc){let w=img.naturalWidth||img.width,h=img.naturalHeight||img.height;if(forEnc){if(w<MIN_DIM||h<MIN_DIM){const s=Math.max(MIN_DIM/w,MIN_DIM/h);w=Math.round(w*s);h=Math.round(h*s)}if(w>MAX_DIM||h>MAX_DIM){const s=Math.min(MAX_DIM/w,MAX_DIM/h);w=Math.round(w*s);h=Math.round(h*s)}}w=Math.floor(w/BLOCK)*BLOCK;h=Math.floor(h/BLOCK)*BLOCK;const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);ctx.drawImage(img,0,0,w,h);return c}
function loadImg(src){return new Promise((res,rej)=>{const img=new Image();img.onload=()=>res(img);img.onerror=()=>rej(new Error('fail'));img.src=src})}

function handleImage(e){
  const f=e.target.files?.[0];if(!f)return;
  if(f.size>MAX_FILE){$('status').textContent=t('tools.photoCipher.imageTooLarge');imgUrl=null;encUrl=null;pcCap=0;return}
  encUrl=null;$('encPreview').classList.add('hidden');
  const blobUrl=URL.createObjectURL(f);
  loadImg(blobUrl).then(img=>{
    URL.revokeObjectURL(blobUrl);
    const norm=normCanvas(img,pcMode==='encode');pcW=norm.width;pcH=norm.height;
    imgUrl=norm.toDataURL('image/png');pcCap=maxChars(pcW,pcH);
    $('preview').src=imgUrl;$('preview').classList.remove('hidden');$('imgPlaceholder').classList.add('hidden');
    $('status').textContent=t('tools.photoCipher.imageLoaded').replace('{w}',pcW).replace('{h}',pcH).replace('{chars}',pcCap);
    if(pcMode==='encode'){$('capLine').classList.remove('hidden');$('capLine').style.display='flex';$('capVal').textContent='~'+pcCap;}
    updateControls();
  }).catch(()=>{$('status').textContent=t('tools.photoCipher.imageLoadFailed');imgUrl=null;pcCap=0})
}

function setMode(m){pcMode=m;$('tabEnc').classList.toggle('active',m==='encode');$('tabDec').classList.toggle('active',m==='decode');encUrl=null;$('encPreview').classList.add('hidden');$('capLine').classList.add('hidden');$('capLine').style.display='none';updateControls()}
function updateControls(){
  const c=$('controls');
  if(pcMode==='encode'){
    c.innerHTML='<div class="space-y"><div><label class="label">'+t('tools.photoCipher.secretMessage')+'</label><textarea class="input" id="msg" placeholder="'+t('tools.photoCipher.messagePlaceholder')+'" style="min-height:120px;resize:none" spellcheck="false"></textarea></div><div><label class="label">'+t('tools.photoCipher.securityPassword')+'</label><input type="password" class="input" id="pw" placeholder="'+t('tools.photoCipher.encPasswordPlaceholder')+'" autocomplete="new-password"></div><button class="btn btn-w" onclick="doEncode()" id="encBtn">'+t('tools.photoCipher.burnIntoPixels')+'</button><div id="dlWrap" class="hidden"><button class="btn-outline btn-w" onclick="dlEnc()">'+t('tools.photoCipher.downloadEncoded')+'</button></div></div>';
  }else{
    c.innerHTML='<div class="space-y"><div><label class="label">'+t('tools.photoCipher.securityPassword')+'</label><input type="password" class="input" id="pw" placeholder="'+t('tools.photoCipher.decPasswordPlaceholder')+'" autocomplete="current-password"></div><button class="btn-outline btn-w" onclick="doDecode()" id="decBtn">'+t('tools.photoCipher.extractFromPixels')+'</button><div id="foundWrap" class="hidden"><label class="label">'+t('tools.photoCipher.foundMessage')+'</label><div class="result-box" id="foundMsg" style="text-align:left;font-size:13px;min-height:120px"></div></div></div>';
  }
}
async function doEncode(){
  if(!imgUrl||!$('msg').value||!$('pw').value){$('status').textContent=t('tools.photoCipher.pleaseProvide');return}
  const btn=$('encBtn');btn.disabled=true;btn.textContent=t('tools.photoCipher.embedding');
  try{
    const img=await loadImg(imgUrl);const norm=normCanvas(img,true);const ctx=norm.getContext('2d');
    const id=ctx.getImageData(0,0,norm.width,norm.height);const px=id.data;
    const bx=norm.width/BLOCK,by=norm.height/BLOCK,total=bx*by;
    $('status').textContent=t('tools.photoCipher.encrypting');
    let cipher;try{cipher=await aesEnc($('msg').value,$('pw').value)}catch{$('status').textContent=t('tools.photoCipher.encryptionFailed');btn.disabled=false;return}
    const magic=new TextEncoder().encode(MAGIC_STR);const len=cipher.length;
    const payload=new Uint8Array(HDR_SZ+len);payload.set(magic,0);payload[4]=(len>>24)&0xff;payload[5]=(len>>16)&0xff;payload[6]=(len>>8)&0xff;payload[7]=len&0xff;payload.set(cipher,HDR_SZ);
    const bits=bytesToBits(payload);const expanded=[];for(const b of bits)for(let r=0;r<REP;r++)expanded.push(b);
    if(expanded.length>total){$('status').textContent=t('tools.photoCipher.messageTooLong');btn.disabled=false;return}
    $('status').textContent=t('tools.photoCipher.embedding');
    const seed=await getSeed($('pw').value);const order=shuffledOrder(total,seed);
    await new Promise(r=>setTimeout(r,0));
    for(let i=0;i<expanded.length;i++){const idx=order[i];qimEmbed(px,idx%bx,Math.floor(idx/bx),norm.width,expanded[i])}
    ctx.putImageData(id,0,0);encUrl=norm.toDataURL('image/png');
    $('encPreview').src=encUrl;$('encPreview').classList.remove('hidden');$('preview').classList.add('hidden');
    $('status').textContent=t('tools.photoCipher.messageHidden');
    const dl=document.getElementById('dlWrap');if(dl)dl.classList.remove('hidden');
  }catch{$('status').textContent=t('tools.photoCipher.encryptionFailed')}
  btn.disabled=false;btn.textContent=t('tools.photoCipher.burnIntoPixels');
}
function dlEnc(){if(!encUrl)return;const a=document.createElement('a');a.download='photo-cipher.png';a.href=encUrl;a.click()}
async function doDecode(){
  if(!imgUrl||!$('pw').value){$('status').textContent=t('tools.photoCipher.pleaseProvideImage');return}
  const btn=$('decBtn');btn.disabled=true;btn.textContent=t('tools.photoCipher.extracting');
  try{
    const img=await loadImg(imgUrl);const norm=normCanvas(img,false);const ctx=norm.getContext('2d');
    const id=ctx.getImageData(0,0,norm.width,norm.height);const px=id.data;
    const bxC=norm.width/BLOCK,byC=norm.height/BLOCK,total=bxC*byC;
    if(total<HDR_SZ*8*REP){$('status').textContent=t('tools.photoCipher.imageTooSmall');btn.disabled=false;return}
    $('status').textContent=t('tools.photoCipher.extracting');
    const seed=await getSeed($('pw').value);const order=shuffledOrder(total,seed);
    await new Promise(r=>setTimeout(r,0));
    const raw=new Array(total);for(let i=0;i<total;i++){const idx=order[i];raw[i]=qimExtract(px,idx%bxC,Math.floor(idx/bxC),norm.width)}
    const maxBits=Math.floor(total/REP);const data=new Array(maxBits);
    for(let i=0;i<maxBits;i++){let ones=0;const base=i*REP;for(let r=0;r<REP;r++)ones+=raw[base+r];data[i]=ones>REP/2?1:0}
    const magicB=bitsToBytes(data.slice(0,32));if(new TextDecoder().decode(magicB)!==MAGIC_STR){$('status').textContent=t('tools.photoCipher.noHiddenMessage');btn.disabled=false;return}
    const lenB=bitsToBytes(data.slice(32,64));const pLen=(lenB[0]<<24)|(lenB[1]<<16)|(lenB[2]<<8)|lenB[3];
    if(pLen<=0||64+pLen*8>data.length){$('status').textContent=t('tools.photoCipher.corrupted');btn.disabled=false;return}
    const cipherB=bitsToBytes(data.slice(64,64+pLen*8));$('status').textContent=t('tools.photoCipher.decrypting');
    const msg=await aesDec(cipherB,$('pw').value);$('status').textContent=t('tools.photoCipher.decryptSuccess');
    const fw=document.getElementById('foundWrap'),fm=document.getElementById('foundMsg');
    if(fw&&fm){fw.classList.remove('hidden');fm.textContent=msg}
  }catch{$('status').textContent=t('tools.photoCipher.decryptFailed')}
  btn.disabled=false;btn.textContent=t('tools.photoCipher.extractFromPixels');
}
function updateUI(){
  $('h1').innerHTML=t('tools.photoCipher.h1')+' <span>'+t('tools.photoCipher.h1Highlight')+'</span>';
  $('sub').textContent=t('tools.photoCipher.subtitle');
  $('tabEnc').textContent=t('tools.photoCipher.encode');$('tabDec').textContent=t('tools.photoCipher.decode');
  $('lSrcImg').textContent=t('tools.photoCipher.sourceImage');$('lFmt').textContent=t('tools.photoCipher.anyFormat');
  $('lCap').textContent=t('tools.photoCipher.capacityLabel');$('lChars').textContent=t('tools.photoCipher.chars');
  $('badge').textContent=t('tools.photoCipher.robustBadge');
  $('iTitle').textContent=t('tools.photoCipher.info.title');$('iText').textContent=t('tools.photoCipher.info.text');
  document.title=t('tools.photoCipher.meta.title')+' — encrypt.click (offline)';
  updateControls();
}
</script>`;
  return buildHTML('Photo Cipher', '', body, js, keys);
}

function generateDeadDrop() {
  const keys = ['tools.deadDrop.textLabel','tools.deadDrop.textPlaceholder','tools.deadDrop.orSmallFile','tools.deadDrop.password','tools.deadDrop.creatingLink','tools.deadDrop.generateLink','tools.deadDrop.payloadNote','tools.deadDrop.deadDropLink','tools.deadDrop.encryptedPayload','tools.deadDrop.openDrop','tools.deadDrop.decrypting','tools.deadDrop.decryptedText','tools.deadDrop.fileDecrypted','tools.deadDrop.downloadFile','tools.deadDrop.passwordRequired','tools.deadDrop.errorNoData','tools.deadDrop.errorOpen','tools.deadDrop.errorFileTooLarge','tools.deadDrop.errorTextTooLarge','tools.deadDrop.errorEnterText'];
  // Dead Drop has the special "h1" in the page title from the astro page; let's use a reasonable default
  const body = `<div class="main">
  <div style="margin-bottom:32px"><h1>Dead <span>Drop.</span></h1><p class="subtitle">Encrypt a short message or file into a self-contained URL. Everything lives in the hash fragment — no server, no storage. AES-256-GCM + gzip.</p></div>
  <div class="card space-y" id="createSection">
    <div><label class="label" id="lText"></label><textarea class="input" id="textInp" style="min-height:140px;resize:vertical;font-family:var(--mono);font-size:12px"></textarea></div>
    <div><label class="label" id="lFile"></label><input type="file" class="input" id="fileInp" style="cursor:pointer"></div>
    <div class="grid2" style="align-items:end">
      <div><label class="label" id="lPw"></label><input type="password" class="input" id="pw" autocomplete="new-password"></div>
      <button class="btn" onclick="handleCreate()" id="createBtn"></button>
    </div>
    <p style="font-size:11px;color:var(--text3)" id="payloadNote"></p>
    <div id="errBox" class="error hidden"></div>
    <div id="linkWrap" class="hidden space-y">
      <div><label class="label" id="lLink"></label><input class="input" type="text" readonly id="linkOut" style="font-family:var(--mono);font-size:11px" onclick="this.select()"></div>
    </div>
  </div>
  <div class="card space-y hidden" id="openSection">
    <p style="font-size:13px;color:var(--text2)" id="openDesc"></p>
    <div><label class="label" id="lPw2"></label><input type="password" class="input" id="openPw" autocomplete="current-password"></div>
    <button class="btn btn-w" onclick="handleOpen()" id="openBtn"></button>
    <div id="openErr" class="error hidden"></div>
    <div id="openText" class="hidden"><h3 class="label" style="color:var(--brand)" id="lDecText"></h3><div class="output-box" style="font-family:var(--mono);white-space:pre-wrap;text-align:left" id="decText"></div></div>
    <div id="openFile" class="hidden space-y"><p style="font-size:12px;color:var(--brand)" id="fileLabel"></p><button class="btn-outline" onclick="dlFile()" id="dlFileBtn"></button></div>
  </div>
</div>`;
  const js = `<script>
const MAX_BYTES=10*1024;
const SALT_SZ=16,IV_SZ=12,PBKDF2_ITER=100000;
let hasHash=false,hashPayload='',openedFileUrl='',openedFileName='';
async function deriveKey(pw,salt){const e=new TextEncoder();const k=await crypto.subtle.importKey('raw',e.encode(pw),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:PBKDF2_ITER,hash:'SHA-256'},k,{name:'AES-GCM',length:256},false,['encrypt','decrypt'])}
async function aesEnc(text,pw){const e=new TextEncoder();const salt=crypto.getRandomValues(new Uint8Array(SALT_SZ));const iv=crypto.getRandomValues(new Uint8Array(IV_SZ));const key=await deriveKey(pw,salt);const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,e.encode(text));const r=new Uint8Array(SALT_SZ+IV_SZ+ct.byteLength);r.set(salt,0);r.set(iv,SALT_SZ);r.set(new Uint8Array(ct),SALT_SZ+IV_SZ);return r}
async function aesDec(data,pw){const salt=data.slice(0,SALT_SZ);const iv=data.slice(SALT_SZ,SALT_SZ+IV_SZ);const ct=data.slice(SALT_SZ+IV_SZ);const key=await deriveKey(pw,salt);const pt=await crypto.subtle.decrypt({name:'AES-GCM',iv},key,ct);return new TextDecoder().decode(pt)}
function b64UrlEnc(bytes){let b='';for(let i=0;i<bytes.length;i++)b+=String.fromCharCode(bytes[i]);return btoa(b).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/g,'')}
function b64UrlDec(input){const b64=input.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(input.length/4)*4,'=');const binary=atob(b64);const bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);return bytes}
function bytesToB64(bytes){let b='';for(let i=0;i<bytes.length;i++)b+=String.fromCharCode(bytes[i]);return btoa(b)}
async function gzip(input){const stream=new Blob([input]).stream().pipeThrough(new CompressionStream('gzip'));return new Uint8Array(await new Response(stream).arrayBuffer())}
async function gunzip(input){const stream=new Blob([input]).stream().pipeThrough(new DecompressionStream('gzip'));return new Uint8Array(await new Response(stream).arrayBuffer())}

(function(){
  const hash=window.location.hash||'';
  if(hash.length>1){hasHash=true;hashPayload=decodeURIComponent(hash.slice(1));
    $('createSection').classList.add('hidden');$('openSection').classList.remove('hidden');
  }
})();

async function handleCreate(){
  $('errBox').classList.add('hidden');$('linkWrap').classList.add('hidden');
  const pw=$('pw').value;if(!pw){$('errBox').textContent=t('tools.deadDrop.passwordRequired');$('errBox').classList.remove('hidden');return}
  const fileEl=$('fileInp');const file=fileEl.files&&fileEl.files[0];
  let payload;
  try{
    if(file){
      if(file.size>MAX_BYTES)throw new Error(t('tools.deadDrop.errorFileTooLarge'));
      const buf=await file.arrayBuffer();const bytes=new Uint8Array(buf);
      let b64='';for(let i=0;i<bytes.length;i++)b64+=String.fromCharCode(bytes[i]);b64=btoa(b64);
      payload={kind:'file',name:file.name,type:file.type||'application/octet-stream',data:b64};
    }else{
      const text=$('textInp').value.trim();
      if(!text)throw new Error(t('tools.deadDrop.errorEnterText'));
      if(new TextEncoder().encode(text).byteLength>MAX_BYTES)throw new Error(t('tools.deadDrop.errorTextTooLarge'));
      payload={kind:'text',text};
    }
  }catch(e){$('errBox').textContent=e.message;$('errBox').classList.remove('hidden');return}
  $('createBtn').disabled=true;$('createBtn').textContent=t('tools.deadDrop.creatingLink');
  try{
    const json=JSON.stringify(payload);const jsonBytes=new TextEncoder().encode(json);
    const compressed=await gzip(jsonBytes);const compB64=bytesToB64(compressed);
    const encrypted=await aesEnc(compB64,pw);const encoded=b64UrlEnc(encrypted);
    const origin=window.location.origin;
    $('linkOut').value=origin+window.location.pathname+'#'+encoded;
    $('linkWrap').classList.remove('hidden');
  }catch(e){$('errBox').textContent=e.message||'Failed to create link.';$('errBox').classList.remove('hidden')}
  finally{$('createBtn').disabled=false;updateUI()}
}

async function handleOpen(){
  $('openErr').classList.add('hidden');$('openText').classList.add('hidden');$('openFile').classList.add('hidden');
  if(!hashPayload){$('openErr').textContent=t('tools.deadDrop.errorNoData');$('openErr').classList.remove('hidden');return}
  const pw=$('openPw').value;if(!pw){$('openErr').textContent=t('tools.deadDrop.passwordRequired');$('openErr').classList.remove('hidden');return}
  $('openBtn').disabled=true;$('openBtn').textContent=t('tools.deadDrop.decrypting');
  try{
    const bytes=b64UrlDec(hashPayload);const compB64=await aesDec(bytes,pw);
    const compressed=Uint8Array.from(atob(compB64),c=>c.charCodeAt(0));
    const decompressed=await gunzip(compressed);const json=new TextDecoder().decode(decompressed);
    const data=JSON.parse(json);
    if(data.kind==='text'){$('decText').textContent=data.text||'';$('openText').classList.remove('hidden');}
    else if(data.kind==='file'&&data.data){
      const binary=atob(data.data);const buf=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)buf[i]=binary.charCodeAt(i);
      const blob=new Blob([buf],{type:data.type||'application/octet-stream'});
      if(openedFileUrl)URL.revokeObjectURL(openedFileUrl);
      openedFileUrl=URL.createObjectURL(blob);openedFileName=data.name||'download';
      $('fileLabel').textContent=t('tools.deadDrop.fileDecrypted')+' '+openedFileName;$('openFile').classList.remove('hidden');
    }else throw new Error('Unsupported');
  }catch(e){$('openErr').textContent=t('tools.deadDrop.errorOpen');$('openErr').classList.remove('hidden')}
  finally{$('openBtn').disabled=false;updateUI()}
}
function dlFile(){if(!openedFileUrl)return;const a=document.createElement('a');a.href=openedFileUrl;a.download=openedFileName||'download';a.click()}
function updateUI(){
  $('lText').textContent=t('tools.deadDrop.textLabel');$('textInp').placeholder=t('tools.deadDrop.textPlaceholder');
  $('lFile').textContent=t('tools.deadDrop.orSmallFile');$('lPw').textContent=t('tools.deadDrop.password');
  $('createBtn').textContent=t('tools.deadDrop.generateLink');$('payloadNote').textContent=t('tools.deadDrop.payloadNote');
  $('lLink').textContent=t('tools.deadDrop.deadDropLink');
  $('openDesc').textContent=t('tools.deadDrop.encryptedPayload');$('lPw2').textContent=t('tools.deadDrop.password');
  $('openBtn').textContent=t('tools.deadDrop.openDrop');$('lDecText').textContent=t('tools.deadDrop.decryptedText');
  $('dlFileBtn').textContent=t('tools.deadDrop.downloadFile');
  document.title='Dead Drop — encrypt.click (offline)';
}
</script>`;
  return buildHTML('Dead Drop', '', body, js, keys);
}

function generateEncryptTunnel() {
  // Encrypt & Tunnel: local AES-256-GCM encrypt + steganography + multi-host direct upload + decrypt from file/URL
  // Upload goes direct to public hosts (CORS-allowing ones). For image hosts that require server proxy, we skip them
  // and only use file hosts that accept direct browser CORS uploads.
  const keys = [];
  const body = `<div class="main" style="max-width:900px">
  <div style="margin-bottom:32px"><h1>Encrypt <span>& Tunnel.</span></h1><p class="subtitle">Encrypt any file with AES-256-GCM, then upload to anonymous file hosts — or decrypt from a file. Everything runs locally.</p></div>
  <div class="card space-y">
    <div class="tab-bar"><button class="tab-btn active" id="tabEnc" onclick="setMode('encrypt')">Encrypt & Upload</button><button class="tab-btn" id="tabDec" onclick="setMode('decrypt')">Decrypt</button></div>
    <div id="encSection">
      <div class="space-y">
        <div><label class="label">File to encrypt (max 25 MB)</label><input type="file" class="input" id="fileInp" style="cursor:pointer"></div>
        <div id="fileInfo" class="hidden" style="font-size:11px;color:var(--text2)"></div>
        <div><label class="label">Encryption password</label><input type="text" class="input" id="pw" style="font-family:var(--mono);font-size:12px" autocomplete="new-password" spellcheck="false"><div style="display:flex;align-items:center;gap:12px;margin-top:8px;flex-wrap:wrap"><label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text2)"><input type="checkbox" id="autoPw" checked> Auto-generate if empty</label><button class="btn-outline" style="font-size:11px;padding:4px 12px" onclick="$('pw').value=genRandPw(32)">Generate strong password</button></div></div>
        <div style="padding:12px;background:rgba(59,130,246,0.06);border:1px solid rgba(59,130,246,0.15);border-radius:12px;font-size:11px;color:#1d4ed8"><strong>File hosts</strong> store base64-encoded encrypted data as .txt. <strong>Steganography</strong> embeds encrypted data in a PNG image.</div>
        <div class="space-y-sm">
          <label class="label">Upload destinations</label>
          <div id="serviceList" style="display:flex;flex-direction:column;gap:8px"></div>
        </div>
        <button class="btn btn-w" onclick="handleUpload()" id="uploadBtn">Encrypt & Upload</button>
        <div id="encErr" class="error hidden"></div>
      </div>
      <div id="logWrap" class="hidden" style="margin-top:16px"><div class="label" style="font-size:10px">Log</div><div id="logBox" style="padding:12px;background:#18181b;border-radius:12px;font-family:var(--mono);font-size:11px;color:#a1a1aa;max-height:192px;overflow-y:auto"></div></div>
      <div id="resultsWrap" class="hidden" style="margin-top:16px">
        <div class="label" style="font-size:10px">Upload Results</div>
        <div id="resultsList" class="space-y-sm"></div>
        <div style="margin-top:12px"><button class="btn-outline btn-w" onclick="copyAllUrls()">Copy All URLs</button></div>
      </div>
      <div id="pwReveal" class="hidden" style="margin-top:16px;padding:16px;background:rgba(245,158,11,0.06);border:1px solid rgba(245,158,11,0.15);border-radius:16px">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#b45309;margin-bottom:8px">Your Encryption Password</div>
        <div style="display:flex;gap:8px;align-items:center"><input type="text" readonly class="input" id="pwOut" style="font-family:var(--mono);font-size:12px;flex:1"><button class="btn-outline" onclick="copyText($('pwOut').value)" style="font-size:11px;padding:6px 16px">Copy</button></div>
        <p style="font-size:10px;color:#b45309;margin-top:8px">Save this password! Recipients need it to decrypt.</p>
      </div>
    </div>
    <div id="decSection" class="hidden">
      <div class="space-y">
        <div class="tab-bar" style="max-width:240px"><button class="tab-btn active" id="tabUrl" onclick="setDecMode('url')">From URL</button><button class="tab-btn" id="tabFile" onclick="setDecMode('file')">From File</button></div>
        <div id="decUrlSection"><label class="label">URL to encrypted file</label><input type="text" class="input" id="decUrl" style="font-family:var(--mono);font-size:12px" placeholder="https://qu.ax/xxx.txt or direct image link"><p style="font-size:10px;color:var(--text3);margin-top:4px">Supports base64 .txt files and steganography images</p></div>
        <div id="decFileSection" class="hidden"><label class="label">Select encrypted file</label><input type="file" class="input" id="decFileInp" style="cursor:pointer"><p style="font-size:10px;color:var(--text3);margin-top:4px">Supports .txt (base64) and .png (steganography)</p></div>
        <div><label class="label">Decryption password</label><input type="text" class="input" id="decPw" style="font-family:var(--mono);font-size:12px" placeholder="Enter the password used for encryption"></div>
        <button class="btn btn-w" onclick="handleDecrypt()" id="decBtn">Decrypt File</button>
        <div id="decErr" class="error hidden"></div>
        <div id="decResult" class="hidden" style="padding:16px;background:rgba(16,185,129,0.06);border:1px solid rgba(16,185,129,0.15);border-radius:16px"><div style="display:flex;align-items:center;gap:12px"><div style="flex:1"><div style="font-size:11px;font-weight:700;color:#065f46">Decrypted successfully!</div><div style="font-size:10px;color:var(--brand);font-family:var(--mono)" id="decInfo"></div></div><button class="btn" onclick="dlDecrypted()" style="font-size:12px">Download</button></div></div>
      </div>
    </div>
  </div>
</div>`;
  const js = `<script>
const SALT_SZ=16,IV_SZ=12,PBKDF2_ITER=100000,MARKER_STR='!!DONE!!';
const MARKER=new TextEncoder().encode(MARKER_STR);
async function deriveKey(pw,salt){const e=new TextEncoder();const k=await crypto.subtle.importKey('raw',e.encode(pw),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:PBKDF2_ITER,hash:'SHA-256'},k,{name:'AES-GCM',length:256},false,['encrypt','decrypt'])}
async function ghostEncrypt(data,pw,name){
  const salt=crypto.getRandomValues(new Uint8Array(SALT_SZ));const iv=crypto.getRandomValues(new Uint8Array(IV_SZ));const key=await deriveKey(pw,salt);
  const meta=JSON.stringify({name:name||'',size:data.length});const mb=new TextEncoder().encode(meta);
  const payload=new Uint8Array(1+mb.length+data.length);payload[0]=mb.length;payload.set(mb,1);payload.set(data,1+mb.length);
  const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,payload);
  const r=new Uint8Array(SALT_SZ+IV_SZ+ct.byteLength);r.set(salt,0);r.set(iv,SALT_SZ);r.set(new Uint8Array(ct),SALT_SZ+IV_SZ);return r;
}
async function ghostDecrypt(enc,pw){
  const salt=enc.slice(0,SALT_SZ);const iv=enc.slice(SALT_SZ,SALT_SZ+IV_SZ);const ct=enc.slice(SALT_SZ+IV_SZ);
  const key=await deriveKey(pw,salt);const pt=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv},key,ct));
  const ml=pt[0];const meta=JSON.parse(new TextDecoder().decode(pt.slice(1,1+ml)));
  return{data:pt.slice(1+ml),name:meta.name||'decrypted-file'};
}
function createStegoImage(data){
  const payload=new Uint8Array(data.length+MARKER.length);payload.set(data,0);payload.set(MARKER,data.length);
  const bits=[];for(const b of payload)for(let i=7;i>=0;i--)bits.push((b>>i)&1);
  const totalPx=Math.ceil(bits.length/3);const size=Math.ceil(Math.sqrt(totalPx))+20;
  const c=document.createElement('canvas');c.width=size;c.height=size;const ctx=c.getContext('2d');
  const id=ctx.createImageData(size,size);const px=id.data;let bi=0;
  for(let i=0;i<px.length;i+=4){px[i]=50+Math.floor(Math.random()*100);px[i+1]=50+Math.floor(Math.random()*100);px[i+2]=50+Math.floor(Math.random()*100);px[i+3]=255;
    if(bi<bits.length)px[i]=(px[i]&0xfe)|bits[bi++];if(bi<bits.length)px[i+1]=(px[i+1]&0xfe)|bits[bi++];if(bi<bits.length)px[i+2]=(px[i+2]&0xfe)|bits[bi++];}
  ctx.putImageData(id,0,0);
  return new Promise((res,rej)=>{c.toBlob(b=>{if(!b)return rej();b.arrayBuffer().then(buf=>res(new Uint8Array(buf)));},'image/png');});
}
function extractStego(imageData){
  return new Promise(async(res)=>{
    const blob=new Blob([imageData],{type:'image/png'});const bmp=await createImageBitmap(blob);
    const c=document.createElement('canvas');c.width=bmp.width;c.height=bmp.height;const ctx=c.getContext('2d');
    ctx.drawImage(bmp,0,0);const id=ctx.getImageData(0,0,c.width,c.height);const px=id.data;
    const bits=[];for(let i=0;i<px.length;i+=4){bits.push(px[i]&1);bits.push(px[i+1]&1);bits.push(px[i+2]&1);}
    const bytes=[];for(let i=0;i<bits.length;i+=8){if(i+8>bits.length)break;let b=0;for(let j=0;j<8;j++)b=(b<<1)|bits[i+j];bytes.push(b);
      if(bytes.length>=MARKER.length){const tail=bytes.slice(-MARKER.length);if(tail.every((b,i)=>b===MARKER[i]))return res(new Uint8Array(bytes.slice(0,-MARKER.length)));}}
    res(null);
  });
}
function ab2b64(arr){let b='';for(let i=0;i<arr.length;i++)b+=String.fromCharCode(arr[i]);return btoa(b)}
function b642ab(b64){const s=b64.replace(/[^A-Za-z0-9+\\/=]/g,'').trim();const p=s.padEnd(Math.ceil(s.length/4)*4,'=');const b=atob(p);const a=new Uint8Array(b.length);for(let i=0;i<b.length;i++)a[i]=b.charCodeAt(i);return a}
function genRandPw(n){const b=crypto.getRandomValues(new Uint8Array(n));const c='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.~';let o='';for(let i=0;i<n;i++)o+=c[b[i]%c.length];return o}
function genRandName(){const b=crypto.getRandomValues(new Uint8Array(16));return Array.from(b,x=>x.toString(16).padStart(2,'0')).join('')}

const SERVICES=[
  {id:'tmpfiles',name:'tmpfiles.org',type:'file',maxMB:100,retention:'60 min',url:'https://tmpfiles.org/api/v1/upload',field:'file'},
  {id:'0x0',name:'0x0.st',type:'file',maxMB:512,retention:'30 days',url:'https://0x0.st',field:'file'},
];
let etMode='encrypt',decMode='url',etFile=null,decryptedResult=null,logs=[];
function setMode(m){etMode=m;$('tabEnc').classList.toggle('active',m==='encrypt');$('tabDec').classList.toggle('active',m==='decrypt');$('encSection').classList.toggle('hidden',m!=='encrypt');$('decSection').classList.toggle('hidden',m!=='decrypt');}
function setDecMode(m){decMode=m;$('tabUrl').classList.toggle('active',m==='url');$('tabFile').classList.toggle('active',m==='file');$('decUrlSection').classList.toggle('hidden',m!=='url');$('decFileSection').classList.toggle('hidden',m!=='file');}
$('fileInp').addEventListener('change',e=>{const f=e.target.files[0];if(!f)return;if(f.size>25*1024*1024){$('encErr').textContent='File exceeds 25 MB.';$('encErr').classList.remove('hidden');etFile=null;return;}etFile=f;$('fileInfo').textContent='Selected: '+f.name+' — '+(f.size/(1024*1024)).toFixed(2)+' MB';$('fileInfo').classList.remove('hidden');$('encErr').classList.add('hidden');});
function addLog(msg){const ts=new Date().toLocaleTimeString();logs.push('['+ts+'] '+msg);$('logBox').innerHTML=logs.map(l=>'<div>'+l+'</div>').join('');$('logWrap').classList.remove('hidden');}
function initServices(){$('serviceList').innerHTML=SERVICES.map(s=>'<label style="display:flex;align-items:center;gap:8px;padding:8px 12px;border:1px solid var(--border);border-radius:8px;cursor:pointer;font-size:11px"><input type="checkbox" value="'+s.id+'" checked> <span style="font-weight:600">'+s.name+'</span> <span style="color:var(--text3)">('+s.type+', max '+s.maxMB+'MB, '+s.retention+')</span></label>').join('');}
function getSelectedServices(){return Array.from(document.querySelectorAll('#serviceList input:checked')).map(el=>el.value)}
async function handleUpload(){
  if(!etFile)return;const sids=getSelectedServices();if(!sids.length){$('encErr').textContent='Select at least one service.';$('encErr').classList.remove('hidden');return;}
  let pw=$('pw').value;if(!pw&&$('autoPw').checked)pw=genRandPw(32);$('pw').value=pw;
  if(!pw){$('encErr').textContent='Password is required.';$('encErr').classList.remove('hidden');return;}
  $('encErr').classList.add('hidden');$('resultsWrap').classList.add('hidden');$('pwReveal').classList.add('hidden');logs=[];
  $('uploadBtn').disabled=true;$('uploadBtn').textContent='Processing...';
  try{
    addLog('Reading file...');const buf=new Uint8Array(await etFile.arrayBuffer());addLog('File size: '+(buf.length/1024).toFixed(2)+' KB');
    addLog('Encrypting with AES-256-GCM...');const encrypted=await ghostEncrypt(buf,pw,etFile.name);addLog('Encrypted size: '+(encrypted.length/1024).toFixed(2)+' KB');
    addLog('Encoding to base64...');const b64=ab2b64(encrypted);const txtBuf=new TextEncoder().encode(b64);addLog('Base64 size: '+(txtBuf.length/1024).toFixed(2)+' KB');
    const randName=genRandName();const results=[];
    for(const sid of sids){
      const svc=SERVICES.find(s=>s.id===sid);if(!svc)continue;
      addLog('Uploading to '+svc.name+'...');
      try{
        const fd=new FormData();fd.append(svc.field,new Blob([txtBuf],{type:'text/plain'}),randName+'.txt');
        const res=await fetch(svc.url,{method:'POST',body:fd,mode:'cors'});
        if(!res.ok)throw new Error('HTTP '+res.status);
        let url;
        if(sid==='0x0'){url=(await res.text()).trim();}
        else if(sid==='tmpfiles'){const d=await res.json();url=d?.data?.url||d?.url||d?.link;if(url&&!url.startsWith('http'))url='https://tmpfiles.org'+url;}
        if(url){addLog('✓ '+svc.name+': '+url);results.push({svc:svc.name,url});}
        else{addLog('✗ '+svc.name+': no URL');results.push({svc:svc.name,url:null,err:'No URL returned'});}
      }catch(e){addLog('✗ '+svc.name+': '+e.message);results.push({svc:svc.name,url:null,err:e.message});}
    }
    $('resultsList').innerHTML=results.map(r=>r.url?'<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border:1px solid var(--border);border-radius:8px"><div style="flex:1"><div style="font-size:11px;font-weight:600">'+r.svc+'</div><div style="font-size:10px;font-family:var(--mono);color:var(--text2);overflow:hidden;text-overflow:ellipsis">'+r.url+'</div></div><button class="btn-outline" onclick="copyText(\\''+r.url.replace(/'/g,"\\\\'")+'\\')" style="font-size:10px;padding:4px 10px">Copy</button></div>':'<div style="padding:8px 12px;border:1px solid rgba(239,68,68,0.2);border-radius:8px;background:rgba(239,68,68,0.04)"><div style="font-size:11px;font-weight:600">'+r.svc+'</div><div style="font-size:10px;color:#dc2626">'+(r.err||'Failed')+'</div></div>').join('');
    $('resultsWrap').classList.remove('hidden');
    $('pwOut').value=pw;$('pwReveal').classList.remove('hidden');
    addLog('Done! '+results.filter(r=>r.url).length+' succeeded, '+results.filter(r=>!r.url).length+' failed.');
    window._etResults=results;
  }catch(e){$('encErr').textContent=e.message;$('encErr').classList.remove('hidden');addLog('ERROR: '+e.message);}
  finally{$('uploadBtn').disabled=false;$('uploadBtn').textContent='Encrypt & Upload';}
}
function copyAllUrls(){if(!window._etResults)return;const urls=window._etResults.filter(r=>r.url).map(r=>r.url).join('\\n');copyText(urls);}
async function handleDecrypt(){
  $('decErr').classList.add('hidden');$('decResult').classList.add('hidden');decryptedResult=null;
  const pw=$('decPw').value;if(!pw){$('decErr').textContent='Password is required.';$('decErr').classList.remove('hidden');return;}
  $('decBtn').disabled=true;$('decBtn').textContent='Decrypting...';logs=[];
  try{
    let encData;let isImg=false;
    if(decMode==='url'){
      const url=$('decUrl').value.trim();if(!url)throw new Error('URL is required.');
      isImg=/\\.(png|jpg|jpeg|gif|webp)$/i.test(url)||/ibb\\.co|sxcu\\.net|freeimage\\.host/i.test(url);
      addLog('Fetching '+url+'...');const res=await fetch(url,{mode:'cors'});if(!res.ok)throw new Error('HTTP '+res.status);
      if(isImg){addLog('Extracting steganography...');const buf=new Uint8Array(await res.arrayBuffer());encData=await extractStego(buf);if(!encData)throw new Error('No hidden data in image');}
      else{addLog('Decoding base64...');const text=await res.text();if(text.trim().startsWith('<!doctype')||text.trim().startsWith('<html'))throw new Error('Got HTML page. Use direct download link.');encData=b642ab(text);}
    }else{
      const f=$('decFileInp').files[0];if(!f)throw new Error('No file selected.');
      isImg=/\\.(png|jpg|jpeg|gif|webp)$/i.test(f.name);addLog('Reading '+f.name+'...');const buf=new Uint8Array(await f.arrayBuffer());
      if(isImg){addLog('Extracting steganography...');encData=await extractStego(buf);if(!encData)throw new Error('No hidden data in image');}
      else{addLog('Decoding base64...');encData=b642ab(new TextDecoder().decode(buf));}
    }
    addLog('Encrypted data: '+(encData.length/1024).toFixed(2)+' KB');addLog('Decrypting...');
    const result=await ghostDecrypt(encData,pw);addLog('Decrypted: '+(result.data.length/1024).toFixed(2)+' KB, name: '+result.name);
    decryptedResult=result;$('decInfo').textContent=result.name+' — '+(result.data.length/1024).toFixed(2)+' KB';$('decResult').classList.remove('hidden');
    addLog('Success!');
  }catch(e){$('decErr').textContent=e.message;$('decErr').classList.remove('hidden');addLog('ERROR: '+e.message);}
  finally{$('decBtn').disabled=false;$('decBtn').textContent='Decrypt File';}
}
function dlDecrypted(){if(!decryptedResult)return;const b=new Blob([decryptedResult.data]);const u=URL.createObjectURL(b);const a=document.createElement('a');a.href=u;a.download=decryptedResult.name;a.click();URL.revokeObjectURL(u);}
function updateUI(){initServices();}
</script>`;
  return buildHTML('Encrypt & Tunnel', '', body, js, keys);
}

function generateAnonUpload() {
  const keys = ['tools.anonUpload.meta.title','tools.anonUpload.h1','tools.anonUpload.h1Highlight','tools.anonUpload.subtitle','tools.anonUpload.dropFile','tools.anonUpload.anonSteps','tools.anonUpload.processing','tools.anonUpload.fileTooLarge','tools.anonUpload.failedToProcess','tools.anonUpload.anonAs','tools.anonUpload.download','tools.anonUpload.uploadTo','tools.anonUpload.uploadAnonymous','tools.anonUpload.uploading','tools.anonUpload.uploadFailed','tools.anonUpload.uploadSuccess','tools.anonUpload.copy','tools.anonUpload.sendInstances','tools.anonUpload.sendManual','tools.anonUpload.moreInstances','tools.anonUpload.info.title','tools.anonUpload.info.text'];
  const body = `<div class="main">
  <div style="margin-bottom:32px"><h1 id="h1"></h1><p class="subtitle" id="sub"></p></div>
  <div class="card space-y">
    <div class="drop-zone" style="padding:48px;text-align:center;border:4px dashed var(--border);border-radius:24px;position:relative;background:rgba(16,185,129,0.01)"><input type="file" id="fileInp" style="position:absolute;inset:0;opacity:0;cursor:pointer"><div style="display:flex;flex-direction:column;align-items:center;gap:16px"><div style="width:64px;height:64px;background:rgba(16,185,129,0.1);color:var(--brand);border-radius:50%;display:flex;align-items:center;justify-content:center"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg></div><div><p style="font-weight:700;font-size:14px" id="dropText"></p><p style="font-size:10px;color:var(--text2);text-transform:uppercase;letter-spacing:0.1em;margin-top:4px" id="dropSub"></p></div></div></div>
    <div id="errBox" class="error hidden"></div>
    <div id="processingBox" class="hidden" style="text-align:center;padding:16px"><span style="font-size:12px;font-weight:700;color:var(--brand)" id="procText"></span></div>
    <div id="resultSection" class="hidden space-y">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap"><div style="font-size:12px;font-family:var(--mono);color:var(--text2)" id="anonLabel"></div><button class="btn-outline" onclick="dlAnon()" style="font-size:11px" id="dlBtn"></button></div>
      <div class="space-y-sm"><label class="label" id="lUpload"></label><button class="btn" onclick="handleUpload()" id="uploadBtn" style="font-size:12px"></button></div>
      <div id="uploadResult" class="hidden space-y-sm">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--text3)" id="uploadLabel"></div>
        <div style="display:flex;gap:8px;align-items:center"><input type="text" readonly class="input" id="uploadUrl" style="font-family:var(--mono);font-size:11px;flex:1" onclick="this.select()"><button class="btn-outline" onclick="copyText($('uploadUrl').value)" id="copyBtn" style="font-size:11px;padding:6px 16px"></button></div>
      </div>
      <div style="border-top:1px solid var(--border);padding-top:16px;margin-top:8px" class="space-y-sm">
        <label class="label" id="lSend"></label>
        <p style="font-size:11px;color:var(--text2)" id="sendDesc"></p>
        <div style="display:flex;flex-wrap:wrap;gap:8px" id="sendLinks"></div>
      </div>
    </div>
  </div>
  <div class="info-section"><h3 class="info-title" id="iTitle"></h3><p class="info-text" id="iText"></p></div>
</div>`;
  const js = `<script>
const MAX_BYTES=100*1024*1024;const IMAGE_TYPES=['image/jpeg','image/png','image/webp','image/gif'];
const SEND_INSTANCES=[{url:'https://send.codespace.cz',limit:'10 GB'},{url:'https://upload.nolog.cz',limit:'5 GB'},{url:'https://send.vis.ee',limit:'2.5 GB'},{url:'https://send.mni.li',limit:'8 GB'},{url:'https://send.adminforge.de',limit:'8 GB'},{url:'https://send.monks.tools',limit:'5 GB'}];
let anonBlob=null,anonName='',uploading=false;
function ulid(){const C='0123456789ABCDEFGHJKMNPQRSTVWXYZ';const t=Date.now();let r='';for(let i=9;i>=0;i--)r+=C[Math.floor(t/Math.pow(32,i))%32];for(let i=0;i<16;i++)r+=C[crypto.getRandomValues(new Uint8Array(1))[0]%32];return r}
function getExt(n){const i=n.lastIndexOf('.');return i>0?n.slice(i):'';}
function anonFilename(orig){return ulid()+(getExt(orig).toLowerCase()||'.bin');}
function stripExif(file){return new Promise((res,rej)=>{const img=new Image();img.src=URL.createObjectURL(file);img.onload=()=>{URL.revokeObjectURL(img.src);const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);c.toBlob(b=>b?res(b):rej(),'image/jpeg',0.92);};img.onerror=()=>rej();})}
$('fileInp').addEventListener('change',async e=>{
  const f=e.target.files[0];if(!f)return;
  if(f.size>MAX_BYTES){$('errBox').textContent=t('tools.anonUpload.fileTooLarge');$('errBox').classList.remove('hidden');return;}
  $('errBox').classList.add('hidden');$('resultSection').classList.add('hidden');$('uploadResult').classList.add('hidden');
  $('processingBox').classList.remove('hidden');$('procText').textContent=t('tools.anonUpload.processing');
  try{
    const name=anonFilename(f.name);
    let blob;
    if(IMAGE_TYPES.includes(f.type)){blob=await stripExif(f);anonName=name.replace(/\\.[^.]+$/,'.jpg');}
    else{blob=new Blob([await f.arrayBuffer()],{type:f.type||'application/octet-stream'});anonName=name;}
    anonBlob=blob;
    $('processingBox').classList.add('hidden');
    $('anonLabel').innerHTML=t('tools.anonUpload.anonAs')+' <span style="color:var(--brand);font-weight:700">'+anonName+'</span>';
    $('resultSection').classList.remove('hidden');
  }catch{$('errBox').textContent=t('tools.anonUpload.failedToProcess');$('errBox').classList.remove('hidden');$('processingBox').classList.add('hidden');}
});
function dlAnon(){if(!anonBlob)return;const a=document.createElement('a');a.href=URL.createObjectURL(anonBlob);a.download=anonName;a.click();URL.revokeObjectURL(a.href);}
async function handleUpload(){
  if(!anonBlob||uploading)return;uploading=true;$('uploadBtn').textContent=t('tools.anonUpload.uploading');$('uploadResult').classList.add('hidden');$('errBox').classList.add('hidden');
  try{
    const fd=new FormData();fd.append('file',anonBlob,anonName);
    let url,provider;
    try{const res=await fetch('https://tmpfiles.org/api/v1/upload',{method:'POST',body:fd,mode:'cors'});if(!res.ok)throw 0;const d=await res.json();url=d?.data?.url||d?.url;if(url&&!url.startsWith('http'))url='https://tmpfiles.org'+url;provider='tmpfiles.org';}
    catch{const fd2=new FormData();fd2.append('file',anonBlob,anonName);const res=await fetch('https://0x0.st',{method:'POST',body:fd2,mode:'cors'});if(!res.ok)throw new Error('Upload failed');url=(await res.text()).trim();provider='0x0.st';}
    $('uploadUrl').value=url;$('uploadLabel').textContent=t('tools.anonUpload.uploadSuccess')+' ('+provider+')';$('uploadResult').classList.remove('hidden');
  }catch{$('errBox').textContent=t('tools.anonUpload.uploadFailed');$('errBox').classList.remove('hidden');}
  finally{uploading=false;$('uploadBtn').textContent=t('tools.anonUpload.uploadAnonymous');}
}
function updateUI(){
  $('h1').innerHTML=t('tools.anonUpload.h1')+' <span>'+t('tools.anonUpload.h1Highlight')+'</span>';
  $('sub').textContent=t('tools.anonUpload.subtitle');$('dropText').textContent=t('tools.anonUpload.dropFile');
  $('dropSub').textContent=t('tools.anonUpload.anonSteps');$('dlBtn').textContent=t('tools.anonUpload.download');
  $('lUpload').textContent=t('tools.anonUpload.uploadTo');$('uploadBtn').textContent=t('tools.anonUpload.uploadAnonymous');
  $('copyBtn').textContent=t('tools.anonUpload.copy');$('lSend').textContent=t('tools.anonUpload.sendInstances');
  $('sendDesc').textContent=t('tools.anonUpload.sendManual');
  $('sendLinks').innerHTML=SEND_INSTANCES.map(s=>'<a href="'+s.url+'" target="_blank" rel="noopener" class="btn-outline" style="font-size:10px;padding:6px 10px">'+new URL(s.url).hostname+'</a>').join('');
  $('iTitle').textContent=t('tools.anonUpload.info.title');$('iText').textContent=t('tools.anonUpload.info.text');
  document.title=t('tools.anonUpload.meta.title')+' — encrypt.click (offline)';
}
</script>`;
  return buildHTML('Anonymous Upload', '', body, js, keys);
}

function generateTimeCapsule() {
  const keys = ['tools.timeCapsule.meta.title','tools.timeCapsule.h1','tools.timeCapsule.h1Highlight','tools.timeCapsule.subtitle','tools.timeCapsule.footnote','tools.timeCapsule.createCapsule','tools.timeCapsule.openCapsule','tools.timeCapsule.message','tools.timeCapsule.messagePlaceholder','tools.timeCapsule.unlockAfter','tools.timeCapsule.encrypting','tools.timeCapsule.lockMessage','tools.timeCapsule.ciphertext','tools.timeCapsule.pastePlaceholder','tools.timeCapsule.decrypting','tools.timeCapsule.decryptedMessage','tools.timeCapsule.advancedTiming','tools.timeCapsule.localTime','tools.timeCapsule.utc','tools.timeCapsule.unixTimestamp','tools.timeCapsule.drandRound','tools.timeCapsule.errorMessage','tools.timeCapsule.errorUnlockTime','tools.timeCapsule.errorInvalidDate','tools.timeCapsule.errorFuture','tools.timeCapsule.errorPaste','tools.timeCapsule.tooEarly','tools.timeCapsule.info.title','tools.timeCapsule.info.text'];
  const body = `<div class="main">
  <div style="margin-bottom:32px"><h1 id="h1"></h1><p class="subtitle" id="sub"></p></div>
  <div class="card space-y">
    <div class="tab-bar"><button class="tab-btn active" id="tabCreate" onclick="setMode('encrypt')"></button><button class="tab-btn" id="tabOpen" onclick="setMode('decrypt')"></button></div>
    <div id="encSection">
      <div class="space-y">
        <div><label class="label" id="lMsg"></label><textarea class="input" id="msg" style="min-height:140px;resize:vertical;font-family:var(--mono);font-size:12px"></textarea></div>
        <div class="grid2" style="align-items:end"><div><label class="label" id="lUnlock"></label><input type="datetime-local" class="input" id="dateInp"></div><button class="btn" onclick="handleEncrypt()" id="lockBtn"></button></div>
        <div id="encErr" class="error hidden"></div>
        <div id="cipherWrap" class="hidden"><label class="label" id="lCipher"></label><textarea class="input" readonly id="cipherOut" style="min-height:180px;resize:vertical;font-family:var(--mono);font-size:11px"></textarea></div>
      </div>
    </div>
    <div id="decSection" class="hidden">
      <div class="space-y">
        <div><label class="label" id="lCipher2"></label><textarea class="input" id="decInp" style="min-height:160px;resize:vertical;font-family:var(--mono);font-size:11px"></textarea></div>
        <button class="btn btn-w" onclick="handleDecrypt()" id="openBtn"></button>
        <div id="decErr" class="error hidden"></div>
        <div id="decCountdown" class="hidden" style="padding:20px;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.2);border-radius:12px;text-align:center"><div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#b45309;margin-bottom:8px" id="cdLabel"></div><div style="font-size:28px;font-weight:800;font-family:var(--mono);color:var(--text);letter-spacing:2px" id="cdTimer"></div><div style="font-size:10px;color:var(--text3);margin-top:6px" id="cdDate"></div></div>
        <div id="decResult" class="hidden"><h3 class="label" style="color:var(--brand)" id="lDecMsg"></h3><div class="output-box" style="font-family:var(--mono);white-space:pre-wrap;text-align:left" id="decText"></div></div>
      </div>
    </div>
    <p style="font-size:10px;color:var(--text3);text-align:center" id="footnote"></p>
  </div>
  <div class="info-section"><h3 class="info-title" id="iTitle"></h3><p class="info-text" id="iText"></p></div>
</div>
<script>${lzStringMin}<\/script>
<script>${tlockBundle}<\/script>`;
  // LZ-String for cross-compatible token encoding with the website
  // tlock-js IIFE bundle exposes TlockJS global with all exports
  // We talk directly to drand API (no proxy needed)
  const js = `<script>
// Unpack tlock-js exports from the IIFE bundle
const {timelockEncrypt,timelockDecrypt,HttpCachingChain,HttpChainClient,Buffer:TlockBuffer}=TlockJS;
let tcMode='encrypt';
const DRAND_URL='https://api.drand.sh/52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971';
const CHAIN_HASH='52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971';
const CHAIN_PK='83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a';
const GENESIS=1595431050;const PERIOD=30;
function nowIsoLocal(){const d=new Date();d.setMinutes(d.getMinutes()-d.getTimezoneOffset());return d.toISOString().slice(0,16);}
function setMode(m){tcMode=m;$('tabCreate').classList.toggle('active',m==='encrypt');$('tabOpen').classList.toggle('active',m==='decrypt');$('encSection').classList.toggle('hidden',m!=='encrypt');$('decSection').classList.toggle('hidden',m!=='decrypt');}
function computeRound(timeMs){return Math.floor((timeMs-GENESIS*1000)/(PERIOD*1000))+1;}
function lzCompressB64(str){
  return LZString.compressToBase64(str).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/g,'');
}
function lzDecompressB64(tok){
  const b64=tok.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(tok.length/4)*4,'=');
  // Try LZ-String first (website format), fall back to plain base64 (legacy)
  const lz=LZString.decompressFromBase64(b64);
  if(lz)try{JSON.parse(lz);return lz;}catch{}
  try{return decodeURIComponent(escape(atob(b64)));}catch{}
  return lz||'';
}
async function handleEncrypt(){
  $('encErr').classList.add('hidden');$('cipherWrap').classList.add('hidden');
  const msg=$('msg').value.trim();if(!msg){$('encErr').textContent=t('tools.timeCapsule.errorMessage');$('encErr').classList.remove('hidden');return;}
  const dateVal=$('dateInp').value;if(!dateVal){$('encErr').textContent=t('tools.timeCapsule.errorUnlockTime');$('encErr').classList.remove('hidden');return;}
  const timeMs=new Date(dateVal).getTime();if(!Number.isFinite(timeMs)){$('encErr').textContent=t('tools.timeCapsule.errorInvalidDate');$('encErr').classList.remove('hidden');return;}
  if(timeMs<=Date.now()){$('encErr').textContent=t('tools.timeCapsule.errorFuture');$('encErr').classList.remove('hidden');return;}
  $('lockBtn').disabled=true;$('lockBtn').textContent=t('tools.timeCapsule.encrypting');
  try{
    if(typeof timelockEncrypt==='undefined')throw new Error('tlock-js not loaded. Check internet connection.');
    const round=computeRound(timeMs);
    const chainOpts={chainVerificationParams:{chainHash:CHAIN_HASH,publicKey:CHAIN_PK}};
    const chain=new HttpCachingChain(DRAND_URL,chainOpts);const client=new HttpChainClient(chain,chainOpts);
    const payload=TlockBuffer?TlockBuffer.from(msg,'utf8'):new TextEncoder().encode(msg);
    const armored=await timelockEncrypt(round,payload,client);
    const unix=Math.floor(timeMs/1000);const packed=JSON.stringify({v:1,r:round,t:unix,c:armored});
    $('cipherOut').value=lzCompressB64(packed);$('cipherWrap').classList.remove('hidden');
  }catch(e){$('encErr').textContent=e.message;$('encErr').classList.remove('hidden');}
  finally{$('lockBtn').disabled=false;$('lockBtn').textContent=t('tools.timeCapsule.lockMessage');}
}
async function handleDecrypt(){
  $('decErr').classList.add('hidden');$('decResult').classList.add('hidden');
  const inp=$('decInp').value.trim();if(!inp){$('decErr').textContent=t('tools.timeCapsule.errorPaste');$('decErr').classList.remove('hidden');return;}
  $('openBtn').disabled=true;$('openBtn').textContent=t('tools.timeCapsule.decrypting');
  try{
    if(typeof timelockDecrypt==='undefined')throw new Error('tlock-js not loaded. Check internet connection.');
    const chainOpts={chainVerificationParams:{chainHash:CHAIN_HASH,publicKey:CHAIN_PK}};
    const chain=new HttpCachingChain(DRAND_URL,chainOpts);const client=new HttpChainClient(chain,chainOpts);
    let armored,unlockTime='';
    try{const json=lzDecompressB64(inp);const obj=JSON.parse(json);armored=obj.c;if(obj.t)unlockTime=new Date(obj.t*1000).toISOString();}
    catch{armored=inp;}
    const buf=await timelockDecrypt(armored,client);
    const text=typeof buf==='string'?buf:new TextDecoder().decode(buf);
    $('decText').textContent=text;$('decResult').classList.remove('hidden');
  }catch(e){
    let unlockUnix=0;
    try{const json=lzDecompressB64(inp);const obj=JSON.parse(json);if(obj.t)unlockUnix=obj.t;}catch{}
    if(unlockUnix>0){
      startCountdown(unlockUnix);
    }else{
      $('decErr').textContent=t('tools.timeCapsule.tooEarly').replace('{time}','unknown');$('decErr').classList.remove('hidden');
    }
  }finally{$('openBtn').disabled=false;$('openBtn').textContent=t('tools.timeCapsule.openCapsule');}
}
let cdInterval=null;
function startCountdown(unlockUnix){
  $('decErr').classList.add('hidden');$('decResult').classList.add('hidden');
  $('decCountdown').classList.remove('hidden');
  $('cdDate').textContent=new Date(unlockUnix*1000).toLocaleString();
  if(cdInterval)clearInterval(cdInterval);
  function tick(){
    const diff=unlockUnix-Math.floor(Date.now()/1000);
    if(diff<=0){clearInterval(cdInterval);$('cdTimer').textContent='NOW';$('cdLabel').textContent='Ready to decrypt!';return;}
    const d=Math.floor(diff/86400),h=Math.floor((diff%86400)/3600),m=Math.floor((diff%3600)/60),s=diff%60;
    const parts=[];
    if(d>0)parts.push(d+'d');parts.push(String(h).padStart(2,'0')+'h');parts.push(String(m).padStart(2,'0')+'m');parts.push(String(s).padStart(2,'0')+'s');
    $('cdTimer').textContent=parts.join(' ');
    $('cdLabel').textContent=lang==='de'?'Diese Nachricht wird entsperrt in':lang==='cs'?'Tato zpráva se odemkne za':'This message unlocks in';
  }
  tick();cdInterval=setInterval(tick,1000);
}
function updateUI(){
  $('h1').innerHTML=t('tools.timeCapsule.h1')+' <span>'+t('tools.timeCapsule.h1Highlight')+'</span>';
  $('sub').textContent=t('tools.timeCapsule.subtitle');$('footnote').textContent=t('tools.timeCapsule.footnote');
  $('tabCreate').textContent=t('tools.timeCapsule.createCapsule');$('tabOpen').textContent=t('tools.timeCapsule.openCapsule');
  $('lMsg').textContent=t('tools.timeCapsule.message');$('msg').placeholder=t('tools.timeCapsule.messagePlaceholder');
  $('lUnlock').textContent=t('tools.timeCapsule.unlockAfter');$('lockBtn').textContent=t('tools.timeCapsule.lockMessage');
  $('lCipher').textContent=t('tools.timeCapsule.ciphertext');$('lCipher2').textContent=t('tools.timeCapsule.ciphertext');
  $('decInp').placeholder=t('tools.timeCapsule.pastePlaceholder');$('openBtn').textContent=t('tools.timeCapsule.openCapsule');
  $('lDecMsg').textContent=t('tools.timeCapsule.decryptedMessage');
  $('iTitle').textContent=t('tools.timeCapsule.info.title');$('iText').textContent=t('tools.timeCapsule.info.text');
  document.title=t('tools.timeCapsule.meta.title')+' — encrypt.click (offline)';
  if(!$('dateInp').value)$('dateInp').value=nowIsoLocal();
}
</script>`;
  return buildHTML('Time Capsule', '', body, js, keys);
}

function generatePDFRedact() {
  const keys = ['tools.pdfRedact.meta.title','tools.pdfRedact.h1','tools.pdfRedact.h1Highlight','tools.pdfRedact.subtitle','tools.pdfRedact.infoP1','tools.pdfRedact.infoP2','tools.pdfRedact.sourcePdf','tools.pdfRedact.processedInMemory','tools.pdfRedact.renderingPages','tools.pdfRedact.drawInstructions','tools.pdfRedact.clearAllBoxes','tools.pdfRedact.page','tools.pdfRedact.rasterizing','tools.pdfRedact.redactBtn','tools.pdfRedact.downloadRedacted','tools.pdfRedact.drawAtLeast','tools.pdfRedact.pdfTooLarge','tools.pdfRedact.failedToLoad','tools.pdfRedact.failedToProcess','tools.pdfRedact.info.title','tools.pdfRedact.info.text'];
  const extraCSS = `
.page-wrap{position:relative;display:inline-block;border-radius:12px;border:1px solid var(--border);overflow:hidden;background:#fff;max-width:100%}
.page-wrap canvas{display:block;max-width:100%;height:auto}
.page-overlay{position:absolute;inset:0;cursor:crosshair;z-index:10}
.redact-box{position:absolute;background:rgba(0,0,0,0.9)}
.drag-box{position:absolute;border:1px solid var(--brand);background:rgba(16,185,129,0.2);pointer-events:none}
`;
  const body = `<div class="main" style="max-width:900px">
  <div style="margin-bottom:32px"><h1 id="h1"></h1><p class="subtitle" id="sub"></p></div>
  <div class="card space-y">
    <div style="padding:16px;background:rgba(59,130,246,0.06);border:1px solid rgba(59,130,246,0.12);border-radius:12px;font-size:12px;color:#1d4ed8"><p style="font-weight:600" id="infoP1"></p><p id="infoP2" style="margin-top:4px"></p></div>
    <div><label class="label" id="lSrc"></label><input type="file" accept=".pdf" class="input" id="fileInp"><p style="font-size:11px;color:var(--text3);margin-top:4px" id="maxNote"></p></div>
    <div id="loadingBox" class="hidden" style="text-align:center;padding:16px;font-size:12px;color:var(--text2)" id="loadText"></div>
    <div id="pagesWrap" class="hidden space-y">
      <div style="display:flex;align-items:center;justify-content:space-between"><p style="font-size:12px;color:var(--text2)" id="drawInstr"></p><button class="btn-outline" onclick="clearAll()" style="font-size:11px;padding:4px 12px" id="clearBtn"></button></div>
      <div id="pagesList" class="space-y" style="max-height:420px;overflow-y:auto;padding-right:4px"></div>
    </div>
    <button class="btn btn-w" onclick="handleRedact()" id="redactBtn" disabled></button>
    <div id="errBox" class="error hidden"></div>
    <div id="resultWrap" class="hidden space-y">
      <div style="aspect-ratio:1/1.4;background:var(--bg2);border-radius:16px;border:1px solid var(--border);overflow:hidden"><embed id="pdfEmbed" type="application/pdf" style="width:100%;height:100%"></div>
      <a id="dlLink" download="redacted-document.pdf" class="btn-outline btn-w" style="display:block;text-align:center;text-decoration:none"></a>
    </div>
  </div>
  <div class="info-section"><h3 class="info-title" id="iTitle"></h3><p class="info-text" id="iText"></p></div>
</div>
<script src="https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.min.mjs" type="module"><\/script>
<script src="https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.worker.min.mjs" type="module"><\/script>
<script src="https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js"><\/script>`;
  const js = `<script type="module">
// We need pdfjs-dist loaded as ES module
const pdfjsLib=await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.min.mjs');
pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.worker.min.mjs';
window._pdfjsLib=pdfjsLib;
window._pdfReady=true;
</script>
<script>
const MAX_BYTES=5*1024*1024;let pageCount=0,redactions=[],isDragging=false,dragPage=-1,dragSX=0,dragSY=0,dragCX=0,dragCY=0;
$('fileInp').addEventListener('change',async e=>{
  const f=e.target.files[0];if(!f)return;
  if(f.size>MAX_BYTES){$('errBox').textContent=t('tools.pdfRedact.pdfTooLarge');$('errBox').classList.remove('hidden');return;}
  $('errBox').classList.add('hidden');$('resultWrap').classList.add('hidden');$('pagesWrap').classList.add('hidden');redactions=[];pageCount=0;
  $('loadingBox').classList.remove('hidden');$('loadingBox').textContent=t('tools.pdfRedact.renderingPages');
  // Wait for pdfjs to load
  let tries=0;while(!window._pdfReady&&tries<50){await new Promise(r=>setTimeout(r,200));tries++;}
  if(!window._pdfReady){$('errBox').textContent='PDF.js failed to load.';$('errBox').classList.remove('hidden');$('loadingBox').classList.add('hidden');return;}
  try{
    const buf=await f.arrayBuffer();const pdf=await window._pdfjsLib.getDocument({data:buf}).promise;
    pageCount=pdf.numPages;const vw=Math.min(window.innerWidth-64,860);
    let html='';for(let i=0;i<pageCount;i++)html+='<div style="margin-bottom:8px"><p style="font-size:11px;color:var(--text2);font-weight:500">'+t('tools.pdfRedact.page')+' '+(i+1)+'</p><div class="page-wrap" data-page="'+i+'"><canvas data-pc="'+i+'"></canvas><div class="page-overlay" data-po="'+i+'"></div></div></div>';
    $('pagesList').innerHTML=html;
    for(let i=0;i<pageCount;i++){
      const page=await pdf.getPage(i+1);const vp=page.getViewport({scale:1});const baseScale=vw/vp.width;const scale=Math.min(baseScale*2,3);const v=page.getViewport({scale});
      const canvas=document.querySelector('[data-pc="'+i+'"]');const ctx=canvas.getContext('2d');canvas.width=v.width;canvas.height=v.height;
      canvas.style.width=vw+'px';canvas.style.height=(v.height/v.width*vw)+'px';
      await page.render({canvasContext:ctx,viewport:v}).promise;
    }
    // Attach drag events
    document.querySelectorAll('.page-overlay').forEach(el=>{
      const pi=parseInt(el.dataset.po);
      el.addEventListener('mousedown',e=>{const r=el.getBoundingClientRect();isDragging=true;dragPage=pi;dragSX=e.clientX-r.left;dragSY=e.clientY-r.top;dragCX=dragSX;dragCY=dragSY;});
      el.addEventListener('mousemove',e=>{if(!isDragging||dragPage!==pi)return;const r=el.getBoundingClientRect();dragCX=e.clientX-r.left;dragCY=e.clientY-r.top;renderBoxes();});
      el.addEventListener('mouseup',()=>{if(!isDragging||dragPage!==pi)return;finishDrag(el,pi);});
      el.addEventListener('mouseleave',()=>{if(isDragging&&dragPage===pi)finishDrag(el,pi);});
    });
    $('pagesWrap').classList.remove('hidden');$('redactBtn').disabled=false;
  }catch(e){$('errBox').textContent=t('tools.pdfRedact.failedToLoad');$('errBox').classList.remove('hidden');}
  finally{$('loadingBox').classList.add('hidden');}
});
function finishDrag(el,pi){
  isDragging=false;const w=Math.abs(dragCX-dragSX),h=Math.abs(dragCY-dragSY);
  if(w<4||h<4){dragPage=-1;return;}
  const{width:ow,height:oh}=el.getBoundingClientRect();
  const x=Math.min(dragSX,dragCX),y=Math.min(dragSY,dragCY);
  redactions.push({pageIndex:pi,nx:x/ow,ny:y/oh,nw:w/ow,nh:h/oh});dragPage=-1;renderBoxes();
}
function renderBoxes(){
  document.querySelectorAll('.page-overlay').forEach(el=>{
    const pi=parseInt(el.dataset.po);
    let html=redactions.filter(r=>r.pageIndex===pi).map(r=>'<div class="redact-box" style="left:'+r.nx*100+'%;top:'+r.ny*100+'%;width:'+r.nw*100+'%;height:'+r.nh*100+'%"></div>').join('');
    if(isDragging&&dragPage===pi){const x=Math.min(dragSX,dragCX),y=Math.min(dragSY,dragCY),w=Math.abs(dragCX-dragSX),h=Math.abs(dragCY-dragSY);html+='<div class="drag-box" style="left:'+x+'px;top:'+y+'px;width:'+w+'px;height:'+h+'px"></div>';}
    el.innerHTML=html;
  });
}
function clearAll(){redactions=[];renderBoxes();}
async function handleRedact(){
  if(!pageCount||redactions.length===0){$('errBox').textContent=t('tools.pdfRedact.drawAtLeast');$('errBox').classList.remove('hidden');return;}
  $('errBox').classList.add('hidden');$('resultWrap').classList.add('hidden');$('redactBtn').disabled=true;$('redactBtn').textContent=t('tools.pdfRedact.rasterizing');
  try{
    const pdfDoc=await PDFLib.PDFDocument.create();
    for(let i=0;i<pageCount;i++){
      const baseC=document.querySelector('[data-pc="'+i+'"]');const tmp=document.createElement('canvas');tmp.width=baseC.width;tmp.height=baseC.height;const ctx=tmp.getContext('2d');ctx.drawImage(baseC,0,0);
      ctx.fillStyle='#000';redactions.filter(r=>r.pageIndex===i).forEach(r=>{ctx.fillRect(r.nx*baseC.width,r.ny*baseC.height,r.nw*baseC.width,r.nh*baseC.height);});
      const blob=await new Promise((res,rej)=>{tmp.toBlob(b=>b?res(b):rej(),'image/png');});
      const png=await pdfDoc.embedPng(await blob.arrayBuffer());const{width,height}=png.size();const page=pdfDoc.addPage([width,height]);page.drawImage(png,{x:0,y:0,width,height});
    }
    const bytes=await pdfDoc.save();const blob=new Blob([bytes],{type:'application/pdf'});const url=URL.createObjectURL(blob);
    $('pdfEmbed').src=url;$('dlLink').href=url;$('resultWrap').classList.remove('hidden');
  }catch(e){$('errBox').textContent=t('tools.pdfRedact.failedToProcess');$('errBox').classList.remove('hidden');}
  finally{$('redactBtn').disabled=false;updateUI();}
}
function updateUI(){
  $('h1').innerHTML=t('tools.pdfRedact.h1')+' <span>'+t('tools.pdfRedact.h1Highlight')+'</span>';
  $('sub').textContent=t('tools.pdfRedact.subtitle');$('infoP1').textContent=t('tools.pdfRedact.infoP1');$('infoP2').textContent=t('tools.pdfRedact.infoP2');
  $('lSrc').textContent=t('tools.pdfRedact.sourcePdf');$('maxNote').textContent=t('tools.pdfRedact.processedInMemory').replace('{size}','5');
  $('drawInstr').textContent=t('tools.pdfRedact.drawInstructions');$('clearBtn').textContent=t('tools.pdfRedact.clearAllBoxes');
  $('redactBtn').textContent=t('tools.pdfRedact.redactBtn');$('dlLink').textContent=t('tools.pdfRedact.downloadRedacted');
  $('iTitle').textContent=t('tools.pdfRedact.info.title');$('iText').textContent=t('tools.pdfRedact.info.text');
  document.title=t('tools.pdfRedact.meta.title')+' — encrypt.click (offline)';
}
</script>`;
  return buildHTML('PDF Redact', extraCSS, body, js, keys);
}

// ═══════════════════════════════════════════════════════════
// GENERATE INDEX PAGE
// ═══════════════════════════════════════════════════════════

function generateIndex(toolList) {
  const items = toolList.map(t => `<a href="${t.name}.html" class="tool-link"><div class="tool-name">${t.title}</div><div class="tool-desc">${t.desc}</div></a>`).join('\n      ');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>encrypt.click — Standalone Offline Tools</title>
<style>
${SHARED_CSS}
.tool-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;margin-top:32px}
.tool-link{display:block;padding:20px 24px;background:var(--card-bg);border:1px solid var(--card-border);border-radius:16px;text-decoration:none;color:var(--text);transition:all .15s}
.tool-link:hover{border-color:var(--brand);box-shadow:0 4px 16px rgba(16,185,129,0.1);text-decoration:none;transform:translateY(-2px)}
.tool-name{font-weight:700;font-size:14px;margin-bottom:4px}
.tool-desc{font-size:11px;color:var(--text2);line-height:1.5}
.badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em}
.badge-cdn{background:rgba(245,158,11,0.1);color:#b45309;margin-left:8px}
.count{font-size:12px;color:var(--text2);margin-top:8px}
</style>
</head>
<body>
${headerHTML()}
<div class="main" style="max-width:900px">
  <div style="margin-bottom:16px">
    <h1>encrypt.click <span>Offline</span></h1>
    <p class="subtitle">${toolList.length} standalone tools — each a single HTML file. Works 100% offline.</p>
    <p class="count">${toolList.length} tools available</p>
  </div>
  <div class="tool-grid">
      ${items}
  </div>
  <div style="margin-top:48px;padding:24px;background:rgba(245,158,11,0.06);border:1px solid rgba(245,158,11,0.15);border-radius:16px">
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#b45309;margin-bottom:8px">Tools not available offline</div>
    <div style="font-size:12px;color:var(--text2);line-height:1.8">
      <strong>Encrypt &amp; Tunnel</strong> — requires server API endpoints<br>
      <strong>Anonymous Upload</strong> — requires server-side upload proxy<br>
      <strong>Time Capsule</strong> — requires drand network access<br>
      <strong>PDF Redact</strong> — requires pdfjs-dist worker (too large for inline)
    </div>
  </div>
</div>
${footerHTML()}
<script>
function toggleLang(){}
function toggleTheme(){
  document.documentElement.classList.toggle('dark');
  localStorage.setItem('ec-theme',document.documentElement.classList.contains('dark')?'dark':'light');
}
(function(){
  const th=localStorage.getItem('ec-theme');
  if(th==='dark'||(th==null&&matchMedia('(prefers-color-scheme:dark)').matches))document.documentElement.classList.add('dark');
})();
</script>
</body>
</html>`;
}

// ═══════════════════════════════════════════════════════════
// GENERATE ALL FILES
// ═══════════════════════════════════════════════════════════

const tools = [
  { name: 'caesar', fn: generateCaesar, title: 'Caesar Cipher', desc: 'Classic rotation cipher with adjustable shift' },
  { name: 'base64', fn: generateBase64, title: 'Base64', desc: 'Encode and decode Base64 strings' },
  { name: 'vigenere', fn: generateVigenere, title: 'Vigenere Cipher', desc: 'Polyalphabetic encryption with keyword' },
  { name: 'morse', fn: generateMorse, title: 'Morse Code', desc: 'Text to Morse and back, with audio playback' },
  { name: 'token', fn: generateTokenGen, title: 'Token Generator', desc: 'Cryptographic random tokens (hex, base64, url-safe)' },
  { name: 'uuid-ulid', fn: generateUUID, title: 'UUID & ULID', desc: 'Generate UUIDv4 and ULID identifiers' },
  { name: 'hmac', fn: generateHMAC, title: 'HMAC-SHA256', desc: 'Generate message authentication codes' },
  { name: 'rsa', fn: generateRSA, title: 'RSA Keys', desc: 'Generate RSA key pairs (1024-4096 bit)' },
  { name: 'ssh-keys', fn: generateSSHKeys, title: 'SSH Keys', desc: 'Generate OpenSSH-format RSA key pairs' },
  { name: 'jwt', fn: generateJWT, title: 'JWT Debugger', desc: 'Decode and inspect JSON Web Tokens' },
  { name: 'enigma', fn: generateEnigma, title: 'Enigma M3', desc: 'Simulate the WWII Enigma cipher machine' },
  { name: 'watermark', fn: generateWatermark, title: 'ID Watermarker', desc: 'Apply visible watermark to identity documents' },
  { name: 'exif-scrub', fn: generateExifScrub, title: 'EXIF Scrubber', desc: 'Remove metadata from photos by redrawing' },
  { name: 'steganography', fn: generateSteganography, title: 'Steganography', desc: 'Hide AES-encrypted messages in image pixels (LSB)' },
  { name: 'pdf-unlock', fn: generatePDFUnlock, title: 'PDF Unlock', desc: 'Remove password protection from PDFs (CDN: pdf-lib)' },
  { name: 'qr-gen', fn: generateQRGen, title: 'QR Generator', desc: 'Generate clean, tracker-free QR codes (CDN: qrcode)' },
  { name: 'bip39', fn: generateBIP39, title: 'BIP39 Mnemonic', desc: '12-word recovery phrases for crypto wallets' },
  { name: 'bcrypt', fn: generateBcrypt, title: 'Bcrypt Hash', desc: 'Hash and verify passwords with bcrypt (CDN: hash-wasm)' },
  { name: 'pgp-keys', fn: generatePGPKeys, title: 'PGP Keys', desc: 'Generate OpenPGP RSA key pairs (CDN: openpgp)' },
  { name: 'aes-words', fn: generateAESWords, title: 'AES Words', desc: 'Encrypt text into human-readable word sequences' },
  { name: 'photo-cipher', fn: generatePhotoCipher, title: 'Photo Cipher', desc: 'QIM steganography that survives JPEG compression' },
  { name: 'dead-drop', fn: generateDeadDrop, title: 'Dead Drop', desc: 'Encrypt messages into self-contained URL fragments' },
  { name: 'encrypt-tunnel', fn: generateEncryptTunnel, title: 'Encrypt & Tunnel', desc: 'AES-256 encrypt files + upload to anonymous hosts' },
  { name: 'anon-upload', fn: generateAnonUpload, title: 'Anonymous Upload', desc: 'Strip EXIF, randomize filename, upload anonymously' },
  { name: 'time-capsule', fn: generateTimeCapsule, title: 'Time Capsule', desc: 'Timelock encryption via drand network (CDN: tlock-js)' },
  { name: 'pdf-redact', fn: generatePDFRedact, title: 'PDF Redactor', desc: 'Draw redaction boxes on PDF pages (CDN: pdfjs + pdf-lib)' },
];

/**
 * Generate all standalone HTML files into the given output directory.
 * @param {string} outDir — absolute path to the output directory
 */
export function generateAll(outDir) {
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`\n[standalone] Generating ${tools.length} standalone HTML tools + index...\n`);

  for (const tool of tools) {
    const html = tool.fn();
    const outPath = path.join(outDir, `${tool.name}.html`);
    fs.writeFileSync(outPath, html, 'utf8');
    const sizeKB = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
    console.log(`  [OK] ${tool.name}.html (${sizeKB} KB)`);
  }

  // Generate index
  const indexHTMLContent = generateIndex(tools);
  fs.writeFileSync(path.join(outDir, 'index.html'), indexHTMLContent, 'utf8');
  const indexKB = (Buffer.byteLength(indexHTMLContent, 'utf8') / 1024).toFixed(1);
  console.log(`  [OK] index.html (${indexKB} KB)`);

  console.log(`\n[standalone] Done! ${tools.length} tools + index written to ${outDir}\n`);
  return tools.length;
}

// ── CLI mode: run directly with `node generate-standalone.mjs` ──
const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url).includes(path.basename(process.argv[1]));
if (isDirectRun) {
  const outDir = path.join(__dirname, 'standalone');
  generateAll(outDir);
}
