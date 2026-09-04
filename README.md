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

                                        ┌─────────────────────────────────┐
                                        │  GitHub Actions (quotidien 08:00 │
                                        │  Maroc) — Real-ESRGAN upscales  │
                                        │  → Cloudinary → upscales[]       │
                                        └─────────────────────────────────┘
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
| `api/` | API Node.js + Express + Mongoose (Sessions/Images, auth double, validation zod, rate limit, pagination/search/filter/sort backend, proxy download, cascade delete, **upscales** : endpoints + filtres + cap serveur, **`GET /api/images/all`** : toute la librairie en un appel pour l'anti-doublons de l'agent) | **Render** (runtime Node) |
| `web/` | WebApp Next.js 16 (password gate, pages Sessions/Images, tampon « Used · Adobe Stock », copy icons, modales custom, **affichage des upscales** : preview Original/×N, Mark used / Download / Delete, **export CSV Adobe Stock** : sélection multi-pages originaux + upscales → fichier `Filename,Title,Keywords,Category` téléchargeable) | **Netlify** |
| `AGENT_PROMPT.md` | **Le prompt réutilisable** à donner à l'agent (variables à remplacer + prompt Lyra inclus verbatim) | — |
| `.github/workflows/` | **Jobs d'upscale Real-ESRGAN** : batch quotidien 08:00 Maroc + job manuel image unique (réveil auto de l'API Render, logs heartbeat, sortie JPEG prête Adobe Stock) | **GitHub Actions** |
| `scripts/upscale/` | Scripts Python partagés des jobs (API client, Cloudinary, Real-ESRGAN) | — |

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
clés, liens des repos), et envoie-le à ton agent. Il fait tout : recherche → **anti-doublons
(`GET /api/images/all` — il vérifie la librairie existante avant de générer)** → prompts
(Lyra) → génération → session → enregistrement → rapport. La webapp te permet ensuite de
parcourir, trier, filtrer, copier les métadonnées (titre / catégorie / keywords), télécharger
les images, marquer ce qui a été uploadé sur Adobe Stock (tampon vert), et **générer le CSV
d'upload Adobe Stock** pour un lot sélectionné.

### 5. Upscales — Real-ESRGAN via GitHub Actions

Les images générées en 1K/2K sont agrandies (×2/×4) par **Real-ESRGAN** dans deux workflows :

- **`Upscale — batch`** — tous les jours à **08:00 Maroc** : prend toutes les images dont le
  nombre d'upscales est **<** `MAX_NUMBER_OF_UPSCALES_PER_IMAGE` (secret, **défaut 1**),
  les plus anciennes d'abord, puis download → upscale → **upload Cloudinary** →
  enregistrement sur l'image (`upscales[]` : url, datetime, scale, modèle, dimensions,
  taille, run id). Exécution manuelle possible avec les mêmes inputs surchargeant les secrets.
- **`Upscale — single image`** — manuel : prend un `image_id` en input, vérifie qu'il existe
  (message clair sinon), vérifie le nombre d'upscales < max (stop propre sinon), puis traite.

Dans la webapp : section *Upscales* dans le détail d'une image — preview commutable
Original/×N et actions **Mark used / Download / Delete** par variante, chip `×n` sur les
cartes, filtre « With/Without upscales ».

Détails opérationnels : le job **réveille l'API Render** si elle est en pause (retry 5 min),
imprime un **timer `⏱ hh:mm:ss` toutes les 5 s** pendant les phases silencieuses (chargement
du modèle, upscale, upload), sort en **JPEG qualité 95 par défaut** (mêmes dimensions, ~2-4 Mo,
sous la limite Cloudinary de 10 Mo — la qualité est baissée automatiquement si nécessaire) et
retente 2× un 502 de téléchargement (service source en cours de réveil) avant de déclarer un
lien mort.

➡️ **Guide complet (secrets, inputs, formats, erreurs, quota) : [`docs/UPSCALE.md`](docs/UPSCALE.md)**

### 6. Export CSV Adobe Stock (webapp)

Sur les pages *Images* et *Session* : sélectionne les assets voulus — **originaux et/ou leurs
upscales** — via les checkboxes (carte = original ; détail = original + chaque variante).
La sélection **survit aux changements de pages/filtres** (barre flottante en bas), puis le
bouton **Download CSV** génère le fichier `Filename,Title,Keywords,Category` exactement au
format de l'upload par CSV d'Adobe Stock (catégorie = code numérique 1-21, filename = basename
de l'URL de l'asset, keywords cités, doublons de noms renommés automatiquement). Les upscales
exportées réutilisent les métadonnées de leur image d'origine.

➡️ **Détails + table des catégories : [`docs/CSV_EXPORT.md`](docs/CSV_EXPORT.md)**

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

# Tests E2E de l'API (90 assertions)
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

- **Upscales & liens éphémères** : le job d'upscale télécharge l'originale via le proxy de
  l'API — une image dont le lien serveur a expiré (spin-down) est ignorée avec un message
  clair ; une image avec URL Cloudinary reste toujours éligible. Voir
  [`docs/UPSCALE.md`](docs/UPSCALE.md) § 10.
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

API : Node 18+, Express 4, Mongoose 8, zod 3, express-rate-limit 7, helmet 8, cloudinary 2
(destroy optionnel).
WebApp : Next.js 16 (App Router), TypeScript, Tailwind CSS 4, shadcn/ui, Radix, lucide-react.
Upscales : GitHub Actions + Python (PyTorch CPU, Real-ESRGAN, cloudinary-py).
Design : « Stockroom » — papier/encre/orange sécurité, Barlow Semi Condensed + Barlow + IBM
Plex Mono, signature = tampon « USED · ADOBE STOCK ».
