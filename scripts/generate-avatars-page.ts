import fs from 'fs';
import path from 'path';
import esbuild from 'esbuild';

// Bundle identicon.ts into a clean browser JS IIFE
const bundleRes = esbuild.buildSync({
  entryPoints: ['src/lib/identicon.ts'],
  bundle: true,
  format: 'iife',
  globalName: 'IdenticonLib',
  write: false,
});

const bundleJs = bundleRes.outputFiles[0].text.replace(
  'var IdenticonLib =',
  'window.IdenticonLib ='
);

const html = `<!DOCTYPE html>
<html lang="cs">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Generátor Profilovek • Grid 200 vzorků</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='50' fill='%2300bc7d'/><circle cx='50' cy='50' r='24' fill='%23000'/></svg>">
  <style>
    :root {
      --bg: #000000;
      --card-bg: #0d0d12;
      --card-border: rgba(255, 255, 255, 0.08);
      --card-border-hover: rgba(0, 188, 125, 0.5);
      --text: #f4f4f5;
      --text-muted: #9ca3af;
      --accent: #00bc7d;
      --accent-glow: rgba(0, 188, 125, 0.28);
      --radius: 50%;
      --item-size: 72px;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      background-color: var(--bg);
      background-image: 
        radial-gradient(ellipse at 50% -20%, rgba(0, 188, 125, 0.15), transparent 50%),
        radial-gradient(circle at 100% 100%, rgba(99, 102, 241, 0.08), transparent 40%),
        radial-gradient(circle at 0% 50%, rgba(20, 184, 166, 0.06), transparent 40%);
      background-attachment: fixed;
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      display: flex;
      flex-direction: column;
      overflow-x: hidden;
      padding: 0 0 60px 0;
      -webkit-font-smoothing: antialiased;
    }

    header {
      position: sticky;
      top: 0;
      z-index: 100;
      background: rgba(0, 0, 0, 0.88);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border-bottom: 1px solid var(--card-border);
      padding: 16px 24px;
    }

    .header-inner {
      max-width: 1440px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .top-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 16px;
    }

    .brand-title {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .brand-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 34px;
      height: 34px;
      border-radius: 9px;
      background: linear-gradient(135deg, #00bc7d, #059669);
      box-shadow: 0 0 18px var(--accent-glow);
    }

    .brand-badge svg {
      width: 18px;
      height: 18px;
      fill: #000;
    }

    h1 {
      font-size: 1.25rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: #ffffff;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .count-pill {
      font-size: 0.75rem;
      font-weight: 600;
      background: rgba(0, 188, 125, 0.16);
      color: #34d399;
      border: 1px solid rgba(0, 188, 125, 0.35);
      padding: 2px 8px;
      border-radius: 9999px;
    }

    .specs-badge {
      font-size: 0.8rem;
      color: var(--text-muted);
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }

    .controls-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
    }

    .filter-tabs {
      display: flex;
      align-items: center;
      gap: 6px;
      overflow-x: auto;
      padding-bottom: 2px;
    }

    .tab-btn {
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid var(--card-border);
      color: var(--text-muted);
      padding: 6px 14px;
      border-radius: 8px;
      font-size: 0.82rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s ease;
      white-space: nowrap;
    }

    .tab-btn:hover {
      background: rgba(255, 255, 255, 0.08);
      color: #fff;
    }

    .tab-btn.active {
      background: rgba(0, 188, 125, 0.16);
      border-color: rgba(0, 188, 125, 0.45);
      color: #00bc7d;
      font-weight: 600;
    }

    .action-group {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    .search-input {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 7px 14px;
      font-size: 0.82rem;
      color: #fff;
      outline: none;
      width: 180px;
      transition: all 0.15s ease;
    }

    .search-input:focus {
      border-color: var(--accent);
      background: rgba(255, 255, 255, 0.08);
      box-shadow: 0 0 10px var(--accent-glow);
      width: 220px;
    }

    .tool-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid var(--card-border);
      color: var(--text);
      padding: 7px 12px;
      border-radius: 8px;
      font-size: 0.82rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .tool-btn:hover {
      background: rgba(255, 255, 255, 0.12);
      border-color: rgba(255, 255, 255, 0.2);
    }

    .tool-btn.primary {
      background: #00bc7d;
      color: #000;
      border-color: #00bc7d;
      font-weight: 600;
    }

    .tool-btn.primary:hover {
      background: #10b981;
      box-shadow: 0 0 16px var(--accent-glow);
    }

    main {
      max-width: 1440px;
      margin: 24px auto 0;
      padding: 0 24px;
      width: 100%;
      flex: 1;
    }

    .avatar-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(105px, 1fr));
      gap: 16px;
    }

    .avatar-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 14px;
      padding: 14px 10px;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      gap: 10px;
      cursor: pointer;
      transition: transform 0.18s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.18s ease, box-shadow 0.18s ease;
      position: relative;
    }

    .avatar-card:hover {
      transform: translateY(-4px) scale(1.02);
      border-color: var(--card-border-hover);
      box-shadow: 0 10px 24px rgba(0, 0, 0, 0.7), 0 0 18px var(--accent-glow);
      z-index: 10;
    }

    .avatar-wrapper {
      width: var(--item-size);
      height: var(--item-size);
      border-radius: var(--radius);
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5);
      transition: border-radius 0.2s ease, transform 0.15s ease;
      flex-shrink: 0;
    }

    .avatar-card:hover .avatar-wrapper {
      transform: scale(1.06);
    }

    .avatar-wrapper svg {
      width: 100%;
      height: 100%;
      display: block;
    }

    .avatar-info {
      display: flex;
      flex-direction: column;
      gap: 2px;
      width: 100%;
      overflow: hidden;
    }

    .avatar-label {
      font-size: 0.76rem;
      font-weight: 600;
      color: #e4e4e7;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      width: 100%;
    }

    .avatar-meta {
      font-size: 0.68rem;
      color: var(--text-muted);
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.85);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      z-index: 200;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s ease;
      padding: 16px;
    }

    .modal-backdrop.open {
      opacity: 1;
      pointer-events: auto;
    }

    .modal-card {
      background: #101015;
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 20px;
      padding: 28px;
      max-width: 440px;
      width: 100%;
      box-shadow: 0 24px 48px rgba(0, 0, 0, 0.9), 0 0 32px rgba(0, 188, 125, 0.18);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 20px;
      transform: scale(0.95);
      transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      position: relative;
    }

    .modal-backdrop.open .modal-card {
      transform: scale(1);
    }

    .modal-close {
      position: absolute;
      top: 16px;
      right: 16px;
      background: rgba(255, 255, 255, 0.08);
      border: none;
      color: #aaa;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: 1.2rem;
      transition: background 0.15s ease;
    }

    .modal-close:hover {
      background: rgba(255, 255, 255, 0.16);
      color: #fff;
    }

    .modal-avatar-preview {
      width: 160px;
      height: 160px;
      border-radius: var(--radius);
      overflow: hidden;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.8);
      flex-shrink: 0;
      transition: border-radius 0.2s ease;
    }

    .modal-avatar-preview svg {
      width: 100%;
      height: 100%;
    }

    .modal-details {
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 12px;
      background: rgba(255, 255, 255, 0.03);
      padding: 14px 16px;
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.06);
    }

    .modal-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.82rem;
    }

    .modal-label {
      color: var(--text-muted);
    }

    .modal-value {
      color: #fff;
      font-weight: 600;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }

    .modal-actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      width: 100%;
    }

    .modal-btn {
      padding: 10px 14px;
      border-radius: 10px;
      font-size: 0.84rem;
      font-weight: 600;
      cursor: pointer;
      border: 1px solid var(--card-border);
      background: rgba(255, 255, 255, 0.06);
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      transition: all 0.15s ease;
    }

    .modal-btn:hover {
      background: rgba(255, 255, 255, 0.12);
    }

    .modal-btn.primary {
      background: #00bc7d;
      color: #000;
      border-color: #00bc7d;
    }

    .modal-btn.primary:hover {
      background: #10b981;
      box-shadow: 0 0 16px var(--accent-glow);
    }

    .toast {
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%) translateY(60px);
      background: #00bc7d;
      color: #000;
      font-weight: 600;
      font-size: 0.85rem;
      padding: 10px 20px;
      border-radius: 9999px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6), 0 0 18px rgba(0, 188, 125, 0.5);
      z-index: 300;
      opacity: 0;
      pointer-events: none;
      transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    }

    .toast.show {
      transform: translateX(-50%) translateY(0);
      opacity: 1;
    }

    .live-tester-bar {
      margin-top: 14px;
      display: flex;
      align-items: center;
      gap: 12px;
      background: rgba(255, 255, 255, 0.03);
      border: 1px dashed rgba(255, 255, 255, 0.14);
      border-radius: 12px;
      padding: 12px 18px;
    }

    .live-tester-bar input {
      flex: 1;
      background: transparent;
      border: none;
      color: #fff;
      font-size: 0.9rem;
      outline: none;
      font-family: inherit;
    }

    .live-tester-preview {
      width: 36px;
      height: 36px;
      border-radius: var(--radius);
      overflow: hidden;
      flex-shrink: 0;
    }

    .live-tester-preview svg {
      width: 100%;
      height: 100%;
    }

    footer {
      max-width: 1440px;
      margin: 40px auto 0;
      padding: 20px 24px 0;
      border-top: 1px solid var(--card-border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      color: var(--text-muted);
      font-size: 0.8rem;
      flex-wrap: wrap;
      gap: 12px;
    }

    @media (max-width: 768px) {
      .top-row {
        flex-direction: column;
        align-items: flex-start;
      }
      .controls-row {
        flex-direction: column;
        align-items: stretch;
      }
      .avatar-grid {
        grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
        gap: 10px;
      }
      .avatar-card {
        padding: 10px 6px;
      }
    }
  </style>
</head>
<body>

  <header>
    <div class="header-inner">
      <div class="top-row">
        <div class="brand-title">
          <div class="brand-badge">
            <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"/></svg>
          </div>
          <div>
            <h1>Nový Generátor Profilovek <span class="count-pill" id="gridCount">200 kusů</span></h1>
            <div class="specs-badge">Forgejo 3×3 symetrie • SHA-256 seed • 88 barevných palet • Circle-safe SVG</div>
          </div>
        </div>

        <div class="action-group">
          <!-- Shape Switcher -->
          <div style="display: flex; background: rgba(255,255,255,0.06); padding: 3px; border-radius: 8px; border: 1px solid var(--card-border);">
            <button class="tool-btn" id="shapeRound" style="padding: 4px 10px; font-size: 0.78rem;" title="Kruhový ořez">Kruh</button>
            <button class="tool-btn" id="shapeSquircle" style="padding: 4px 10px; font-size: 0.78rem;" title="Zaoblený čtverec">Squircle</button>
            <button class="tool-btn" id="shapeSquare" style="padding: 4px 10px; font-size: 0.78rem;" title="Čtvercový">Čtverec</button>
          </div>

          <!-- Size switcher -->
          <div style="display: flex; background: rgba(255,255,255,0.06); padding: 3px; border-radius: 8px; border: 1px solid var(--card-border);">
            <button class="tool-btn" id="sizeSm" style="padding: 4px 8px; font-size: 0.78rem;">S</button>
            <button class="tool-btn" id="sizeMd" style="padding: 4px 8px; font-size: 0.78rem;">M</button>
            <button class="tool-btn" id="sizeLg" style="padding: 4px 8px; font-size: 0.78rem;">L</button>
          </div>

          <!-- Reroll button -->
          <button class="tool-btn primary" id="rerollBtn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
            Přegenerovat 200
          </button>
        </div>
      </div>

      <div class="controls-row">
        <!-- Category Filter Tabs -->
        <div class="filter-tabs" id="filterTabs">
          <button class="tab-btn active" data-cat="all">Všechny (200)</button>
          <button class="tab-btn" data-cat="Aliasy">Aliasy (60)</button>
          <button class="tab-btn" data-cat="Cypherpunk">Cypherpunk (30)</button>
          <button class="tab-btn" data-cat="Kryptografie">Kryptografie (35)</button>
          <button class="tab-btn" data-cat="Agenti">Sci-Fi Agenti (35)</button>
          <button class="tab-btn" data-cat="Místnosti">Místnosti (40)</button>
        </div>

        <div style="display: flex; gap: 10px;">
          <input type="text" id="searchInput" class="search-input" placeholder="Hledat jméno, paletu...">
        </div>
      </div>

      <!-- Live Custom Seed Generator Bar -->
      <div class="live-tester-bar">
        <div class="live-tester-preview" id="livePreview"></div>
        <input type="text" id="liveSeedInput" value="moje-vlastni-prezdivka" placeholder="Vyzkoušejte jakýkoliv vlastní text / seed v reálném čase...">
        <button class="tool-btn" id="addCustomBtn" style="white-space: nowrap;">Přidat do gridu</button>
      </div>
    </div>
  </header>

  <main>
    <div class="avatar-grid" id="avatarGrid"></div>
  </main>

  <!-- Modal / Inspector -->
  <div class="modal-backdrop" id="modalBackdrop">
    <div class="modal-card">
      <button class="modal-close" id="modalClose">&times;</button>
      <div class="modal-avatar-preview" id="modalAvatar"></div>
      
      <div style="text-align: center;">
        <h2 id="modalTitle" style="font-size: 1.15rem; color: #fff; margin-bottom: 4px;"></h2>
        <div id="modalCategory" style="font-size: 0.75rem; color: #10b981; font-weight: 600;"></div>
      </div>

      <div class="modal-details">
        <div class="modal-row">
          <span class="modal-label">Seed klíč:</span>
          <span class="modal-value" id="modalSeed" style="max-width: 240px; overflow: hidden; text-overflow: ellipsis;"></span>
        </div>
        <div class="modal-row">
          <span class="modal-label">Barevná paleta:</span>
          <span class="modal-value" id="modalPalette"></span>
        </div>
        <div class="modal-row">
          <span class="modal-label">Středový motiv:</span>
          <span class="modal-value" id="modalCenter"></span>
        </div>
        <div class="modal-row">
          <span class="modal-label">Formát:</span>
          <span class="modal-value">3×3 symetrické SVG</span>
        </div>
      </div>

      <div class="modal-actions">
        <button class="modal-btn primary" id="btnCopySvg">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
          Kopírovat SVG
        </button>
        <button class="modal-btn" id="btnCopyDataUri">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>
          Data URI
        </button>
        <button class="modal-btn" id="btnDownloadSvg">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
          Stáhnout SVG
        </button>
        <button class="modal-btn" id="btnCopySeed">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>
          Zkopírovat seed
        </button>
      </div>
    </div>
  </div>

  <div class="toast" id="toast">Zkopírováno do schránky!</div>

  <footer>
    <div>Generátor identiconů pro <strong>encrypt.click</strong> • 3×3 Forgejo pattern s SHA-256 & 88 paletami</div>
    <div>Plně offline, bez externích závislostí • 200 unikátních profilovek</div>
  </footer>

  <script>
  ${bundleJs}

  const { identiconSvg, identiconDataUri, sha256Sync, normalizeSeed, ENCRYPT_PALETTES, CENTER_SHAPES, CENTER_COUNT } = window.IdenticonLib;

  const ADJECTIVES_CS = [
    'Hbitý', 'Klidný', 'Smělý', 'Bystrý', 'Vřelý', 'Chladný', 'Moudrý', 'Čestný',
    'Statečný', 'Jasný', 'Rychlý', 'Hrdý', 'Vznešený', 'Lstivý', 'Divoký', 'Jemný',
    'Zuřivý', 'Tichý', 'Šťastný', 'Tajemný', 'Nezlomný', 'Bleskový', 'Ostražitý', 'Zlatý',
    'Stříbrný', 'Temný', 'Noční', 'Lesní', 'Horský', 'Polární', 'Severský', 'Větrný'
  ];

  const ANIMALS_CS = [
    'Lišák', 'Výr', 'Medvěd', 'Vlk', 'Jestřáb', 'Jelen', 'Rys', 'Tuleň', 'Havran', 'Holub',
    'Sokol', 'Bobr', 'Jezevec', 'Káně', 'Orel', 'Delfín', 'Panter', 'Tygr', 'Leopard',
    'Jaguár', 'Gepard', 'Krkavec', 'Vydra', 'Sob', 'Kondor', 'Fénix', 'Chameleon', 'Bizon'
  ];

  const CYPHERPUNKS = [
    'Satoshi Nakamoto', 'Hal Finney', 'David Chaum', 'Nick Szabo', 'Adam Back',
    'Whitfield Diffie', 'Martin Hellman', 'Ron Rivest', 'Adi Shamir', 'Leonard Adleman',
    'Bruce Schneier', 'Phil Zimmermann', 'Julian Assange', 'Edward Snowden', 'Timothy May',
    'Eric Hughes', 'John Gilmore', 'Len Sassaman', 'Bram Cohen', 'Wladimir van der Laan',
    'Gavin Andresen', 'Vitalik Buterin', 'Ralph Merkle', 'Claude Shannon'
  ];

  const CRYPTO_PRIMITIVES = [
    'AES-256-GCM', 'Argon2id', 'ML-KEM-768', 'Kyber-1024', 'Dilithium-5', 'BLAKE3',
    'SHA-256', 'Curve25519', 'Ed25519', 'ChaCha20-Poly1305', 'Zero-Knowledge',
    'Diffie-Hellman', 'Schnorr', 'Post-Quantum', 'Double Ratchet', 'X3DH', 'HKDF-SHA512',
    'Scrypt', 'Bcrypt', 'SPHINCS+', 'FALCON-512', 'Bulletproofs', 'RingCT', 'Pedersen'
  ];

  const SCI_FI_AGENTS = [
    'Neo', 'Trinity', 'Morpheus', 'Cipher', 'Ghost in the Shell', 'Major Kusanagi',
    'Deckard', 'Roy Batty', 'Wintermute', 'Neuromancer', 'Case', 'Molly Millions',
    'Agent Smith', 'Shadow Broker', 'Spectre-007', 'Phantom Nine', 'Vortex', 'Apex',
    'Enigma-42', 'Krypton', 'Chronos', 'Zero-Cool', 'Acid Burn', 'Crash Override',
    'Lord Nikon', 'Cereal Killer', 'Trinity-Prime', 'Sentinel', 'Overwatch', 'Darknet'
  ];

  function getAvatarDetails(seed) {
    const bytes = sha256Sync(normalizeSeed(seed));
    const pal = ENCRYPT_PALETTES[((bytes[22] << 8) | bytes[23]) % ENCRYPT_PALETTES.length];
    const center = CENTER_SHAPES[bytes[5] % CENTER_COUNT].name;
    return { palette: pal.name, centerShape: center, svg: identiconSvg(seed, 100) };
  }

  function generateInitial200() {
    const list = [];
    let id = 1;

    // 1. Aliasy (60)
    for (let i = 0; i < 60; i++) {
      const adj = ADJECTIVES_CS[i % ADJECTIVES_CS.length];
      const animal = ANIMALS_CS[(i * 3 + 2) % ANIMALS_CS.length];
      const seed = \`alias:\${i % 20}-\${(i * 2) % 20}-\${(i * 17) % 360}\`;
      const d = getAvatarDetails(seed);
      list.push({ id: id++, seed, label: \`\${adj} \${animal}\`, category: 'Aliasy', palette: d.palette, centerShape: d.centerShape, svg: d.svg });
    }

    // 2. Cypherpunks (30)
    for (let i = 0; i < CYPHERPUNKS.length; i++) {
      const name = CYPHERPUNKS[i];
      const seed = \`cypherpunk:\${name.toLowerCase().replace(/\\s+/g, '-')}\`;
      const d = getAvatarDetails(seed);
      list.push({ id: id++, seed, label: name, category: 'Cypherpunk', palette: d.palette, centerShape: d.centerShape, svg: d.svg });
    }

    // 3. Kryptografie (35)
    for (let i = 0; i < CRYPTO_PRIMITIVES.length; i++) {
      const name = CRYPTO_PRIMITIVES[i];
      const seed = \`crypto:\${name.toLowerCase()}\`;
      const d = getAvatarDetails(seed);
      list.push({ id: id++, seed, label: name, category: 'Kryptografie', palette: d.palette, centerShape: d.centerShape, svg: d.svg });
    }

    // 4. Sci-Fi Agenti (35)
    for (let i = 0; i < SCI_FI_AGENTS.length; i++) {
      const name = SCI_FI_AGENTS[i];
      const seed = \`agent:\${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}\`;
      const d = getAvatarDetails(seed);
      list.push({ id: id++, seed, label: name, category: 'Agenti', palette: d.palette, centerShape: d.centerShape, svg: d.svg });
    }

    // 5. Místnosti / Hashe (40)
    const remaining = 200 - list.length;
    for (let i = 0; i < remaining; i++) {
      const hex = sha256Sync(\`seed-\${i * 997 + 13}\`).slice(0, 6).reduce((acc, b) => acc + b.toString(16).padStart(2, '0'), '');
      const seed = \`room:\${hex}\`;
      const d = getAvatarDetails(seed);
      list.push({ id: id++, seed, label: \`#\${hex.toUpperCase()}\`, category: 'Místnosti', palette: d.palette, centerShape: d.centerShape, svg: d.svg });
    }

    return list;
  }

  let avatarItems = generateInitial200();
  let currentFilter = 'all';
  let currentSearch = '';
  let selectedItem = null;

  const grid = document.getElementById('avatarGrid');
  const countEl = document.getElementById('gridCount');
  const modalBackdrop = document.getElementById('modalBackdrop');
  const toast = document.getElementById('toast');

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2200);
  }

  function renderGrid() {
    const filtered = avatarItems.filter(item => {
      const matchCat = currentFilter === 'all' || item.category === currentFilter;
      const matchSearch = !currentSearch || 
        item.label.toLowerCase().includes(currentSearch) ||
        item.seed.toLowerCase().includes(currentSearch) ||
        item.palette.toLowerCase().includes(currentSearch);
      return matchCat && matchSearch;
    });

    countEl.textContent = filtered.length + ' kusů';

    grid.innerHTML = filtered.map(item => \`
      <div class="avatar-card" data-id="\${item.id}">
        <div class="avatar-wrapper">
          \${item.svg}
        </div>
        <div class="avatar-info">
          <div class="avatar-label" title="\${item.label}">\${item.label}</div>
          <div class="avatar-meta">\${item.palette}</div>
        </div>
      </div>
    \`).join('');

    document.querySelectorAll('.avatar-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = parseInt(card.dataset.id);
        const item = avatarItems.find(x => x.id === id);
        if (item) openModal(item);
      });
    });
  }

  function openModal(item) {
    selectedItem = item;
    document.getElementById('modalAvatar').innerHTML = item.svg;
    document.getElementById('modalTitle').textContent = item.label;
    document.getElementById('modalCategory').textContent = item.category;
    document.getElementById('modalSeed').textContent = item.seed;
    document.getElementById('modalPalette').textContent = item.palette;
    document.getElementById('modalCenter').textContent = item.centerShape;
    modalBackdrop.classList.add('open');
  }

  document.getElementById('modalClose').addEventListener('click', () => {
    modalBackdrop.classList.remove('open');
  });

  modalBackdrop.addEventListener('click', (e) => {
    if (e.target === modalBackdrop) modalBackdrop.classList.remove('open');
  });

  document.getElementById('btnCopySvg').addEventListener('click', () => {
    if (!selectedItem) return;
    navigator.clipboard.writeText(selectedItem.svg).then(() => showToast('SVG kód byl zkopírován!'));
  });

  document.getElementById('btnCopyDataUri').addEventListener('click', () => {
    if (!selectedItem) return;
    const uri = identiconDataUri(selectedItem.seed);
    navigator.clipboard.writeText(uri).then(() => showToast('Data URI zkopírováno!'));
  });

  document.getElementById('btnCopySeed').addEventListener('click', () => {
    if (!selectedItem) return;
    navigator.clipboard.writeText(selectedItem.seed).then(() => showToast('Seed zkopírován do schránky!'));
  });

  document.getElementById('btnDownloadSvg').addEventListener('click', () => {
    if (!selectedItem) return;
    const blob = new Blob([selectedItem.svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = \`avatar-\${selectedItem.seed.replace(/[^a-z0-9_-]/gi, '_')}.svg\`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('SVG staženo!');
  });

  document.getElementById('filterTabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab-btn');
    if (!tab) return;
    document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentFilter = tab.dataset.cat;
    renderGrid();
  });

  document.getElementById('searchInput').addEventListener('input', (e) => {
    currentSearch = e.target.value.toLowerCase().trim();
    renderGrid();
  });

  document.getElementById('shapeRound').addEventListener('click', () => {
    document.documentElement.style.setProperty('--radius', '50%');
  });
  document.getElementById('shapeSquircle').addEventListener('click', () => {
    document.documentElement.style.setProperty('--radius', '22%');
  });
  document.getElementById('shapeSquare').addEventListener('click', () => {
    document.documentElement.style.setProperty('--radius', '6px');
  });

  document.getElementById('sizeSm').addEventListener('click', () => {
    document.documentElement.style.setProperty('--item-size', '56px');
  });
  document.getElementById('sizeMd').addEventListener('click', () => {
    document.documentElement.style.setProperty('--item-size', '72px');
  });
  document.getElementById('sizeLg').addEventListener('click', () => {
    document.documentElement.style.setProperty('--item-size', '96px');
  });

  const liveSeedInput = document.getElementById('liveSeedInput');
  const livePreview = document.getElementById('livePreview');

  function updateLivePreview() {
    const val = liveSeedInput.value || 'test';
    livePreview.innerHTML = identiconSvg(val, 100);
  }
  liveSeedInput.addEventListener('input', updateLivePreview);
  updateLivePreview();

  document.getElementById('addCustomBtn').addEventListener('click', () => {
    const val = liveSeedInput.value.trim();
    if (!val) return;
    const details = getAvatarDetails(val);
    const newItem = {
      id: Date.now(),
      seed: val,
      label: val,
      category: 'Vlastní',
      palette: details.palette,
      centerShape: details.centerShape,
      svg: details.svg
    };
    avatarItems.unshift(newItem);
    renderGrid();
    showToast('Vlastní profilovka přidána do gridu!');
  });

  document.getElementById('rerollBtn').addEventListener('click', () => {
    const newItems = [];
    for (let i = 0; i < 200; i++) {
      const randSeed = 'seed-' + Math.random().toString(36).substring(2, 10) + '-' + Date.now().toString(36);
      const details = getAvatarDetails(randSeed);
      newItems.push({
        id: i + 1,
        seed: randSeed,
        label: '#' + randSeed.substring(5, 13).toUpperCase(),
        category: 'Náhodné',
        palette: details.palette,
        centerShape: details.centerShape,
        svg: details.svg
      });
    }
    avatarItems = newItems;
    currentFilter = 'all';
    document.querySelectorAll('.tab-btn').forEach((t, idx) => {
      t.classList.toggle('active', idx === 0);
    });
    renderGrid();
    showToast('Vygenerováno 200 nových náhodných profilovek!');
  });

  renderGrid();
  </script>
</body>
</html>
`;

fs.writeFileSync(path.resolve('avatars.html'), html, 'utf8');
console.log('Successfully regenerated avatars.html! File length:', html.length);

