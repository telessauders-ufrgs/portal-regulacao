# Arquitetura

Monólito TypeScript full-stack: uma **SPA React** conversa com um **servidor
Express/tRPC** de mesma origem; a persistência é **MySQL via Drizzle ORM**, com
jobs de sincronização que trazem dados de fontes externas.

```
Navegador (React/Vite SPA)
      │  tRPC sobre HTTP (superjson)  →  POST/GET /api/trpc/*   credentials: include
      ▼
Express (server/_core/index.ts)
      ├─ /api/trpc/*  → appRouter (server/routers.ts)
      ├─ OAuth        → /api/auth/login, /api/auth/callback/google
      ├─ sendBeacon   → /api/checkins/clear, /api/auth/beacon-logout
      │
      ├─ Drizzle ORM  → MySQL (DATABASE_URL)
      └─ Syncs        → Google Sheets, Metabase/GERCON, PostgreSQL externo
```

## Entrypoints

- **Servidor (ativo):** [`server/_core/index.ts`](../server/_core/index.ts) — é o
  alvo dos scripts `dev`/`build`/`start`. Monta o Express, registra o tRPC em
  `/api/trpc`, as rotas de OAuth e os endpoints de `sendBeacon`, roda as
  migrações no boot e agenda os syncs.
- **Servidor (legado/inerte):** [`server/index.ts`](../server/index.ts) — servidor
  estático alternativo, **não referenciado** pelos scripts.
- **Frontend:** `client/index.html` → `client/src/main.tsx` (monta o React,
  configura o cliente tRPC + QueryClient) → `client/src/App.tsx` (rotas wouter).

## Contrato de API (tRPC)

- Transporte: **tRPC sobre HTTP**, endpoint único `/api/trpc`, transformer
  `superjson`. **Não há** OpenAPI/Swagger nem GraphQL.
- O "contrato" é o **tipo TypeScript** `AppRouter`, importado diretamente pelo
  client em [`client/src/lib/trpc.ts`](../client/src/lib/trpc.ts). Alterar uma
  procedure no servidor altera o tipo consumido no front — mantenha-os coerentes.
- Entradas são validadas com **Zod** em cada procedure; as saídas usam os tipos
  de linha do Drizzle (`drizzle/schema.ts`), re-exportados por `shared/types.ts`.
- Frontend e API são **mesma origem** (`credentials: "include"`); não há
  middleware de CORS configurado.

A árvore de procedures vive em [`server/routers.ts`](../server/routers.ts), com
sub-roteadores como `auth`, `sheets` (dados da planilha + sync), `reguladores`,
`encaminhamentos`, `checkIns`, `agendasConcluidas`, `recados`, `condutas`,
`loginLog`, `usoPortal`, entre outros.

### Rotas REST fora do tRPC

Necessárias porque não cabem no tRPC (OAuth e `navigator.sendBeacon`):

| Rota | Função |
|---|---|
| `GET /api/auth/login` | Redireciona para o Google OAuth |
| `GET /api/auth/callback/google` | Callback do OAuth |
| `GET /api/oauth/callback` | Redirecionamento legado para `/api/auth/login` |
| `POST /api/checkins/clear` | Limpa check-ins ao fechar a aba (sendBeacon) |
| `POST /api/auth/beacon-logout` | Logout por sendBeacon |

## Autenticação e sessão

Fluxo (sem Supabase/Firebase/Keycloak):

1. `GET /api/auth/login` redireciona ao Google (`scope openid email profile`).
2. O callback troca o `code` por tokens, lê o `userinfo`, faz `upsert` do usuário
   e cria a sessão. A conta em `OWNER_EMAIL` é promovida a administrador.
   Ver [`server/_core/oauth.ts`](../server/_core/oauth.ts).
3. **Sessão:** JWT HS256 assinado com `JWT_SECRET` (`jose`), payload
   `{ openId, name, email }`, validade de 1 ano
   ([`server/_core/sdk.ts`](../server/_core/sdk.ts)). É **stateless** (não há lista
   de revogação; o logout limpa o cookie e registra o evento).
4. **Cookie:** `app_session_id` (`shared/const.ts`), `httpOnly`, com `secure`/
   `sameSite` derivados do protocolo ([`server/_core/cookies.ts`](../server/_core/cookies.ts)).
5. **Contexto tRPC:** `createContext` resolve o usuário a partir do cookie (auth
   é opcional para procedures públicas).

**Guards** ([`server/_core/trpc.ts`](../server/_core/trpc.ts)): `publicProcedure`,
`protectedProcedure` (exige usuário autenticado) e `adminProcedure` (exige
`role === 'admin'`). A autorização por **perfil de domínio** (regulador, consultor,
monitoramento, administrador) é resolvida pela procedure `auth.checkAccess` + a
tabela `reguladores` — ver [`docs/DOMINIO.md`](DOMINIO.md). No client, o
[`AuthGuard`](../client/src/components/AuthGuard.tsx) roda `auth.me` +
`auth.checkAccess` e renderiza `AcessoNegado` quando o usuário não está autorizado.

## Persistência

- **Banco da aplicação: MySQL** (`drizzle.config.ts` → `dialect: "mysql"`).
  Conexão **lazy** em [`server/db.ts`](../server/db.ts) (`getDb()` lê `DATABASE_URL`).
- **Schema:** 25 tabelas em [`drizzle/schema.ts`](../drizzle/schema.ts) — detalhado
  em [`docs/DOMINIO.md`](DOMINIO.md).
- **Migrações:** há **dois caminhos** que coexistem:
  1. Migrações do **Drizzle** (`drizzle/0000_*.sql … 0018_*.sql`), aplicadas no
     boot e via `pnpm db:push`.
  2. DDL **imperativa** em `runPendingMigrations()` dentro de
     `server/_core/index.ts`, mais scripts `migrate_*.mjs` na raiz.

  Ao evoluir o schema, **prefira o Drizzle** e evite ampliar a DDL imperativa,
  para reduzir divergência entre os dois caminhos.

## Integrações e sincronizações

| Fonte | Módulo | Papel |
|---|---|---|
| Google OAuth2 | `server/_core/oauth.ts` | Login |
| Google Sheets API v4 | [`server/syncSheets.ts`](../server/syncSheets.ts) | **Fonte primária** dos dados de regulação (aba "Final") |
| Metabase / GERCON | [`server/syncMetabase.ts`](../server/syncMetabase.ts) | Condutas-padrão; alcançável apenas por VPN institucional |
| PostgreSQL externo (SESDW) | [`server/syncPostgres.ts`](../server/syncPostgres.ts) | Popula a tabela espelho `regulacao_data_pg` (prévia da migração) |
| PostgreSQL "plataforma-backend" | [`server/plataformaBackendClient.ts`](../server/plataformaBackendClient.ts) | Console de consulta **read-only** (exploração/comparação) |

- **Mapa das regiões de saúde:** não usa biblioteca de mapa nem GeoJSON em
  runtime — é **SVG inline** com as 30 regiões embutidas em
  [`client/src/components/MapaRegioesSaude.tsx`](../client/src/components/MapaRegioesSaude.tsx)
  (contornos derivados da malha municipal do IBGE, simplificados).
- **Importação alternativa:** [`server/importCondutasCsv.ts`](../server/importCondutasCsv.ts)
  é descrita como alternativa temporária enquanto o acesso ao Metabase não é liberado.

## Agendamento e processamento assíncrono

Não há fila/worker. O agendamento é feito por `setInterval` em
`server/_core/index.ts`: a cada ~5 min o servidor checa o horário de Brasília e
dispara os syncs diários (planilha e GERCON) nas janelas configuradas. Os syncs
rodam **inline** no processo Node.

## Erros, logs e observabilidade

- Logs via `console.*` com prefixos (`[Sync]`, `[Auth]`, `[Migration]`, …); não há
  logger estruturado nem APM/tracing.
- Erros: `TRPCError` (server) e `HttpError`/subclasses em `shared/_core/errors.ts`;
  `ErrorBoundary` no client, com redirect global ao login em erro de não-autenticado.
- "Observabilidade" disponível é via tabelas `sync_log`, `condutas_gercon_sync_log`,
  `login_log` e `atividade_log`, mais a procedure `system.health`.

## Scaffold "Manus/forge" (inerte)

Os módulos `server/_core/{llm,map,storage,imageGeneration,voiceTranscription,dataApi,notification}.ts`
são restos de um scaffold de plataforma: dependem de `ENV.forgeApiUrl`/`ENV.forgeApiKey`,
que **não são definidos** em `server/_core/env.ts`. Qualquer chamada a eles falha —
trate-os como **código inerte** (não é o caminho de produção, que usa Google OAuth
direto). No client, `AIChatBox.tsx` e `Map.tsx` só são referenciados pela página
não roteada `ComponentShowcase.tsx`.

## Decisões técnicas e pontos em transição

- Migração **MySQL → PostgreSQL** em validação: tabela `regulacao_data_pg`, página
  `PreviaPostgres` (`/previa-pg`) e `TestePlataformaBackend` são explicitamente
  transitórios.
- A rota `/dashboard` (declarada em `App.tsx`) **não tem case** no `Switch` interno
  de `Home.tsx`, renderizando a área principal em branco; `pages/Dashboard.tsx` não
  é importado.
