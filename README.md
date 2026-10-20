# Portal de Monitoramento da Regulação TSRS

Portal web interno da equipe de regulação do **TelessaúdeRS (TSRS/UFRGS)** para
**consulta, análise e gestão de encaminhamentos para consultas especializadas**
no SUS do Rio Grande do Sul.

O portal centraliza dados de regulação vindos de uma **planilha Google** (fonte
primária) e do sistema **GERCON** (via Metabase), e os apresenta como listas de
agendas priorizadas por indicadores (INDEX, Fila/Cotas, saldo, tempo de espera),
com check-in de reguladores, encaminhamentos, condutas-padrão e um mapa das 30
regiões de saúde do RS.

> O acesso é **restrito a reguladores autorizados**, autenticados com conta
> Google institucional.

Documentação complementar:

- [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) — componentes, fluxo tRPC, auth, dados e integrações.
- [`docs/DOMINIO.md`](docs/DOMINIO.md) — entidades, perfis de acesso, glossário e regras de negócio.
- [`CLAUDE.md`](CLAUDE.md) — padrões para contribuições.

---

## Stack

Monólito **TypeScript full-stack** (um único `package.json`), gerenciado com **pnpm**.

| Camada | Tecnologias |
|---|---|
| Frontend | React 19, Vite 7, [wouter](https://github.com/molefrog/wouter) (rotas), tRPC v11 + TanStack Query, shadcn/ui (Radix + Tailwind v4), react-hook-form + Zod, Recharts |
| Backend | Node.js (ESM), Express 4, tRPC v11, Drizzle ORM |
| Banco | **MySQL** (app) via `drizzle-orm/mysql2`; PostgreSQL (`pg`) apenas para leitura de fontes externas |
| Auth | Google OAuth2 → JWT (HS256, `jose`) em cookie `httpOnly` |
| Deploy | Railway (indicado em comentários do `.env.example`) |

## Estrutura de pastas

```
client/            # SPA React (Vite root)
  src/
    pages/         # Telas (Regulation, MinhasAgendas, Landing, …)
    components/    # Componentes de domínio + ui/ (shadcn)
    contexts/      # ReguladorContext, ThemeContext
    hooks/         # useHeartbeat, usePersistedFilters, …
    lib/           # trpc.ts, corAgenda.ts (regras de cor/prioridade), utils
server/            # Backend Express + tRPC
  _core/           # Infra: index.ts (entry), oauth, sdk (JWT), trpc, context, env, vite
  routers.ts       # Árvore de procedures tRPC (appRouter)
  sync*.ts         # ETL: Google Sheets, Metabase/GERCON, Postgres externo
shared/            # Código compartilhado client/server (const, tipos, erros)
drizzle/           # schema.ts + migrações SQL (0000…0018) + snapshots
scripts/           # Utilitários de seed/migração/sync (ad-hoc)
```

Aliases de import: `@/*` → `client/src`, `@shared/*` → `shared`.

## Pré-requisitos

- Node.js (compatível com `@types/node` v24; versão não fixada por `engines`).
- **pnpm** (versão fixada em `packageManager`, `package.json`).
- Um **MySQL** acessível via `DATABASE_URL`.
- Credenciais de Google OAuth e (para os syncs) acesso às fontes externas.

## Configuração (variáveis de ambiente)

Copie `.env.example` para `.env` e preencha. **Chaves** usadas (valores ficam
fora do versionamento — `.env` é git-ignored):

| Chave | Uso |
|---|---|
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Login Google OAuth2 |
| `DATABASE_URL` | Conexão MySQL (app) |
| `JWT_SECRET` | Assinatura do cookie de sessão (JWT) |
| `APP_URL` | URL pública do app |
| `NODE_ENV` | `development` / `production` |
| `METABASE_URL`, `METABASE_CARD_ID`, `METABASE_API_KEY` *(ou `METABASE_EMAIL`/`METABASE_PASSWORD`)* | Sync de condutas GERCON |

Outras chaves lidas pelo código, ausentes do `.env.example` (confirmar conforme o
ambiente): `GOOGLE_SHEETS_API_KEY`, `OWNER_EMAIL`, `PORT`, `PG_*` e
`PLATAFORMA_BACKEND_*` (fontes PostgreSQL externas). Ver [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md).

## Scripts

> ⚠️ Vários comandos têm **efeitos colaterais** (tocam banco, rede ou disco).
> Rode-os cientes do ambiente apontado por `DATABASE_URL`.

| Comando | O que faz | Efeito colateral |
|---|---|---|
| `pnpm dev` | Sobe o servidor em watch (`tsx watch server/_core/index.ts`) | **Sim** — no boot roda migrações e sincronizações se o banco estiver vazio (ver abaixo) |
| `pnpm build` | `vite build` + bundle do servidor com esbuild → `dist/` | Escreve em `dist/` |
| `pnpm start` | Produção: `node dist/index.js` | **Sim** — mesmo boot do `dev` |
| `pnpm check` | `tsc --noEmit` (type-check) | Nenhum — seguro |
| `pnpm format` | Prettier `--write .` | **Altera arquivos** |
| `pnpm test` | `vitest run` (testes de backend) | Pode tocar banco/rede |
| `pnpm db:push` | `drizzle-kit generate && drizzle-kit migrate` | **Altera o banco** |

### Comportamento de boot

Ao iniciar, `server/_core/index.ts` executa, em sequência: migrações do Drizzle,
migrações imperativas adicionais (`runPendingMigrations()`), e **seed/sync a
partir da planilha e do GERCON se as tabelas estiverem vazias**. Além disso,
agenda (via `setInterval`) sincronizações diárias no horário de Brasília. Trate
qualquer execução do servidor como uma operação que **lê e grava dados reais**.

## Testes

Vitest, apenas backend (`server/**/*.test.ts`): `auth.logout`, `checkin-encaminhamento`,
`municipio-join`, `regulation-filter`, `sheets`. Não há testes de frontend.

## Git

Por convenção do repositório, alterações são deixadas **em disco e sem commit**
por padrão; commits são feitos apenas quando explicitamente solicitados.
