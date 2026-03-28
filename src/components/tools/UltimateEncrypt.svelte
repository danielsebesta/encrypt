<script lang="ts">
  import { onMount } from 'svelte';
  import QRCode from 'qrcode';
  import { encrypt, decrypt } from '../../lib/crypto';
  import { encryptData } from '../../lib/ghost/crypto';
  import { createStegoImage } from '../../lib/ghost/steganography';
  import { prepareSendUpload } from '../../lib/nologSend';
  import CopyButton from '../CopyButton.svelte';
  import ProgressPulse from '../ProgressPulse.svelte';
  import { getTranslations, t } from '../../lib/i18n';

  export let locale = 'en';
  $: dict = getTranslations(locale);

  type Step = 'input' | 'processing' | 'result';
  type DeliveryMode = 'auto' | 'link' | 'ghost';
  type ShortProvider = 'shrink' | 'nolog' | 'spoome' | 'isgd' | '1url';

  let step: Step = 'input';

  let textInput = '';
  let file: File | null = null;
  let password = '';
  let timelockDate = '';
  let showQr = false;

  let resultUrl = '';
  let shortUrl = '';
  let stegoImageUrl = '';
  let stegoImageBlob: Blob | null = null;
  let localFileUrl = '';
  let localFileName = '';
  let error = '';
  let progressTitle = '';
  let progressDetail = '';
  let debugLog: string[] = [];
  let qrSvg = '';

  const INLINE_LIMIT = 10 * 1024;
  const MAX_FILE = 50 * 1024 * 1024;
  const STEGO_THRESHOLD = 500 * 1024;

  interface HostInfo { id: string; name: string; retention: string; maxBytes: number; }

  // Send network is preferred — E2E encrypted, multiple instances
  const SEND_HOST: HostInfo = { id: 'nologsend', name: 'Send network', retention: '7+ days', maxBytes: 5 * 1024 * 1024 * 1024 };

  // Fallback binary hosts (shuffled at upload time)
  const BINARY_HOSTS: HostInfo[] = [
    { id: 'quax', name: 'qu.ax', retention: '30 days', maxBytes: 256 * 1024 * 1024 },
    { id: 'x0at', name: 'x0.at', retention: '3-100 days', maxBytes: 512 * 1024 * 1024 },
    { id: 'catbox', name: 'Catbox.moe', retention: 'forever', maxBytes: 200 * 1024 * 1024 },
    { id: 'tmpfile', name: 'tmpfile.link', retention: '7 days', maxBytes: 100 * 1024 * 1024 },
    { id: 'litterbox', name: 'Litterbox', retention: '3 days', maxBytes: 1024 * 1024 * 1024 },
    { id: 'tempsh', name: 'temp.sh', retention: '3 days', maxBytes: 4 * 1024 * 1024 * 1024 },
    { id: 'uguu', name: 'Uguu.se', retention: '3 hours', maxBytes: 128 * 1024 * 1024 },
  ];

  // Image hosts for stego PNGs (shuffled at upload time)
  const IMAGE_HOSTS: HostInfo[] = [
    { id: 'sxcu', name: 'sxcu.net', retention: 'forever', maxBytes: 95 * 1024 * 1024 },
    { id: 'freeimage', name: 'FreeImage.host', retention: 'forever', maxBytes: 64 * 1024 * 1024 },
    { id: 'imgbb', name: 'ImgBB', retention: 'forever', maxBytes: 32 * 1024 * 1024 },
  ];

  function shuffleArr<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  $: totalFileSize = files.reduce((s, f) => s + f.size, 0);
  $: payloadSize = files.length > 0 ? totalFileSize : new TextEncoder().encode(textInput.trim()).byteLength;
  $: isLarge = payloadSize > INLINE_LIMIT;
  $: isHuge = payloadSize > MAX_FILE;
  $: deliveryMode = isHuge ? 'local' : isLarge ? 'ghost' : 'link';
  $: shareUrl = shortUrl || resultUrl;
  $: if (step === 'result' && shareUrl) {
    void generateQr(shareUrl);
  }


  // EFF-inspired compact wordlist (1024 common short English words, 10 bits each)
  // 5 words = 50 bits entropy, 6 words = 60 bits — comparable to 20-char random
  const WORDS = 'able,acid,aged,also,area,army,away,baby,back,ball,band,bank,base,bath,bean,bear,beat,been,beer,bell,belt,best,bill,bird,bite,blow,blue,boat,body,bomb,bond,bone,book,boom,born,boss,both,bowl,bulk,burn,bush,busy,cafe,cage,cake,call,calm,came,camp,card,care,case,cash,cast,cave,cell,chat,chip,city,claim,clan,clay,clip,club,coal,coat,code,coin,cold,come,cook,cool,cope,copy,core,cost,crew,crop,cure,cute,dado,dale,dame,dare,dark,data,date,dawn,dead,deaf,deal,dear,debt,deck,deed,deem,deep,deer,demo,deny,desk,dial,dice,diet,dirt,disc,dish,dock,does,dome,done,door,dose,down,draw,drew,drop,drum,dual,duck,dude,duel,duke,dull,dump,dune,dust,duty,each,earn,ease,east,easy,edge,else,emit,epic,euro,even,ever,evil,exam,exit,eyed,face,fact,fade,fail,fair,fake,fall,fame,fang,fare,farm,fast,fate,fear,feat,feed,feel,feet,fell,felt,file,fill,film,find,fine,fire,firm,fish,fist,five,flag,flat,fled,flew,flip,flow,foam,fold,folk,fond,font,food,fool,foot,ford,fore,fork,form,fort,foul,four,free,from,fuel,full,fund,fury,fuse,gain,gala,gale,game,gang,gave,gaze,gear,gene,gift,girl,give,glad,glow,glue,goat,goes,gold,golf,gone,good,grab,gram,gray,grew,grey,grid,grip,grow,gulf,guru,gust,guys,hack,half,hall,halt,hand,hang,hard,harm,hate,haul,have,haze,head,heal,heap,hear,heat,heel,held,hell,help,herb,here,hero,hide,high,hike,hill,hint,hire,hold,hole,holy,home,hood,hook,hope,horn,host,hour,huge,hull,hung,hunt,hurt,icon,idea,inch,info,into,iron,isle,item,jack,jail,java,jazz,jean,jeep,jets,jobs,join,joke,jump,june,jury,just,keen,keep,kept,kick,kids,kill,kind,king,kiss,knee,knew,knit,knob,knot,know,labs,lack,laid,lake,lamp,land,lane,last,late,lawn,lead,leaf,lean,left,lend,lens,less,lied,lieu,life,lift,like,limb,lime,limp,line,link,lion,list,live,load,loan,lock,logo,lone,long,look,lord,lose,loss,lost,lots,loud,love,luck,lump,lung,lure,made,mail,main,make,male,mall,malt,mane,many,mare,mark,mask,mass,mate,maze,meal,mean,meat,melt,memo,menu,mere,mesh,mess,mild,mile,milk,mill,mind,mine,mint,miss,mode,mole,mood,moon,more,most,moth,move,much,must,myth,nail,name,navy,neat,neck,need,nest,news,next,nice,nine,node,none,noon,norm,nose,note,noun,nude,nuts,oath,obey,odds,okay,once,only,onto,open,oral,ours,oval,oven,over,pace,pack,page,paid,pain,pair,pale,palm,pane,pack,park,part,pass,past,path,peak,peel,peer,pine,pink,pipe,plan,play,plea,plot,ploy,plug,plus,poem,poet,pole,poll,polo,pond,pool,poor,pope,pork,port,pose,post,pour,pray,prey,prop,pull,pump,punk,pure,push,quit,quiz,race,rack,rage,raid,rail,rain,rang,rank,rare,rate,rays,read,real,rear,reef,reel,rely,rent,rest,rice,rich,ride,rife,rift,ring,riot,rise,risk,road,roam,rock,rode,role,roll,roof,room,root,rope,rose,ruin,rule,rush,ruth,sack,safe,sage,said,sake,sale,salt,same,sand,sang,save,seal,seed,seek,seem,seen,self,sell,semi,send,sent,sept,shed,ship,shoe,shop,shot,show,shut,sick,side,sift,sigh,sign,silk,sing,sink,site,size,skin,skip,slam,slap,slid,slim,slip,slot,slow,snap,snow,soak,soar,sock,soft,soil,sold,sole,some,song,soon,sort,soul,sour,span,spec,sped,spin,spot,star,stay,stem,step,stir,stop,stud,such,suit,sung,sure,surf,swan,swap,swim,sync,tact,tail,take,tale,talk,tall,tank,tape,task,team,tear,tell,temp,tend,tent,term,test,text,than,that,them,then,they,thin,this,thus,tick,tide,tidy,tied,tier,tile,till,time,tiny,tire,toad,told,toll,tomb,tone,took,tool,tops,tore,torn,toss,tour,town,trap,tray,tree,trek,trim,trio,trip,true,tube,tuck,tuna,tune,turf,turn,twin,type,ugly,undo,unit,upon,urge,used,user,vain,vale,vary,vast,veil,vein,vent,verb,very,vest,veto,vibe,vice,view,vine,visa,void,volt,vote,wade,wage,wait,wake,walk,wall,wand,want,ward,warm,warn,warp,wary,wash,watt,wave,wavy,waxy,weak,wear,weed,week,well,went,were,west,what,when,whom,wide,wife,wild,will,wilt,wily,wind,wine,wing,wink,wipe,wire,wise,wish,with,woke,wolf,womb,wood,wool,word,wore,work,worm,worn,wrap,wren,yard,yarn,yeah,year,yell,yoga,your,zeal,zero,zinc,zone,zoom'.split(',');

  function capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function generatePassphrase(): string {
    const count = 5;
    const arr = crypto.getRandomValues(new Uint8Array(count * 2 + 2));
    const words: string[] = [];
    for (let i = 0; i < count; i++) {
      const idx = ((arr[i * 2] << 8) | arr[i * 2 + 1]) % WORDS.length;
      words.push(capitalize(WORDS[idx]));
    }
    // Add a random 2-digit number to a random word
    const numIdx = arr[count * 2] % count;
    const num = (arr[count * 2 + 1] % 90) + 10; // 10-99
    const before = arr[count * 2] & 1; // coin flip: prepend or append
    words[numIdx] = before ? `${num}${words[numIdx]}` : `${words[numIdx]}${num}`;
    return words.join('-');
  }


  let textFocused = false;
  let dragging = false;
  let dropZoneEl: HTMLElement;
  let fileInputEl: HTMLInputElement;
  let files: File[] = [];

  $: file = files.length === 1 && !needsZip ? files[0] : null;
  $: needsZip = files.length > 1;
  $: zipName = needsZip ? (files[0]?.webkitRelativePath?.split('/')[0] || 'files') + '.zip' : '';

  function addFiles(incoming: FileList | File[]) {
    const arr = Array.from(incoming);
    if (arr.length === 0) return;
    files = arr;
    textInput = '';
  }

  function handleFileChange(e: Event) {
    const target = e.target as HTMLInputElement;
    if (target.files) addFiles(target.files);
  }

  function clearFile() {
    files = [];
    if (fileInputEl) fileInputEl.value = '';
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    if (e.dataTransfer?.files) addFiles(e.dataTransfer.files);
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    dragging = true;
  }

  function handleDragLeave() {
    dragging = false;
  }

  function handlePaste(e: ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;
    const pasted: File[] = [];
    for (const item of items) {
      if (item.kind === 'file') {
        const f = item.getAsFile();
        if (f) pasted.push(f);
      }
    }
    if (pasted.length > 0) {
      e.preventDefault();
      addFiles(pasted);
    }
  }

  // Minimal ZIP creator (store only, no compression — we encrypt after anyway)
  async function buildZip(entries: File[]): Promise<Uint8Array> {
    const enc = new TextEncoder();
    const centralHeaders: Uint8Array[] = [];
    const localParts: Uint8Array[] = [];
    let offset = 0;

    for (const f of entries) {
      const name = enc.encode(f.webkitRelativePath || f.name);
      const data = new Uint8Array(await f.arrayBuffer());
      const d = new Date(f.lastModified);
      const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
      const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
      const crc = crc32(data);
      // Local file header
      const local = new Uint8Array(30 + name.length + data.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(8, 0, true);
      lv.setUint16(10, dosTime, true);
      lv.setUint16(12, dosDate, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, name.length, true);
      local.set(name, 30);
      local.set(data, 30 + name.length);
      localParts.push(local);
      // Central directory header
      const ch = new Uint8Array(46 + name.length);
      const cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(12, dosTime, true);
      cv.setUint16(14, dosDate, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, name.length, true);
      cv.setUint32(42, offset, true);
      ch.set(name, 46);
      centralHeaders.push(ch);

      offset += local.length;
    }

    const cdSize = centralHeaders.reduce((s, h) => s + h.length, 0);
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, entries.length, true);
    ev.setUint16(10, entries.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);

    const total = offset + cdSize + 22;
    const zip = new Uint8Array(total);
    let pos = 0;
    for (const p of localParts) { zip.set(p, pos); pos += p.length; }
    for (const h of centralHeaders) { zip.set(h, pos); pos += h.length; }
    zip.set(eocd, pos);
    return zip;
  }

  function crc32(data: Uint8Array): number {
    let crc = ~0;
    for (let i = 0; i < data.length; i++) {
      crc ^= data[i];
      for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
    return (~crc) >>> 0;
  }

  function setProgress(title: string, detail = '') {
    progressTitle = title;
    progressDetail = detail;
  }

  function pushDebug(message: string) {
    const line = `[${new Date().toLocaleTimeString('en-GB', { hour12: false })}] ${message}`;
    debugLog = [...debugLog, line];
  }

  function base64UrlEncode(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  function buildReceiveUrls(encoded: string) {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://encrypt.click';
    return {
      direct: `${origin}/u/#${encoded}`,
      shortenable: `${origin}/u/?p=${encoded}`,
    };
  }

  async function gzipBytes(input: Uint8Array): Promise<Uint8Array> {
    const stream = new Blob([input]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function generateQr(url: string) {
    try {
      qrSvg = await QRCode.toString(url, {
        type: 'svg',
        errorCorrectionLevel: 'H',
        margin: 1,
        width: 320,
        color: {
          dark: '#065f46',
          light: '#ffffff',
        },
      });
    } catch (e: any) {
      pushDebug(`QR generation failed: ${e?.message || 'unknown error'}`);
      qrSvg = '';
    }
  }

  async function handleEncrypt() {
    error = '';
    resultUrl = '';
    shortUrl = '';
    stegoImageUrl = '';
    stegoImageBlob = null;
    setProgress('', '');
    debugLog = [];

    const trimmed = textInput.trim();
    pushDebug(`Start encrypt: mode=${deliveryMode}, file=${file ? file.name : 'none'}, payloadSize=${payloadSize} bytes`);
    if (files.length === 0 && !trimmed) {
      error = t(dict, 'tools.ultimateEncrypt.errorEnterMessageOrFile');
      pushDebug('Validation failed: empty input');
      return;
    }
    if (!password) {
      error = t(dict, 'tools.ultimateEncrypt.errorPasswordRequired');
      pushDebug('Validation failed: missing password');
      return;
    }

    step = 'processing';

    try {
      if (deliveryMode === 'local') {
        await encryptLocal();
      } else if (deliveryMode === 'link') {
        await encryptInline();
      } else {
        await encryptGhost();
      }
      step = 'result';
    } catch (e: any) {
      error = e?.message || t(dict, 'tools.ultimateEncrypt.errorEncryptionFailed');
      pushDebug(`Encrypt failed: ${error}`);
      step = 'input';
    }
  }

  async function resolvePayload(): Promise<{ buffer: Uint8Array; filename: string }> {
    if (needsZip) {
      pushDebug(`Zipping ${files.length} files client-side...`);
      setProgress(t(dict, 'tools.ultimateEncrypt.progressPreparingTitle'), 'Creating ZIP archive...');
      const buffer = await buildZip(files);
      const filename = zipName;
      pushDebug(`ZIP created: ${filename} (${buffer.byteLength} bytes)`);
      return { buffer, filename };
    }
    if (files.length === 1) {
      const f = files[0];
      const buffer = new Uint8Array(await f.arrayBuffer());
      return { buffer, filename: f.name };
    }
    return { buffer: new TextEncoder().encode(textInput.trim()), filename: 'message.txt' };
  }

  async function encryptLocal() {
    if (files.length === 0) throw new Error('No file selected');
    const { buffer, filename } = await resolvePayload();
    setProgress(t(dict, 'tools.ultimateEncrypt.progressEncryptingTitle'), t(dict, 'tools.ultimateEncrypt.progressEncryptingDetail'));
    pushDebug(`Local encrypt: ${filename} (${buffer.byteLength} bytes)`);

    const encrypted = await encryptData(buffer, password, filename);
    pushDebug(`Encrypted to ${encrypted.byteLength} bytes`);

    const blob = new Blob([encrypted], { type: 'application/octet-stream' });
    localFileName = `${filename}.enc`;
    if (localFileUrl) URL.revokeObjectURL(localFileUrl);
    localFileUrl = URL.createObjectURL(blob);

    setProgress(t(dict, 'tools.ultimateEncrypt.progressReadyTitle') || 'Ready', '');
    pushDebug(`Local encrypted file ready for download`);
  }

  async function encryptInline() {
    setProgress(t(dict, 'tools.ultimateEncrypt.progressPreparingTitle'), t(dict, 'tools.ultimateEncrypt.progressPreparingDetail'));
    let payload: any;
    if (files.length > 0) {
      const { buffer: bytes, filename } = await resolvePayload();
      const b64 = btoa(String.fromCharCode(...bytes));
      payload = { v: 1, mode: 'inline', kind: 'file', name: filename, type: 'application/octet-stream', data: b64 };
      pushDebug(`Inline payload prepared for ${filename} (${bytes.byteLength} bytes)`);
    } else {
      payload = { v: 1, mode: 'inline', kind: 'text', text: textInput.trim() };
      pushDebug(`Inline payload prepared for text (${textInput.trim().length} chars)`);
    }

    setProgress(t(dict, 'tools.ultimateEncrypt.progressEncryptingTitle'), t(dict, 'tools.ultimateEncrypt.progressEncryptingDetail'));
    const json = JSON.stringify(payload);
    const jsonBytes = new TextEncoder().encode(json);
    const compressed = await gzipBytes(jsonBytes);
    const compressedB64 = bytesToBase64(compressed);
    pushDebug(`Inline payload compressed from ${jsonBytes.byteLength} to ${compressed.byteLength} bytes`);
    const encrypted = await encrypt(compressedB64, password);
    const encoded = base64UrlEncode(encrypted);
    pushDebug(`Inline payload encrypted (${encrypted.byteLength} bytes, encoded length ${encoded.length})`);

    const urls = buildReceiveUrls(encoded);
    resultUrl = urls.direct;
    setProgress(t(dict, 'tools.ultimateEncrypt.progressLinkTitle'), t(dict, 'tools.ultimateEncrypt.progressLinkDetail'));
    await autoShorten(urls.shortenable);

  }

  async function encryptGhost() {
    setProgress(t(dict, 'tools.ultimateEncrypt.progressReadingTitle'), t(dict, 'tools.ultimateEncrypt.progressReadingDetail'));
    const { buffer, filename } = files.length > 0
      ? await resolvePayload()
      : { buffer: new TextEncoder().encode(textInput.trim()), filename: 'message.txt' };
    pushDebug(`Read payload ${filename} (${buffer.byteLength} bytes)`);

    setProgress(t(dict, 'tools.ultimateEncrypt.progressEncryptingTitle'), t(dict, 'tools.ultimateEncrypt.progressEncryptingUploadDetail'));
    const encrypted = await encryptData(buffer, password, filename);
    pushDebug(`Inner ghost payload encrypted (${encrypted.byteLength} bytes)`);

    let uploadBytes: Uint8Array;
    let uploadFilename: string;
    let usedStego = false;

    if (encrypted.length <= STEGO_THRESHOLD) {
      setProgress(t(dict, 'tools.ultimateEncrypt.progressHiddenPackageTitle'), t(dict, 'tools.ultimateEncrypt.progressHiddenPackageDetail'));
      uploadBytes = await createStegoImage(encrypted);
      uploadFilename = 'ghost.png';
      usedStego = true;
      pushDebug(`Stego wrapper created (${uploadBytes.byteLength} bytes PNG)`);
    } else {
      uploadBytes = encrypted;
      uploadFilename = 'ghost.bin';
      pushDebug(`Using raw binary upload (${uploadBytes.byteLength} bytes)`);
    }

    // Upload to hosts — try to get 2 URLs for redundancy
    setProgress(t(dict, 'tools.ultimateEncrypt.progressSendingTitle'), t(dict, 'tools.ultimateEncrypt.progressSendingDetail'));
    const uploadUrls: string[] = [];

    async function tryUploadHost(host: HostInfo): Promise<string | null> {
      try {
        pushDebug(`Trying host ${host.name} (${host.id})`);
        let fetchBody: Uint8Array = uploadBytes;
        const headers: Record<string, string> = {};

        if (host.id === 'nologsend') {
          pushDebug('Preparing Send ECE encryption client-side...');
          const prepared = await prepareSendUpload(uploadBytes, uploadFilename, uploadFilename.endsWith('.png') ? 'image/png' : 'application/octet-stream');
          pushDebug(`Send ECE encrypted (${prepared.encryptedBytes.byteLength} bytes)`);
          fetchBody = prepared.encryptedBytes;
          headers['X-Send-Metadata'] = prepared.metadataB64;
          headers['X-Send-Auth'] = prepared.authHeader;
          headers['X-Send-Secret'] = prepared.secretB64;
        }

        const res = await fetch(`/api/ghost/upload?services=${host.id}&stego=${usedStego}&filename=${encodeURIComponent(uploadFilename)}`, {
          method: 'POST', body: fetchBody, headers,
        });
        pushDebug(`Host ${host.name} responded with HTTP ${res.status}`);
        if (!res.ok) return null;
        const data = await res.json().catch(() => null) as any;
        const url = data?.results?.[0]?.url;
        if (url) pushDebug(`Host ${host.name} returned URL ${url}`);
        return url || null;
      } catch (e: any) {
        pushDebug(`Host ${host.name} failed: ${e?.message || 'unknown error'}`);
        return null;
      }
    }

    if (usedStego) {
      // Stego: try image hosts sequentially
      for (const host of shuffleArr(IMAGE_HOSTS).filter(h => uploadBytes.length <= h.maxBytes)) {
        const url = await tryUploadHost(host);
        if (url) { uploadUrls.push(url); break; }
      }
    } else {
      // Binary: Send + file host in parallel for redundancy
      const sendEligible = uploadBytes.length <= SEND_HOST.maxBytes ? SEND_HOST : null;
      const fileHosts = shuffleArr(BINARY_HOSTS).filter(h => uploadBytes.length <= h.maxBytes);

      if (sendEligible && fileHosts.length > 0) {
        // Parallel: Send + first file host
        pushDebug(`Parallel upload: ${sendEligible.name} + ${fileHosts[0].name}`);
        const results = await Promise.allSettled([
          tryUploadHost(sendEligible),
          tryUploadHost(fileHosts[0]),
        ]);
        for (const r of results) {
          if (r.status === 'fulfilled' && r.value) uploadUrls.push(r.value);
        }
        // If both failed, try remaining file hosts sequentially
        if (uploadUrls.length === 0) {
          for (const host of fileHosts.slice(1)) {
            const url = await tryUploadHost(host);
            if (url) { uploadUrls.push(url); break; }
          }
        }
      } else {
        // No Send or no file hosts — try whatever is available
        const all = sendEligible ? [sendEligible, ...fileHosts] : fileHosts;
        for (const host of all) {
          const url = await tryUploadHost(host);
          if (url) { uploadUrls.push(url); break; }
        }
      }
    }

    pushDebug(`Upload complete: ${uploadUrls.length} URL(s) stored`);

    if (uploadUrls.length === 0) {
      throw new Error(t(dict, 'tools.ultimateEncrypt.errorAllUploadHostsFailed'));
    }

    const ghostPayload = {
      v: 1,
      mode: 'ghost',
      urls: uploadUrls,
      stego: usedStego,
    };

    setProgress(t(dict, 'tools.ultimateEncrypt.progressLinkTitle'), t(dict, 'tools.ultimateEncrypt.progressFinalLinkDetail'));
    const payloadJson = JSON.stringify(ghostPayload);
    const payloadBytes = new TextEncoder().encode(payloadJson);
    const compressed = await gzipBytes(payloadBytes);
    const compressedB64 = bytesToBase64(compressed);
    pushDebug(`Outer ghost payload compressed from ${payloadBytes.byteLength} to ${compressed.byteLength} bytes`);
    const encPayload = await encrypt(compressedB64, password);
    const encoded = base64UrlEncode(encPayload);
    pushDebug(`Final link payload encrypted (${encPayload.byteLength} bytes, encoded length ${encoded.length})`);

    const urls = buildReceiveUrls(encoded);
    resultUrl = urls.direct;
    await autoShorten(urls.shortenable);

  }

  async function wrapInStego(url: string) {
    setProgress(t(dict, 'tools.ultimateEncrypt.progressCoverImageTitle'), t(dict, 'tools.ultimateEncrypt.progressCoverImageDetail'));
    const urlBytes = new TextEncoder().encode(url);
    const stegoBytes = await createStegoImage(urlBytes);
    pushDebug(`Generated downloadable PNG wrapper (${stegoBytes.byteLength} bytes)`);
    stegoImageBlob = new Blob([stegoBytes], { type: 'image/png' });
    stegoImageUrl = URL.createObjectURL(stegoImageBlob);
  }

  // Our own shortener — always try first
  const OWN_SHORT: ShortProvider = 'shrink';
  // Fallback if our shortener is down — shuffled
  const FALLBACK_SHORT: ShortProvider[] = ['nolog', 'spoome', '1url', 'isgd'];

  const SHORT_NAMES: Record<ShortProvider, string> = {
    shrink: 'l.encrypt.click', nolog: 'Nolog.link',
    spoome: 'spoo.me', isgd: 'is.gd', '1url': '1url.cz',
  };

  const SHORTEN_TIMEOUT = 3000;

  async function tryShorten(url: string, provider: ShortProvider): Promise<string | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SHORTEN_TIMEOUT);
    try {
      pushDebug(`Shortener ${SHORT_NAMES[provider]}: request start`);
      const res = await fetch('/api/shorten', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, provider }),
        signal: controller.signal,
      });
      const data = await res.json();
      pushDebug(`Shortener ${SHORT_NAMES[provider]}: HTTP ${res.status}`);
      if (res.ok && data?.shorturl) {
        pushDebug(`Shortener ${SHORT_NAMES[provider]}: success -> ${data.shorturl}`);
        return data.shorturl;
      }
      if (data?.error) pushDebug(`Shortener ${SHORT_NAMES[provider]}: ${data.error}`);
    } catch (e: any) {
      pushDebug(`Shortener ${SHORT_NAMES[provider]}: ${e?.name === 'AbortError' ? 'timeout' : e?.message || 'failed'}`);
    } finally {
      clearTimeout(timer);
    }
    return null;
  }

  async function autoShorten(url: string): Promise<void> {
    setProgress(t(dict, 'tools.ultimateEncrypt.progressShortenTitle'), t(dict, 'tools.ultimateEncrypt.progressShortenDetail'));
    // Try our own shortener first (with retry)
    const own = await tryShorten(url, OWN_SHORT);
    if (own) { shortUrl = own; return; }
    const ownRetry = await tryShorten(url, OWN_SHORT);
    if (ownRetry) { shortUrl = ownRetry; return; }
    // Fallback to external providers (shuffled)
    for (const provider of shuffleArr(FALLBACK_SHORT)) {
      const result = await tryShorten(url, provider);
      if (result) { shortUrl = result; return; }
    }
  }

  function downloadStego() {
    if (!stegoImageUrl) return;
    const a = document.createElement('a');
    a.href = stegoImageUrl;
    a.download = 'secret.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function reset() {
    step = 'input';
    textInput = '';
    files = [];
    password = '';
    password = generatePassphrase();
    timelockDate = '';
    resultUrl = '';
    shortUrl = '';
    error = '';
    showQr = false;
    setProgress('', '');
    if (stegoImageUrl) URL.revokeObjectURL(stegoImageUrl);
    stegoImageUrl = '';
    stegoImageBlob = null;
    if (localFileUrl) URL.revokeObjectURL(localFileUrl);
    localFileUrl = '';
    localFileName = '';
    qrSvg = '';
    debugLog = [];
  }

  onMount(() => { password = generatePassphrase(); });
</script>

<div class="space-y-6 text-left">
  {#if step === 'input'}
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="space-y-4" on:paste={handlePaste}>
      <!-- Input area: text + file -->
      <div class="ue-input-grid" class:ue-input-grid--focused={textFocused && files.length === 0}>
        <!-- Text input -->
        <div class="ue-input-pane" class:ue-input-pane--active={files.length === 0 && textInput.trim().length > 0} class:ue-input-pane--disabled={files.length > 0}>
          <label class="ue-input-pane__label" for="ue-text">
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
            {t(dict, 'tools.ultimateEncrypt.messageLabel')}
          </label>
          <textarea
            id="ue-text"
            class="ue-textarea"
            bind:value={textInput}
            placeholder={t(dict, 'tools.ultimateEncrypt.messagePlaceholder')}
            disabled={files.length > 0}
            on:focus={() => textFocused = true}
            on:blur={() => textFocused = false}
          ></textarea>
        </div>

        <!-- File drop zone -->
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div
          class="ue-input-pane ue-drop-zone"
          class:ue-input-pane--active={files.length > 0}
          class:ue-drop-zone--dragging={dragging}
          bind:this={dropZoneEl}
          on:drop={handleDrop}
          on:dragover={handleDragOver}
          on:dragleave={handleDragLeave}
        >
          {#if files.length > 0}
            <div class="flex flex-col w-full">
              <span class="ue-input-pane__label">
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                {files.length === 1 ? files[0].name : `${files.length} files`}
              </span>
              <div class="flex items-center gap-2 mt-1">
                {#if files.length > 1}
                  <span class="text-[10px] text-emerald-600 dark:text-emerald-400">auto-zipped</span>
                {/if}
                <span class="text-[10px] text-zinc-400">{totalFileSize < 1024 * 1024 ? `${(totalFileSize / 1024).toFixed(1)} KB` : `${(totalFileSize / (1024 * 1024)).toFixed(1)} MB`}</span>
                <button type="button" class="text-[10px] font-bold text-red-500 hover:underline ml-auto" on:click={clearFile}>{t(dict, 'tools.ultimateEncrypt.remove')}</button>
              </div>
            </div>
          {:else}
            <label class="flex flex-col items-center gap-1.5 cursor-pointer text-center py-2 w-full h-full justify-center" for="ue-file">
              <span class="ue-input-pane__label">
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                {t(dict, 'tools.ultimateEncrypt.fileLabel')}
              </span>
              <span class="text-[10px] text-zinc-300 dark:text-zinc-600">Drop, paste, or click</span>
            </label>
            <input id="ue-file" type="file" multiple class="sr-only" bind:this={fileInputEl} on:change={handleFileChange} />
          {/if}
        </div>
      </div>

      <!-- Password -->
      <div class="space-y-1.5">
        <label class="label flex items-center gap-1.5" for="ue-pass">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="opacity-40"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          {t(dict, 'tools.ultimateEncrypt.passwordLabel')}
        </label>
        <div class="ue-passphrase-box">
          <input
            id="ue-pass"
            type="text"
            class="ue-passphrase-input"
            bind:value={password}
            autocomplete="off"
            placeholder={t(dict, 'tools.ultimateEncrypt.passwordPlaceholder')}
          />
          <button type="button" class="ue-passphrase-refresh" on:click={() => { password = generatePassphrase(); }} aria-label="Generate passphrase">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          </button>
        </div>
      </div>

      {#if error}
        <p class="text-xs text-red-500">{error}</p>
      {/if}

      <button
        class="btn w-full"
        type="button"
        on:click={handleEncrypt}
        disabled={(!textInput.trim() && files.length === 0)}
      >
        {t(dict, 'tools.ultimateEncrypt.encryptAndShare')}
      </button>
    </div>

  {:else if step === 'processing'}
    <div class="space-y-4">
      <ProgressPulse title={progressTitle || t(dict, 'tools.ultimateEncrypt.progressDefaultTitle')} detail={progressDetail || t(dict, 'tools.ultimateEncrypt.progressDefaultDetail')} />
      {#if error}
        <p class="text-xs text-red-500">{error}</p>
      {/if}
    </div>

  {:else if step === 'result'}
    <div class="space-y-5">
      {#if resultUrl || shortUrl}
      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <label class="label block">{shortUrl ? t(dict, 'tools.ultimateEncrypt.shareThisLink') : t(dict, 'tools.ultimateEncrypt.encryptedLink')}</label>
          <div class="flex items-center gap-2">
            {#if qrSvg && shareUrl}
              <button
                type="button"
                class="inline-flex h-9 w-9 items-center justify-center rounded-full border border-emerald-200 dark:border-emerald-900/70 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 transition-colors hover:bg-emerald-100 dark:hover:bg-emerald-900/40"
                aria-label={t(dict, 'tools.ultimateEncrypt.qrAlt')}
                title={t(dict, 'tools.ultimateEncrypt.qrAlt')}
                on:click={() => showQr = !showQr}
              >
                <svg viewBox="0 0 24 24" class="h-4.5 w-4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M4 4h6v6H4z" />
                  <path d="M14 4h6v6h-6z" />
                  <path d="M4 14h6v6H4z" />
                  <path d="M14 14h2" />
                  <path d="M18 14h2v2" />
                  <path d="M14 18h2v2h-2z" />
                  <path d="M18 18h2v2h-2z" />
                </svg>
              </button>
            {/if}
            <CopyButton text={shortUrl || resultUrl} label={t(dict, 'tools.ultimateEncrypt.copy')} />
          </div>
        </div>
        <input class="input text-xs font-mono" type="text" readonly value={shortUrl || resultUrl} />
        {#if showQr && qrSvg && shareUrl}
          <div class="mt-3 flex justify-center">
            <div class="w-full max-w-[248px] rounded-[1.8rem] border border-emerald-200/80 dark:border-emerald-900/70 bg-[linear-gradient(180deg,rgba(236,253,245,0.98),rgba(209,250,229,0.92))] dark:bg-[linear-gradient(180deg,rgba(2,44,34,0.96),rgba(4,28,24,0.98))] p-3 shadow-[0_18px_60px_rgba(6,95,70,0.18)]">
              <div class="relative overflow-hidden rounded-[1.35rem] border border-white/70 dark:border-white/8 bg-white p-3">
                <div class="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(16,185,129,0.10),transparent_58%)]"></div>
                <div class="relative mx-auto w-full max-w-[200px]" aria-label={t(dict, 'tools.ultimateEncrypt.qrAlt')}>
                  <div class="block w-full [&>svg]:block [&>svg]:h-auto [&>svg]:w-full [&>svg]:rounded-[1rem]">
                    {@html qrSvg}
                  </div>
                  <div class="absolute left-1/2 top-1/2 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-xl border border-emerald-200 bg-white shadow-[0_10px_30px_rgba(6,95,70,0.16)]">
                    <img src="/encryptclick_icon.svg" alt="" class="h-6 w-6" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        {/if}
        {#if shortUrl}
          <details class="text-[11px] text-zinc-400">
            <summary class="cursor-pointer select-none hover:text-zinc-600 dark:hover:text-zinc-300">{t(dict, 'tools.ultimateEncrypt.fullLink')}</summary>
            <div class="mt-1 flex items-center gap-2">
              <input class="input text-[10px] font-mono flex-1" type="text" readonly value={resultUrl} />
              <CopyButton text={resultUrl} label={t(dict, 'tools.ultimateEncrypt.copy')} className="!text-[9px]" />
            </div>
          </details>
        {/if}
      </div>
      {/if}

      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <label class="label block">{t(dict, 'tools.ultimateEncrypt.passwordLabel')}</label>
          <CopyButton text={password} label={t(dict, 'tools.ultimateEncrypt.copy')} />
        </div>
        <input class="input text-xs font-mono" type="text" readonly value={password} />
        <p class="text-[10px] text-amber-500">{t(dict, 'tools.ultimateEncrypt.passwordWarning')}</p>
      </div>

      {#if localFileUrl}
        <div class="space-y-3">
          <div class="ue-passphrase-box">
            <div class="flex-1">
              <p class="text-sm font-medium text-emerald-700 dark:text-emerald-400">{localFileName}</p>
              <p class="text-[10px] text-emerald-600/60 dark:text-emerald-500/60 mt-0.5">Encrypted with AES-256-GCM</p>
            </div>
            <a href={localFileUrl} download={localFileName} class="btn text-xs px-4 py-2">Download</a>
          </div>
          <div class="rounded-xl border border-zinc-200/60 dark:border-zinc-800/50 bg-zinc-50/50 dark:bg-zinc-900/30 p-4 space-y-2">
            <p class="text-xs font-bold text-zinc-600 dark:text-zinc-300">Next steps:</p>
            <ol class="text-[11px] text-zinc-500 dark:text-zinc-400 space-y-1.5 list-decimal list-inside">
              <li>Download the encrypted file above</li>
              <li>Upload it to a <a href="https://github.com/timvisee/send-instances/#instances" target="_blank" rel="noopener noreferrer" class="text-emerald-600 dark:text-emerald-400 underline underline-offset-2">Send instance</a></li>
              <li>Share the Send link + password with the recipient</li>
              <li>Recipient decrypts using <a href="/u" class="text-emerald-600 dark:text-emerald-400 underline underline-offset-2">encrypt.click/u</a></li>
            </ol>
          </div>
        </div>
      {/if}

      {#if stegoImageUrl}
        <div class="space-y-2">
          <label class="label block">{t(dict, 'tools.ultimateEncrypt.steganographyImage')}</label>
          <p class="text-[11px] text-zinc-400">{t(dict, 'tools.ultimateEncrypt.steganographyHelp')}</p>
          <div class="flex items-center gap-3">
            <img src={stegoImageUrl} alt="" class="w-16 h-16 rounded border border-zinc-200 dark:border-zinc-800 object-cover" />
            <button type="button" class="btn-outline text-xs" on:click={downloadStego}>{t(dict, 'tools.ultimateEncrypt.downloadImage')}</button>
          </div>
        </div>
      {/if}

      <button type="button" class="btn-outline w-full text-xs" on:click={reset}>{t(dict, 'tools.ultimateEncrypt.encryptAnother')}</button>
    </div>
  {/if}
</div>
