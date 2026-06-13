// ============================================================
// BetAnalytics Pro — Serveur Backend v3
// Lit les canaux Telegram via Bot API (plus fiable que scraping)
// Jeux : Baccara, Penalty 18, Penalty 22, Jeu 21, FIFA 4×4
// ============================================================

const express = require('express');
const cors    = require('cors');
const https   = require('https');

const app = express();
app.use(cors());
app.use(express.json());

// ── Configuration Telegram ───────────────────────────────────
// Note : le BOT_TOKEN n'est pas nécessaire pour lire les canaux publics
// via t.me/s/ — le scraping HTML suffit et évite d'exposer un token.

const CHANNELS = {
  baccara:   'statistika_baccara',
  penalty18: 'statistika_fifa_penalty_fast',
  penalty22: 'statistika_fifa_penalty_fast2022',
  jeu21:     'statistika_21f',
  fifa4x4:   'statistika_fifa_4x4',
};

// ── État en mémoire ──────────────────────────────────────────
const results = {
  baccara:   [],
  penalty18: [],
  penalty22: [],
  jeu21:     [],
  fifa4x4:   [],
};

// ── Traductions équipes ──────────────────────────────────────
const TEAMS = {
  // ── Penalty / Jeu standard (avec espaces) ───────────────
  'Ливерпуль': 'Liverpool',        'Арсенал': 'Arsenal',
  'Бавария': 'Bayern',             'Реал': 'Real Madrid',
  'Барселона': 'Barcelone',        'ПСЖ': 'PSG',
  'Ювентус': 'Juventus',           'Манчестер Сити': 'Man City',
  'Пьемонте Кальчо': 'Juventus',   'Манчестер Юнайтед': 'Man United',
  'Челси': 'Chelsea',              'Атлетико': 'Atlético',
  'Милан': 'AC Milan',             'Интер': 'Inter',
  'Дортмунд': 'Dortmund',          'Тоттенхэм': 'Tottenham',
  'Наполи': 'Naples',              'Севилья': 'Séville',
  'Вильярреал': 'Villarreal',      'Бенфика': 'Benfica',
  'Порту': 'Porto',                'Аякс': 'Ajax',
  'Лейпциг': 'Leipzig',            'Лион': 'Lyon',
  'Марсель': 'Marseille',          'Рома': 'Roma',
  'Лацио': 'Lazio',                'Валенсия': 'Valencia',
  'Бетис': 'Betis',                'Монако': 'Monaco',
  // ── FIFA 4×4 spécifique (noms collés, sans espaces) ─────
  'БрайтонэндХавАльбион': 'Brighton',
  'Вулверхэмптон': 'Wolverhampton',
  'МанчестерЮнайтед': 'Man United',
  'МанчестерСити': 'Man City',
  'ШеффилдЮнайтед': 'Sheffield Utd',
  'КристалПэлэс': 'Crystal Palace',
  'НьюкаслЮнайтед': 'Newcastle',
  'НоттингемФорест': 'Nottm Forest',
  'ЛутонТаун': 'Luton Town',
  'ЛидсЮнайтед': 'Leeds',
  'ВестХэм': 'West Ham',
  'ВестХэмЮнайтед': 'West Ham',
  'АстонВилла': 'Aston Villa',
  'Бернли': 'Burnley',
  'Фулхэм': 'Fulham',
  'Брентфорд': 'Brentford',
  'Эвертон': 'Everton',
  'Лестер': 'Leicester',
  'Борнмут': 'Bournemouth',
  'Ипсвич': 'Ipswich',
  'Саутгемптон': 'Southampton',
  'Суонси': 'Swansea',
  'Сандерленд': 'Sunderland',
  'Мидлсбро': 'Middlesbrough',
  'Стоук': 'Stoke',
  'Норвич': 'Norwich',
  'Блэкберн': 'Blackburn',
  'КвинзПаркРейнджерс': 'QPR',
  'Дерби': 'Derby',
  'Кардифф': 'Cardiff',
  'Миллуолл': 'Millwall',
  'Ковентри': 'Coventry',
  'Халл': 'Hull City',
  'Шеффилд': 'Sheffield',
  'Уотфорд': 'Watford',
  'Вест Хэм': 'West Ham',
  'Вест Бромвич': 'West Brom',
  'ВестБромвич': 'West Brom',
};
function translateTeam(name) {
  const t = name ? name.trim() : name;
  return TEAMS[t] || t;
}

// ── Fetch via Bot API Telegram ───────────────────────────────
// Récupère les 100 derniers messages d'un canal public via forwardFromChat
// Méthode : on lit le channel via getUpdates n'est pas possible sur les canaux
// On utilise plutôt le scraping HTML de t.me/s/ + fallback bot API
function fetchChannelHTML(username) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 't.me',
      path: `/s/${username}`,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache',
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      // Suivre les redirects si besoin
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchChannelHTML(res.headers.location.replace('https://t.me/s/', '')).then(resolve).catch(reject);
      }
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(12000, () => { req.destroy(); reject(new Error('Timeout HTML')); });
    req.end();
  });
}

// ── Extrait les textes des messages depuis HTML t.me/s ───────
function extractMessages(html, is4x4 = false) {
  const messages = [];
  const regex = /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/g;
  let m;
  while ((m = regex.exec(html)) !== null) {
    let text = m[1]
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)))
      .trim();
    // FIFA 4×4 : pas de #N — le message commence par #EquipeA_EquipeB
    const marker = is4x4 ? /#[А-ЯЁа-яёA-Za-z]/ : /#N/;
    if (text && marker.test(text)) messages.push(text);
  }
  // Fallback pattern alternatif
  if (messages.length < 3) {
    const regex2 = /class="js-message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/g;
    while ((m = regex2.exec(html)) !== null) {
      let text = m[1].replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();
      const marker = is4x4 ? /#[А-ЯЁа-яёA-Za-z]/ : /#N/;
      if (text && marker.test(text) && !messages.includes(text)) messages.push(text);
    }
  }
  return messages;
}

// ── Parsers ──────────────────────────────────────────────────

// Baccara : #N123 7(J,5) - 3(D,2) #T10 #R
function parseBaccara(text) {
  const match = text.match(/#N(\d+)[.\s]+(\d+)\([^)]*\)\s*[-–]\s*(\d+)\([^)]*\)(?:\s*#T(\d+))?(\s*#R)?/);
  if (!match) return null;
  const p = parseInt(match[2]), b = parseInt(match[3]);
  return {
    n: parseInt(match[1]),
    playerScore: p,
    bankerScore: b,
    playerCards: '',
    bankerCards: '',
    total: match[4] ? parseInt(match[4]) : p + b,
    natural: !!match[5],
    ts: Date.now()
  };
}

// Penalty / FIFA : #N123 Liverpool (3:1) Arsenal
function parsePenalty(text) {
  const match = text.match(/#N(\d+)\s+(.+?)\s+\((\d+):(\d+)\)\s+(.+)/);
  if (!match) return null;
  return {
    n: parseInt(match[1]),
    home:  translateTeam(match[2].trim()),
    away:  translateTeam(match[5].trim()),
    score: `${match[3]}:${match[4]}`,
    ts: Date.now()
  };
}

// Jeu 21 — formats multiples possibles
function parseJeu21(text) {
  const n_match = text.match(/#N(\d+)/);
  if (!n_match) return null;
  const n = parseInt(n_match[1]);

  // Format : #N123 X(cards) - Y(cards) #TX [#R]
  // Même format que baccara mais les scores sont entre 1 et 21
  let m = text.match(/#N\d+[.\s]+(\d+)\([^)]*\)\s*[-–]\s*(\d+)\([^)]*\)(?:\s*#T\d+)?(\s*#R)?/);
  if (m) {
    const player = parseInt(m[1]), dealer = parseInt(m[2]);
    const result = player > 21 ? 'BUST' : dealer > 21 ? 'WIN' : player > dealer ? 'WIN' : player < dealer ? 'LOSE' : 'PUSH';
    return { n, player, dealer, result, ts: Date.now() };
  }

  // Format : #N123 21 - 18 ou #N123 (21-18)
  m = text.match(/#N\d+[.\s]+(\d+)\s*[-–]\s*(\d+)/);
  if (m) {
    const player = parseInt(m[1]), dealer = parseInt(m[2]);
    const result = player > 21 ? 'BUST' : dealer > 21 ? 'WIN' : player > dealer ? 'WIN' : player < dealer ? 'LOSE' : 'PUSH';
    return { n, player, dealer, result, ts: Date.now() };
  }

  // Format avec mots clés WIN/LOSE/BUST
  m = text.match(/#N\d+.*?(\d{1,2}).*?(\d{1,2}).*(WIN|LOSE|BUST|PUSH|BJ)/i);
  if (m) {
    const player = parseInt(m[1]), dealer = parseInt(m[2]);
    const rw = m[3].toUpperCase();
    const result = rw.includes('WIN')||rw.includes('BJ') ? 'WIN' : rw.includes('LOS')||rw.includes('BUST') ? 'LOSE' : 'PUSH';
    return { n, player, dealer, result, ts: Date.now() };
  }

  // Format P:X D:Y
  m = text.match(/#N\d+.*?P[:\s](\d+).*?D[:\s](\d+)/i);
  if (m) {
    const player = parseInt(m[1]), dealer = parseInt(m[2]);
    const result = player > 21 ? 'BUST' : dealer > 21 ? 'WIN' : player > dealer ? 'WIN' : player < dealer ? 'LOSE' : 'PUSH';
    return { n, player, dealer, result, ts: Date.now() };
  }

  return null;
}

// FIFA 4×4 — Format réel du canal statistika_fifa_4x4 :
// Bloc de plusieurs matchs dans un même message, ex :
//   #БрайтонэндХавАльбион_Арсенал ⏰ 2-й тайм 5:57
//   6:7 (3:4 3:3 ) #T13
// Un message peut contenir plusieurs matchs → on les découpe tous.
// On génère un id séquentiel basé sur l'ordre de parution (pas de #N).
let fifa4x4Counter = Date.now(); // compteur unique par session

function parseFifa4x4Block(text) {
  const results = [];
  // Découper le texte en lignes
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  for (let i = 0; i < lines.length - 1; i++) {
    const line1 = lines[i];
    const line2 = lines[i + 1];

    // Ligne 1 : #EquipeA_EquipeB ⏰ ...
    const teamMatch = line1.match(/^#([А-ЯЁа-яёA-Za-z]+)_([А-ЯЁа-яёA-Za-z]+)/);
    if (!teamMatch) continue;

    // Ligne 2 : H:A (h1:a1 h2:a2) #TXX
    const scoreMatch = line2.match(/^(\d+):(\d+)\s*\([\d: ]+\)\s*#T(\d+)/);
    if (!scoreMatch) continue;

    const home  = translateTeam(teamMatch[1]);
    const away  = translateTeam(teamMatch[2]);
    const scoreH = parseInt(scoreMatch[1]);
    const scoreA = parseInt(scoreMatch[2]);
    const total  = parseInt(scoreMatch[3]);

    results.push({
      n:     fifa4x4Counter++,
      home,
      away,
      score: `${scoreH}:${scoreA}`,
      total,
      ts:    Date.now()
    });

    i++; // sauter line2 déjà consommée
  }
  return results;
}

// ── Mise à jour d'un canal ───────────────────────────────────
async function updateChannel(key, username) {
  try {
    const html = await fetchChannelHTML(username);
    if (!html || html.length < 100) {
      console.warn(`[${key}] HTML vide ou trop court`);
      return false;
    }

    const is4x4 = key === 'fifa4x4';
    const messages = extractMessages(html, is4x4);

    if (messages.length === 0) {
      console.log(`[${key}] Aucun message trouvé sur t.me/s/${username}`);
      return true;
    }

    const parsed = [];

    if (is4x4) {
      // FIFA 4×4 : chaque message peut contenir plusieurs matchs
      for (const msg of messages) {
        const bloc = parseFifa4x4Block(msg);
        parsed.push(...bloc);
      }
    } else {
      for (const msg of messages) {
        let r = null;
        if (key === 'baccara') r = parseBaccara(msg);
        else if (key === 'jeu21') r = parseJeu21(msg);
        else r = parsePenalty(msg);
        if (r) parsed.push(r);
      }
    }

    if (parsed.length > 0) {
      if (!is4x4) parsed.sort((a, b) => b.n - a.n);
      results[key] = parsed.slice(0, 50);
      const label = is4x4 ? `${parsed.length} matchs` : `Dernier: #N${parsed[0].n}`;
      console.log(`✅ [${key}] ${parsed.length} résultats. ${label}`);
    } else {
      console.log(`[${key}] ⚠️ ${messages.length} messages trouvés mais aucun parsé`);
      messages.slice(0, 3).forEach((msg, i) => {
        console.log(`   [${key}] msg${i+1}: ${msg.substring(0, 120).replace(/\n/g,' ')}`);
      });
    }
    return true;
  } catch (e) {
    console.error(`❌ [${key}] Erreur: ${e.message}`);
    return false;
  }
}

// ── Polling ──────────────────────────────────────────────────
async function pollAll() {
  await updateChannel('baccara',   CHANNELS.baccara);
  await updateChannel('penalty18', CHANNELS.penalty18);
  await updateChannel('penalty22', CHANNELS.penalty22);
  await updateChannel('jeu21',     CHANNELS.jeu21);
  await updateChannel('fifa4x4',   CHANNELS.fifa4x4);
}

// ── Polling adaptatif ────────────────────────────────────────
let pollErrorCount = 0;
const POLL_INTERVAL_OK  = 15000; // 15s en fonctionnement normal
const POLL_INTERVAL_ERR = 60000; // 60s en cas d'erreur répétée

async function pollAll() {
  let hasError = false;
  // Séquence avec petite pause entre chaque canal pour ne pas spammer Telegram
  const channels = [
    ['baccara',   CHANNELS.baccara],
    ['penalty18', CHANNELS.penalty18],
    ['penalty22', CHANNELS.penalty22],
    ['jeu21',     CHANNELS.jeu21],
    ['fifa4x4',   CHANNELS.fifa4x4],
  ];
  for (const [key, username] of channels) {
    const ok = await updateChannel(key, username);
    if (!ok) hasError = true;
    // Pause 1s entre chaque requête pour éviter le rate-limit
    await new Promise(r => setTimeout(r, 1000));
  }

  if (hasError) {
    pollErrorCount++;
  } else {
    pollErrorCount = 0;
  }

  // Backoff : si 3+ erreurs consécutives → attendre 60s
  const delay = pollErrorCount >= 3 ? POLL_INTERVAL_ERR : POLL_INTERVAL_OK;
  if (pollErrorCount >= 3) {
    console.warn(`⚠️ ${pollErrorCount} erreurs consécutives — prochain poll dans ${delay/1000}s`);
  }
  setTimeout(pollAll, delay);
}

console.log('🔄 Récupération initiale...');
pollAll(); // démarre la boucle adaptative (plus de setInterval fixe)

// ── API REST ─────────────────────────────────────────────────
app.get('/results/:game', (req, res) => {
  const game = req.params.game;
  if (!results[game]) return res.status(404).json({ error: 'Jeu inconnu' });
  res.json(results[game]);
});

app.get('/status', (req, res) => {
  res.json({
    status: 'online',
    counts: {
      baccara:   results.baccara.length,
      penalty18: results.penalty18.length,
      penalty22: results.penalty22.length,
      jeu21:     results.jeu21.length,
      fifa4x4:   results.fifa4x4.length,
    }
  });
});

// ── Endpoint Analyse IA ──────────────────────────────────────
const https_req = require('https');

app.post('/analyze', (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Prompt manquant' });

  const apiKey = process.env.ANTHROPIC_API_KEY || '';
  if (!apiKey) {
    console.error('❌ ANTHROPIC_API_KEY manquante !');
    return res.status(500).json({ error: 'Clé API manquante. Lance: set ANTHROPIC_API_KEY=sk-ant-... && node server.js' });
  }

  const body = JSON.stringify({
    model: 'claude-sonnet-4-6',
    max_tokens: 1200,
    messages: [{ role: 'user', content: prompt }]
  });

  const options = {
    hostname: 'api.anthropic.com',
    path: '/v1/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'anthropic-version': '2023-06-01',
      'x-api-key': apiKey
    }
  };

  console.log('[/analyze] Appel Claude API...');

  const apiReq = https_req.request(options, (apiRes) => {
    let data = '';
    apiRes.on('data', chunk => data += chunk);
    apiRes.on('end', () => {
      console.log('[/analyze] HTTP status:', apiRes.statusCode);
      try {
        const parsed = JSON.parse(data);
        if (parsed.error) {
          console.error('[/analyze] Erreur Claude:', parsed.error);
          return res.status(500).json({ error: parsed.error.message || 'Erreur Claude API' });
        }
        const text = parsed.content.map(c => c.text || '').join('').replace(/```json|```/g, '').trim();
        console.log('[/analyze] OK. Début réponse:', text.substring(0, 100));
        res.json({ raw: text });
      } catch(e) {
        console.error('[/analyze] Parse error:', e.message);
        res.status(500).json({ error: 'Erreur parsing réponse Claude' });
      }
    });
  });

  apiReq.on('error', (e) => {
    console.error('[/analyze] Erreur réseau:', e.message);
    res.status(500).json({ error: 'Erreur réseau: ' + e.message });
  });
  apiReq.setTimeout(30000, () => {
    apiReq.destroy();
    res.status(500).json({ error: 'Timeout Claude API (30s)' });
  });

  apiReq.write(body);
  apiReq.end();
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`\n✅ HADAR BetAnalytics Server v3`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`   Jeux: Baccara | Penalty 18 | Penalty 22 | Jeu 21 | FIFA 4×4\n`);
});
