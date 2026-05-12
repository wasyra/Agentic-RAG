# RAG Knowledge Base Agent

Monorepo según [PLAN.md](./PLAN.md): **Next.js** (solo UI) + **FastAPI** (backend `/api/...`) + **PostgreSQL** con **pgvector**, chat RAG con citas.

## Requisitos

- **Solo Docker**: Docker Desktop (o Docker Engine + Compose v2).
- **Desarrollo híbrido** (Postgres en Docker, apps en el host): Node.js 20+, Python 3.12+ y Docker.

---

## Opción A — Todo en Docker (recomendado)

En la **raíz** del repositorio.

### 1. Levantar Postgres, API y web

```powershell
docker compose up -d --build
```

- **Postgres** (pgvector): puerto `5432`.
- **API** (FastAPI / Uvicorn): [http://localhost:8000](http://localhost:8000) — salud: [http://localhost:8000/api/health](http://localhost:8000/api/health).
- **Web** (Next.js producción): [http://localhost:3000](http://localhost:3000).  
  El build de la imagen incluye `NEXT_PUBLIC_API_URL=http://localhost:8000` para que el navegador llame al API en el host.

Los **subidos** y `storage/app-settings.json` persisten en el volumen `rag_web_storage`, montado en **`/app/storage`** tanto en `web` como en `api` (misma carpeta lógica).

### 2. Primera vez: migraciones y seed

Ejecútalos **después** del paso 1 (con `db` en marcha):

```powershell
docker compose --profile tools run --rm migrate
docker compose --profile tools run --rm seed
```

`seed` crea el usuario `dev@local.rag` y la base de conocimiento **Personal**. Si omites `migrate`, la app fallará al consultar tablas que aún no existen.

### 3. IA (claves en el navegador)

En [http://localhost:3000/settings](http://localhost:3000/settings): proveedor **OpenAI** o **Google**, una API key y modelos. Las claves van en **localStorage** y se envían con `X-AI-Provider` y `X-API-Key` al API.

### Comandos útiles

| Comando | Descripción |
|--------|-------------|
| `docker compose up -d` | Arranca `db` + `api` + `web` |
| `docker compose logs -f api` | Logs del backend FastAPI |
| `docker compose logs -f web` | Logs del front Next.js |
| `docker compose down` | Para contenedores (los volúmenes de datos se conservan) |

---

## Opción B — Next + FastAPI en local, solo Postgres en Docker

### 1. Base de datos

```powershell
docker compose up -d db
```

### 2. Variables (`apps/web`)

```powershell
cd apps\web
copy .env.example .env
```

En `.env`: `DATABASE_URL` con **localhost**; **`NEXT_PUBLIC_API_URL=http://127.0.0.1:8000`** (obligatorio para que el navegador apunte al FastAPI).

### 3. API Python (`apps/api`)

```powershell
cd apps\api
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
copy .env.example .env
```

Ajusta `STORAGE_ROOT` en `apps/api/.env` para que coincida con la carpeta `storage` de Next (por defecto en el ejemplo: `../web/storage` si trabajas con `cwd` en `apps/api`). `DATABASE_URL` debe usar **localhost**.

Arranque del API:

```powershell
.\.venv\Scripts\uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

### 4. Migraciones y seed (desde `apps/web`)

```powershell
npm run db:migrate
npm run db:seed
```

### 5. Next en desarrollo

```powershell
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000). Salud del API: [http://127.0.0.1:8000/api/health](http://127.0.0.1:8000/api/health).

---

## Scripts útiles (`apps/web`)

| Script | Descripción |
|--------|-------------|
| `npm run dev` | Next.js en desarrollo |
| `npm run build` | Build (también usado por la imagen Docker) |
| `npm run db:migrate` | Migraciones Drizzle |
| `npm run db:seed` | Usuario + KB de desarrollo |
| `npm run db:studio` | Drizzle Studio |

---

## Estado del código (resumen)

- Esquema Drizzle (en `apps/web`): `users`, `knowledge_bases`, `documents`, `chunks` (vectores **768** + índice HNSW), etc. Las migraciones siguen ejecutándose con `npm run db:migrate` en la imagen/herramienta `migrate`.
- **FastAPI** (`apps/api`): indexación (PDF / TXT / MD), embeddings, chat RAG, listados, ajustes persistidos en `storage/app-settings.json`.
- **Chat** (`POST /api/chat` en el API): embedding de la pregunta → búsqueda → respuesta según proveedor en ajustes.
- **Ajustes**: claves en localStorage; modelos en `storage/app-settings.json` (compartido con el volumen Docker `rag_web_storage`).

## Estructura

```
RAG-Documents/
├── PLAN.md
├── docker-compose.yml
├── README.md
└── apps/
    ├── api/               # FastAPI + Dockerfile
    └── web/               # Next.js + Dockerfile
```
# Agentic-RAG
