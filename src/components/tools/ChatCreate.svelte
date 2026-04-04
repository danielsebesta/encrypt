<script lang="ts">
  import { getTranslations, t } from '../../lib/i18n';

  export let locale = 'en';
  $: dict = getTranslations(locale);

  type Step = 'password' | 'ready';
  let step: Step = 'password';
  let generatedLink = '';
  let password = '';
  let customRoomId = '';
  let copied = false;
  let copiedPass = false;

  const WORDS = 'able,acid,aged,area,army,away,baby,back,ball,band,bank,base,bath,bear,beat,bell,belt,best,bird,blow,blue,boat,body,bold,bone,book,born,boss,burn,busy,cafe,cage,cake,call,calm,came,camp,card,care,case,cash,cave,cell,chip,city,clan,clay,clip,club,coal,coat,code,coin,cold,come,cook,cool,cope,copy,core,cost,crew,crop,cure,cute,dale,dame,dare,dark,data,date,dawn,dead,deal,dear,debt,deck,deed,deep,deer,deny,desk,dial,dice,diet,dirt,dock,dome,done,door,dose,down,draw,drop,drum,dual,duck,duke,dull,dump,dune,dust,duty,each,earn,ease,east,easy,edge,epic,euro,even,ever,evil,exam,exit,face,fact,fade,fail,fair,fake,fall,fame,fare,farm,fast,fate,fear,feed,feel,feet,fell,file,fill,film,find,fine,fire,firm,fish,five,flag,flat,flew,flip,flow,foam,fold,folk,fond,food,fool,foot,fork,form,fort,four,free,from,fuel,full,fund,fury,fuse,gain,gale,game,gang,gave,gaze,gear,gene,gift,girl,give,glad,glow,glue,goat,gold,golf,gone,good,grab,gram,gray,grew,grid,grip,grow,gulf,gust,hack,half,hall,halt,hand,hang,hard,harm,hate,have,haze,head,heal,heap,hear,heat,heel,held,help,herb,here,hero,hide,high,hike,hill,hint,hire,hold,hole,holy,home,hood,hook,hope,horn,host,hour,huge,hull,hung,hunt,hurt,icon,idea,inch,info,into,iron,isle,item,jack,jail,jazz,jeep,jobs,join,joke,jump,jury,just,keen,keep,kept,kick,kill,kind,king,kiss,knee,knew,knot,know,lack,laid,lake,lamp,land,lane,last,late,lawn,lead,leaf,lean,left,lend,lens,life,lift,like,lime,line,link,lion,list,live,load,loan,lock,logo,lone,long,look,lord,lose,loss,lost,loud,love,luck,lump,lung,lure,made,mail,main,make,male,mall,mane,many,mark,mask,mass,mate,maze,meal,mean,meat,melt,memo,menu,mesh,mess,mild,mile,milk,mill,mind,mine,mint,miss,mode,mood,moon,more,most,move,much,must,myth,nail,name,navy,neat,neck,need,nest,news,next,nice,nine,node,none,noon,norm,nose,note,nude,nuts,oath,odds,okay,once,only,onto,open,oval,oven,over,pace,pack,page,paid,pain,pair,pale,palm,park,part,pass,past,path,peak,peel,peer,pine,pink,pipe,plan,play,plea,plot,plug,plus,poem,poet,pole,poll,pond,pool,poor,port,pose,post,pour,pray,prey,prop,pull,pump,pure,push,quit,quiz,race,rack,rage,raid,rail,rain,rang,rank,rare,rate,read,real,rear,reef,reel,rely,rent,rest,rice,rich,ride,rift,ring,riot,rise,risk,road,roam,rock,rode,role,roll,roof,room,root,rope,rose,ruin,rule,rush,sack,safe,sage,said,sake,sale,salt,same,sand,sang,save,seal,seed,seek,seem,seen,self,sell,semi,send,sent,shed,ship,shoe,shop,shot,show,shut,sick,side,sigh,sign,silk,sing,sink,site,size,skin,skip,slam,slap,slim,slip,slot,slow,snap,snow,soak,soar,sock,soft,soil,sold,sole,some,song,soon,sort,soul,sour,span,spec,sped,spin,spot,star,stay,stem,step,stir,stop,such,suit,sung,sure,surf,swan,swap,swim,sync,tail,take,tale,talk,tall,tank,tape,task,team,tear,tell,tend,tent,term,test,text,than,that,them,then,they,thin,this,thus,tick,tide,tidy,tied,tier,tile,till,time,tiny,tire,toad,told,toll,tomb,tone,took,tool,tops,tore,torn,toss,tour,town,trap,tray,tree,trek,trim,trio,trip,true,tube,tuck,tuna,tune,turf,turn,twin,type,ugly,undo,unit,upon,urge,used,user,vain,vale,vary,vast,veil,vein,vent,verb,very,vest,veto,vibe,vice,view,vine,visa,void,volt,vote,wade,wage,wait,wake,walk,wall,wand,want,ward,warm,warn,warp,wary,wash,wave,weak,wear,weed,week,well,went,were,west,what,when,whom,wide,wife,wild,will,wind,wine,wing,wink,wipe,wire,wise,wish,with,woke,wolf,wood,wool,word,wore,work,worm,worn,wrap,yard,yarn,yeah,year,yell,yoga,your,zeal,zero,zinc,zone,zoom'.split(',');

  function genRoomId(): string {
    const arr = crypto.getRandomValues(new Uint8Array(6));
    return Array.from(arr, b => b.toString(36).padStart(2, '0')).join('').slice(0, 8);
  }

  const DIACRITICS: Record<string, string> = {
    'á':'a','à':'a','â':'a','ä':'a','ã':'a','å':'a','ą':'a',
    'č':'c','ć':'c','ç':'c',
    'ď':'d','đ':'d',
    'é':'e','è':'e','ê':'e','ë':'e','ě':'e','ę':'e',
    'í':'i','ì':'i','î':'i','ï':'i',
    'ľ':'l','ĺ':'l','ł':'l',
    'ň':'n','ń':'n','ñ':'n',
    'ó':'o','ò':'o','ô':'o','ö':'o','õ':'o','ø':'o',
    'ř':'r','ŕ':'r',
    'š':'s','ś':'s','ß':'ss',
    'ť':'t','ţ':'t',
    'ú':'u','ù':'u','û':'u','ü':'u','ů':'u',
    'ý':'y','ÿ':'y',
    'ž':'z','ź':'z','ż':'z',
  };

  function stripDiacritics(s: string): string {
    return s.split('').map(c => DIACRITICS[c] || c).join('');
  }

  function sanitizeRoomId(input: string, final = false): string {
    let s = stripDiacritics(input.toLowerCase())
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .slice(0, 48);
    if (final) s = s.replace(/^-|-$/g, '');
    return s;
  }

  function handleRoomIdInput() {
    customRoomId = sanitizeRoomId(customRoomId);
  }

  function genPassphrase(): string {
    const count = 5;
    const arr = crypto.getRandomValues(new Uint8Array(count * 2 + 2));
    const words: string[] = [];
    for (let i = 0; i < count; i++) {
      const idx = ((arr[i * 2] << 8) | arr[i * 2 + 1]) % WORDS.length;
      const w = WORDS[idx];
      words.push(w.charAt(0).toUpperCase() + w.slice(1));
    }
    const numIdx = arr[count * 2] % count;
    const num = (arr[count * 2 + 1] % 90) + 10;
    words[numIdx] = (arr[count * 2] & 1) ? `${num}${words[numIdx]}` : `${words[numIdx]}${num}`;
    return words.join('-');
  }

  // Pre-generate password on load
  password = genPassphrase();

  function confirmPassword() {
    if (!password.trim()) { password = genPassphrase(); }
    const roomId = customRoomId.trim() ? sanitizeRoomId(customRoomId.trim(), true) : genRoomId();
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://encrypt.click';
    generatedLink = `${origin}/chat/${roomId}`;
    step = 'ready';
  }

  async function copyLink() {
    try { await navigator.clipboard.writeText(generatedLink); copied = true; setTimeout(() => { copied = false; }, 1500); } catch {}
  }

  async function copyPassword() {
    try { await navigator.clipboard.writeText(password); copiedPass = true; setTimeout(() => { copiedPass = false; }, 1500); } catch {}
  }

  function openRoom() {
    if (!generatedLink) return;
    if (password.trim()) sessionStorage.setItem('chat-password', password.trim());
    window.location.href = generatedLink;
  }
</script>

<div class="space-y-4">
  {#if step === 'password'}
    <!-- Step 1: Room name + password -->
    <div class="space-y-1.5">
      <label class="label block">{t(dict, 'chat.customRoomId')}</label>
      <input
        class="input w-full"
        type="text"
        bind:value={customRoomId}
        on:input={handleRoomIdInput}
        placeholder={t(dict, 'chat.customRoomIdPlaceholder')}
        autocomplete="off"
        data-lpignore="true"
        data-1p-ignore
        data-bwignore="true"
      />
      <p class="text-[10px] text-zinc-400 dark:text-zinc-500">{t(dict, 'chat.customRoomIdHint')}</p>
    </div>

    <div class="space-y-1.5">
      <label class="label block">{t(dict, 'chat.password')}</label>
      <div class="ue-passphrase-box">
        <input
          class="ue-passphrase-input flex-1"
          type="text"
          bind:value={password}
          placeholder={t(dict, 'chat.roomPasswordPlaceholder')}
          autocomplete="off"
          data-lpignore="true"
          data-1p-ignore
          data-bwignore="true"
        />
        <button class="ue-passphrase-refresh" on:click={() => { password = genPassphrase(); }} aria-label="Generate">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
        </button>
      </div>
      <p class="text-[10px] text-zinc-400 dark:text-zinc-500">{t(dict, 'chat.createDescription')}</p>
    </div>
    <button class="btn w-full" on:click={confirmPassword}>{t(dict, 'chat.createRoom')}</button>

    <!-- How it works -->
    <div class="chat-how-it-works">
      <p class="chat-how-title">{t(dict, 'chat.howItWorks')}</p>
      <div class="chat-how-steps">
        <div class="chat-how-step">
          <span class="chat-how-num">1</span>
          <span>{t(dict, 'chat.howStep1')}</span>
        </div>
        <div class="chat-how-step">
          <span class="chat-how-num">2</span>
          <span>{t(dict, 'chat.howStep2')}</span>
        </div>
        <div class="chat-how-step">
          <span class="chat-how-num">3</span>
          <span>{t(dict, 'chat.howStep3')}</span>
        </div>
      </div>
    </div>

  {:else}
    <!-- Step 2: Link + hidden password + enter -->
    <div class="space-y-1.5">
      <label class="label block">{t(dict, 'chat.roomLink')}</label>
      <div class="ue-passphrase-box">
        <input class="ue-passphrase-input flex-1" type="text" readonly value={generatedLink} />
        <button class="ue-passphrase-refresh" on:click={copyLink}>
          {#if copied}
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-emerald-500"><polyline points="20 6 9 17 4 12"/></svg>
          {:else}
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          {/if}
        </button>
      </div>
    </div>

    <div class="space-y-1.5">
      <label class="label block">{t(dict, 'chat.password')}</label>
      <div class="ue-passphrase-box">
        <input class="ue-passphrase-input flex-1" type="password" readonly value={password} autocomplete="off" data-lpignore="true" data-1p-ignore data-bwignore="true" />
        <button class="ue-passphrase-refresh" on:click={copyPassword}>
          {#if copiedPass}
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-emerald-500"><polyline points="20 6 9 17 4 12"/></svg>
          {:else}
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          {/if}
        </button>
      </div>
      <p class="text-[10px] text-amber-500">{t(dict, 'chat.sharePasswordWarning')}</p>
    </div>

    <button class="btn w-full" on:click={openRoom}>{t(dict, 'chat.enterRoom')}</button>
  {/if}
</div>

<style>
  .chat-how-it-works {
    border-top: 1px solid rgba(228, 228, 231, 0.5);
    padding-top: 1rem;
    margin-top: 0.5rem;
  }
  :global(.dark) .chat-how-it-works {
    border-color: rgba(39, 39, 42, 0.4);
  }
  .chat-how-title {
    font-size: 11px;
    font-weight: 600;
    color: rgb(113, 113, 122);
    margin-bottom: 0.6rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .chat-how-steps {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .chat-how-step {
    display: flex;
    align-items: flex-start;
    gap: 0.6rem;
    font-size: 12px;
    color: rgb(113, 113, 122);
    text-align: left;
    line-height: 1.4;
  }
  :global(.dark) .chat-how-step {
    color: rgb(161, 161, 170);
  }
  .chat-how-num {
    flex-shrink: 0;
    width: 18px;
    height: 18px;
    border-radius: 9999px;
    background: rgba(16, 185, 129, 0.1);
    color: rgb(16, 185, 129);
    font-size: 10px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
  }
</style>
