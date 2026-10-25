import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { syncAndSeedIfEmpty } from "../syncSheets";
import { syncCondutasGerconIfEmpty, syncCondutasGerconComLog } from "../syncMetabase";
import { sdk } from "./sdk";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);
  // Endpoint dedicado para limpeza de check-ins via sendBeacon (beforeunload)
  // navigator.sendBeacon só suporta POST com Content-Type text/plain ou application/x-www-form-urlencoded
  app.post("/api/checkins/clear", async (req, res) => {
    try {
      const user = await sdk.authenticateRequest(req);
      if (!user?.email) {
        res.status(401).end();
        return;
      }
      const { getDb } = await import("../db");
      const { checkIns } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const db = await getDb();
      if (db) {
        await db.delete(checkIns).where(eq(checkIns.usuarioEmail, user.email));
      }
      res.status(204).end();
    } catch {
      // Silently fail — sendBeacon não processa a resposta
      res.status(204).end();
    }
  });

  // Endpoint para registrar logout via sendBeacon (fechamento de aba/navegador).
  // navigator.sendBeacon só suporta POST com body text/plain ou form-encoded;
  // não passa pelo middleware tRPC, por isso é um endpoint REST dedicado.
  app.post("/api/auth/beacon-logout", async (req, res) => {
    try {
      const user = await sdk.authenticateRequest(req);
      if (!user?.email) { res.status(204).end(); return; }
      const email = user.email.toLowerCase();
      const { getDb } = await import("../db");
      const { sql } = await import("drizzle-orm");
      const db = await getDb();
      if (db) {
        await db.execute(
          sql`UPDATE login_log SET logout_at = NOW() WHERE regulador_email = ${email} AND logout_at IS NULL ORDER BY login_at DESC LIMIT 1`
        );
      }
    } catch { /* beacon não processa resposta */ }
    res.status(204).end();
  });

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

async function runPendingMigrations() {
  try {
    const { getDb } = await import("../db");
    const db = await getDb();
    if (!db) return;

    // Verifica colunas atuais da tabela
    const result = await db.execute(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'agendas_relacionadas_config' AND TABLE_SCHEMA = DATABASE()"
    ) as unknown as [{ COLUMN_NAME: string }[], unknown];

    const colNames: string[] = result[0].map((r: { COLUMN_NAME: string }) => r.COLUMN_NAME);

    if (!colNames.includes('relacionadas_nomes')) {
      console.log('[Migration] Aplicando: adicionar relacionadas_nomes em agendas_relacionadas_config...');

      // Remover índice único de agenda_id se existir
      if (colNames.includes('agenda_id')) {
        try { await db.execute("ALTER TABLE `agendas_relacionadas_config` DROP INDEX `agendas_relacionadas_config_agenda_id_unique`"); }
        catch { /* pode não existir */ }
      }

      // Adicionar nova coluna
      await db.execute("ALTER TABLE `agendas_relacionadas_config` ADD COLUMN `relacionadas_nomes` text NOT NULL");

      // Adicionar unique em agenda_nome
      try { await db.execute("ALTER TABLE `agendas_relacionadas_config` ADD CONSTRAINT `agendas_relacionadas_config_agenda_nome_unique` UNIQUE(`agenda_nome`)"); }
      catch { /* pode já existir */ }

      // Remover colunas antigas
      for (const col of ['agenda_id', 'municipio', 'central', 'relacionadas_ids']) {
        if (colNames.includes(col)) {
          try { await db.execute(`ALTER TABLE \`agendas_relacionadas_config\` DROP COLUMN \`${col}\``); }
          catch (e) { console.warn(`[Migration] Não foi possível remover coluna ${col}:`, e); }
        }
      }

      console.log('[Migration] Concluída com sucesso!');
    } else {
      console.log('[Migration] agendas_relacionadas_config já está atualizada.');
    }

    // Migration: adicionar coluna createdAt em sem_cotas
    const colsSemCotas = await db.execute(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'sem_cotas' AND TABLE_SCHEMA = DATABASE()"
    ) as unknown as [{ COLUMN_NAME: string }[], unknown];
    const semCotasCols = colsSemCotas[0].map((r: { COLUMN_NAME: string }) => r.COLUMN_NAME);
    if (!semCotasCols.includes('createdAt')) {
      console.log('[Migration] Adicionando createdAt em sem_cotas...');
      await db.execute("ALTER TABLE sem_cotas ADD COLUMN createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP");
      console.log('[Migration] createdAt em sem_cotas OK!');
    }
    // Migration: adicionar novas_cotas e especialidade_categoria em sem_cotas
    if (!semCotasCols.includes('novas_cotas')) {
      console.log('[Migration] Adicionando novas_cotas em sem_cotas...');
      await db.execute("ALTER TABLE sem_cotas ADD COLUMN novas_cotas int NULL");
      console.log('[Migration] novas_cotas OK!');
    }
    if (!semCotasCols.includes('especialidade_categoria')) {
      console.log('[Migration] Adicionando especialidade_categoria em sem_cotas...');
      await db.execute("ALTER TABLE sem_cotas ADD COLUMN especialidade_categoria varchar(255) NULL");
      console.log('[Migration] especialidade_categoria OK!');
    }

    // Migration: criar tabela agenda_protocolos
    try {
      await db.execute(`CREATE TABLE IF NOT EXISTS agenda_protocolos (
        id int AUTO_INCREMENT PRIMARY KEY,
        agenda_nome varchar(255) NOT NULL,
        protocolos_nomes text NOT NULL,
        prioridades_nomes text NOT NULL,
        updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY agenda_nome_unique (agenda_nome)
      )`);
      console.log('[Migration] agenda_protocolos OK!');
    } catch(e) { console.warn('[Migration] agenda_protocolos:', e); }

    // Migration: criar tabela agenda_observacoes
    try {
      await db.execute(`CREATE TABLE IF NOT EXISTS agenda_observacoes (
        id int AUTO_INCREMENT PRIMARY KEY,
        agenda_nome varchar(255) NOT NULL,
        central varchar(100) NOT NULL,
        observacao text NOT NULL,
        updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY agenda_central (agenda_nome, central)
      )`);
      console.log('[Migration] agenda_observacoes OK!');
    } catch(e) { console.warn('[Migration] agenda_observacoes:', e); }

    // Migration: ampliar cor_index e cor_aut_cotas de varchar(100) para text
    // A planilha passou a usar textos longos nessas colunas (orientações de regulação)
    try {
      const colsRegulacao = await db.execute(
        "SELECT COLUMN_NAME, COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'regulacao_data' AND TABLE_SCHEMA = DATABASE() AND COLUMN_NAME IN ('cor_index', 'cor_aut_cotas')"
      ) as unknown as [{ COLUMN_NAME: string; COLUMN_TYPE: string }[], unknown];
      const tipos = Object.fromEntries(colsRegulacao[0].map((r: { COLUMN_NAME: string; COLUMN_TYPE: string }) => [r.COLUMN_NAME, r.COLUMN_TYPE]));
      if (tipos['cor_index'] && !tipos['cor_index'].toLowerCase().includes('text')) {
        console.log('[Migration] Ampliando cor_index para text...');
        await db.execute("ALTER TABLE `regulacao_data` MODIFY COLUMN `cor_index` text NULL");
        console.log('[Migration] cor_index OK!');
      }
      if (tipos['cor_aut_cotas'] && !tipos['cor_aut_cotas'].toLowerCase().includes('text')) {
        console.log('[Migration] Ampliando cor_aut_cotas para text...');
        await db.execute("ALTER TABLE `regulacao_data` MODIFY COLUMN `cor_aut_cotas` text NULL");
        console.log('[Migration] cor_aut_cotas OK!');
      }
    } catch(e) { console.warn('[Migration] Ampliação cor_index/cor_aut_cotas:', e); }

    // Migration: renomear aguardando_28d→aguardando_7d e aguardando_60d→aguardando_28d
    try {
      const cols = await db.execute(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'regulacao_data' AND TABLE_SCHEMA = DATABASE() AND COLUMN_NAME IN ('aguardando_28d', 'aguardando_60d', 'aguardando_7d')"
      ) as unknown as [{ COLUMN_NAME: string }[], unknown];
      const colNames = cols[0].map((r: { COLUMN_NAME: string }) => r.COLUMN_NAME);
      // Ordem importa: renomear 60d→28d antes de 28d→7d para evitar conflito
      if (colNames.includes('aguardando_60d')) {
        await db.execute("ALTER TABLE `regulacao_data` RENAME COLUMN `aguardando_60d` TO `aguardando_28d_new`");
        console.log('[Migration] aguardando_60d → aguardando_28d_new OK');
      }
      if (colNames.includes('aguardando_28d') && !colNames.includes('aguardando_7d')) {
        await db.execute("ALTER TABLE `regulacao_data` RENAME COLUMN `aguardando_28d` TO `aguardando_7d`");
        console.log('[Migration] aguardando_28d → aguardando_7d OK');
      }
      // Finalizar renomeação intermediária
      const cols2 = await db.execute(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'regulacao_data' AND TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'aguardando_28d_new'"
      ) as unknown as [{ COLUMN_NAME: string }[], unknown];
      if (cols2[0].length > 0) {
        await db.execute("ALTER TABLE `regulacao_data` RENAME COLUMN `aguardando_28d_new` TO `aguardando_28d`");
        console.log('[Migration] aguardando_28d_new → aguardando_28d OK');
      }
    } catch(e) { console.warn('[Migration] Renomeação colunas aguardando:', e); }

    // Migration: criar tabela regulacao_data_pg (prévia PostgreSQL) se não existir
    try {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS \`regulacao_data_pg\` (
          \`id\`             int NOT NULL AUTO_INCREMENT PRIMARY KEY,
          \`agenda\`         varchar(255)  NULL,
          \`municipio\`      varchar(255)  NULL,
          \`cotas\`          int           NULL,
          \`saldo\`          int           NULL,
          \`aguardando\`     int           NULL,
          \`autorizadas\`    int           NULL,
          \`aut_cotas\`      varchar(50)   NULL,
          \`index_regula\`   double        NULL,
          \`aguardando_7d\`  int           NULL,
          \`aguardando_28d\` int           NULL,
          \`aguardando_90d\` int           NULL,
          \`central\`        varchar(100)  NULL,
          \`especialidade\`  varchar(255)  NULL,
          \`flag_index\`     text          NULL,
          \`cor_index\`      text          NULL,
          \`flag_aut_cotas\` text          NULL,
          \`cor_aut_cotas\`  text          NULL,
          \`updatedAt\`      timestamp     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);
      console.log('[Migration] regulacao_data_pg OK!');
    } catch(e) { console.warn('[Migration] regulacao_data_pg:', e); }

    // Migration: criar tabelas de recados
    try {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS \`recados\` (
          \`id\`          int NOT NULL AUTO_INCREMENT PRIMARY KEY,
          \`titulo\`      varchar(255) NOT NULL,
          \`mensagem\`    text NOT NULL,
          \`autor_email\` varchar(320) NOT NULL,
          \`autor_nome\`  varchar(255) NULL,
          \`criado_em\`   timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
          \`ativo\`       tinyint NOT NULL DEFAULT 1
        )
      `);
      await db.execute(`
        CREATE TABLE IF NOT EXISTS \`recados_lidos\` (
          \`id\`             int NOT NULL AUTO_INCREMENT PRIMARY KEY,
          \`recado_id\`      int NOT NULL,
          \`usuario_email\`  varchar(320) NOT NULL,
          \`lido_em\`        timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY \`recado_usuario\` (\`recado_id\`, \`usuario_email\`)
        )
      `);
      console.log('[Migration] recados e recados_lidos OK!');
    } catch(e) { console.warn('[Migration] recados:', e); }

    // Migration: configurações do portal (legenda da aba Início + limites Fila/Cotas e Index)
    try {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS \`configuracoes_portal\` (
          \`chave\`          varchar(100) NOT NULL PRIMARY KEY,
          \`valor\`          mediumtext NOT NULL,
          \`atualizado_em\`  timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
          \`atualizado_por\` varchar(255) NULL
        )
      `);
      console.log('[Migration] configuracoes_portal OK!');
    } catch(e) { console.warn('[Migration] configuracoes_portal:', e); }

    // Migration: criar tabelas de condutas GERCON (sincronizadas via Metabase)
    try {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS \`condutas_gercon\` (
          \`id\`             int NOT NULL AUTO_INCREMENT PRIMARY KEY,
          \`especialidade\`  varchar(255)  NOT NULL,
          \`situacao\`       text          NOT NULL,
          \`ciap_cid\`       text          NULL,
          \`conduta\`        text          NOT NULL,
          \`referencias\`    text          NULL,
          \`updatedAt\`      timestamp     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);
      await db.execute(`
        CREATE TABLE IF NOT EXISTS \`condutas_gercon_sync_log\` (
          \`id\`          int NOT NULL AUTO_INCREMENT PRIMARY KEY,
          \`synced_at\`   timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
          \`row_count\`   int NULL,
          \`status\`      varchar(50) NULL DEFAULT 'success',
          \`message\`     text NULL
        )
      `);
      console.log('[Migration] condutas_gercon e condutas_gercon_sync_log OK!');
    } catch(e) { console.warn('[Migration] condutas_gercon:', e); }

    // Migration: heartbeat de atividade no login_log + histórico permanente de atividade
    try {
      const colsLoginLog = await db.execute(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'login_log' AND TABLE_SCHEMA = DATABASE()"
      ) as unknown as [{ COLUMN_NAME: string }[], unknown];
      const loginLogCols = colsLoginLog[0].map((r: { COLUMN_NAME: string }) => r.COLUMN_NAME);
      if (!loginLogCols.includes('ultima_atividade_at')) {
        console.log('[Migration] Adicionando ultima_atividade_at em login_log...');
        await db.execute("ALTER TABLE login_log ADD COLUMN ultima_atividade_at timestamp NULL");
        // Sessões antigas ficaram "abertas" para sempre por falta de logout — encerra todas
        await db.execute("UPDATE login_log SET logout_at = login_at WHERE logout_at IS NULL");
        console.log('[Migration] ultima_atividade_at OK (sessões antigas encerradas).');
      }

      await db.execute(`
        CREATE TABLE IF NOT EXISTS \`atividade_log\` (
          \`id\`             int NOT NULL AUTO_INCREMENT PRIMARY KEY,
          \`usuario_email\`  varchar(320) NOT NULL,
          \`usuario_nome\`   varchar(255) NULL,
          \`tipo\`           varchar(30)  NOT NULL,
          \`agenda_nome\`    varchar(255) NULL,
          \`municipio\`      varchar(255) NULL,
          \`central\`        varchar(100) NULL,
          \`especialidade\`  varchar(255) NULL,
          \`created_at\`     timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
          INDEX \`idx_atividade_email_data\` (\`usuario_email\`, \`created_at\`)
        )
      `);

      // Carga inicial (só na primeira vez): aproveita o que ainda existe de histórico
      const cnt = await db.execute("SELECT COUNT(*) AS total FROM atividade_log") as unknown as [{ total: number }[], unknown];
      if (Number(cnt[0][0]?.total ?? 0) === 0) {
        await db.execute(`
          INSERT INTO atividade_log (usuario_email, usuario_nome, tipo, agenda_nome, municipio, central, especialidade, created_at)
          SELECT LOWER(usuario_email), usuario_nome, 'conclusao', agenda_nome, municipio, central, especialidade, concluido_em
          FROM agendas_concluidas
        `);
        await db.execute(`
          INSERT INTO atividade_log (usuario_email, usuario_nome, tipo, agenda_nome, municipio, central, especialidade, created_at)
          SELECT LOWER(usuario_email), usuario_nome, 'checkin', agenda_nome, municipio, central, especialidade, createdAt
          FROM check_ins
        `);
        console.log('[Migration] atividade_log criada com carga inicial.');
      }
    } catch(e) { console.warn('[Migration] atividade/heartbeat:', e); }

    // Limpeza diária: remover check-ins com mais de 24h
    try {
      await db.execute("DELETE FROM check_ins WHERE createdAt < DATE_SUB(NOW(), INTERVAL 24 HOUR)");
      console.log('[Migration] Check-ins antigos removidos.');
    } catch(e) { console.warn('[Migration] Limpeza check-ins:', e); }
  } catch (err) {
    console.error('[Migration] Erro:', err);
  }
}

async function runDrizzleMigrations() {
  try {
    console.log('[Drizzle] Rodando migrations...');
    const { migrate } = await import('drizzle-orm/mysql2/migrator');
    const { getDb, getConnection } = await import('../db');
    const db = await getDb();
    if (!db) { console.error('[Drizzle] Banco não disponível'); return; }
    await migrate(db, { migrationsFolder: './drizzle' });
    console.log('[Drizzle] Migrations concluídas!');
  } catch (err) {
    console.error('[Drizzle] Erro nas migrations:', err);
  }
}

startServer()
  .then(() => runDrizzleMigrations())
  .then(() => runPendingMigrations())
  .then(() => syncAndSeedIfEmpty(false))
  .then(() => syncCondutasGerconIfEmpty())
  .catch(console.error);

// Sincronização automática diária às 08:30 (horário de Brasília, UTC-3)
// Usa verificação periódica a cada 5 minutos para garantir que não perca o horário
// mesmo após reinicializações do servidor.
let lastSyncDate: string | null = null;

function getBrasiliaHourMinute(): { hour: number; minute: number; dateStr: string } {
  const now = new Date();
  // UTC-3 = subtrair 3 horas
  const brasilia = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  return {
    hour: brasilia.getUTCHours(),
    minute: brasilia.getUTCMinutes(),
    dateStr: brasilia.toISOString().slice(0, 10), // YYYY-MM-DD
  };
}

async function checkAndRunDailySync() {
  const { hour, minute, dateStr } = getBrasiliaHourMinute();
  // Executar entre 08:30 e 08:34 (janela de 5 min), uma vez por dia
  if (hour === 8 && minute >= 30 && minute < 35 && lastSyncDate !== dateStr) {
    lastSyncDate = dateStr;
    console.log(`[Sync] Iniciando sincronização automática diária (${dateStr} 08:30 Brasília)...`);
    try {
      await syncAndSeedIfEmpty(true);
      console.log('[Sync] Sincronização automática concluída com sucesso!');
    } catch (err) {
      console.error('[Sync] Erro na sincronização automática:', err);
    }
  }
}

// Verificar a cada 5 minutos
setInterval(checkAndRunDailySync, 5 * 60 * 1000);
console.log('[Sync] Verificação periódica de sincronização ativada (a cada 5 min, executa às 08:30 Brasília)');

// Sincronização automática diária das condutas GERCON (Metabase) às 08:40 Brasília —
// horário separado do sync do Sheets (08:30) para não concorrer pelo banco ao mesmo tempo.
let lastCondutasSyncDate: string | null = null;

async function checkAndRunDailyCondutasSync() {
  const { hour, minute, dateStr } = getBrasiliaHourMinute();
  if (hour === 8 && minute >= 40 && minute < 45 && lastCondutasSyncDate !== dateStr) {
    lastCondutasSyncDate = dateStr;
    console.log(`[Sync Metabase] Iniciando sincronização automática diária de condutas GERCON (${dateStr} 08:40 Brasília)...`);
    try {
      await syncCondutasGerconComLog();
      console.log('[Sync Metabase] Sincronização automática de condutas GERCON concluída com sucesso!');
    } catch (err) {
      console.error('[Sync Metabase] Erro na sincronização automática de condutas GERCON:', err);
    }
  }
}

setInterval(checkAndRunDailyCondutasSync, 5 * 60 * 1000);
console.log('[Sync Metabase] Verificação periódica de sincronização de condutas GERCON ativada (a cada 5 min, executa às 08:40 Brasília)');
