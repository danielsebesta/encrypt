<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { randomIndex } from "../../lib/random";
  import { t } from '../../lib/t';
  import { checkRoomPassword, roomPasswordOk } from '../../lib/chatRoomSettings';
  import { generateRoomKey } from '../../lib/chatCrypto';
  import { SAVED_BOARD_BYTES, SAVED_BOARD_IDLE_DAYS } from '../../lib/whiteboardSync';
  import PassphraseField from '../PassphraseField.svelte';
  import WizardProgress from '../WizardProgress.svelte';
  import PasswordChecklist from '../PasswordChecklist.svelte';
  import MyRooms from './MyRooms.svelte';

  export let locale = 'en';
  export let dict: Record<string, string>;

  type Keep = 'live' | 'saved';

  let step = 1;
  let keep: Keep = 'live';
  let creating = false;
  let customRoomId = '';
  let password = '';
  let passwordRevealed = true;
  let passwordError = '';
  let stepEl: HTMLFormElement;

  const WORDS = 'able,acid,aged,area,army,away,baby,back,ball,band,bank,base,bath,bear,beat,bell,belt,best,bird,blow,blue,boat,body,bold,bone,book,born,boss,burn,busy,cafe,cage,cake,call,calm,came,camp,card,care,case,cash,cave,cell,chip,city,clan,clay,clip,club,coal,coat,code,coin,cold,come,cook,cool,cope,copy,core,cost,crew,crop,cure,cute,dale,dame,dare,dark,data,date,dawn,dead,deal,dear,debt,deck,deed,deep,deer,deny,desk,dial,dice,diet,dirt,dock,dome,done,door,dose,down,draw,drop,drum,dual,duck,duke,dull,dump,dune,dust,duty,each,earn,ease,east,easy,edge,epic,euro,even,ever,evil,exam,exit,face,fact,fade,fail,fair,fake,fall,fame,fare,farm,fast,fate,fear,feed,feel,feet,fell,file,fill,film,find,fine,fire,firm,fish,five,flag,flat,flew,flip,flow,foam,fold,folk,fond,food,fool,foot,fork,form,fort,four,free,from,fuel,full,fund,fury,fuse,gain,gale,game,gang,gave,gaze,gear,gene,gift,girl,give,glad,glow,glue,goat,gold,golf,gone,good,grab,gram,gray,grew,grid,grip,grow,gulf,gust,hack,half,hall,halt,hand,hang,hard,harm,hate,have,haze,head,heal,heap,hear,heat,heel,held,help,herb,here,hero,hide,high,hike,hill,hint,hire,hold,hole,holy,home,hood,hook,hope,horn,host,hour,huge,hull,hung,hunt,hurt,icon,idea,inch,info,into,iron,isle,item,jack,jail,jazz,jeep,jobs,join,joke,jump,jury,just,keen,keep,kept,kick,kill,kind,king,kiss,knee,knew,knot,know,lack,laid,lake,lamp,land,lane,last,late,lawn,lead,leaf,lean,left,lend,lens,life,lift,like,lime,line,link,lion,list,live,load,loan,lock,logo,lone,long,look,lord,lose,loss,lost,loud,love,luck,lump,lung,lure,made,mail,main,make,male,mall,mane,many,mark,mask,mass,mate,maze,meal,mean,meat,melt,memo,menu,mesh,mess,mild,mile,milk,mill,mind,mine,mint,miss,mode,mood,moon,more,most,move,much,must,myth,nail,name,navy,neat,neck,need,nest,news,next,nice,nine,node,none,noon,norm,nose,note,nude,nuts,oath,odds,okay,once,only,onto,open,oval,oven,over,pace,pack,page,paid,pain,pair,pale,palm,park,part,pass,past,path,peak,peel,peer,pine,pink,pipe,plan,play,plea,plot,plug,plus,poem,poet,pole,poll,pond,pool,poor,port,pose,post,pour,pray,prey,prop,pull,pump,pure,push,quit,quiz,race,rack,rage,raid,rail,rain,rang,rank,rare,rate,read,real,rear,reef,reel,rely,rent,rest,rice,rich,ride,rift,ring,riot,rise,risk,road,roam,rock,rode,role,roll,roof,room,root,rope,rose,ruin,rule,rush,sack,safe,sage,said,sake,sale,salt,same,sand,sang,save,seal,seed,seek,seem,seen,self,sell,semi,send,sent,shed,ship,shoe,shop,shot,show,shut,sick,side,sigh,sign,silk,sing,sink,site,size,skin,skip,slam,slap,slim,slip,slot,slow,snap,snow,soak,soar,sock,soft,soil,sold,sole,some,song,soon,sort,soul,sour,span,spec,sped,spin,spot,star,stay,stem,step,stir,stop,such,suit,sung,sure,surf,swan,swap,swim,sync,tail,take,tale,talk,tall,tank,tape,task,team,tear,tell,tend,tent,term,test,text,than,that,them,then,they,thin,this,thus,tick,tide,tidy,tied,tier,tile,till,time,tiny,tire,toad,told,toll,tomb,tone,took,tool,tops,tore,torn,toss,tour,town,trap,tray,tree,trek,trim,trio,trip,true,tube,tuck,tuna,tune,turf,turn,twin,type,ugly,undo,unit,upon,urge,used,user,vain,vale,vary,vast,veil,vein,vent,verb,very,vest,veto,vibe,vice,view,vine,visa,void,volt,vote,wade,wage,wait,wake,walk,wall,wand,want,ward,warm,warn,warp,wary,wash,wave,weak,wear,weed,week,well,went,were,west,what,when,whom,wide,wife,wild,will,wind,wine,wing,wink,wipe,wire,wise,wish,with,woke,wolf,wood,wool,word,wore,work,worm,worn,wrap,yard,yarn,yeah,year,yell,yoga,your,zeal,zero,zinc,zone,zoom'.split(',');

  function genRoomId(): string {
    const arr = crypto.getRandomValues(new Uint8Array(6));
    return Array.from(arr, b => b.toString(36).padStart(2, '0')).join('').slice(0, 8);
  }

  function genSavedId(): string {
    const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
    return Array.from({ length: 12 }, () => alphabet[randomIndex(alphabet.length)]).join('');
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
  password = genPassphrase();

  $: roomName = sanitizeRoomId(customRoomId.trim(), true);
  $: checks = checkRoomPassword(password, roomName);
  $: rules = [
    { ok: checks.length, label: t(dict, 'common.passwordRuleLength') },
    { ok: checks.variety, label: t(dict, 'common.passwordRuleVariety') },
    { ok: checks.strength, label: t(dict, 'common.passwordRuleStrength') },
    { ok: checks.distinct, label: t(dict, 'common.passwordRuleDistinct') },
  ];
  $: steps = keep === 'saved' ? 2 : 3;
  $: stepText = t(dict, 'common.wizardStep').replace('{current}', String(step)).replace('{total}', String(steps));
  $: savedWarning2 = t(dict, 'whiteboard.savedWarning2').replace('{size}', String(SAVED_BOARD_BYTES / 1024 / 1024)).replace('{days}', String(SAVED_BOARD_IDLE_DAYS));

  onMount(() => {
    const name = new URLSearchParams(window.location.search).get('name');
    if (name) customRoomId = sanitizeRoomId(name, true);
  });

  async function goTo(next: number) {
    step = next;
    await tick();
    stepEl?.querySelector<HTMLElement>('input:not([type=radio]), button')?.focus();
  }

  function submitKeep() {
    goTo(2);
  }

  function submitRoom() {
    customRoomId = roomName;
    goTo(3);
  }

  async function createSaved() {
    if (creating) return;
    creating = true;
    try {
      const key = await generateRoomKey();
      sessionStorage.setItem('whiteboard-share-link', '1');
      window.location.href = `${window.location.origin}${locale && locale !== 'en' ? `/${locale}` : ''}/whiteboard/${genSavedId()}#k=${key}&p=1`;
    } finally {
      creating = false;
    }
  }

  function openBoard() {
    passwordError = '';
    if (!roomPasswordOk(password, roomName)) {
      passwordError = t(dict, 'common.passwordWeak');
      return;
    }
    const roomId = roomName || genRoomId();
    const typed = password.trim();
    sessionStorage.setItem('whiteboard-password', typed);
    sessionStorage.setItem('whiteboard-share-password', typed);
    window.location.href = `${window.location.origin}${locale && locale !== 'en' ? `/${locale}` : ''}/whiteboard/${roomId}`;
  }
</script>

<div class="stack text-left">
  <WizardProgress step={step} total={steps} label={stepText} />

  {#if step === 1}
    <form class="stack" method="dialog" bind:this={stepEl} on:submit|preventDefault={submitKeep}>
      <fieldset class="field">
        <legend class="label">{t(dict, 'whiteboard.mode')}</legend>
        <div class="choice-list">
          <label class="choice" class:choice--active={keep === 'live'}>
            <input type="radio" name="wb-keep" value="live" bind:group={keep} />
            <span>
              <span class="choice__title">{t(dict, 'whiteboard.modeLiveTitle')}</span>
              <span class="choice__hint">{t(dict, 'whiteboard.modeLiveHint')}</span>
            </span>
          </label>
          <label class="choice" class:choice--active={keep === 'saved'}>
            <input type="radio" name="wb-keep" value="saved" bind:group={keep} />
            <span>
              <span class="choice__title">{t(dict, 'whiteboard.modeSavedTitle')}</span>
              <span class="choice__hint">{t(dict, 'whiteboard.modeSavedHint')}</span>
            </span>
          </label>
        </div>
      </fieldset>
      <button class="btn w-full" type="submit">{t(dict, 'common.continue')}</button>
    </form>
  {:else if step === 2 && keep === 'saved'}
    <form class="stack" method="dialog" bind:this={stepEl} on:submit|preventDefault={createSaved}>
      <div class="stack">
        <p class="label">{t(dict, 'whiteboard.savedWarningTitle')}</p>
        <p class="status status--warn">{t(dict, 'whiteboard.savedWarning1')}</p>
        <p class="hint">{savedWarning2}</p>
        <p class="hint">{t(dict, 'whiteboard.savedWarning3')}</p>
      </div>
      <div class="wizard-actions">
        <button class="btn-secondary" type="button" on:click={() => goTo(1)}>{t(dict, 'common.back')}</button>
        <button class="btn" type="submit" disabled={creating}>{t(dict, 'whiteboard.createSavedBoard')}</button>
      </div>
    </form>
  {:else if step === 2}
    <form class="stack" method="dialog" bind:this={stepEl} on:submit|preventDefault={submitRoom}>
      <div class="field">
        <label class="label" for="wb-room">{t(dict, 'whiteboard.customRoomId')}</label>
        <input
          id="wb-room"
          class="input"
          type="text"
          bind:value={customRoomId}
          on:input={handleRoomIdInput}
          placeholder={t(dict, 'whiteboard.customRoomIdPlaceholder')}
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          data-lpignore="true"
          data-1p-ignore
          data-bwignore="true"
          aria-describedby="wb-room-hint"
        />
        <p id="wb-room-hint" class="hint">{t(dict, 'whiteboard.customRoomIdHint')}</p>
      </div>
      <div class="wizard-actions">
        <button class="btn-secondary" type="button" on:click={() => goTo(1)}>{t(dict, 'common.back')}</button>
        <button class="btn" type="submit">{t(dict, 'common.continue')}</button>
      </div>
    </form>
  {:else}
    <form class="stack" method="dialog" bind:this={stepEl} on:submit|preventDefault={openBoard}>
      <div class="field">
        <label class="label" for="wb-pass">{t(dict, 'whiteboard.password')}</label>
        <PassphraseField {dict} id="wb-pass" bind:value={password} bind:revealed={passwordRevealed} placeholder={t(dict, 'whiteboard.roomPasswordPlaceholder')} describedby="wb-pass-rules wb-pass-hint" invalid={!!passwordError} generate={() => { passwordError = ''; return genPassphrase(); }} />
        <PasswordChecklist id="wb-pass-rules" label={t(dict, 'common.passwordRules')} {rules} />
        {#if passwordError}
          <p class="status status--error" role="alert">{passwordError}</p>
        {/if}
        <p id="wb-pass-hint" class="hint">{t(dict, 'whiteboard.createDescription')}</p>
      </div>
      <div class="wizard-actions">
        <button class="btn-secondary" type="button" on:click={() => goTo(2)}>{t(dict, 'common.back')}</button>
        <button class="btn" type="submit">{t(dict, 'whiteboard.createRoom')}</button>
      </div>
    </form>
  {/if}
  <MyRooms {dict} {locale} />
</div>

