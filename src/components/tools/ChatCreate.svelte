<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { randomIndex } from "../../lib/random";
  import { t } from '../../lib/t';
  import PassphraseField from '../PassphraseField.svelte';
  import WizardProgress from '../WizardProgress.svelte';
  import PasswordChecklist from '../PasswordChecklist.svelte';
  import { RETENTION_SECONDS, PERSISTENT_HISTORY_LIMIT, PERSISTENT_IDLE_DAYS, checkRoomPassword, roomPasswordOk, formatDuration, type ChatMode } from '../../lib/chatRoomSettings';
  import { generateRoomKey } from '../../lib/chatCrypto';
  import MyRooms from './MyRooms.svelte';

  export let locale = 'en';
  export let dict: Record<string, string>;

  type Keep = 'local' | 'ttl' | 'persistent';

  let step = 1;
  let keep: Keep = 'local';
  let customRoomId = '';
  let password = '';
  let retentionIndex = RETENTION_SECONDS.indexOf(3600);
  let roomError = '';
  let passwordError = '';
  let creating = false;
  let stepEl: HTMLFormElement;

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
    const words: string[] = [];
    for (let i = 0; i < count; i++) {
      const w = WORDS[randomIndex(WORDS.length)];
      words.push(w.charAt(0).toUpperCase() + w.slice(1));
    }
    const numIdx = randomIndex(count);
    const num = randomIndex(90) + 10;
    words[numIdx] = (randomIndex(2)) ? `${num}${words[numIdx]}` : `${words[numIdx]}${num}`;
    return words.join('-');
  }

  // A saved room gets a random address: the key in the link already keeps strangers out, and the name would be the only thing the server could read.
  function genRoomId(): string {
    const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
    return Array.from({ length: 12 }, () => alphabet[randomIndex(alphabet.length)]).join('');
  }

  // A room page that found no room sends people here with its name, so creating always goes through this form.
  onMount(() => {
    const requested = new URLSearchParams(location.search).get('room');
    if (requested) customRoomId = sanitizeRoomId(requested, true);
  });

  $: steps = keep === 'persistent' ? 2 : 3;
  $: roomId = sanitizeRoomId(customRoomId.trim(), true);
  $: checks = checkRoomPassword(password, roomId);
  $: rules = [
    { ok: checks.length, label: t(dict, 'common.passwordRuleLength') },
    { ok: checks.variety, label: t(dict, 'common.passwordRuleVariety') },
    { ok: checks.strength, label: t(dict, 'common.passwordRuleStrength') },
    { ok: checks.distinct, label: t(dict, 'common.passwordRuleDistinct') },
  ];
  $: retentionSeconds = RETENTION_SECONDS[retentionIndex];
  $: retentionTime = formatDuration(retentionSeconds, locale);
  $: retentionLabel = t(dict, 'chat.retentionTtl').replace('{time}', retentionTime);
  $: stepText = t(dict, 'common.wizardStep').replace('{current}', String(step)).replace('{total}', String(steps));
  $: persistentWarning2 = t(dict, 'chat.persistentWarning2').replace('{count}', String(PERSISTENT_HISTORY_LIMIT)).replace('{days}', String(PERSISTENT_IDLE_DAYS));

  async function goTo(next: number) {
    step = next;
    await tick();
    stepEl?.querySelector<HTMLElement>('input:not([type=radio]), button')?.focus();
  }

  function submitKeep() {
    goTo(2);
  }

  function submitRoom() {
    roomError = '';
    if (!roomId) {
      roomError = t(dict, 'chat.roomNameRequired');
      return;
    }
    customRoomId = roomId;
    goTo(3);
  }

  function startChat() {
    passwordError = '';
    if (!roomId) return goTo(2);
    if (!roomPasswordOk(password, roomId)) {
      passwordError = t(dict, 'common.passwordWeak');
      return;
    }
    const typedPassword = password.trim();
    const mode: ChatMode = keep === 'ttl' ? `ttl-${retentionSeconds}` : 'live';
    sessionStorage.setItem('chat-password', typedPassword);
    sessionStorage.setItem('chat-room-config', JSON.stringify({ mode, authMode: 'password', createdAt: Date.now(), v: 3 }));
    sessionStorage.setItem('chat-share-password', typedPassword);
    window.location.href = `${window.location.origin}/chat/${roomId}`;
  }

  async function startPersistent() {
    if (creating) return;
    creating = true;
    try {
      const key = await generateRoomKey();
      sessionStorage.setItem('chat-room-config', JSON.stringify({ mode: 'persistent', authMode: 'fragment', createdAt: Date.now() }));
      sessionStorage.setItem('chat-share-link', '1');
      window.location.href = `${window.location.origin}/chat/${genRoomId()}#k=${key}&p=1`;
    } finally {
      creating = false;
    }
  }
</script>

<div class="stack text-left">
  <WizardProgress step={step} total={steps} label={stepText} />

  {#if step === 1}
    <form class="stack" method="dialog" bind:this={stepEl} on:submit|preventDefault={submitKeep}>
      <fieldset class="field">
        <legend class="label">{t(dict, 'chat.retention')}</legend>
        <div class="choice-list">
          <label class="choice" class:choice--active={keep === 'local'}>
            <input type="radio" name="chat-keep" value="local" bind:group={keep} />
            <span>
              <span class="choice__title">{t(dict, 'chat.modeLiveTitle')}</span>
              <span class="choice__hint">{t(dict, 'chat.modeLiveHint')}</span>
            </span>
          </label>
          <label class="choice" class:choice--active={keep === 'ttl'}>
            <input type="radio" name="chat-keep" value="ttl" bind:group={keep} />
            <span class="min-w-0 flex-1">
              <span class="choice__title">{t(dict, 'chat.modeTtlTitle')}</span>
              <span class="choice__hint">{t(dict, 'chat.modeTtlHint')}</span>
              {#if keep === 'ttl'}
                <span class="retention-picker">
                  <span class="retention-value" aria-hidden="true">{retentionLabel}</span>
                  <input
                    id="chat-retention"
                    type="range"
                    min="0"
                    max={RETENTION_SECONDS.length - 1}
                    step="1"
                    bind:value={retentionIndex}
                    aria-label={t(dict, 'chat.retention')}
                    aria-valuetext={retentionLabel}
                  />
                  <span class="retention-scale" aria-hidden="true">
                    <span>{formatDuration(RETENTION_SECONDS[0], locale, 'short')}</span>
                    <span>{formatDuration(RETENTION_SECONDS[RETENTION_SECONDS.length - 1], locale, 'short')}</span>
                  </span>
                </span>
              {/if}
            </span>
          </label>
          <label class="choice" class:choice--active={keep === 'persistent'}>
            <input type="radio" name="chat-keep" value="persistent" bind:group={keep} />
            <span>
              <span class="choice__title">{t(dict, 'chat.modePersistentTitle')}</span>
              <span class="choice__hint">{t(dict, 'chat.modePersistentHint')}</span>
            </span>
          </label>
        </div>
      </fieldset>
      <button class="btn w-full" type="submit">{t(dict, 'common.continue')}</button>
    </form>
  {:else if step === 2 && keep === 'persistent'}
    <form class="stack" method="dialog" bind:this={stepEl} on:submit|preventDefault={startPersistent}>
      <div class="stack">
        <p class="label">{t(dict, 'chat.persistentWarningTitle')}</p>
        <p class="status status--warn">{t(dict, 'chat.persistentWarning1')}</p>
        <p class="hint">{persistentWarning2}</p>
        <p class="hint">{t(dict, 'chat.persistentWarning3')}</p>
      </div>
      <div class="wizard-actions">
        <button class="btn-secondary" type="button" on:click={() => goTo(1)}>{t(dict, 'common.back')}</button>
        <button class="btn" type="submit" disabled={creating}>{t(dict, 'chat.createPersistentRoom')}</button>
      </div>
    </form>
  {:else if step === 2}
    <form class="stack" method="dialog" bind:this={stepEl} on:submit|preventDefault={submitRoom}>
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
      <div class="wizard-actions">
        <button class="btn-secondary" type="button" on:click={() => goTo(1)}>{t(dict, 'common.back')}</button>
        <button class="btn" type="submit">{t(dict, 'common.continue')}</button>
      </div>
    </form>
  {:else}
    <form class="stack" method="dialog" bind:this={stepEl} on:submit|preventDefault={startChat}>
      <div class="field">
        <label class="label" for="chat-pass">{t(dict, 'chat.password')}</label>
        <PassphraseField {dict} id="chat-pass" bind:value={password} placeholder={t(dict, 'chat.roomPasswordPlaceholder')} describedby="chat-pass-rules chat-pass-hint" invalid={!!passwordError} generate={() => { passwordError = ''; return genPassphrase(); }} />
        <PasswordChecklist id="chat-pass-rules" label={t(dict, 'common.passwordRules')} {rules} />
        {#if passwordError}
          <p class="status status--error" role="alert">{passwordError}</p>
        {/if}
        <p id="chat-pass-hint" class="hint">{t(dict, 'chat.createDescription')}</p>
      </div>
      <div class="wizard-actions">
        <button class="btn-secondary" type="button" on:click={() => goTo(2)}>{t(dict, 'common.back')}</button>
        <button class="btn" type="submit">{t(dict, 'chat.createRoom')}</button>
      </div>
    </form>
  {/if}
  <MyRooms {dict} {locale} />
</div>

<style>
  .retention-picker {
    display: grid;
    gap: 0.25rem;
    margin-top: 0.5rem;
  }
  .retention-value {
    font-size: 1rem;
    font-weight: 800;
    color: var(--text);
  }
  .retention-scale {
    display: flex;
    justify-content: space-between;
    font-size: 0.75rem;
    color: var(--muted);
  }
</style>
