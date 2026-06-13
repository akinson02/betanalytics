# HADAR BetAnalytics Pro — Guide d'installation v3

## 1. Préparer le dossier

Crée un dossier `betanalytics` sur ton bureau.
Copie dedans : `server.js` et `betting-analyzer.html`

## 2. Installer Node.js

Télécharge sur https://nodejs.org — choisir la version LTS.

## 3. Installer les dépendances

Ouvre un terminal dans le dossier et tape :

    npm init -y
    npm install express cors

## 4. ⚠️ IMPORTANT — Configurer la clé API Claude

L'analyse IA nécessite une clé API Anthropic.
Obtiens ta clé sur : https://console.anthropic.com

Lance le serveur EN INCLUANT ta clé (Windows) :

    set ANTHROPIC_API_KEY=sk-ant-xxxxxxxx && node server.js

Ou sur Mac/Linux :

    ANTHROPIC_API_KEY=sk-ant-xxxxxxxx node server.js

Tu dois voir :
    ✅ API démarrée sur http://localhost:3000

## 5. Ouvrir l'application

Ouvre `betting-analyzer.html` dans ton navigateur.
Le serveur DOIT être démarré pour que l'analyse IA fonctionne.

---

## 🔐 Système d'accès

### Compte administrateur (par défaut)
- Identifiant : HADAR_ADMIN
- Code d'accès : Sh@lom12541

### Créer des membres
1. Connecte-toi en admin
2. Clique sur ☰ → Panneau Admin
3. Crée un identifiant + code personnalisé (ex : HADARVIP001)
4. Partage l'identifiant et le code à ton membre

### Fonctionnalités admin
- Créer des comptes avec codes personnalisés
- Générateurs de codes (VIP / GOLD / PREMIUM)
- Modifier / Activer / Désactiver / Supprimer un compte
- Rechercher dans la liste des membres
- Export CSV compatible Excel

---

## En cas de problème

- "Erreur d'analyse IA" → vérifie que le serveur tourne avec la clé API
- "MODULE_NOT_FOUND" → relance : npm install express cors
- Pas de résultats live → les canaux Telegram doivent publier un message
