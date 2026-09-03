# Upscales — Real-ESRGAN via GitHub Actions

Guide complet de la fonctionnalité « upscale » du projet : les images générées
(1K/2K) sont agrandies avec **Real-ESRGAN** par des jobs GitHub Actions,
uploadées sur **Cloudinary**, et enregistrées sur le document image dans
MongoDB (`upscales[]`). La webapp les affiche avec les actions
**Mark used / Download / Delete**.

```
 MongoDB (images)          GitHub Actions (ubuntu-latest)         Cloudinary
┌──────────────────┐      ┌───────────────────────────────┐     ┌─────────────┐
│ image            │      │ upscale-batch.yml (08:00 Maroc)│     │ adobe-stock │
│  upscales: [ … ] │◄─────┤ 1. images éligibles            │────►│  /upscales/ │
│  (url, scale,    │ POST │ 2. download (proxy API)        │ up  │  <id>_x4_1  │
│   model, date…)  │      │ 3. Real-ESRGAN ×2/×4           │     └─────────────┘
└──────────────────┘      │ 4. upload Cloudinary           │
        ▲                 └───────────────────────────────┘
        │ PATCH/DELETE (webapp : Mark used / Delete)
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

### 2.1 `Upscale — batch` (`.github/workflows/upscale-batch.yml`)

- **Quotidien à 08:00 Maroc** — cron `0 7 * * *` (UTC). Le Maroc est UTC+1
  toute l'année, sauf pendant le Ramadan où il passe à UTC+0 : le job
  s'exécute alors à 07:00 heure locale (GitHub Actions ne planifie qu'en UTC).
- Prend **toutes** les images dont le nombre d'upscales **<**
  `MAX_NUMBER_OF_UPSCALES_PER_IMAGE` (défaut 1), **plus anciennes d'abord**
  (progression déterministe du backlog), plafonnées à `max_images` (défaut 5).
- Exécution **manuelle** possible avec les inputs :

| Input | Rôle | Défaut |
|---|---|---|
| `max_upscales_per_image` | surcharge le secret | secret, sinon 1 |
| `scale` | facteur 2-8 | secret `DEFAULT_SCALE`, sinon 4 |
| `model` | `RealESRGAN_x4plus` \| `realesr-general-x4v3` \| `RealESRGAN_x2plus` | `RealESRGAN_x4plus` |
| `max_images` | limite du run (quota Actions) | 5 |
| `dry_run` | lister sans traiter | false |

### 2.2 `Upscale — single image` (`.github/workflows/upscale-single.yml`)

Manuel uniquement. Inputs : `image_id` (requis, le `_id` MongoDB visible
dans le détail d'une image dans la webapp), `max_upscales`, `scale`,
`model`, `dry_run`.

Comportement (messages clairs dans les logs et le résumé) :

1. **Image introuvable** → `✖ IMAGE INTROUVABLE` + run rouge (exit 1) ;
2. **Nombre d'upscales ≥ max** → `🛑 STOP — l'image a déjà N upscale(s)…`
   + run **vert** (règle métier attendue, exit 0) ;
3. sinon : download → upscale → Cloudinary → enregistrement (exit 0) ;
   toute erreur → run rouge avec message précis.

---

## 3. Format de données — `upscales[]` sur le document image

Chaque variante est ajoutée par le job via `POST /api/images/:id/upscales` :

```jsonc
{
  "upscales": [
    {
      "_id": "68f2…",              // id de la variante (actions webapp)
      "url": "https://res.cloudinary.com/<cloud>/image/upload/…/…_x4_1.png",
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

---

## 4. Endpoints API (auth `X-API-Key` ou `X-App-Password`)

| Méthode | Route | Rôle |
|---|---|---|
| `POST` | `/api/images/:id/upscales` | Enregistrer une variante (job GH). Body : `url`, `scale` (2-8), `model`, `public_id?`, `width?`, `height?`, `size_bytes?`, `source?`, `run_id?`, `max_upscales?` → **409 `UPSCALE_LIMIT_REACHED`** si le compte atteint la limite (celle du body, sinon `MAX_UPSCALES_PER_IMAGE`, plafond absolu 10) |
| `PATCH` | `/api/images/:id/upscales/:upscaleId` | « Mark used » d'une variante — body `{ "used_in_adobe_stock": true }` |
| `DELETE` | `/api/images/:id/upscales/:upscaleId` | Supprimer la variante (+ destruction Cloudinary si configurée — best effort, jamais bloquante) |
| `GET` | `/api/images/:id/upscales/:upscaleId/download` | Télécharger la variante (proxy serveur, nommage `<slug>_<id>_x4.png`) |

Filtres de listing ajoutés sur `GET /api/images` :

- `has_upscales=true|false` — avec / sans upscale (utilisé par la webapp) ;
- `upscales_lt=N` — images avec **moins de N** upscales (requête
  d'éligibilité du batch). Les deux sont mutuellement exclusifs (400 sinon).

---

## 5. Dans la webapp

- **Détail d'une image** : section *Upscales (n)* — chaque variante affiche
  ×scale, modèle, dimensions, taille, date, run, et les actions
  **View** (bascule la preview sur la variante), **Download** (proxy),
  **Cloudinary** (lien direct), **Mark used** (tampon par variante),
  **Delete** (confirmation — l'original n'est jamais touché).
- Le sélecteur de variantes sous la preview permet de basculer
  **Original / ×4 / ×2…** ; le tampon affiché correspond à la variante vue.
- **Grille** : chip orange `×n` sur les cartes ayant des upscales ;
  filtre *Upscales* (With / Without) sur la page Images.

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
- Le **tuilage** (`tile=512`) borne la mémoire (runners 7 Go).
- Formats de sortie : source **jpg → jpg qualité 95** (prêt pour Adobe
  Stock), png/webp/autre → **png** (lossless). L'alpha est ignoré.
- `public_id` déterministe `<imageId>_x<scale>_<index>` + `overwrite=true`
  → un re-run après échec partiel reprend proprement (idempotent).
- Poids des modèles mis en **cache** (`~/.cache/upscale-models`, ~65 Mo).

---

## 7. Gestion des erreurs & codes de sortie

| Situation | Comportement | Run |
|---|---|---|
| Secrets manquants / mauvais | message listant exactement ce qui manque | ❌ exit 1 |
| 401 API | « vérifiez le secret ASSET_API_KEY (clé de l'agent) » | ❌ exit 1 |
| API injoignable | « vérifiez ASSET_API_URL + cold start Render ~30-60 s » | ❌ exit 1 |
| Image introuvable (single) | message + piste de vérification | ❌ exit 1 |
| Lien source mort (éphémère) | « ⏭️ ignorée — lien expiré » | ✅ (comptée ignorée) |
| Limite d'upscales atteinte | « 🛑 STOP — déjà N upscales, max M » | ✅ exit 0 |
| Échec d'une image (batch) | message + résumé ; les autres continuent | ❌ exit 1 |
| Rien à traiter | « ✓ aucune image éligible » | ✅ exit 0 |

Le **résumé du job** (table Markdown dans l'onglet Summary) liste chaque
image : statut, échelle, dimensions, taille et lien Cloudinary.

---

## 8. Quota GitHub Actions (repo privé)

Plan gratuit : **2000 min/mois**. Ordre de grandeur : setup ~3-4 min +
**~3-6 min par image** en ×4 (CPU). Avec `max_images=5`/jour →
~150-200 min/jour ≈ 4500-6000 min/mois ⚠️ **au-delà du quota gratuit**.

Ajustements possibles : baisser `max_images` (ex. 2-3/jour), utiliser le
modèle compact `realesr-general-x4v3` ou `scale=2` (2-4× plus rapide), ou
passer le repo en public (Actions illimitées).

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
- **Concurrence** : un run batch et un run single simultanés sur la même
  image sont protégés par la vérification serveur (409 → « ignorée/stop »).
- **Qualité** : Real-ESRGAN ×4 sur du 1K donne ~4096 px — au-dessus du
  minimum Adobe Stock (4 MP). Un upscale n'ajoute pas de détail réel,
  il agrandit : privilégiez des générations 2K quand c'est possible.
