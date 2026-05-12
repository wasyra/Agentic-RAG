# Plan: RAG Knowledge Base Agent (IA personal con fuentes)

**Versión:** 1.1  
**Stack fijado:** Next.js (frontend) + PostgreSQL (**pgvector** para embeddings).  
**Estado:** Backlog prioridad #3 — base antes de sistemas de soporte más complejos.

---

## 1. Objetivo central

Construir un asistente conversacional que **solo** utilice información aportada por el usuario (PDFs, notas, manuales, etc.) para:

- Reducir alucinaciones frente a un chat genérico.
- Ofrecer respuestas **100% ancladas** a documentos privados o de negocio.
- Comportarse como producto: **privacidad**, **actualización** de conocimiento y **citas** verificables.

El sistema debe sentirse como una **IA de chat** (UX moderna), pero con un motor **RAG estricto**: primero recuperación, luego generación.

---

## 2. Principios de producto (“IA personal neta”)

### 2.1 Fuentes de verdad

- Carga masiva o incremental de documentos (FAQs, políticas, catálogos, historiales).
- Cada documento pertenece a una **base de conocimiento** (proyecto / espacio) para aislar contextos.

### 2.2 Guardrails (límites del agente)

- Si la evidencia recuperada **no** responde con suficiente soporte, el agente **debe** admitir que no está en los documentos (plantilla fija o respuesta mínima sin inventar).
- Opción conservadora: por debajo de un **umbral de similitud / score** del retrieval, **no** invocar al LLM para “inventar” una negativa; devolver mensaje estándar.

### 2.3 Contexto estricto (flujo RAG)

1. Pregunta del usuario → embedding de la consulta.  
2. Búsqueda **top-k** en la base vectorial (filtrada por `knowledge_base_id`).  
3. Construcción del prompt con **únicamente** los fragmentos recuperados + instrucciones de citación y abstención.  
4. Generación del LLM **después** de inyectar ese contexto.  
5. Respuesta al cliente incluye **citas** enlazadas a fragmentos y metadatos (archivo, página o sección).

### 2.4 Diferenciación (mensaje comercial)

> Construye un ChatGPT privado que solo sabe lo que tú le has enseñado en tus documentos.

**Beneficios a destacar:**

| Beneficio | Qué implementar |
|-----------|------------------|
| Privacidad | Datos en tu infra o proveedor bajo contrato; política clara de no uso para entrenamiento de modelos públicos. |
| Actualización | Nuevo PDF → indexación → disponible en el chat sin “reentrenar” un modelo. |
| Confianza | Citas con documento + página + extracto corto. |

---

## 3. Arquitectura técnica

### 3.1 Capas

| Capa | Responsabilidad |
|------|------------------|
| **Frontend** | Chat tipo IA, streaming, panel de fuentes, biblioteca de documentos, estados de indexación. |
| **Backend (API)** | Auth, CRUD de bases y documentos, ingestión, orquestación RAG, streaming de respuestas. |
| **Almacén de archivos** | Blobs (local en dev, S3-compatible o Supabase Storage en prod). |
| **PostgreSQL + pgvector** | Tablas relacionales (usuarios, docs, conversaciones) y columna tipo `vector` por chunk para **similarity search**; metadata (`doc_id`, `chunk_id`, `page`, `title`, `knowledge_base_id`). |
| **Workers / cola** (recomendado tras MVP) | PDFs grandes, OCR, re-embeddings sin bloquear la API. |

### 3.2 Stack fijado (Next.js + PostgreSQL)

| Área | Elección |
|------|----------|
| Frontend | **Next.js 15+ (App Router)** — UI chat, Server/Client Components según necesidad |
| Estilos | Tailwind CSS |
| API / BFF | **Route Handlers** (`app/api/...`) y/o **Server Actions** para CRUD y chat; alternativa: servicio **FastAPI** aparte si el equipo prefiere RAG en Python (los datos siguen en Postgres) |
| Base de datos | **PostgreSQL** con extensión **[pgvector](https://github.com/pgvector/pgvector)** |
| ORM / SQL | **Drizzle ORM** o **Prisma** (pgvector vía SQL raw o helpers según versión) |
| Orquestación RAG | En TypeScript (pipeline propio + SDK del LLM) o Python vía worker; embeddings en tabla `chunks` con índice `ivfflat` / `hnsw` según volumen |
| Embeddings + chat | API externa (OpenAI u otro); dimensión del vector alineada al modelo de embeddings |
| Dev local | Docker Compose: **PostgreSQL imagen con pgvector** (p. ej. `pgvector/pgvector:pg16`) + app Next |

### 3.3 Ruta no-code / integración (fase posterior)

- **Dify / Botpress** para prototipos o clientes sin código.
- **n8n** para sincronizar archivos nuevos desde **Google Drive** o exportaciones de **Notion**.
- El núcleo propio (Next + Postgres/pgvector) mantiene control fino sobre **citas** y **guardrails**.

---

## 4. Modelo de datos (mínimo viable)

Entidades conceptuales:

- **User** — identidad y límites (cuotas, bases permitidas).
- **KnowledgeBase** — contenedor lógico de documentos (proyecto / cliente).
- **Document** — archivo, estado (`pending` | `processing` | `indexed` | `error`), metadatos.
- **Chunk** — texto, vector de embedding en **Postgres (pgvector)**, `page` u offset, `document_id`; índice aproximado para consultas `<=>` / `<->` según escala.
- **Conversation** / **Message** — historial para UX; el RAG puede usar solo últimos N turnos + pregunta actual.

---

## 5. Contratos API (referencia)

Definir versionado bajo `/api/v1/`:

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/documents` | Subida multipart; body incluye `knowledge_base_id`. |
| `GET` | `/documents/{id}` | Estado de indexación y errores legibles. |
| `DELETE` | `/documents/{id}` | Borra archivo, registros y vectores asociados. |
| `POST` | `/chat` | Body: `messages`, `knowledge_base_id`. Respuesta: stream (SSE/WebSocket) + payload final con `citations[]`. |

**Citations (ejemplo de forma):**

```json
{
  "citations": [
    {
      "chunk_id": "…",
      "document_id": "…",
      "title": "Política RRHH 2025.pdf",
      "page": 12,
      "excerpt": "…"
    }
  ]
}
```

---

## 6. Experiencia de usuario (visual “como una IA”)

- **Chat principal:** burbujas, markdown, bloques de código si aplica, indicador de “escribiendo”, scroll automático.
- **Panel “Fuentes”:** snippets recuperados con título, página y relevancia; sincronización con referencias `[1]` en la respuesta.
- **Biblioteca:** drag-and-drop, lista con estado, reindexar, eliminar.
- **Empty states:** mensaje claro (“Sube documentos para que las respuestas salgan solo de ahí”).
- **Tema:** claro/oscuro coherente con marca del producto.

---

## 7. Fases de implementación

### Fase 0 — Fundamentos (1–2 semanas)

- Monorepo sugerido: `apps/web` (**Next.js**), opcional `apps/api` o solo rutas `app/api` en el mismo app.
- Docker Compose: **Postgres + pgvector**; variables `DATABASE_URL` para Drizzle/Prisma.
- Auth MVP: **NextAuth.js** / **Auth.js** o Clerk; roadmap multi-tenant.
- Migraciones iniciales: tablas `users`, `knowledge_bases`, `documents`, `chunks` (con columna `embedding vector(N)`), `conversations`, `messages`; `CREATE EXTENSION vector`.

### Fase 1 — Ingestión y vectorización (2–3 semanas)

- Extracción de texto (pypdf, unstructured u homólogo).
- Chunking con solapamiento; metadata con **página** cuando sea posible.
- Embeddings y upsert en tabla `chunks` (Postgres) con `knowledge_base_id` y vector indexado.
- Endpoints de estado y manejo de errores por documento.

### Fase 2 — Chat RAG + guardrails + citas (2–3 semanas)

- Retrieval top-k + filtro por base.
- Prompt de sistema: uso exclusivo del contexto; abstención si no hay soporte.
- Umbral de retrieval: respuesta estándar sin inventar si la evidencia es débil.
- Streaming al cliente; objeto final con `citations`.

### Fase 3 — Frontend completo (paralelo desde Fase 1: 2–3 semanas)

- Pantallas en **Next.js**: chat, fuentes, biblioteca.
- Streaming: **Route Handler** con `ReadableStream` / AI SDK de Vercel (`streamText`) si aplica.
- Eliminación de documentos y **borrado en cascada** de filas `chunks` (vectores).

### Fase 4 — Calidad, privacidad y demo (1–2 semanas)

- Documentación de privacidad y retención.
- Suite manual de evaluación (preguntas fijas sobre docs de prueba).
- Pulido visual y accesibilidad básica (contraste, foco).

### Fase 5 — Extensiones (backlog)

- Conectores: Google Drive, Notion, webhooks n8n.
- OCR para PDFs escaneados.
- Colas dedicadas para jobs pesados.
- Reindexación incremental avanzada (post-MVP).

---

## 8. Riesgos y mitigaciones

| Riesgo | Mitigación |
|--------|------------|
| Alucinaciones | Contexto obligatorio + abstención + umbral de retrieval |
| PDF mal parseado | Librerías robustas + UI de error + vista previa de texto extraído |
| Coste de embeddings | Batching, modelos económicos, reindex bajo demanda |
| Latencia percibida | Streaming; optimizar k y tamaño de chunks |

---

## 9. Criterios de éxito del MVP

- [ ] Subir al menos un PDF y ver estado hasta `indexed`.
- [ ] Pregunta cuya respuesta está en el doc → respuesta correcta con **cita** a archivo/página.
- [ ] Pregunta fuera del doc → respuesta de **no sé** sin datos inventados.
- [ ] Borrar documento elimina su presencia en búsquedas posteriores.
- [ ] UI percibida como **asistente de IA** (chat + fuentes).

---

## 10. Próximo paso sugerido en el repo

1. `create-next-app` en `apps/web` + `docker-compose.yml` con **Postgres pgvector**.  
2. Stub `app/api/chat` (o ruta equivalente) con respuesta fija + forma de `citations` para cablear la UI.  
3. Ingestión mínima de PDF → chunks + embeddings en **Postgres**; consulta `ORDER BY embedding <=> $query_embedding`.  
4. Sustituir stub por LLM con prompt de guardrails.

---

*Documento vivo: actualizar fechas y checkboxes conforme avance el desarrollo.*
