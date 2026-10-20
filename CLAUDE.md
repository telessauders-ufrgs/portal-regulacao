# Guia para contribuições — portal-regulacao

Instruções curtas para quem altera este repositório. O detalhamento vive nos
documentos abaixo — este arquivo **não os duplica**, aponta para eles.

## Propósito

Portal web interno (TypeScript full-stack) de **monitoramento da regulação de
encaminhamentos** para consultas especializadas no SUS-RS, da equipe do
TelessaúdeRS. Centraliza dados de uma planilha Google e do GERCON (via Metabase)
e os prioriza por indicadores (INDEX, Fila/Cotas), com check-in de reguladores.

> Ressalva: a indicação de deploy (Railway) vem de comentários no
> `.env.example`, não de configuração de infraestrutura versionada; não há
> evidência no repositório de qual versão está em produção.

## Mapa de navegação

- Visão geral, setup e comandos → [`README.md`](README.md)
- Arquitetura (tRPC, auth, dados, integrações) → [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md)
- Domínio (entidades, perfis, glossário, regras) → [`docs/DOMINIO.md`](docs/DOMINIO.md)
- Entry do servidor → `server/_core/index.ts` · API (procedures) → `server/routers.ts`
- Schema do banco → `drizzle/schema.ts` · Client (rotas) → `client/src/App.tsx`, `client/src/pages/Home.tsx`

## Convenções confirmadas (dos arquivos do repo)

- **TypeScript estrito**, ESM (`tsconfig.json`, `package.json` `type: module`).
- Aliases `@/*` → `client/src`, `@shared/*` → `shared` (`vite.config.ts`, `tsconfig.json`).
- **pnpm** como gerenciador (versão fixada em `packageManager`).
- Formatação por **Prettier** (`.prettierrc`); **não há ESLint** no projeto.
- Rotas no client com **wouter**; estado de servidor via **tRPC + TanStack Query**.
- Procedures tRPC validam entrada com **Zod** (padrão observado em `server/routers.ts`).
- UI em **português (pt-BR)** inline; **não há biblioteca de i18n**.

## Comandos

Definidos em `package.json`. **Nenhum foi executado/validado nesta descoberta** —
rode-os ciente do ambiente apontado por `DATABASE_URL`.

| Comando | Declarado para | Observação |
|---|---|---|
| `pnpm check` | `tsc --noEmit` (type-check) | Sem efeito colateral aparente |
| `pnpm dev` | Servidor em watch | **No boot roda migrações e sincronizações** |
| `pnpm build` / `pnpm start` | Build e produção | `start` repete o boot do servidor |
| `pnpm test` | Vitest (só backend) | Pode tocar banco/rede |
| `pnpm db:push` | `drizzle-kit generate && migrate` | **Altera o banco** |

Inspeções read-only usadas na descoberta (sem efeito no projeto): `git log/show/status`,
`ls`, `find`, `grep`.

## Segurança e compatibilidade

- Acesso restrito a reguladores autorizados (login Google + `reguladores.ativo='sim'`).
- Segredos ficam em `.env` (git-ignored); **só `.env.example` é versionado**. Nunca
  commitar segredos; referencie variáveis **apenas por chave**.
- Node não é fixado por `engines` (compatível com `@types/node` v24 — a confirmar).
- Banco da aplicação é **MySQL**; `pg` serve só a fontes externas/prévia de migração.
- **Git:** não commitar automaticamente; deixar alterações em disco. Sem push/
  amend/rebase/reset sem autorização explícita.

## Armadilhas conhecidas

- Os dados de regulação são **recriados diariamente (DELETE+INSERT)**, então os IDs
  mudam; relacione agendas por `agenda + municipio + central` (padrão já usado no código).
- **Dois caminhos de migração coexistem** (arquivos Drizzle e DDL imperativa no boot) —
  preferir Drizzle; evitar ampliar a DDL de boot.
- Scaffold `server/_core/{llm,map,storage,imageGeneration,voiceTranscription,dataApi,
  notification}.ts` é **inerte** (depende de `forge*` não configurado) — não é o caminho
  de produção.
- Rota `/dashboard` renderiza área em branco (sem case no `Switch` de `Home.tsx`).
- Rodar o servidor **lê/grava dados reais** (migração + sync no boot).