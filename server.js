// ============================================================
// BetAnalytics Pro — Serveur Backend v3
// Lit les canaux Telegram via Bot API (plus fiable que scraping)
// Jeux : Baccara, Penalty 18, Penalty 22, Jeu 21, FIFA 4×4
// ============================================================

const express = require('express');
const cors    = require('cors');
const https   = require('https');
const path    = require('path');


const app = express();
app.use(cors());
app.use(express.json());

// ── Servir les fichiers statiques (HTML, JS, icônes, etc.) ───
app.use(express.static(path.join(__dirname)));

// Page principale
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'betting-analyzer.html'));
});


// ── Configuration Telegram ───────────────────────────────────
const BOT_TOKEN = '8985006064:AAE6H_PyFKT3RVccTjOw3sq1N_c_xhGafjw';

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
  'Ливерпуль': 'Liverpool',               'Арсенал': 'Arsenal',
  'Бавария': 'Bayern',                    'Реал': 'Real Madrid',
  'Барселона': 'Barcelone',               'ПСЖ': 'PSG',
  'Ювентус': 'Juventus',                  'МанчестерСити': 'Man City',
  'Манчестер Сити': 'Man City',           'МанчестерЮнайтед': 'Man United',
  'Манчестер Юнайтед': 'Man United',      'Пьемонте Кальчо': 'Juventus',
  'Челси': 'Chelsea',                     'Атлетико': 'Atlético',
  'Милан': 'AC Milan',                    'Интер': 'Inter',
  'Дортмунд': 'Dortmund',                 'Тоттенхэм': 'Tottenham',
  'Наполи': 'Naples',                     'Севилья': 'Séville',
  'Вильярреал': 'Villarreal',             'Бенфика': 'Benfica',
  'Порту': 'Porto',                       'Аякс': 'Ajax',
  'Лейпциг': 'Leipzig',                   'Лион': 'Lyon',
  'Марсель': 'Marseille',                 'Рома': 'Roma',
  'Лацио': 'Lazio',                       'Валенсия': 'Valencia',
  'Бетис': 'Betis',                       'Монако': 'Monaco',
  // FIFA 4×4 teams
  'БрайтонэндХавАльбион': 'Brighton',    'Вулверхэмптон': 'Wolves',
  'Брентфорд': 'Brentford',              'ШеффилдЮнайтед': 'Sheffield Utd',
  'КристалПэлэс': 'Crystal Palace',      'Бернли': 'Burnley',
  'Фулхэм': 'Fulham',                    'ЛутонТаун': 'Luton Town',
  'НьюкаслЮнайтед': 'Newcastle',         'АстонВилла': 'Aston Villa',
  'НоттингемФорест': 'Nottm Forest',     'ЭвертонФК': 'Everton',
  'ВестХэмЮнайтед': 'West Ham',         'БорнмутФК': 'Bournemouth',
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

// ── Fetch via Bot API (getHistory via forwardMessages) ───────
// Pour les canaux publics, on peut aussi utiliser l'API bot pour
// récupérer les messages avec copyMessage/forwardMessage
// MAIS la méthode la plus simple est getChatHistory via bot
function fetchViaBotAPI(username) {
  return new Promise((resolve, reject) => {
    // On utilise la méthode channel_history via getChatAdministrators
    // Puis getHistory sur le chat public
    const path = `/bot${BOT_TOKEN}/getUpdates?limit=100&allowed_updates=channel_post`;
    const options = {
      hostname: 'api.telegram.org',
      path,
      method: 'GET',
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout Bot API')); });
    req.end();
  });
}

// ── Extrait les textes des messages depuis HTML t.me/s ───────
function extractMessages(html, game) {
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

    if (!text) continue;

    // Canaux avec #N
    if (text.includes('#N')) { messages.push(text); continue; }

    // FIFA 4×4 : messages avec score X:Y et #T
    if (game === 'fifa4x4' && text.match(/\d+:\d+/) && text.includes('#T')) {
      messages.push(text); continue;
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

// Jeu 21 — Format: #N492. 20(9♣️A♣️) - 23(8♠️6♥️9♦️) #T43 [#O=#dealer21 #X=égalité]
function parseJeu21(text) {
  const match = text.match(/#N(\d+)[.\s]+(\d+)\([^)]*\)\s*[-–]\s*(\d+)\([^)]*\)(?:\s*#T(\d+))?(\s*#[OX])?/);
  if (!match) return null;
  const n      = parseInt(match[1]);
  const player = parseInt(match[2]);
  const dealer = parseInt(match[3]);
  const flag   = (match[5] || '').trim();
  let result;
  if (flag === '#X')    result = 'PUSH';   // égalité exacte
  else if (dealer > 21) result = 'WIN';    // dealer bust → joueur gagne
  else if (player > 21) result = 'BUST';   // joueur bust → perd
  else if (player > dealer) result = 'WIN';
  else if (player < dealer) result = 'LOSE';
  else result = 'PUSH';
  return { n, player, dealer, result, ts: Date.now() };
}

// FIFA 4×4 — Format multi-ligne:
// #Team1_Team2 ⏰ 2-й тайм 5:57
// 6:7 (3:4 3:3 ) #T13

// FIFA 4×4 — format différent, pas de #N, équipes dans le hashtag
// Ex: #Челси_Вулверхэмптон ⏰ 2-й тайм 5:53
// 5:8 (2:4 3:4 ) #T13
let fifa4x4Counter = 1000; // compteur auto pour les IDs
const fifa4x4Seen = new Set();

function parseFifa4x4(text) {
  // Chercher le score principal X:Y (pas celui dans les parenthèses)
  // Format: #Team1_Team2 ... SCORE:SCORE (halftime) #TX
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  let teamLine = '', scoreLine = '';
  for (const line of lines) {
    if (line.startsWith('#') && line.includes('_')) teamLine = line;
    if (line.match(/^\d+:\d+\s*\(/)) scoreLine = line;
  }

  if (!scoreLine) return null;

  // Extraire score total (ex: "6:7 (3:4 3:3 ) #T13")
  const sm = scoreLine.match(/^(\d+):(\d+)/);
  if (!sm) return null;

  const homeGoals = parseInt(sm[1]);
  const awayGoals = parseInt(sm[2]);
  const score = `${homeGoals}:${awayGoals}`;

  // Extraire équipes depuis le hashtag (ex: #Челси_Вулверхэмптон)
  let home = '—', away = '—';
  if (teamLine) {
    const teamsRaw = teamLine.replace(/^#/, '').split('_');
    if (teamsRaw.length >= 2) {
      home = translateTeam(teamsRaw[0].replace(/⏰.*/, '').trim());
      away = translateTeam(teamsRaw[1].replace(/⏰.*/, '').trim());
    }
  }

  // Générer un ID unique basé sur le texte
  const key = `${home}_${away}_${score}`;
  if (fifa4x4Seen.has(key)) return null;
  fifa4x4Seen.add(key);
  const n = fifa4x4Counter++;

  return { n, home, away, score, ts: Date.now() };
}

// ── Mise à jour d'un canal ───────────────────────────────────
async function updateChannel(key, username) {
  try {
    const html = await fetchChannelHTML(username);
    if (!html || html.length < 100) {
      console.warn(`[${key}] HTML vide ou trop court`);
      return;
    }

    const messages = extractMessages(html, key);

    if (messages.length === 0) {
      console.log(`[${key}] Aucun message #N trouvé sur t.me/s/${username}`);
      return;
    }

    const parsed = [];
    for (const msg of messages) {
      let r = null;
      if (key === 'baccara')   r = parseBaccara(msg);
      else if (key === 'jeu21')    r = parseJeu21(msg);
      else if (key === 'fifa4x4')  r = parseFifa4x4(msg);
      else                          r = parsePenalty(msg);
      if (r) parsed.push(r);
    }

    if (parsed.length > 0) {
      parsed.sort((a, b) => b.n - a.n);
      results[key] = parsed.slice(0, 50);
      console.log(`✅ [${key}] ${parsed.length} résultats. Dernier: #N${parsed[0].n}`);
    } else {
      console.log(`[${key}] ⚠️ ${messages.length} messages trouvés mais aucun parsé`);
      // Afficher les 3 premiers pour debug
      messages.slice(0, 3).forEach((msg, i) => {
        console.log(`   [${key}] msg${i+1}: ${msg.substring(0, 100).replace(/\n/g,' ')}`);
      });
    }
  } catch (e) {
    console.error(`❌ [${key}] Erreur: ${e.message}`);
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

console.log('🔄 Récupération initiale...');
pollAll();
setInterval(pollAll, 10000);

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

// Railway fournit le port via process.env.PORT
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✅ HADAR BetAnalytics Server v3`);
  console.log(`   Port: ${PORT}`);
  console.log(`   Jeux: Baccara | Penalty 18 | Penalty 22 | Jeu 21 | FIFA 4x4\n`);
});
