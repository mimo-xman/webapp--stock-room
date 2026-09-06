# ── Stock Room ──

**Stock Room** est le hub de dispatch des images générées par IA : un **agent IA** reçoit une
mission (batch Adobe Stock, coloring book Etsy, visuels d'événement Instagram, scènes d'une
vidéo, créations publicitaires…), génère les images via l'API
[Zazo Image Studio](https://github.com/mimo-xman/webapp--zazo-image-studio),
et enregistre chaque asset (image + métadonnées) dans une base de données, **une Session par
mission**. Le propriétaire gère ensuite le tout depuis une webapp protégée par mot de passe.

> Historique : le projet s'appelait *Adobe Stock — Images Generator by agents* car la
> première mission était la production d'images pour Adobe Stock. Le nom a changé quand les
> missions se sont multipliées (Etsy, Redbubble, Instagram, pubs, scènes vidéo…) : Stock Room
> est **agnostique de la plateforme**. Les repos GitHub sont renommés
> (`webapp--stock-room` et `webapp--zazo-image-studio`) — les anciennes URLs redirigent
> automatiquement.

```
┌─────────────┐   1. agent prompt (mission)    ┌──────────────┐
│  AI Agent   │ ────────────────────────────► │  Toi (owner) │  tu colles le prompt rempli
└──────┬──────┘                               └──────────────┘
       │ 2. recherche web (règles + demande de la plateforme cible)
       │ 3. POST /generate
       ▼
┌──────────────────┐  image URL   ┌─────────────────────────────────┐
│ Zazo Image Studio│ ───────────► │  Stock Room API  (Render)       │
│  (Render, Tor)   │              │  Sessions → Images (MongoDB)    │
└──────────────────┘              └───────────────┬─────────────────┘
                                                  │ 4. lecture/édition
                                                  ▼
                                        ┌──────────────────┐
                                        │ WebApp (Cloudflare│  mot de passe (APP_PASSWORD)
                                        │ Workers + Netlify)│  pagination/filtres backend
                                        └──────────────────┘

                                        ┌─────────────────────────────────┐
                                        │  GitHub Actions (quotidien 08:00 │
                                        │  Maroc) — Real-ESRGAN upscales  │
                                        │  → Cloudinary → upscales[]       │
                                        └─────────────────────────────────┘
```

## Les missions = des agent prompts

Chaque type de mission a son prompt prêt à envoyer, dans [`prompts/`](prompts/) (l'index
détaillé est dans [`AGENT_PROMPT.md`](AGENT_PROMPT.md)) :

| Prompt | Mission | Variable spécifique |
|---|---|---|
| [`prompts/main.md`](prompts/main.md) | **Universel** — explique les deux APIs + la structure Session → Images ; tu décris la mission (n'importe quoi : visuels Instagram, scènes vidéo, pubs…) | `[MISSION BRIEF]` |
| [`prompts/adobe-stock.md`](prompts/adobe-stock.md) | Batch **Adobe Stock** — règles dures (aucun être vivant, aucun visage/partie du corps), recherche live des règles, métadonnées prêtes à l'upload | `[NUMBER OF PROMPTS TO CREATE]` |
| [`prompts/coloring-book-etsy.md`](prompts/coloring-book-etsy.md) | **Coloring book Etsy** — pages line-art pour enfants + couverture, règles Etsy recherchées live, print-ready | `[BOOK THEME]`, `[NUMBER OF COLORING PAGES]` |

La webapp (page **Agent prompts**) remplie, valide et exporte ces prompts — les six variables
de connexion (les 2 URLs + 2 clés + 2 repos) sont partagées entre tous les prompts et
sauvegardées une fois pour toutes dans le navigateur. Ajouter un 4ᵉ prompt = un fichier
`.md` dans `prompts/` + une entrée dans `web/src/lib/prompts.ts`.

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
| `web/` | WebApp Next.js 16 (password gate, pages Sessions/Images, tampon « Used », copy icons, modales custom, **navigation prev/next en boucle dans le détail**, **affichage des upscales**, **export CSV Adobe Stock**, **statut batch**, **page « Agent prompts »** : switcher multi-prompts + variables partagées + validation → prompt généré copiable/téléchargeable en .md, **jeu d'icônes complet** : `icon.svg` + `apple-icon.png` + `favicon.ico` « SR ») | **Cloudflare Workers** (ou Netlify) |
| `prompts/` | **Les prompts réutilisables** à donner à l'agent — un `.md` par type de mission (variables à remplacer + partie sous la ligne ✂ CUT) | — |
| `AGENT_PROMPT.md` | Index des prompts + mode d'emploi | — |
| `.github/workflows/` | **Jobs d'upscale Real-ESRGAN** : batch quotidien 08:00 Maroc + job manuel image unique (réveil auto de l'API Render, logs heartbeat, sortie JPEG prête à vendre) | **GitHub Actions** |
| `scripts/upscale/` | Scripts Python partagés des jobs (API client, Cloudinary, Real-ESRGAN) | — |
| `scripts/gen-prompt-template.py` | Régénère les fallbacks bundlés de la page « Agent prompts » (`web/src/lib/prompt-templates/`) depuis `prompts/*.md` — à lancer après chaque édition d'un prompt | — |

## Déploiement

### 1. Base de données — MongoDB Atlas (gratuit)

1. Crée un cluster M0 sur [mongodb.com/atlas](https://www.mongodb.com/atlas).
2. Database Access : un utilisateur + mot de passe.
3. Network Access : `0.0.0.0/0` (Render n'a pas d'IP fixe en free tier).
4. Récupère l'URI : `mongodb+srv://<user>:<pass>@<cluster>/?retryWrites=true&w=majority`
   (lien seul — le nom de la base se règle à part via `MONGO_DB_NAME`, défaut `adobe-stock`
   *conservé pour ne pas perdre les données existantes* ; mets `stock-room` pour repartir
   d'une base neuve).

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
| `CORS_ORIGINS` | l'URL de la webapp (ex. `https://stock-room.<ton-compte>.workers.dev` ou l'URL Netlify) — ou `*` |

Après déploiement : `https://<service>.onrender.com/` affiche la page de docs de l'API.

### 3. WebApp — Cloudflare Workers (recommandé)

#### ⚠️ La règle d'or — les trois noms identiques

La webapp tourne sur Workers via l'adaptateur officiel
[@opennextjs/cloudflare](https://opennext.js.org/cloudflare/get-started). Ce Worker doit
posséder un **service binding `WORKER_SELF_REFERENCE` vers lui-même** (déjà déclaré dans
`web/wrangler.jsonc`), et Cloudflare exige que le nom référencé existe dans ton compte.
Les **trois noms suivants doivent donc être strictement identiques** — c'est déjà le cas
dans ce repo, il suffit de créer le Worker avec le bon nom :

| Où | Nom |
|---|---|
| `web/wrangler.jsonc` → `"name"` **et** `"services[0].service"` | `stock-room` |
| `web/package.json` → `"name"` | `stock-room` |
| Worker créé dans le dashboard Cloudflare | `stock-room` |

Si un seul diffère, le déploiement échoue avec
`Service binding 'WORKER_SELF_REFERENCE' references Worker '…' which was not found [code: 10143]`.
C'est la cause exacte des erreurs de déploiement passées : sans section `services` dans le
`wrangler.jsonc`, l'adaptateur OpenNext **génère le binding tout seul à partir du `name` du
`package.json`** — qui ne matchait pas le nom du Worker réellement déployé. Le binding est
maintenant **déclaré explicitement** dans le repo : le nom ne peut plus dériver. Si tu veux
un autre nom que `stock-room`, change-le aux **trois endroits** en même temps.

#### Étapes (dashboard Cloudflare)

1. *Workers & Pages → Create → Workers → Import a repository* — **nomme le Worker
   exactement `stock-room`** (les Workers ne peuvent pas être renommés ensuite).
2. Repo : ce dépôt, production branch `main`.
3. Build configuration :
   - **Root directory : `web`**
   - **Build command : `npm run build`**
   - **Deploy command : `npm run deploy`** (= `opennextjs-cloudflare build && wrangler deploy`)

   ⚠️ **Écris-le exactement comme ça.** `npx run deploy` **n'existe pas** (`npx` exécute un
   binaire, `run` est une sous-commande de `npm`) et fait échouer le déploiement avec
   `npm error could not determine executable to run` — après un build pourtant réussi.
   Deux réglages équivalents et sûrs, au choix :

   | Réglage | Build command | Deploy command |
   |---|---|---|
   | **Recommandé** (un seul build) | `npx opennextjs-cloudflare build` | `npx wrangler deploy` *(valeur par défaut — laisse le champ vide)* |
   | **Simple** | `npm run build` | `npm run deploy` *(refait un build OpenNext complet : ~30 s de plus)* |

   Note : `npm run build` reste volontairement `next build` — l'adaptateur OpenNext
   l'appelle en interne pendant `opennextjs-cloudflare build` ; ne le remplace jamais
   par `opennextjs-cloudflare build` (récursion infinie).
4. Variable d'environnement (Settings → Variables and Secrets, ou *Build → Variables*) :

   | Variable | Valeur |
   |---|---|
   | `NEXT_PUBLIC_API_URL` | `https://<service-render>.onrender.com` |

   (inlinée à la compilation : un `NEXT_PUBLIC_*` est figé au build, changer la variable
   nécessite un **re-déploiement**, pas juste un redémarrage)
5. *Save and deploy*.

Les fichiers de déploiement **requis** (tous présents) : `web/wrangler.jsonc` (nom +
main `.open-next/worker.js` + assets + binding), `web/open-next.config.ts` (adaptateur),
`web/public/_headers` (cache statique). Sans eux le build échoue (10143 / « Missing
entry-point » / « No open-next.config.ts file was found ») ; `@opennextjs/cloudflare` et
`wrangler` sont en devDependencies et le lock est synchronisé.

Depuis un terminal : `cd web && npm run deploy` (après `npx wrangler login`).
`npm run preview` sert l'app dans le runtime workerd local.

#### Alternative : Netlify

`web/netlify.toml` reste supporté : *Add new site → Import project → Base directory `web`*,
variable `NEXT_PUBLIC_API_URL` comme ci-dessus. Les deux cibles cohabitent — déploie sur
l'une ou l'autre (ou les deux), la webapp est identique.

### 4. Utilisation

Choisis le prompt de ta mission dans `prompts/` (ou la page **Agent prompts** de la webapp —
elle pré-remplit les variables de connexion). Remplace la variable spécifique
(nombre d'images, mission, thème du book…) et envoie-le à ton agent. Il fait tout :
recherche des règles de la plateforme cible + de la demande → **anti-doublons
(`GET /api/images/all` — il vérifie la librairie existante avant de générer)** → prompts →
génération via Zazo Image Studio → **contrôle visuel** → session → enregistrement → rapport.
La webapp te permet ensuite de parcourir, trier, filtrer, copier les métadonnées, télécharger
les images, marquer ce qui a été uploadé sur la plateforme cible (tampon vert), et **générer
le CSV d'upload Adobe Stock** pour un lot sélectionné.

### 5. Upscales — Real-ESRGAN via GitHub Actions

Les images générées en 1K/2K sont agrandies (×2/×4) par **Real-ESRGAN** dans deux workflows :

- **`Upscale — batch`** — tous les jours à **08:00 Maroc**, en **N jobs parallèles**
  (matrix, défaut **10**, input `worker_count` — repo public = Actions illimitées) :
  un job `warmup` réveille d'abord l'API Render, puis chaque worker boucle :
  **réserver atomiquement** une image éligible (upscales <
  `MAX_NUMBER_OF_UPSCALES_PER_IMAGE`, secret, **défaut 1** ; `POST /api/images/claim` —
  deux workers ne peuvent jamais prendre la même image) → download → upscale
  → **upload Cloudinary** → enregistrement (`upscales[]`) → `release`, et reprend
  la suivante jusqu'à épuisement. Une image en échec dur (ex. lien source mort) est
  mise en pause (`active:false` + `error_message`) et **réactivable d'un clic dans la
  webapp** ; une réservation orpheline (worker tué) se libère toute seule après 30 min.
  Les **tuiles Real-ESRGAN sont aussi parallélisées** (input `tile_workers`, défaut
  auto = 1/cœur, max 4 — résultat **bit-à-bit identique** au traitement séquentiel,
  vérifié par test de hash).
- **`Upscale — single image`** — manuel : prend un `image_id` en input, vérifie qu'il existe
  (message clair sinon), vérifie le nombre d'upscales < max (stop propre sinon), puis traite
  (même sémantique release : succès efface l'erreur, échec met l'image en pause).

Dans la webapp : section *Upscales* dans le détail d'une image — preview commutable
Original/×N et actions **Mark used / Download / Delete** par variante, chip `×n` sur les
cartes, filtre « With/Without upscales ». **Statut des workers** : badges `upscaling` /
`inactive` + chip `error` sur les cartes, bannière d'erreur avec **Dismiss**, bouton
**Active/Paused** et filtre Status (Active / Paused (failed)) sur la page Images.

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

## Règles métier absolues — mission Adobe Stock

Ces règles ne s'appliquent **qu'au prompt Adobe Stock** (chaque prompt porte ses propres
règles — le coloring book Etsy, par exemple, exige des animaux mignons, donc PAS de règle
« aucun être vivant »).

**1 — Aucun être vivant dans les images générées** (ni humains, ni animaux — silhouettes,
illustrations et ombres incluses ; plantes/fleurs autorisées).

**2 — Aucun visage ni partie du corps, même sur un objet non vivant (zéro tolérance).**
Cas réels déjà rejetés : citrouilles **jack-o'-lantern** (visage sculpté — yeux, nez, bouche).
Même sanction pour : statues/bustes/mannequins/robots/jouets avec visage, masques, crânes,
mains, pieds, empreintes, yeux/bouches en gros plan, pareidolia (nuages, nœuds de bois,
cailloux « qui ressemblent à un visage »), motifs façon visage dans les textures/abstrait.
Tout ce qu'un regard peut identifier comme visage ou partie du corps est refusé — même sans
aucun être vivant dans l'image.

**3 — Conformité Adobe Stock à jour (images destinées à la vente).** L'agent ne mémorise pas
les règles : à chaque run, il **cherche sur le web les règles officielles actuelles**
("Adobe Stock content requirements", "submission guidelines", politique contenus IA) et les
applique par-dessus les HARD RULES. Recherche impossible → comportement conservateur +
signalement dans le rapport.

Ces règles sont inscrites en dur dans `prompts/adobe-stock.md` (HARD RULES n°1–3), complétées par
un **contrôle visuel obligatoire de chaque image générée avant enregistrement** (STEP 4) —
toute image non conforme n'est pas sauvegardée, pas comptée, et remplacée.

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
- Validation zod systématique (catégorie parmi les 21, keywords 3–50, URL http(s)…).
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
  sur Zazo Image Studio et vérifie dans ses logs Render l'absence de `cloudinary upload failed`.
- Quota journalier easemate (code `6101`) : l'API de génération retry avec rotation d'IP Tor ;
  si toutes les tentatives échouent, attends quelques heures (reset quotidien).
- La webapp n'édite **pas** les sessions (par design : seul le champ *Images* est modifiable —
  marquage « used » + édition complète des métadonnées d'une image).

## Stack

API : Node 18+, Express 4, Mongoose 8, zod 3, express-rate-limit 7, helmet 8, cloudinary 2
(destroy optionnel).
WebApp : Next.js 16 (App Router), TypeScript, Tailwind CSS 4, shadcn/ui, Radix, lucide-react.
Upscales : GitHub Actions + Python (PyTorch CPU, Real-ESRGAN, cloudinary-py).
Design : « Stock Room » — papier/encre/orange sécurité, Barlow Semi Condensed + Barlow + IBM
Plex Mono, signature = tampon « USED » + plaque « SR » inclinée (aussi icon.svg +
apple-icon.png + favicon.ico, régénérables via `scripts/gen-app-icons.py`).
