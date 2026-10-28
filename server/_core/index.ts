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
        await db.delete(checkIns).where(eq(checkIns.usuarioEmail, user.email.toLowerCase()));
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
        // Postgres não aceita ORDER BY/LIMIT em UPDATE: escolhe a sessão aberta mais recente por subconsulta
        await db.execute(
          sql`UPDATE login_log SET logout_at = NOW() WHERE id = (
                SELECT id FROM login_log WHERE regulador_email = ${email} AND logout_at IS NULL ORDER BY login_at DESC LIMIT 1
              )`
        );
      }
    } catch { /* beacon não processa resposta */ }
    res.status(204).end();
  });

  // Verificação de saúde para o servidor/monitoramento da UFRGS:
  // GET /api/health → 200 {"ok":true,"banco":"ok"} ou 503 se o banco não responder.
  app.get("/api/health", async (_req, res) => {
    try {
      const { getDb } = await import("../db");
      const { sql } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) { res.status(503).json({ ok: false, banco: "sem DATABASE_URL" }); return; }
      await db.execute(sql`SELECT 1`);
      res.json({ ok: true, banco: "ok" });
    } catch (e) {
      res.status(503).json({ ok: false, banco: (e as Error).message });
    }
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

/**
 * Prepara o banco PostgreSQL na inicialização:
 *  1. cria as tabelas e índices que ainda não existirem (server/esquemaPostgres.ts);
 *  2. limpeza diária: remove check-ins com mais de 24h.
 *
 * As migrações incrementais antigas (ALTER TABLE do MySQL e a pasta drizzle/*.sql)
 * não são mais usadas: no Postgres o esquema já nasce na versão final.
 */
async function runPendingMigrations() {
  try {
    const { getDb } = await import("../db");
    const db = await getDb();
    if (!db) { console.error('[Esquema PG] Banco não disponível (confira DATABASE_URL)'); return; }

    const { criarEsquemaPostgres } = await import("../esquemaPostgres");
    await criarEsquemaPostgres(db);

    // Limpeza diária: remover check-ins com mais de 24h
    try {
      const { sql } = await import("drizzle-orm");
      await db.execute(sql`DELETE FROM check_ins WHERE createdat < NOW() - INTERVAL '24 hours'`);
      console.log('[Migration] Check-ins antigos removidos.');
    } catch(e) { console.warn('[Migration] Limpeza check-ins:', e); }
  } catch (err) {
    console.error('[Migration] Erro:', err);
  }
}

startServer()
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
