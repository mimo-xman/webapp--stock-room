# ── Adobe Stock — Images Generator by agents ──

Pipeline complet de production d'images IA pour Adobe Stock : un **agent IA** recherche les
sujets en demande, génère les images via l'API [zazogptimage2api](https://github.com/mimo-xman/nodejs--api-for-gpt-image-2),
et enregistre chaque asset (image + métadonnées d'upload Adobe Stock) dans une base de données.
Le propriétaire gère ensuite le tout depuis une webapp protégée par mot de passe.

```
┌─────────────┐   1. prompt agent    ┌──────────────┐
│  AI Agent   │ ───────────────────► │  Toi (owner) │  tu colles AGENT_PROMPT.md
└──────┬──────┘                      └──────────────┘
       │ 2. recherche web (tendances Adobe Stock)
       │ 3. POST /generate
       ▼
┌──────────────────┐  image URL   ┌─────────────────────────────────┐
│ zazogptimage2api │ ───────────► │  THIS API  (Render)             │
│  (Render, Tor)   │              │  Sessions + Images (MongoDB)    │
└──────────────────┘              └───────────────┬─────────────────┘
                                                  │ 4. lecture/édition
                                                  ▼
                                        ┌──────────────────┐
                                        │  WebApp (Netlify)│  mot de passe (APP_PASSWORD)
                                        │  Next.js 16      │  pagination/filtres backend
                                        └──────────────────┘
```

## Aperçu de la webapp

| | |
|---|---|
| ![Gate](docs/screenshots/01-gate.png) | ![Session](docs/screenshots/04-session-detail.png) |
| *Porte d'entrée (mot de passe)* | *Session — grille d'images réelles* |
| ![Detail](docs/screenshots/05-image-detail.png) | ![Grid](docs/screenshots/07-images-viewport.png) |
| *Détail : métadonnées + tampon + copy icons* | *Toutes les images : filtres, tri, pagination* |

## Structure du repo

| Chemin | Contenu | Hébergement |
|---|---|---|
| `api/` | API Node.js + Express + Mongoose (Sessions/Images, auth double, validation zod, rate limit, pagination/search/filter/sort backend, proxy download, cascade delete) | **Render** (runtime Node) |
| `web/` | WebApp Next.js 16 (password gate, pages Sessions/Images, tampon « Used · Adobe Stock », copy icons, modales custom) | **Netlify** |
| `AGENT_PROMPT.md` | **Le prompt réutilisable** à donner à l'agent (variables à remplacer + prompt Lyra inclus verbatim) | — |

## Déploiement

### 1. Base de données — MongoDB Atlas (gratuit)

1. Crée un cluster M0 sur [mongodb.com/atlas](https://www.mongodb.com/atlas).
2. Database Access : un utilisateur + mot de passe.
3. Network Access : `0.0.0.0/0` (Render n'a pas d'IP fixe en free tier).
4. Récupère l'URI : `mongodb+srv://<user>:<pass>@<cluster>/?retryWrites=true&w=majority`
   (lien seul — le nom de la base se règle à part via `MONGO_DB_NAME`, défaut `adobe-stock`).

### 2. API — Render

Le plus simple : **Render Blueprint** — le repo contient `render.yaml`
(root dir `api`, health check `/health`, build `npm ci --omit=dev`, start `npm start`).
Sinon : *New → Web Service → repo → Root Directory `api` → Build `npm ci --omit=dev` → Start `npm start`*.

Variables d'environnement à définir :

| Variable | Valeur |
|---|---|
| `MONGODB_URI` | l'URI Atlas ci-dessus (lien seul, sans base) |
| `MONGO_DB_NAME` | optionnel — nom de la base, **séparé** de l'URI (défaut : `adobe-stock`, ou la base de l'URI si présente) |
| `API_KEY` | clé de l'agent — `openssl rand -hex 24` |
| `APP_PASSWORD` | le mot de passe de la webapp |
| `CORS_ORIGINS` | l'URL Netlify de la webapp (ex. `https://stockroom.netlify.app`) — ou `*` |

Après déploiement : `https://<service>.onrender.com/` affiche la page de docs de l'API.

### 3. WebApp — Netlify

1. *Add new site → Import an existing project → repo → Base directory `web`*
   (Build command `npm run build`, plugin `@netlify/plugin-nextjs` déjà déclaré dans `web/netlify.toml`).
2. Variable d'environnement (Site settings → Environment variables) :

| Variable | Valeur |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://<service-render>.onrender.com` |

### 4. Utilisation

Copie `AGENT_PROMPT.md`, remplace les `[VARIABLES]` (nombre d'images, liens des 2 APIs, les 2
clés, liens des repos), et envoie-le à ton agent. Il fait tout : recherche → prompts (Lyra) →
génération → session → enregistrement → rapport. La webapp te permet ensuite de parcourir,
trier, filtrer, copier les métadonnées (titre / catégorie / keywords), télécharger les images
et marquer ce qui a été uploadé sur Adobe Stock (tampon vert).

## Règle métier absolue

**Aucun être vivant dans les images générées** (ni humains, ni animaux — silhouettes et
illustrations incluses ; plantes/fleurs autorisées). La règle est inscrite en dur dans
`AGENT_PROMPT.md` (HARD RULES n°1).

## Développement local

```bash
# API (MongoDB en mémoire, zéro config) — http://localhost:3333
cd api && npm install && npm run dev          # key: dev-agent-key, pass: dev-app-password

# WebApp — http://localhost:3000 (détecte l'API locale automatiquement)
cd web && npm install && npm run dev

# Démo visuelle : API + 2 sessions + 16 images pré-remplies
cd api && node scripts/seed-demo.cjs

# Tests E2E de l'API (56 assertions)
cd api && npm test
```

## Sécurité

- Authentification **double et fail-closed** : `X-API-Key` (agent) ou `X-App-Password` (webapp) —
  sans variable configurée, personne n'entre.
- Rate limiting : général (300/min), `/auth/verify` strict (20/5 min), garde anti-brute-force
  (30 échecs/5 min → blocage 10 min).
- Validation zod systématique (catégorie parmi les 21 Adobe, keywords 3–50, URL http(s)…).
- Pagination, tri et filtres **imposés côté serveur** (limit ∈ 5/10/20/50/100, sort whitelist).
- Supprimer une session supprime ses images (cascade), mots de passe jamais stockés côté client
  au-delà du `sessionStorage` (onglet).

## Notes / limites connues

- **Persistance des `image_link`** : l'API de génération peut uploader chaque image sur
  Cloudinary (`result.cloudinaryUrl`, URL permanente). Si Cloudinary n'est pas/plus configuré
  sur ce service, l'agent stocke l'URL serveur (`/files/…?apiKey=…`) qui est **éphémère**
  (redémarrages / spin-down du free tier Render). Pour un usage intensif : configure Cloudinary
  sur zazogptimage2api et vérifie dans ses logs Render l'absence de `cloudinary upload failed`.
- Quota journalier easemate (code `6101`) : l'API de génération retry avec rotation d'IP Tor ;
  si toutes les tentatives échouent, attends quelques heures (reset quotidien).
- La webapp n'édite **pas** les sessions (par design : seul le champ *Images* est modifiable —
  marquage « used » + édition complète des métadonnées d'une image).

## Stack

API : Node 18+, Express 4, Mongoose 8, zod 3, express-rate-limit 7, helmet 8.
WebApp : Next.js 16 (App Router), TypeScript, Tailwind CSS 4, shadcn/ui, Radix, lucide-react.
Design : « Stockroom » — papier/encre/orange sécurité, Barlow Semi Condensed + Barlow + IBM
Plex Mono, signature = tampon « USED · ADOBE STOCK ».
