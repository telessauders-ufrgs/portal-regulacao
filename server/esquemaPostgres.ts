/**
 * esquemaPostgres.ts — cria as tabelas do portal no PostgreSQL.
 *
 * Executado a cada inicialização do servidor (ver server/_core/index.ts).
 * Todos os comandos usam "IF NOT EXISTS": rodar de novo não apaga nem altera
 * nada que já exista.
 *
 * Substitui, no Postgres, as migrações antigas do MySQL (pasta drizzle/*.sql e
 * os ALTER TABLE incrementais de index.ts), que só faziam sentido para o
 * histórico do banco MySQL. O SQL abaixo foi gerado a partir de drizzle/schema.ts
 * (drizzle-kit generate, dialeto postgresql) + tabelas/índices criados à mão.
 *
 * ⚠️ Ao acrescentar uma coluna no futuro, inclua aqui um
 *   ALTER TABLE "tabela" ADD COLUMN IF NOT EXISTS "coluna" tipo;
 * (o Postgres aceita IF NOT EXISTS também em ADD COLUMN).
 */
import { sql } from "drizzle-orm";
import type { getDb } from "./db";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

const COMANDOS: string[] = [
  `CREATE TABLE IF NOT EXISTS "agenda_observacoes" (
	"id" serial PRIMARY KEY NOT NULL,
	"agenda_nome" varchar(255) NOT NULL,
	"central" varchar(100) NOT NULL,
	"observacao" text NOT NULL,
	"updatedat" timestamp with time zone DEFAULT now() NOT NULL
);`,
  `CREATE TABLE IF NOT EXISTS "agenda_protocolos" (
	"id" serial PRIMARY KEY NOT NULL,
	"agenda_nome" varchar(255) NOT NULL,
	"protocolos_nomes" text NOT NULL,
	"prioridades_nomes" text NOT NULL,
	"updatedat" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agenda_protocolos_agenda_nome_unique" UNIQUE("agenda_nome")
);`,
  `CREATE TABLE IF NOT EXISTS "agendas_concluidas" (
	"id" serial PRIMARY KEY NOT NULL,
	"agenda_id" integer NOT NULL,
	"agenda_nome" varchar(255) NOT NULL,
	"municipio" varchar(255),
	"especialidade" varchar(255) NOT NULL,
	"central" varchar(100),
	"cotas" integer,
	"saldo" integer,
	"aguardando" integer,
	"index_regula" double precision,
	"usuario_email" varchar(320) NOT NULL,
	"usuario_nome" varchar(255) NOT NULL,
	"concluido_em" timestamp with time zone DEFAULT now() NOT NULL
);`,
  `CREATE TABLE IF NOT EXISTS "agendas_favoritas" (
	"id" serial PRIMARY KEY NOT NULL,
	"regulador_email" varchar(320) NOT NULL,
	"agenda_id" integer NOT NULL,
	"agenda_nome" varchar(255) NOT NULL,
	"municipio" varchar(255),
	"central" varchar(100),
	"especialidade" varchar(255),
	"createdat" timestamp with time zone DEFAULT now() NOT NULL
);`,
  `CREATE TABLE IF NOT EXISTS "agendas_relacionadas_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"agenda_nome" varchar(255) NOT NULL,
	"especialidade" varchar(255),
	"relacionadas_nomes" text DEFAULT '[]' NOT NULL,
	"updatedat" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agendas_relacionadas_config_agenda_nome_unique" UNIQUE("agenda_nome")
);`,
  `CREATE TABLE IF NOT EXISTS "atividade_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"usuario_email" varchar(320) NOT NULL,
	"usuario_nome" varchar(255),
	"tipo" varchar(30) NOT NULL,
	"agenda_nome" varchar(255),
	"municipio" varchar(255),
	"central" varchar(100),
	"especialidade" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);`,
  `CREATE TABLE IF NOT EXISTS "check_ins" (
	"id" serial PRIMARY KEY NOT NULL,
	"agenda_id" integer NOT NULL,
	"agenda_nome" varchar(255) NOT NULL,
	"municipio" varchar(255),
	"especialidade" varchar(255) NOT NULL,
	"central" varchar(100),
	"cotas" integer,
	"saldo" integer,
	"aguardando" integer,
	"index_regula" double precision,
	"usuario_email" varchar(320) NOT NULL,
	"usuario_nome" varchar(255) NOT NULL,
	"createdat" timestamp with time zone DEFAULT now() NOT NULL
);`,
  `CREATE TABLE IF NOT EXISTS "condutas_gercon" (
	"id" serial PRIMARY KEY NOT NULL,
	"especialidade" varchar(255) NOT NULL,
	"situacao" text NOT NULL,
	"ciap_cid" text,
	"conduta" text NOT NULL,
	"referencias" text,
	"updatedat" timestamp with time zone DEFAULT now() NOT NULL
);`,
  `CREATE TABLE IF NOT EXISTS "condutas_gercon_sync_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_count" integer,
	"status" varchar(50) DEFAULT 'success',
	"message" text
);`,
  `CREATE TABLE IF NOT EXISTS "dicionario_especialidades" (
	"id" serial PRIMARY KEY NOT NULL,
	"agenda" varchar(255) NOT NULL,
	"especialidade" varchar(255) NOT NULL,
	"updatedat" timestamp with time zone DEFAULT now() NOT NULL
);`,
  `CREATE TABLE IF NOT EXISTS "encaminhamentos" (
	"id" serial PRIMARY KEY NOT NULL,
	"agenda_id" integer NOT NULL,
	"agenda_nome" varchar(255) NOT NULL,
	"municipio" varchar(255),
	"central" varchar(100),
	"especialidade" varchar(255) NOT NULL,
	"regulador_email" varchar(320) NOT NULL,
	"regulador_nome" varchar(255) NOT NULL,
	"encaminhado_por_email" varchar(320) NOT NULL,
	"encaminhado_por_nome" varchar(255) NOT NULL,
	"createdat" timestamp with time zone DEFAULT now() NOT NULL
);`,
  `CREATE TABLE IF NOT EXISTS "login_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"regulador_email" varchar(320) NOT NULL,
	"regulador_nome" varchar(255),
	"login_at" timestamp with time zone DEFAULT now() NOT NULL,
	"logout_at" timestamp with time zone,
	"ultima_atividade_at" timestamp with time zone
);`,
  `CREATE TABLE IF NOT EXISTS "prioridades" (
	"id" serial PRIMARY KEY NOT NULL,
	"grande_grupo" varchar(255),
	"nome_arquivo" varchar(500),
	"link_url" text,
	"updatedat" timestamp with time zone DEFAULT now() NOT NULL
);`,
  `CREATE TABLE IF NOT EXISTS "protocolos" (
	"id" serial PRIMARY KEY NOT NULL,
	"nome" varchar(500) NOT NULL,
	"link_url" text,
	"updatedat" timestamp with time zone DEFAULT now() NOT NULL
);`,
  `CREATE TABLE IF NOT EXISTS "recados" (
	"id" serial PRIMARY KEY NOT NULL,
	"titulo" varchar(255) NOT NULL,
	"mensagem" text NOT NULL,
	"autor_email" varchar(320) NOT NULL,
	"autor_nome" varchar(255),
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"ativo" smallint DEFAULT 1 NOT NULL
);`,
  `CREATE TABLE IF NOT EXISTS "recados_lidos" (
	"id" serial PRIMARY KEY NOT NULL,
	"recado_id" integer NOT NULL,
	"usuario_email" varchar(320) NOT NULL,
	"lido_em" timestamp with time zone DEFAULT now() NOT NULL
);`,
  `CREATE TABLE IF NOT EXISTS "regulacao_data" (
	"id" serial PRIMARY KEY NOT NULL,
	"agenda" varchar(255),
	"municipio" varchar(255),
	"cotas" integer,
	"saldo" integer,
	"aguardando" integer,
	"autorizadas" integer,
	"aut_cotas" varchar(50),
	"index_regula" double precision,
	"aguardando_7d" integer,
	"aguardando_28d" integer,
	"aguardando_90d" integer,
	"central" varchar(100),
	"especialidade" varchar(255),
	"flag_index" text,
	"cor_index" text,
	"flag_aut_cotas" text,
	"cor_aut_cotas" text,
	"updatedat" timestamp with time zone DEFAULT now() NOT NULL
);`,
  `CREATE TABLE IF NOT EXISTS "regulacao_data_pg" (
	"id" serial PRIMARY KEY NOT NULL,
	"agenda" varchar(255),
	"municipio" varchar(255),
	"cotas" integer,
	"saldo" integer,
	"aguardando" integer,
	"autorizadas" integer,
	"aut_cotas" varchar(50),
	"index_regula" double precision,
	"aguardando_7d" integer,
	"aguardando_28d" integer,
	"aguardando_90d" integer,
	"central" varchar(100),
	"especialidade" varchar(255),
	"flag_index" text,
	"cor_index" text,
	"flag_aut_cotas" text,
	"cor_aut_cotas" text,
	"updatedat" timestamp with time zone DEFAULT now() NOT NULL
);`,
  `CREATE TABLE IF NOT EXISTS "regulador_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"regulador_email" varchar(320) NOT NULL,
	"especialidades" text,
	"agendas_filtro" text,
	"updatedat" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "regulador_config_regulador_email_unique" UNIQUE("regulador_email")
);`,
  `CREATE TABLE IF NOT EXISTS "reguladores" (
	"id" serial PRIMARY KEY NOT NULL,
	"nome" varchar(255) NOT NULL,
	"vinculo" varchar(100),
	"perfil" varchar(100),
	"grande_grupo" text,
	"agendas" text,
	"email" varchar(320) NOT NULL,
	"ativo" varchar(3) DEFAULT 'sim' NOT NULL,
	"updatedat" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reguladores_email_unique" UNIQUE("email")
);`,
  `CREATE TABLE IF NOT EXISTS "sem_cotas" (
	"id" serial PRIMARY KEY NOT NULL,
	"especialidade" varchar(255),
	"municipio" varchar(255),
	"aguardando" integer,
	"autorizados" integer,
	"novas_cotas" integer,
	"central" varchar(100),
	"especialidade_categoria" varchar(255),
	"is_nova" varchar(3) DEFAULT 'nao' NOT NULL,
	"createdat" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedat" timestamp with time zone DEFAULT now() NOT NULL
);`,
  `CREATE TABLE IF NOT EXISTS "sync_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_count" integer,
	"status" varchar(50) DEFAULT 'success',
	"message" text
);`,
  `CREATE TABLE IF NOT EXISTS "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"openid" varchar(64) NOT NULL,
	"name" text,
	"email" varchar(320),
	"loginmethod" varchar(64),
	"role" varchar(20) DEFAULT 'user' NOT NULL,
	"createdat" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedat" timestamp with time zone DEFAULT now() NOT NULL,
	"lastsignedin" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_openid_unique" UNIQUE("openid")
);`,
  `CREATE TABLE IF NOT EXISTS "configuracoes_portal" (
	"chave" varchar(100) PRIMARY KEY NOT NULL,
	"valor" text NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_por" varchar(255)
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "agenda_observacoes_agenda_central" ON "agenda_observacoes" ("agenda_nome", "central")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "recados_lidos_recado_usuario" ON "recados_lidos" ("recado_id", "usuario_email")`,
  `CREATE INDEX IF NOT EXISTS "idx_atividade_email_data" ON "atividade_log" ("usuario_email", "created_at")`,
  `CREATE INDEX IF NOT EXISTS "idx_login_log_email_login" ON "login_log" ("regulador_email", "login_at")`,
  `CREATE INDEX IF NOT EXISTS "idx_check_ins_agenda" ON "check_ins" ("agenda_id")`,
];

/**
 * Normaliza e-mails para minúsculas nos dados existentes (ex.: copiados do MySQL).
 * No MySQL "Fulano@x.org" e "fulano@x.org" eram iguais; no Postgres não são.
 * O portal passa a gravar e comparar sempre em minúsculas. Idempotente.
 */
const NORMALIZAR_EMAILS: [string, string][] = [
  ["reguladores", "email"], ["users", "email"], ["check_ins", "usuario_email"],
  ["agendas_concluidas", "usuario_email"], ["encaminhamentos", "regulador_email"],
  ["encaminhamentos", "encaminhado_por_email"], ["agendas_favoritas", "regulador_email"],
  ["regulador_config", "regulador_email"], ["login_log", "regulador_email"],
  ["atividade_log", "usuario_email"], ["recados", "autor_email"], ["recados_lidos", "usuario_email"],
];

export async function criarEsquemaPostgres(db: Db): Promise<void> {
  let ok = 0;
  for (const comando of COMANDOS) {
    try {
      await db.execute(sql.raw(comando));
      ok++;
    } catch (e) {
      const nome = comando.match(/"([a-z_]+)"/)?.[1] ?? "?";
      console.error(`[Esquema PG] Falha em "${nome}":`, (e as Error).message);
    }
  }
  console.log(`[Esquema PG] ${ok}/${COMANDOS.length} comandos aplicados (tabelas e índices conferidos).`);

  for (const [tabela, coluna] of NORMALIZAR_EMAILS) {
    try {
      await db.execute(sql.raw(`UPDATE "${tabela}" SET "${coluna}" = LOWER("${coluna}") WHERE "${coluna}" <> LOWER("${coluna}")`));
    } catch (e) {
      // Pode falhar se houver duplicata após a conversão (ex.: dois cadastros iguais
      // com maiúsculas diferentes) — nesse caso, avisa e segue.
      console.warn(`[Esquema PG] Não foi possível normalizar ${tabela}.${coluna}:`, (e as Error).message);
    }
  }
}
