# Upscales — Real-ESRGAN via GitHub Actions

Guide complet de la fonctionnalité « upscale » du projet : les images générées
(1K/2K) sont agrandies avec **Real-ESRGAN** par des jobs GitHub Actions,
uploadées sur **Cloudinary**, et enregistrées sur le document image dans
MongoDB (`upscales[]`). La webapp les affiche avec les actions
**Mark used / Download / Delete**.

```
 MongoDB (images)          GitHub Actions (ubuntu-latest)         Cloudinary
┌──────────────────┐      ┌───────────────────────────────┐     ┌─────────────┐
│ image            │      │ warmup : réveil API + plan    │     │ adobe-stock │
│  upscales: [ … ] │◄────┤ N jobs « worker » parallèles  │────►│  /upscales/ │
│  active/in_use/  │ POST │ claim → download → upscale    │ up │  <id>_x4_1  │
│  error_message   │      │  → upload → POST → release    │     └─────────────┘
└──────────────────┘      │ (tuiles aussi parallèles)    │
        ▲                 └───────────────────────────────┘
        │ PATCH (webapp : Active/Pause, dismiss erreur, Mark used, Delete)
┌──────────────────┐
│ webapp (Netlify) │  → preview Original / ×N, download (proxy API)
└──────────────────┘
```

---

## 1. Mise en place (une seule fois)

### 1.1 Secrets GitHub (Settings → Secrets and variables → Actions)

| Secret | Obligatoire | Valeur |
|---|---|---|
| `ASSET_API_URL` | ✅ | URL de l'API Render, ex. `https://adobe-stock-images-generator-api.onrender.com` |
| `ASSET_API_KEY` | ✅ | La clé de l'**agent** (la valeur de `API_KEY` sur Render — header `X-API-Key`) |
| `CLOUDINARY_CLOUD_NAME` | ✅ | Nom du cloud Cloudinary |
| `CLOUDINARY_API_KEY` | ✅ | Clé d'API Cloudinary (Settings → Access Keys) |
| `CLOUDINARY_API_SECRET` | ✅ | Secret d'API Cloudinary |
| `MAX_NUMBER_OF_UPSCALES_PER_IMAGE` | ⭕ | Nombre max d'upscales par image — **défaut 1** si absent |
| `DEFAULT_SCALE` | ⭕ | Facteur d'upscale par défaut — **défaut 4** si absent |

> ⭕ = optionnel : la valeur du secret sert de **défaut**, chaque exécution
> manuelle peut la surcharger via les inputs du workflow.

### 1.2 Variables d'API (Render) — optionnelles mais recommandées

| Variable | Défaut | Rôle |
|---|---|---|
| `MAX_UPSCALES_PER_IMAGE` | `10` | Plafond serveur : l'API refuse (409) un upscale au-delà. Le secret GitHub (1 par défaut) reste la politique métier. |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | *(vide)* | Si définis, **Delete** dans la webapp détruit AUSSI le fichier Cloudinary (hygiène de stockage). Sinon la suppression est purement base de données. |

### 1.3 Premier test

Actions → **Upscale — batch** → *Run workflow* → cocher `dry_run` : le job
liste les images éligibles sans rien upscaler (aucun secret Cloudinary
requis pour un dry-run). Décochez ensuite pour un vrai premier run.

---

## 2. Les deux workflows

### 2.1 `Upscale — batch` (`.github/workflows/upscale-batch.yml`) — **N jobs parallèles**

- **Quotidien à 08:00 Maroc** — cron `0 7 * * *` (UTC). Le Maroc est UTC+1
  toute l'année, sauf pendant le Ramadan où il passe à UTC+0 : le job
  s'exécute alors à 07:00 heure locale (GitHub Actions ne planifie qu'en UTC).
- Le workflow démarre par un job **`warmup`** qui (a) réveille l'API Render
  (ping `/health` jusqu'à 200, ~5 min max — sinon le run échoue avec un
  message explicite au lieu de 502 en cascade) et (b) calcule la liste des
  workers, puis lance **N jobs identiques en parallèle** (matrix, défaut **10**,
  1–20 via l'input `worker_count`) — repo public = minutes Actions illimitées.
- Chaque worker boucle : **réserver** une image éligible (upscales <
  `MAX_NUMBER_OF_UPSCALES_PER_IMAGE`, défaut 1, plus anciennes d'abord) via
  `POST /api/images/claim` — réservation **atomique** (`findOneAndUpdate`),
  deux workers ne peuvent JAMAIS prendre la même image — puis
  download → Real-ESRGAN → Cloudinary → `POST /api/images/:id/upscales` →
  `POST /api/images/:id/release`, et reprend la suivante jusqu'à ce que
  l'API réponde « rien à réclamer ». Débit total ≈ `max_images` **par worker**
  × `worker_count` images par run.
- `fail-fast: false` — l'échec (ou l'annulation) d'un worker n'arrête pas les autres.
- Exécution **manuelle** possible avec les inputs :

| Input | Rôle | Défaut |
|---|---|---|
| `worker_count` | nombre de jobs parallèles (1–20) | 10 |
| `max_upscales_per_image` | surcharge le secret | secret, sinon 1 |
| `scale` | facteur 2-8 | secret `DEFAULT_SCALE`, sinon 4 |
| `model` | `RealESRGAN_x4plus` \| `realesr-general-x4v3` \| `RealESRGAN_x2plus` | `RealESRGAN_x4plus` |
| `output_format` | **jpg** (prêt Adobe Stock, ~2-4 Mo) \| png (lossless, lourd) | `jpg` |
| `jpeg_quality` | qualité JPEG 80-100 (réduite auto si > limite) | 95 |
| `tile_workers` | processus par tuile Real-ESRGAN (auto = min(4, cœurs), résultat **bit-identique**) | auto |
| `max_images` | limite **par worker** (total ≈ × `worker_count`) | 5 |
| `dry_run` | lister sans traiter | false |

#### 2.1.1 Protocole claim / release (verrou optimiste)

Chaque tentative d'un worker se termine TOUJOURS par un `release` :

| Terminal | `release` | Effet sur l'image |
|---|---|---|
| succès | `ok` | `in_use:false` + `error_message` effacé |
| annulé / limite atteinte / image disparue | `stopped` | `in_use:false` (rien d'autre) |
| **échec dur** (Real-ESRGAN crashé, upload refusé, **lien source mort**, fichier vide) | `error` + message | `in_use:false` + **`active:false`** + `error_message` enregistré |

- Une image `active:false` est **exclue de toute réservation** : un lien mort
  ne sera pas retenté indéfiniment tous les matins. La webapp l'affiche
  (badge *inactive* + bannière d'erreur) et le propriétaire la **réactive**
  d'un clic une fois corrigée (bouton *Active/Paused* du détail).
- **Fenêtre stale (30 min)** : une réservation plus vieille que `stale_minutes`
  (défaut 30) est considérée morte (worker tué sans cleanup — cancel,
  SIGKILL, reboot) et redevient réclamable : aucune image ne peut rester
  verrouillée pour toujours.
- Un `SIGINT`/`SIGTERM` (bouton *Cancel workflow*) libère la réservation en
  cours avant de quitter (`ClaimGuard`), et la fenêtre stale couvre le pire cas.
- Les images créées avant la fonctionnalité n'ont pas les champs
  `active`/`in_use` → considérées **actives et libres** (requêtes `$ne`).

### 2.2 `Upscale — single image` (`.github/workflows/upscale-single.yml`)

Manuel uniquement. Inputs : `image_id` (requis, le `_id` MongoDB visible
dans le détail d'une image dans la webapp), `max_upscales`, `scale`,
`model`, `output_format`, `jpeg_quality`, `tile_workers`, `dry_run`.

Comportement (messages clairs dans les logs et le résumé) :

1. **Image introuvable** → `✖ IMAGE INTROUVABLE` + run rouge (exit 1) ;
2. **Nombre d'upscales ≥ max** → `🛑 STOP — l'image a déjà N upscale(s)…`
   + run **vert** (règle métier attendue, exit 0) ;
3. sinon : download → upscale → Cloudinary → enregistrement (exit 0),
   puis `release 'ok'` (efface un éventuel ancien `error_message`) ;
4. toute erreur → `release 'error'` (image mise en pause + message visible
   dans la webapp) + run rouge avec message précis.

---

## 3. Format de données — `upscales[]` sur le document image

Chaque variante est ajoutée par le job via `POST /api/images/:id/upscales` :

```jsonc
{
  "upscales": [
    {
      "_id": "68f2…",              // id de la variante (actions webapp)
      "url": "https://res.cloudinary.com/<cloud>/image/upload/…/…_x4_1.jpg",
      "public_id": "adobe-stock/upscales/<imageId>_x4_1",  // pour le delete Cloudinary
      "scale": 4,
      "model": "RealESRGAN_x4plus",
      "width": 4096, "height": 3072,
      "size_bytes": 8123456,
      "source": "github-actions",  // ou "manual"
      "run_id": "9876543210",      // run GitHub Actions (traçabilité)
      "used_in_adobe_stock": false, // Mark used par variante
      "created_at": "2026-09-04T07:00:31Z"
    }
  ]
}
```

Le « nombre d'upscales » d'une image = `upscales.length` (les images créées
avant la fonctionnalité n'ont pas de champ `upscales` → considéré comme 0).

Champs de coordination des workers parallèles (voir §2.1.1) :

```jsonc
{
  "active": true,        // false = exclue de toute réservation (échec dur)
  "in_use": false,       // true = réservée par un worker en ce moment
  "in_use_at": "…",      // date de réservation (fenêtre stale 30 min)
  "error_message": ""    // dernier message d'échec (bannière webapp)
}
```

(Images créées avant la fonctionnalité : champs absents = actives et libres.)

---

## 4. Endpoints API (auth `X-API-Key` ou `X-App-Password`)

| Méthode | Route | Rôle |
|---|---|---|
| `POST` | `/api/images/claim` | **Réservation atomique** d'une image éligible (upscales < max, `active`, pas déjà réservée — ou réservation stale) par le worker parallèle. Body : `max_upscales?`, `stale_minutes?` (défaut 30). Réponse `{ data: <image \| null>, claimed }` — `data: null` = rien à réclamer, le worker s'arrête |
| `POST` | `/api/images/:id/release` | **Fin de tentative** — body `{ status: "ok" \| "stopped" \| "error", error_message? }` (cf. §2.1.1). Idempotent (404 si l'image a disparu entre-temps) |
| `POST` | `/api/images/:id/upscales` | Enregistrer une variante (job GH). Body : `url`, `scale` (2-8), `model`, `public_id?`, `width?`, `height?`, `size_bytes?`, `source?`, `run_id?`, `max_upscales?` → **409 `UPSCALE_LIMIT_REACHED`** si le compte atteint la limite (celle du body, sinon `MAX_UPSCALES_PER_IMAGE`, plafond absolu 10) |
| `PATCH` | `/api/images/:id/upscales/:upscaleId` | « Mark used » d'une variante — body `{ "used_in_adobe_stock": true }` |
| `DELETE` | `/api/images/:id/upscales/:upscaleId` | Supprimer la variante (+ destruction Cloudinary si configurée — best effort, jamais bloquante) |
| `GET` | `/api/images/:id/upscales/:upscaleId/download` | Télécharger la variante (proxy serveur, nommage `<slug>_<id>_x4.png`) |

`PATCH /api/images/:id` accepte aussi les champs de coordination webapp :
`{ "active": true|false }` (réactiver/mettre en pause) et
`{ "error_message": "" }` (dismiss de la bannière d'erreur).

Filtres de listing ajoutés sur `GET /api/images` :

- `has_upscales=true|false` — avec / sans upscale (utilisé par la webapp) ;
- `upscales_lt=N` — images avec **moins de N** upscales (requête
  d'éligibilité du dry-run). Les deux sont mutuellement exclusifs (400 sinon) ;
- `active=true|false` — actives (y compris sans le champ) / en pause —
  filtre **Status** de la webapp ;
- `in_use=true|false` — réservées par un worker / libres.

---

## 5. Dans la webapp

- **Détail d'une image** : section *Upscales (n)* — chaque variante affiche
  ×scale, modèle, dimensions, taille, date, run, et les actions
  **View** (bascule la preview sur la variante), **Download** (proxy),
  **Cloudinary** (lien direct), **Mark used** (tampon par variante),
  **Delete** (confirmation — l'original n'est jamais touché).
- Le sélecteur de variantes sous la preview permet de basculer
  **Original / ×4 / ×2…** ; le tampon affiché correspond à la variante vue.
- **Grille** : chip orange `×n` sur les cartes ayant des upscales ; filtres
  *Upscales* (With / Without) et **Status** (Active / Paused (failed)) sur la
  page Images — ce dernier retrouve rapidement les images en échec.
- **Statut des workers parallèles** :
  - cartes : badge **`upscaling`** (réservée par un worker en ce moment),
    badge **`inactive`** (en pause) + chip rouge **`error`** (erreur enregistrée) ;
  - détail : **bannière rouge « Last upscale error »** avec le message complet,
    bouton **Copy** et **Dismiss** ; bouton **Active / Paused** pour
    réactiver ou mettre en pause une image ; ligne « claimed by an upscale
    worker » pendant une réservation.

---

## 6. Modèles Real-ESRGAN

| Modèle | Usage | Vitesse (CPU 2 cœurs, ~1,5 MP) |
|---|---|---|
| `RealESRGAN_x4plus` | photo / défaut du projet | ~2-4 min (×4) |
| `RealESRGAN_x2plus` | ×2 natif, plus rapide | ~1-2 min (×2) |
| `realesr-general-x4v3` | compact, compromis vitesse/qualité | ~30-60 s (×4) |

Notes techniques :

- **CPU uniquement** — les runners GitHub standards n'ont pas de GPU ;
  PyTorch est installé via les wheels CPU (`--extra-index-url …/whl/cpu`).
- Le **tuilage** (`tile=512`) borne la mémoire.
- **Tuiles PARALLÈLES (`UPSCALE_TILE_WORKERS` / `--tile-workers`, défaut
  `auto` = min(4, cœurs))** : les tuiles Real-ESRGAN d'une même image sont
  distribuées sur N processus (1 thread torch chacun = N cœurs exactement).
  Le résultat est **bit-à-bit identique** au traitement séquentiel — le code
  réplique mathématiquement le `tile_process` de realesrgan 0.3.0 (chaque
  tuile écrit une région **disjointe** de la sortie, sans fusion), validé par
  un test de hash sur 2 modèles (compact ×4 + RRDBNet ×2 avec mod-pad).
  Sur les runners 4 vCPU des repos publics, c'est ~1,3-2× plus rapide par
  image ; combiné aux N jobs du batch, le débit global est ~N×.
- **Format de sortie : JPEG par défaut** (voir §6bis) ; png disponible via
  `--output-format png` / input `output_format` (lossless, lourd). L'alpha est
  ignoré.
- `public_id` déterministe `<imageId>_x<scale>_<index>` + `overwrite=true`
  → un re-run après échec partiel reprend proprement (idempotent).
- Poids des modèles mis en **cache** (`~/.cache/upscale-models`, ~65 Mo).
- **Logs heartbeat** — pendant chaque phase longue et silencieuse (réveil de
  l'API, téléchargement/chargement du modèle, upscale, upload), un timer
  `⏱ hh:mm:ss` s'imprime toutes les 5 s (`HEARTBEAT_SECONDS` pour changer
  l'intervalle). Un run de 10+ min sans aucune sortie ressemble à un hang :
  ces lignes prouvent que le job vit et permettent de suivre l'avancement —
  indispensable pour RealESRGAN ×4 qui met ~2 min par tuile sans log.
- **Réveil automatique de l'API** — le job commence par `wait_until_ready()` :
  le service Render (plan gratuit) est mis en pause après inactivité ; chaque
  tentative de réveil est logguée (`· réveil de l'API…`, `✓ API prête`),
  jusqu'à 5 min. Le **téléchargement d'une image** retente aussi 2× un 502
  avec 20 s de pause (la SOURCE de l'image — souvent un autre service Render
  — peut elle aussi être en train de se réveiller) avant de déclarer le lien
  réellement mort.

---

## 6bis. Limite de 10 Mo par fichier Cloudinary — politique JPEG

Le plan gratuit Cloudinary **plafonne chaque fichier image à 10 Mo**. Un ×4
PNG lossless (ex. 3456×6144) dépasse facilement cette limite (~20 Mo), et
l'upload échoue avec `File size too large. Got 19709928. Maximum is 10485760.`
Ce n'est PAS contournable côté transport : l'upload par morceaux
(`upload_chunked`/`upload_large`) ne s'applique pas aux images sur ce plan et
la limite est appliquée côté serveur de toute façon.

La bonne réponse est **le format, pas la réduction** :

- les soumissions photo **Adobe Stock sont de toute façon des JPEG** (le PNG
  ne sert que pour les illustrations/vecteurs) ;
- un JPEG qualité 95 aux **mêmes dimensions** (3456×6144) pèse ~2-4 Mo ;
- aucun pixel n'est perdu : **seule la compression change, jamais la taille**.

Politique appliquée par le job :

1. sortie **JPEG qualité 95** par défaut (`--output-format jpg`,
   `UPSCALE_JPEG_QUALITY`, input de workflow `jpeg_quality`) ;
2. si le JPEG dépasse quand même la limite (`CLOUDINARY_MAX_UPLOAD_BYTES`,
   défaut 10 Mo − 0,5 Mo de marge), la qualité est **baissée automatiquement
   par pas de 5** (95 → 90 → 85 → 80) avec un log à chaque ré-encodage ;
3. si même en qualité 80 la limite explose (cas extrême) → message d'erreur
   clair avec les options (réduire `--scale`, ou changer d'hébergement) ;
4. `--output-format png` reste possible pour un besoin lossless explicite —
   si le PNG dépasse la limite, l'erreur explique pourquoi le JPEG est le bon
   choix ici.

> Alternatives si vous voulez un jour stocker des lossless géants :
> Cloudflare R2 (10 Go gratuits, pas de limite par fichier), Backblaze B2,
> ou un plan payant Cloudinary. Le plan gratuit Actions/Render/Cloudinary
> actuel couvre bien le flux JPEG.

---

## 7. Gestion des erreurs & codes de sortie

| Situation | Comportement | Run |
|---|---|---|
| Secrets manquants / mauvais | message listant exactement ce qui manque | ❌ exit 1 |
| 401 API | « vérifiez le secret ASSET_API_KEY (clé de l'agent) » | ❌ exit 1 |
| **API en pause (Render)** | réveil automatique (5 min max, une ligne par tentative) | ✅ ou ❌ après 5 min |
| API injoignable | « vérifiez ASSET_API_URL… ouvrez l'URL dans un navigateur » | ❌ exit 1 |
| Image introuvable (single) | message + piste de vérification | ❌ exit 1 |
| **502 à la source (service qui se réveille)** | 2 retry espacés de 20 s, puis « ⏭️ ignorée » seulement si vraiment morte | ✅ (comptée ignorée) |
| Lien source mort (éphémère) | « ⏭️ ignorée — lien expiré » + **image mise en pause** (`active:false` + `error_message`) — visible dans la webapp, réactivable d'un clic | ✅ (comptée ignorée) |
| **Fichier > limite Cloudinary (10 Mo)** | JPEG re-encodé qualité 95→80 automatiquement ; sinon message clair | ❌ exit 1 (rare) |
| Limite d'upscales atteinte | « 🛑 STOP — déjà N upscales, max M » | ✅ exit 0 |
| Échec d'une image (batch) | message + résumé ; **image mise en pause** (`active:false` + `error_message` visible webapp) ; les autres workers continuent (`fail-fast: false`) | ❌ exit 1 |
| Worker annulé (bouton Cancel) | réservation en cours libérée (`release stopped`), les autres workers continuent | ✅/❌ annulé |
| Rien à traiter | « ✓ aucune image éligible » | ✅ exit 0 |

Le **résumé du job** (table Markdown dans l'onglet Summary) liste chaque
image : statut, échelle, dimensions, taille et lien Cloudinary.

---

## 8. Quota GitHub Actions

**Repo public (le cas ici) : minutes illimitées** — c'est ce qui rend les
N jobs parallèles gratuits. Un run à 10 workers × ~10 min = ~100 min de
runner en même temps, sans impact sur un quota.

Repo privé (plan gratuit) : **2000 min/mois** — l'addition monte vite avec
le parallélisme (N workers × durée). Ajustements : baisser `worker_count`,
`max_images`, utiliser le modèle compact `realesr-general-x4v3` ou `scale=2`.

---

## 9. Exécution locale (sans GitHub)

> ⚠️ **Python ≤ 3.12 requis** : `basicsr 1.4.2` (sdist) utilise un idiome
> `exec()`+`locals()` dans son setup.py que Python 3.13 a cassé (PEP 667 —
> `KeyError: '__version__'`). Les workflows GitHub utilisent Python 3.11.

```bash
# 1. API locale + données de démo
cd api && npm run seed-demo          # API sur :3333, clé demo-agent-key

# 2. dry-run (aucune clé Cloudinary requise)
cd ../scripts/upscale
pip install -r requirements.txt       # ou votre venv (Python ≤ 3.12)
python3 batch.py --api-url http://localhost:3333 --api-key demo-agent-key --dry-run

# 3. vrai run (nécessite les variables d'env Cloudinary + API)
CLOUDINARY_CLOUD_NAME=… CLOUDINARY_API_KEY=… CLOUDINARY_API_SECRET=… \
  python3 single.py --image-id <id> --api-url http://localhost:3333 --api-key demo-agent-key
```

---

## 10. Limites connues

- **Liens éphémères** : une image dont `image_link` pointe vers le serveur
  de génération (`/files/…`) devient inupscalable après un redémarrage de
  ce serveur — le job la signale « ignorée (lien source mort) ». Les images
  avec URL Cloudinary restent toujours éligibles.
- **Concurrence** : les N workers parallèles ne peuvent PAS traiter la même
  image (réservation atomique `POST /api/images/claim`) ; un run batch et un
  run single simultanés sur la même image restent protégés par la vérification
  serveur (409 → « ignorée/stop »).
- **Qualité** : Real-ESRGAN ×4 sur du 1K donne ~4096 px — au-dessus du
  minimum Adobe Stock (4 MP). Un upscale n'ajoute pas de détail réel,
  il agrandit : privilégiez des générations 2K quand c'est possible.
