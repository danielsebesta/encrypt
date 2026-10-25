import fs from 'fs';

const translations = {
  cs: {
    'nav.tool.chatCipher': 'Chatová šifra',
    'tools.chatCipher.meta.title': 'Chatová šifra - schovej zprávu do běžného chatu',
    'tools.chatCipher.meta.description':
      'Zašifruj zprávu heslem a převeď ji na text, který vypadá jako běžný český nebo anglický chat. Modely běží v prohlížeči po jednom stažení.',
    'tools.chatCipher.h1': 'Chatová šifra',
    'tools.chatCipher.subtitle':
      'Schovej AES-256-GCM šifrogram do běžných chatových zpráv. Čeština funguje hned offline; angličtina si jednou stáhne jazykový balíček a drží ho v tomto prohlížeči.',
    'tools.chatCipher.encrypt': 'Šifrovat',
    'tools.chatCipher.decrypt': 'Dešifrovat',
    'tools.chatCipher.language': 'Jazyk',
    'tools.chatCipher.lang.cs': 'Čeština',
    'tools.chatCipher.lang.en': 'Angličtina',
    'tools.chatCipher.password': 'Heslo',
    'tools.chatCipher.passwordPlaceholder': 'Zadej silnou frázi...',
    'tools.chatCipher.inputText': 'Zpráva',
    'tools.chatCipher.coverText': 'Krycí chat',
    'tools.chatCipher.encryptPlaceholder': 'Zadej zprávu ke skrytí...',
    'tools.chatCipher.decryptPlaceholder': 'Vlož krycí chatový text...',
    'tools.chatCipher.encryptBtn': 'Šifrovat do chatu',
    'tools.chatCipher.decryptBtn': 'Dešifrovat',
    'tools.chatCipher.coverOutput': 'Krycí chat',
    'tools.chatCipher.plainOutput': 'Dešifrovaná zpráva',
    'tools.chatCipher.errorBoth': 'Zadej text i heslo.',
    'tools.chatCipher.errorGeneric': 'Něco se nepovedlo. Zkontroluj heslo, jazyk a krycí text.',
    'tools.chatCipher.errorNeedPack': 'Nejdřív stáhni jazykový balíček.',
    'tools.chatCipher.errorPack': 'Jazykový balíček se nepodařilo stáhnout.',
    'tools.chatCipher.pack.bundled': 'Český balíček je součástí stránky. Funguje offline bez stahování.',
    'tools.chatCipher.pack.ready': 'Jazykový balíček je připravený. Šifrování a dešifrování zůstávají offline.',
    'tools.chatCipher.pack.missing':
      'Jednorázové stažení z encrypt.click (~{size}). Uloží se jen v tomto prohlížeči.',
    'tools.chatCipher.pack.downloading': 'Stahuji… {received} / {total}',
    'tools.chatCipher.pack.download': 'Stáhnout jazykový balíček',
    'tools.chatCipher.pack.retry': 'Zkusit znovu',
    'tools.chatCipher.about.1.title': 'K čemu to je',
    'tools.chatCipher.about.1':
      'Chatová šifra zašifruje zprávu heslem a zapíše šifrogram jako sérii běžných chatových zpráv v češtině nebo angličtině. Stejný text, heslo a jazyk sem znovu vložíš a dostaneš původní zprávu.',
    'tools.chatCipher.about.2.title': 'Šifrování',
    'tools.chatCipher.about.2':
      'Heslo se protáhne přes PBKDF2-HMAC-SHA256 (600 000 iterací) a náhodnou sůl na 256bitový klíč. Zpráva se pečetí AES-256-GCM. Špatné heslo nebo změněný krycí text selže naprázdno místo nesmyslu.',
    'tools.chatCipher.about.3.title': 'Krycí chat',
    'tools.chatCipher.about.3':
      'Čeština používá kompaktní chatový balíček dodaný se stránkou (projekt Kecal). Angličtina používá SmolLM2-135M. Bity šifrogramu volí další slova z modelu, aby výsledek vypadal jako dávka zpráv. I krátké tajemství dá dlouhý krycí text, protože sůl, nonce a značka jedou vždy s ním.',
    'tools.chatCipher.about.4.title': 'Stažení a soukromí',
    'tools.chatCipher.about.4':
      'Balíčky se berou jen z encrypt.click, ne z cizích modelových hostitelů. Po stažení zůstanou v mezipaměti prohlížeče. Šifrování a dešifrování síť nevolají. Smazání dat webu balíček odstraní.',
    'tools.chatCipher.about.5.title': 'Dobré vědět',
    'tools.chatCipher.about.5':
      'Běžnému čtenáři to vypadá jako chat, ale kdo nástroj zná, pozná generovaný text. Používej dlouhou frázi. Odesílatel i příjemce musí zvolit stejný jazyk. Další jazyky zatím nejsou.',
  },
  de: {
    'nav.tool.chatCipher': 'Chat-Chiffre',
    'tools.chatCipher.h1': 'Chat-Chiffre',
    'tools.chatCipher.lang.cs': 'Tschechisch',
    'tools.chatCipher.lang.en': 'Englisch',
  },
  es: {
    'nav.tool.chatCipher': 'Cifrado de chat',
    'tools.chatCipher.h1': 'Cifrado de chat',
    'tools.chatCipher.lang.cs': 'Checo',
    'tools.chatCipher.lang.en': 'Inglés',
  },
  fr: {
    'nav.tool.chatCipher': 'Chiffre chat',
    'tools.chatCipher.h1': 'Chiffre chat',
    'tools.chatCipher.lang.cs': 'Tchèque',
    'tools.chatCipher.lang.en': 'Anglais',
  },
  sk: {
    'nav.tool.chatCipher': 'Chatová šifra',
    'tools.chatCipher.h1': 'Chatová šifra',
    'tools.chatCipher.lang.cs': 'Čeština',
    'tools.chatCipher.lang.en': 'Angličtina',
  },
  pl: {
    'nav.tool.chatCipher': 'Szyfr czatu',
    'tools.chatCipher.h1': 'Szyfr czatu',
    'tools.chatCipher.lang.cs': 'Czeski',
    'tools.chatCipher.lang.en': 'Angielski',
  },
};

const en = JSON.parse(fs.readFileSync('src/locales/en.json', 'utf8'));
const chatKeys = Object.keys(en).filter(
  k => k === 'nav.tool.chatCipher' || k.startsWith('tools.chatCipher.'),
);

for (const loc of ['cs', 'de', 'es', 'fr', 'sk', 'pl']) {
  const path = `src/locales/${loc}.json`;
  const data = JSON.parse(fs.readFileSync(path, 'utf8'));
  for (const k of Object.keys(data)) {
    if (k === 'nav.tool.aesWords' || k.startsWith('tools.aesWords.')) delete data[k];
  }
  const map = translations[loc] || {};
  for (const k of chatKeys) {
    data[k] = map[k] ?? en[k];
  }
  fs.writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
  console.log(loc, 'ok');
}
