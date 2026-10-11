<script lang="ts">
  import { randomIndex } from "../../lib/random";
  import { t } from '../../lib/t';
  import { generateRoomKey } from '../../lib/chatCrypto';

  export let locale = 'en';
  export let dict: Record<string, string>;

  let password = '';
  let customRoomId = '';
  let selectedMode: ChatRoomMode = 'live';
  let roomError = '';

  type ChatRoomMode = 'live' | 'ttl-10' | 'ttl-5';

  // The relay receives a slow password-derived capability, so a short typed password could be guessed offline.
  const MIN_PASSWORD_LENGTH = 12;

  const ROOM_MODES: { value: ChatRoomMode; title: string; hint: string }[] = [
    { value: 'live', title: 'chat.modeLiveTitle', hint: 'chat.modeLiveHint' },
    { value: 'ttl-10', title: 'chat.modeTtl10Title', hint: 'chat.modeTtl10Hint' },
    { value: 'ttl-5', title: 'chat.modeTtl5Title', hint: 'chat.modeTtl5Hint' },
  ];

  const WORDS = 'able,acid,aged,area,army,away,baby,back,ball,band,bank,base,bath,bear,beat,bell,belt,best,bird,blow,blue,boat,body,bold,bone,book,born,boss,burn,busy,cafe,cage,cake,call,calm,came,camp,card,care,case,cash,cave,cell,chip,city,clan,clay,clip,club,coal,coat,code,coin,cold,come,cook,cool,cope,copy,core,cost,crew,crop,cure,cute,dale,dame,dare,dark,data,date,dawn,dead,deal,dear,debt,deck,deed,deep,deer,deny,desk,dial,dice,diet,dirt,dock,dome,done,door,dose,down,draw,drop,drum,dual,duck,duke,dull,dump,dune,dust,duty,each,earn,ease,east,easy,edge,epic,euro,even,ever,evil,exam,exit,face,fact,fade,fail,fair,fake,fall,fame,fare,farm,fast,fate,fear,feed,feel,feet,fell,file,fill,film,find,fine,fire,firm,fish,five,flag,flat,flew,flip,flow,foam,fold,folk,fond,food,fool,foot,fork,form,fort,four,free,from,fuel,full,fund,fury,fuse,gain,gale,game,gang,gave,gaze,gear,gene,gift,girl,give,glad,glow,glue,goat,gold,golf,gone,good,grab,gram,gray,grew,grid,grip,grow,gulf,gust,hack,half,hall,halt,hand,hang,hard,harm,hate,have,haze,head,heal,heap,hear,heat,heel,held,help,herb,here,hero,hide,high,hike,hill,hint,hire,hold,hole,holy,home,hood,hook,hope,horn,host,hour,huge,hull,hung,hunt,hurt,icon,idea,inch,info,into,iron,isle,item,jack,jail,jazz,jeep,jobs,join,joke,jump,jury,just,keen,keep,kept,kick,kill,kind,king,kiss,knee,knew,knot,know,lack,laid,lake,lamp,land,lane,last,late,lawn,lead,leaf,lean,left,lend,lens,life,lift,like,lime,line,link,lion,list,live,load,loan,lock,logo,lone,long,look,lord,lose,loss,lost,loud,love,luck,lump,lung,lure,made,mail,main,make,male,mall,mane,many,mark,mask,mass,mate,maze,meal,mean,meat,melt,memo,menu,mesh,mess,mild,mile,milk,mill,mind,mine,mint,miss,mode,mood,moon,more,most,move,much,must,myth,nail,name,navy,neat,neck,need,nest,news,next,nice,nine,node,none,noon,norm,nose,note,nude,nuts,oath,odds,okay,once,only,onto,open,oval,oven,over,pace,pack,page,paid,pain,pair,pale,palm,park,part,pass,past,path,peak,peel,peer,pine,pink,pipe,plan,play,plea,plot,plug,plus,poem,poet,pole,poll,pond,pool,poor,port,pose,post,pour,pray,prey,prop,pull,pump,pure,push,quit,quiz,race,rack,rage,raid,rail,rain,rang,rank,rare,rate,read,real,rear,reef,reel,rely,rent,rest,rice,rich,ride,rift,ring,riot,rise,risk,road,roam,rock,rode,role,roll,roof,room,root,rope,rose,ruin,rule,rush,sack,safe,sage,said,sake,sale,salt,same,sand,sang,save,seal,seed,seek,seem,seen,self,sell,semi,send,sent,shed,ship,shoe,shop,shot,show,shut,sick,side,sigh,sign,silk,sing,sink,site,size,skin,skip,slam,slap,slim,slip,slot,slow,snap,snow,soak,soar,sock,soft,soil,sold,sole,some,song,soon,sort,soul,sour,span,spec,sped,spin,spot,star,stay,stem,step,stir,stop,such,suit,sung,sure,surf,swan,swap,swim,sync,tail,take,tale,talk,tall,tank,tape,task,team,tear,tell,tend,tent,term,test,text,than,that,them,then,they,thin,this,thus,tick,tide,tidy,tied,tier,tile,till,time,tiny,tire,toad,told,toll,tomb,tone,took,tool,tops,tore,torn,toss,tour,town,trap,tray,tree,trek,trim,trio,trip,true,tube,tuck,tuna,tune,turf,turn,twin,type,ugly,undo,unit,upon,urge,used,user,vain,vale,vary,vast,veil,vein,vent,verb,very,vest,veto,vibe,vice,view,vine,visa,void,volt,vote,wade,wage,wait,wake,walk,wall,wand,want,ward,warm,warn,warp,wary,wash,wave,weak,wear,weed,week,well,went,were,west,what,when,whom,wide,wife,wild,will,wind,wine,wing,wink,wipe,wire,wise,wish,with,woke,wolf,wood,wool,word,wore,work,worm,worn,wrap,yard,yarn,yeah,year,yell,yoga,your,zeal,zero,zinc,zone,zoom'.split(',');

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
    const count = 8;
    const arr = crypto.getRandomValues(new Uint8Array(count * 2 + 2));
    const words: string[] = [];
    for (let i = 0; i < count; i++) {
      const idx = randomIndex(WORDS.length);
      const w = WORDS[idx];
      words.push(w.charAt(0).toUpperCase() + w.slice(1));
    }
    const numIdx = randomIndex(count);
    const num = randomIndex(90) + 10;
    words[numIdx] = (randomIndex(2)) ? `${num}${words[numIdx]}` : `${words[numIdx]}${num}`;
    return words.join('-');
  }

  async function confirmPassword() {
    roomError = '';
    const roomId = sanitizeRoomId(customRoomId.trim(), true);
    if (!roomId) {
      roomError = t(dict, 'chat.roomNameRequired');
      return;
    }

    const typedPassword = password.trim();
    if (typedPassword && typedPassword.length < MIN_PASSWORD_LENGTH) {
      roomError = t(dict, 'chat.passwordTooShort');
      return;
    }
    const finalPassword = typedPassword || await generateRoomKey();
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://encrypt.click';
    const link = `${origin}/chat/${roomId}${typedPassword ? '' : '#k=' + finalPassword}`;
    sessionStorage.setItem('chat-password', finalPassword);
    sessionStorage.setItem('chat-room-config', JSON.stringify({
      mode: selectedMode,
      authMode: typedPassword ? 'password' : 'fragment',
      createdAt: Date.now(),
    }));
    if (typedPassword) {
      sessionStorage.setItem('chat-share-password', typedPassword);
    } else {
      sessionStorage.removeItem('chat-share-password');
    }
    window.location.href = link;
  }
</script>
<div class="stack text-left">
  <div class="field">
    <label class="label" for="chat-room">{t(dict, 'chat.customRoomId')}</label>
    <input
      id="chat-room"
      class="input"
      type="text"
      bind:value={customRoomId}
      on:input={handleRoomIdInput}
      placeholder={t(dict, 'chat.customRoomIdPlaceholder')}
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      data-lpignore="true"
      data-1p-ignore
      data-bwignore="true"
      aria-describedby="chat-room-hint"
      aria-invalid={roomError ? 'true' : undefined}
    />
    {#if roomError}
      <p class="status status--error" role="alert">{roomError}</p>
    {/if}
    <p id="chat-room-hint" class="hint">{t(dict, 'chat.customRoomIdHint')}</p>
  </div>

  <div class="field">
    <label class="label" for="chat-pass">{t(dict, 'chat.passwordOptional')}</label>
    <div class="passphrase">
      <input
        id="chat-pass"
        class="input"
        type="text"
        bind:value={password}
        placeholder={t(dict, 'chat.roomPasswordOptionalPlaceholder')}
        autocomplete="off"
        data-lpignore="true"
        data-1p-ignore
        data-bwignore="true"
        aria-describedby="chat-pass-hint"
      />
      <button type="button" class="btn-ghost btn-sm btn-icon" on:click={() => { password = genPassphrase(); }} aria-label={t(dict, 'common.generatePassphrase')}>
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
      </button>
    </div>
    <p id="chat-pass-hint" class="hint">{password.trim() ? t(dict, 'chat.createDescription') : t(dict, 'chat.passwordOptionalHint')}</p>
  </div>

  <fieldset class="field">
    <legend class="label mb-1.5">{t(dict, 'chat.roomMode')}</legend>
    <div class="choice-list">
      {#each ROOM_MODES as mode}
        <label class="choice" class:choice--active={selectedMode === mode.value}>
          <input type="radio" name="chat-mode" value={mode.value} bind:group={selectedMode} />
          <span>
            <span class="choice__title">{t(dict, mode.title)}</span>
            <span class="choice__hint">{t(dict, mode.hint)}</span>
          </span>
        </label>
      {/each}
    </div>
  </fieldset>

  <button class="btn w-full" type="button" on:click={confirmPassword}>{t(dict, 'chat.createRoom')}</button>
</div>
