import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import {
  regulacaoData,
  regulacaoDataPg,
  syncLog,
  prioridades,
  agendaProtocolos,
  agendaObservacoes,
  reguladores,
  protocolos,
  encaminhamentos,
  checkIns,
  agendasConcluidas,
  dicionarioEspecialidades,
  reguladorConfig,
  agendasFavoritas,
  agendasRelacionadasConfig,
  semCotas,
  loginLog,
  recados,
  recadosLidos,
  condutasGercon,
  condutasGerconSyncLog,
} from "../drizzle/schema";
import { asc, desc, eq, and, inArray, sql, gte, lte } from "drizzle-orm";
import { syncSheetsToDb, syncPrioridadesToDb, syncDicionarioToDb, syncSemCotasToDb } from "./syncSheets";
import { syncFromPostgres } from "./syncPostgres";
import { syncCondutasGerconComLog } from "./syncMetabase";
import { importCondutasGerconFromCsvComLog } from "./importCondutasCsv";
import { testarQueryPlataformaBackend } from "./plataformaBackendClient";
import { testarConectividadeTcp } from "./diagnosticoRede";
import { registrarAtividadeSessao, registrarEventoAtividade, encerrarSessoesInativas, relatorioUso } from "./atividade";
import { z } from "zod";
import { normalizarLegenda, validarLegenda } from "@shared/legenda";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(async ({ ctx }) => {
      // Registrar logout no log (fechar sessão aberta)
      const userEmail = ctx.user?.email?.toLowerCase();
      if (userEmail) {
        try {
          const db = await getDb();
          if (db) {
            await db.execute(
              // Postgres não aceita ORDER BY/LIMIT em UPDATE: escolhe a sessão aberta mais recente por subconsulta
              sql`UPDATE login_log SET logout_at = NOW() WHERE id = (
                    SELECT id FROM login_log WHERE regulador_email = ${userEmail} AND logout_at IS NULL ORDER BY login_at DESC LIMIT 1
                  )`
            );
          }
        } catch { /* ignora erros no log */ }
      }
      // clearCookie já expira o cookie imediatamente — passar maxAge é depreciado
      // a partir do Express 5 (seria ignorado). getSessionCookieOptions já não inclui
      // maxAge; passamos as opções diretamente para identificar o cookie correto.
      ctx.res.clearCookie(COOKIE_NAME, getSessionCookieOptions(ctx.req));
      return { success: true } as const;
    }),

    /**
     * Heartbeat de atividade — enviado pelo navegador apenas quando há interação
     * real com o portal (ver client/src/hooks/useHeartbeat.ts).
     */
    heartbeat: protectedProcedure.mutation(async ({ ctx }) => {
      const userEmail = ctx.user?.email?.toLowerCase();
      if (!userEmail) return { ok: false };
      const db = await getDb();
      if (!db) return { ok: false };
      const reg = await db
        .select({ nome: reguladores.nome, ativo: reguladores.ativo })
        .from(reguladores)
        .where(eq(reguladores.email, userEmail))
        .limit(1);
      if (reg.length === 0 || reg[0].ativo !== "sim") return { ok: false };
      try { await registrarAtividadeSessao(userEmail, reg[0].nome); } catch { return { ok: false }; }
      return { ok: true };
    }),

    /**
     * Verifica se o usuário autenticado está na lista de reguladores autorizados.
     * Retorna o perfil do regulador se autorizado, ou null se não autorizado.
     */
    checkAccess: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return { authorized: false, regulador: null };

      const userEmail = ctx.user?.email?.toLowerCase();
      if (!userEmail) return { authorized: false, regulador: null };

      const result = await db
        .select()
        .from(reguladores)
        .where(eq(reguladores.email, userEmail))
        .limit(1);

      if (result.length === 0) {
        return { authorized: false, regulador: null };
      }

      const reg = result[0];

      // Carregar o portal conta como atividade (abre ou estende a sessão)
      if (reg.ativo === "sim") {
        try { await registrarAtividadeSessao(userEmail, reg.nome); } catch { /* ignora erros no log */ }
      }

      return {
        authorized: reg.ativo === "sim",
        regulador: {
          nome: reg.nome,
          perfil: reg.perfil,
          grandeGrupo: reg.grandeGrupo,
          agendas: reg.agendas,
          email: reg.email,
        },
      };
    }),
  }),

  sheets: router({
    // Buscar todos os dados da tabela regulacao_data (inclui id no índice 10)
    getData: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return { rows: [], concluidasIds: [] };

      const data = await db
        .select()
        .from(regulacaoData)
        .orderBy(sql`${regulacaoData.indexRegula} DESC NULLS LAST`);

      // Buscar agendas concluídas por QUALQUER usuário hoje, resolvendo o ID ATUAL de regulacao_data.
      // O agendaId salvo nas concluídas pode estar desatualizado após uma sincronização (pois o
      // DELETE+INSERT da sync recria os IDs). Por isso fazemos JOIN por nome+municipio+central
      // e retornamos regulacaoData.id (o ID vigente), garantindo que o bloqueio persista após sync.
      const concluidasHoje = await db
        .selectDistinct({ currentId: regulacaoData.id })
        .from(agendasConcluidas)
        .innerJoin(
          regulacaoData,
          and(
            eq(agendasConcluidas.agendaNome, regulacaoData.agenda),
            sql`${agendasConcluidas.municipio} IS NOT DISTINCT FROM ${regulacaoData.municipio}`,
            sql`${agendasConcluidas.central} IS NOT DISTINCT FROM ${regulacaoData.central}`
          )
        )
        .where(sql`(${agendasConcluidas.concluidoEm} AT TIME ZONE 'America/Sao_Paulo')::date = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date`);
      const concluidasIds = concluidasHoje.map(c => c.currentId);

      // Layout de índices (novo cabeçalho a partir de 2026-04):
      // [0] agenda, [1] municipio, [2] cotas, [3] saldo, [4] aguardando,
      // [5] autorizadas, [6] autCotas, [7] indexRegula,
      // [8] aguardando7d, [9] aguardando28d, [10] aguardando90d,
      // [11] central, [12] especialidade,
      // [13] flagIndex, [14] corIndex, [15] flagAutCotas, [16] corAutCotas, [17] id
      const rows = data.map(row => [
        row.agenda ?? "",          // 0
        row.municipio ?? "",       // 1
        row.cotas ?? 0,            // 2
        row.saldo ?? 0,            // 3
        row.aguardando ?? 0,       // 4
        row.autorizadas ?? 0,      // 5
        row.autCotas ?? "",        // 6
        row.indexRegula ?? 0,      // 7
        row.aguardando7d ?? 0,    // 8
        row.aguardando28d ?? 0,    // 9
        row.aguardando90d ?? 0,    // 10
        row.central ?? "",         // 11
        row.especialidade ?? "",   // 12
        row.flagIndex ?? "",       // 13: flag/tooltip do IndexRegula
        row.corIndex ?? "",        // 14: cor para colorir a linha
        row.flagAutCotas ?? "",    // 15: flag/tooltip do Fila/Cotas
        row.corAutCotas ?? "",     // 16: cor para colorir o valor Fila/Cotas
        row.id,                    // 17: id para encaminhamentos e check-ins
      ]);

      return { rows, concluidasIds };
    }),


    // Retornar TODAS as agendas (sem filtro de perfil) — usado no dropdown de favoritas
    // para que reguladores possam escolher agendas de qualquer especialidade.
    getAllAgendas: protectedProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      const data = await db
        .select({
          id: regulacaoData.id,
          agenda: regulacaoData.agenda,
          municipio: regulacaoData.municipio,
          central: regulacaoData.central,
          especialidade: regulacaoData.especialidade,
        })
        .from(regulacaoData)
        .orderBy(regulacaoData.agenda);
      return data;
    }),

    // Retornar cores únicas disponíveis na coluna corIndex (para filtro dinâmico)
    getCoresDisponiveis: protectedProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      const rows = await db
        .selectDistinct({ corIndex: regulacaoData.corIndex })
        .from(regulacaoData);
      return rows
        .map(r => r.corIndex ?? '')
        .filter(Boolean)
        .sort();
    }),

    // Sincronizar dados manualmente
    sync: protectedProcedure.mutation(async () => {
      try {
        const count = await syncSheetsToDb();
        return { success: true, count };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Erro desconhecido";
        const db = await getDb();
        if (db) {
          await db.insert(syncLog).values({
            rowCount: 0,
            status: "error",
            message,
          });
        }
        throw error;
      }
    }),

    // Sincronizar todos os bancos de dados de uma vez (Final + Reguladores + Dicionário)
    syncAll: protectedProcedure.mutation(async () => {
      const db = await getDb();
      const results: Record<string, number> = {};
      const errors: string[] = [];

      // 1. Aba Final (agendas)
      try {
        results.agendas = await syncSheetsToDb();
      } catch (e) {
        errors.push(`Agendas: ${e instanceof Error ? e.message : 'erro desconhecido'}`);
      }

      // 2. Dicionário de Especialidades
      try {
        results.dicionario = await syncDicionarioToDb();
      } catch (e) {
        errors.push(`Dicionário: ${e instanceof Error ? e.message : 'erro desconhecido'}`);
      }

      // 3. Aba Sem Cotas
      try {
        results.semCotas = await syncSemCotasToDb();
      } catch (e) {
        errors.push(`Sem Cotas: ${e instanceof Error ? e.message : 'erro desconhecido'}`);
      }

      if (db && errors.length > 0) {
        await db.insert(syncLog).values({
          rowCount: 0,
          status: 'error',
          message: `Erros parciais: ${errors.join('; ')}`,
        });
      }

      if (errors.length === 3) {
        throw new Error(`Falha em todas as sincronizações: ${errors.join('; ')}`);
      }

      return { success: true, results, errors };
    }),

    // Buscar data/hora da última sincronização bem-sucedida
    getUltimaAtualizacao: publicProcedure.query(async () => {
      const db = await getDb();
      if (!db) return null;
      const rows = await db
        .select({ syncedAt: syncLog.syncedAt, rowCount: syncLog.rowCount })
        .from(syncLog)
        .where(eq(syncLog.status, 'success'))
        .orderBy(desc(syncLog.syncedAt))
        .limit(1);
      return rows[0] ?? null;
    }),
    // Buscar histórico de sincronizações
    getSyncHistory: protectedProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];

      return db
        .select()
        .from(syncLog)
        .orderBy(desc(syncLog.syncedAt))
        .limit(10);
    }),

    // Diagnóstico de conectividade com o PostgreSQL externo (apenas administradores)
    testePgConexao: protectedProcedure.query(async ({ ctx }) => {
      const { Client } = await import("pg");
      const net = await import("net");
      const userEmail = ctx.user?.email?.toLowerCase() ?? "";
      const db = await getDb();
      if (!db) throw new Error("Banco não disponível");
      const reg = await db.select({ perfil: reguladores.perfil }).from(reguladores).where(eq(reguladores.email, userEmail)).limit(1);
      const perfil = (reg[0]?.perfil ?? "").toLowerCase();
      if (!perfil.includes("administrador")) throw new Error("Acesso restrito a administradores");

      const host = process.env.PG_HOST ?? "200.169.24.32";
      const port = parseInt(process.env.PG_PORT ?? "5000", 10);

      // Teste 0: descobrir IP de saída do Railway
      let ipSaida = "desconhecido";
      try {
        const r = await fetch("https://api.ipify.org?format=json");
        const j = await r.json() as { ip: string };
        ipSaida = j.ip;
      } catch { /* ignora */ }

      // Teste 1: TCP — consegue abrir socket na porta?
      const tcpOk = await new Promise<boolean>((resolve) => {
        const socket = net.createConnection({ host, port });
        socket.setTimeout(5000);
        socket.on("connect", () => { socket.destroy(); resolve(true); });
        socket.on("error", () => resolve(false));
        socket.on("timeout", () => { socket.destroy(); resolve(false); });
      });

      if (!tcpOk) {
        return { tcpOk: false, pgOk: false, mensagem: `IP de saída do Railway: ${ipSaida} — Não foi possível abrir conexão TCP com ${host}:${port}.` };
      }

      // Teste 2: autenticação PostgreSQL — tenta sem SSL, depois com SSL
      const tentativas = [
        { ssl: false,                          label: "sem SSL" },
        { ssl: { rejectUnauthorized: false },  label: "com SSL (rejectUnauthorized: false)" },
        { ssl: { rejectUnauthorized: true },   label: "com SSL estrito" },
      ];
      for (const t of tentativas) {
        const client = new Client({
          host, port,
          database: process.env.PG_DATABASE ?? "sesdw",
          user: process.env.PG_USER ?? "telessaude_read",
          password: process.env.PG_PASSWORD ?? "tQ#f7qBZ$9pu",
          ssl: t.ssl as never,
          connectionTimeoutMillis: 8000,
        });
        try {
          await client.connect();
          await client.end();
          return { tcpOk: true, pgOk: true, mensagem: `Conexão bem-sucedida (${t.label})!` };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          // Se não for timeout, pode ser erro de SSL/auth — reporta e continua tentando
          if (!msg.includes("timeout")) {
            return { tcpOk: true, pgOk: false, mensagem: `IP de saída: ${ipSaida} — Falhou (${t.label}): ${msg}` };
          }
          // timeout — tenta próxima configuração
        } finally {
          await client.end().catch(() => {});
        }
      }
      return { tcpOk: true, pgOk: false, mensagem: `IP de saída do Railway: ${ipSaida} — Todas as tentativas expiraram. Passe este IP para o time de infra liberar no pg_hba.conf do servidor ${host}:${port}.` };
    }),

    // Sincronizar prévia PostgreSQL (apenas administradores)
    syncPg: protectedProcedure.mutation(async ({ ctx }) => {
      const userEmail = ctx.user?.email?.toLowerCase() ?? "";
      const db = await getDb();
      if (!db) throw new Error("Banco não disponível");
      const reg = await db.select({ perfil: reguladores.perfil }).from(reguladores).where(eq(reguladores.email, userEmail)).limit(1);
      const perfil = (reg[0]?.perfil ?? "").toLowerCase();
      if (!perfil.includes("administrador")) throw new Error("Acesso restrito a administradores");
      const count = await syncFromPostgres();
      return { success: true, count };
    }),

    // Buscar dados da prévia PostgreSQL (apenas administradores)
    getDataPg: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return { rows: [], concluidasIds: [] };
      const userEmail = ctx.user?.email?.toLowerCase() ?? "";
      const reg = await db.select({ perfil: reguladores.perfil }).from(reguladores).where(eq(reguladores.email, userEmail)).limit(1);
      const perfil = (reg[0]?.perfil ?? "").toLowerCase();
      if (!perfil.includes("administrador")) return { rows: [], concluidasIds: [] };
      const data = await db.select().from(regulacaoDataPg).orderBy(regulacaoDataPg.agenda);
      const rows = data.map(row => [
        row.agenda,        // 0  agenda
        row.municipio,     // 1  municipio
        row.cotas,         // 2  cotas
        row.saldo,         // 3  saldo
        row.aguardando,    // 4  aguardando
        row.autorizadas,   // 5  autorizadas
        row.autCotas,      // 6  aut_cotas / fila_cotas
        row.indexRegula,   // 7  index_regula
        row.aguardando7d,  // 8  > 7 dias
        row.aguardando28d, // 9  > 28 dias
        row.aguardando90d, // 10 > 90 dias
        row.central,       // 11 central
        row.especialidade, // 12 especialidade
        row.flagIndex,     // 13 flag_index
        row.corIndex,      // 14 cor_index
        row.flagAutCotas,  // 15 flag_aut_cotas
        row.corAutCotas,   // 16 cor_aut_cotas
        row.id,            // 17 id
      ]);
      return { rows, concluidasIds: [] as number[] };
    }),
  }),

    prioridades: router({
    // Buscar todas as listas de prioridades
    getAll: protectedProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      return db
        .select()
        .from(prioridades)
        .orderBy(asc(prioridades.grandeGrupo), asc(prioridades.nomeArquivo));
    }),
    // Criar prioridade manualmente
    criar: protectedProcedure
      .input(z.object({
        grandeGrupo: z.string().min(1).max(255),
        nomeArquivo: z.string().min(1).max(500),
        linkUrl: z.string().url().optional().or(z.literal('')),
      }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new Error('Banco indisponível');
        const userEmail = ctx.user?.email ?? '';
        const meReg = await db.select({ perfil: reguladores.perfil }).from(reguladores).where(eq(reguladores.email, userEmail)).limit(1);
        const perfil = meReg[0]?.perfil?.toLowerCase() ?? '';
        if (!['administrador', 'admin', 'monitor', 'monitoramento'].some(p => perfil.includes(p))) {
          throw new Error('Sem permissão para criar prioridades');
        }
        await db.insert(prioridades).values({
          grandeGrupo: input.grandeGrupo,
          nomeArquivo: input.nomeArquivo,
          linkUrl: input.linkUrl || null,
        });
        return { success: true };
      }),
    // Atualizar prioridade
    atualizar: protectedProcedure
      .input(z.object({
        id: z.number(),
        grandeGrupo: z.string().min(1).max(255),
        nomeArquivo: z.string().min(1).max(500),
        linkUrl: z.string().url().optional().or(z.literal('')),
      }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new Error('Banco indisponível');
        const userEmail = ctx.user?.email ?? '';
        const meReg = await db.select({ perfil: reguladores.perfil }).from(reguladores).where(eq(reguladores.email, userEmail)).limit(1);
        const perfil = meReg[0]?.perfil?.toLowerCase() ?? '';
        if (!['administrador', 'admin', 'monitor', 'monitoramento'].some(p => perfil.includes(p))) {
          throw new Error('Sem permissão para editar prioridades');
        }
        await db.update(prioridades)
          .set({ grandeGrupo: input.grandeGrupo, nomeArquivo: input.nomeArquivo, linkUrl: input.linkUrl || null })
          .where(eq(prioridades.id, input.id));
        return { success: true };
      }),
    // Excluir prioridade
    excluir: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new Error('Banco indisponível');
        const userEmail = ctx.user?.email ?? '';
        const meReg = await db.select({ perfil: reguladores.perfil }).from(reguladores).where(eq(reguladores.email, userEmail)).limit(1);
        const perfil = meReg[0]?.perfil?.toLowerCase() ?? '';
        if (!['administrador', 'admin', 'monitor', 'monitoramento'].some(p => perfil.includes(p))) {
          throw new Error('Sem permissão para excluir prioridades');
        }
        await db.delete(prioridades).where(eq(prioridades.id, input.id));
        return { success: true };
      }),
    // Sincronizar prioridades manualmente
    sync: protectedProcedure.mutation(async () => {
      try {
        const count = await syncPrioridadesToDb();
        return { success: true, count };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Erro desconhecido";
        throw new Error(message);
      }
    }),
  }),

    protocolos: router({
    // Buscar todos os protocolos
    getAll: protectedProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      return db
        .select()
        .from(protocolos)
        .orderBy(asc(protocolos.nome));
    }),
    // Criar protocolo manualmente
    criar: protectedProcedure
      .input(z.object({
        nome: z.string().min(1).max(500),
        linkUrl: z.string().url().optional().or(z.literal('')),
      }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new Error('Banco indisponível');
        const userEmail = ctx.user?.email ?? '';
        const meReg = await db.select({ perfil: reguladores.perfil }).from(reguladores).where(eq(reguladores.email, userEmail)).limit(1);
        const perfil = meReg[0]?.perfil?.toLowerCase() ?? '';
        if (!['administrador', 'admin', 'monitor', 'monitoramento'].some(p => perfil.includes(p))) {
          throw new Error('Sem permissão para criar protocolos');
        }
        await db.insert(protocolos).values({
          nome: input.nome,
          linkUrl: input.linkUrl || null,
        });
        return { success: true };
      }),
    // Atualizar protocolo
    atualizar: protectedProcedure
      .input(z.object({
        id: z.number(),
        nome: z.string().min(1).max(500),
        linkUrl: z.string().url().optional().or(z.literal('')),
      }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new Error('Banco indisponível');
        const userEmail = ctx.user?.email ?? '';
        const meReg = await db.select({ perfil: reguladores.perfil }).from(reguladores).where(eq(reguladores.email, userEmail)).limit(1);
        const perfil = meReg[0]?.perfil?.toLowerCase() ?? '';
        if (!['administrador', 'admin', 'monitor', 'monitoramento'].some(p => perfil.includes(p))) {
          throw new Error('Sem permissão para editar protocolos');
        }
        await db.update(protocolos)
          .set({ nome: input.nome, linkUrl: input.linkUrl || null })
          .where(eq(protocolos.id, input.id));
        return { success: true };
      }),
    // Excluir protocolo
    excluir: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new Error('Banco indisponível');
        const userEmail = ctx.user?.email ?? '';
        const meReg = await db.select({ perfil: reguladores.perfil }).from(reguladores).where(eq(reguladores.email, userEmail)).limit(1);
        const perfil = meReg[0]?.perfil?.toLowerCase() ?? '';
        if (!['administrador', 'admin', 'monitor', 'monitoramento'].some(p => perfil.includes(p))) {
          throw new Error('Sem permissão para excluir protocolos');
        }
        await db.delete(protocolos).where(eq(protocolos.id, input.id));
        return { success: true };
      }),
    // Sincronização via planilha desativada — protocolos gerenciados pelo portal
    sync: protectedProcedure.mutation(async () => {
      return { success: false, message: "Sincronização de protocolos via planilha foi desativada. Use o portal para gerenciar protocolos." };
    }),
  }),

  reguladores: router({
    // Sincronização de reguladores via planilha foi desativada.
    // Reguladores são agora gerenciados diretamente pelo portal.
    sync: protectedProcedure.mutation(async () => {
      return { success: false, message: "Sincronização de reguladores via planilha foi desativada. Use o portal para gerenciar reguladores." };
    }),

    // Listar todos os usuários ativos cadastrados (para encaminhamento por Admin/Monitor)
    listarReguladores: protectedProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      return db
        .select({ nome: reguladores.nome, email: reguladores.email, perfil: reguladores.perfil })
        .from(reguladores)
        .where(eq(reguladores.ativo, "sim"))
        .orderBy(asc(reguladores.nome));
    }),
  }),

  dicionario: router({
    // Buscar todo o dicionário agenda → especialidade
    getAll: publicProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      return db
        .select({ agenda: dicionarioEspecialidades.agenda, especialidade: dicionarioEspecialidades.especialidade })
        .from(dicionarioEspecialidades)
        .orderBy(asc(dicionarioEspecialidades.agenda));
    }),

    // Sincronizar dicionário manualmente
    sync: protectedProcedure.mutation(async () => {
      try {
        const count = await syncDicionarioToDb();
        return { success: true, count };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Erro desconhecido";
        throw new Error(message);
      }
    }),
  }),

  encaminhamentos: router({
    // Buscar encaminhamentos destinados ao usuário logado (com dados atualizados da agenda)
    // Inclui agendas favoritas do regulador como encaminhamentos virtuais (isFavorita=true).
    getMinhas: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return [];
      const email = ctx.user?.email ?? "";

      // 1. Buscar encaminhamentos reais com JOIN na tabela de dados
      // JOIN usa agendaNome + municipio + central como chave composta para evitar duplicatas.
      // IMPORTANTE: usar eq() direto (match exato) em vez de isNull()+or(), pois agendas sem
      // município têm municipio='' (string vazia, não NULL). Se usarmos isNull()+or(), o JOIN
      // faz match com TODAS as agendas de mesmo nome que também têm municipio='', causando
      // duplicação de linhas (ex: ORTOPEDIA ADULTO aparece em 16 centrais diferentes).
      const encResult = await db
        .select({
          id: encaminhamentos.id,
          agendaId: encaminhamentos.agendaId,
          agendaNome: encaminhamentos.agendaNome,
          especialidade: encaminhamentos.especialidade,
          reguladorEmail: encaminhamentos.reguladorEmail,
          reguladorNome: encaminhamentos.reguladorNome,
          encaminhadoPorEmail: encaminhamentos.encaminhadoPorEmail,
          encaminhadoPorNome: encaminhamentos.encaminhadoPorNome,
          createdAt: encaminhamentos.createdAt,
          // Dados atualizados da agenda via JOIN
          municipio: regulacaoData.municipio,
          central: regulacaoData.central,
          cotas: regulacaoData.cotas,
          saldo: regulacaoData.saldo,
          aguardando: regulacaoData.aguardando,
          aguardando7d: regulacaoData.aguardando7d,
          aguardando28d: regulacaoData.aguardando28d,
          aguardando90d: regulacaoData.aguardando90d,
          autorizadas: regulacaoData.autorizadas,
          autCotas: regulacaoData.autCotas,
          indexRegula: regulacaoData.indexRegula,
          flagIndex: regulacaoData.flagIndex,
          corIndex: regulacaoData.corIndex,
          flagAutCotas: regulacaoData.flagAutCotas,
          corAutCotas: regulacaoData.corAutCotas,
        })
        .from(encaminhamentos)
        .leftJoin(
          regulacaoData,
          and(
            eq(encaminhamentos.agendaNome, regulacaoData.agenda),
            sql`${encaminhamentos.municipio} IS NOT DISTINCT FROM ${regulacaoData.municipio}`,
            sql`${encaminhamentos.central} IS NOT DISTINCT FROM ${regulacaoData.central}`
          )
        )
        .where(eq(encaminhamentos.reguladorEmail, email))
        .orderBy(sql`${regulacaoData.indexRegula} DESC NULLS LAST`, desc(encaminhamentos.createdAt));

      // 2. Buscar agendas favoritas do regulador com dados atualizados via JOIN
      const favResult = await db
        .select({
          favId: agendasFavoritas.id,
          agendaId: agendasFavoritas.agendaId,
          agendaNome: agendasFavoritas.agendaNome,
          especialidade: agendasFavoritas.especialidade,
          // Dados atualizados da agenda via JOIN
          municipio: regulacaoData.municipio,
          central: regulacaoData.central,
          cotas: regulacaoData.cotas,
          saldo: regulacaoData.saldo,
          aguardando: regulacaoData.aguardando,
          aguardando7d: regulacaoData.aguardando7d,
          aguardando28d: regulacaoData.aguardando28d,
          aguardando90d: regulacaoData.aguardando90d,
          autorizadas: regulacaoData.autorizadas,
          autCotas: regulacaoData.autCotas,
          indexRegula: regulacaoData.indexRegula,
          flagIndex: regulacaoData.flagIndex,
          corIndex: regulacaoData.corIndex,
          flagAutCotas: regulacaoData.flagAutCotas,
          corAutCotas: regulacaoData.corAutCotas,
        })
        .from(agendasFavoritas)
        .leftJoin(
          regulacaoData,
          and(
            eq(agendasFavoritas.agendaNome, regulacaoData.agenda),
            sql`${agendasFavoritas.municipio} IS NOT DISTINCT FROM ${regulacaoData.municipio}`,
            sql`${agendasFavoritas.central} IS NOT DISTINCT FROM ${regulacaoData.central}`
          )
        )
        .where(eq(agendasFavoritas.reguladorEmail, email));

      // 3. Converter favoritas para o mesmo formato dos encaminhamentos
      // IDs negativos para distinguir de encaminhamentos reais no frontend
      const encIds = new Set(encResult.map(e => e.agendaId));
      const favAsEnc = favResult
        .filter(f => !encIds.has(f.agendaId)) // não duplicar se já encaminhada
        .map(f => ({
          id: -(f.favId),          // ID negativo = favorita
          agendaId: f.agendaId,
          agendaNome: f.agendaNome,
          especialidade: f.especialidade ?? "",
          reguladorEmail: email,
          reguladorNome: "",
          encaminhadoPorEmail: "favorita",
          encaminhadoPorNome: "Favorita",
          createdAt: new Date(),
          municipio: f.municipio,
          central: f.central,
          cotas: f.cotas,
          saldo: f.saldo,
          aguardando: f.aguardando,
          aguardando7d: f.aguardando7d,
          aguardando28d: f.aguardando28d,
          aguardando90d: f.aguardando90d,
          autorizadas: f.autorizadas,
          autCotas: f.autCotas,
          indexRegula: f.indexRegula,
          flagIndex: f.flagIndex,
          corIndex: f.corIndex,
          flagAutCotas: f.flagAutCotas,
          corAutCotas: f.corAutCotas,
        }));

      // 4. Combinar: encaminhamentos reais primeiro, depois favoritas
      return [...encResult, ...favAsEnc];
    }),

    // Buscar todos os encaminhamentos (carregado uma vez para a tabela)
    getAll: protectedProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      return db
        .select()
        .from(encaminhamentos)
        .orderBy(desc(encaminhamentos.createdAt));
    }),

    // Remover um encaminhamento específico (pelo próprio regulador destinatário)
    removerMeu: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new Error("Banco de dados não disponível");
        const email = ctx.user?.email ?? "";
        // Só permite remover encaminhamentos destinados ao próprio usuário
        await db
          .delete(encaminhamentos)
          .where(and(
            eq(encaminhamentos.id, input.id),
            eq(encaminhamentos.reguladorEmail, email)
          ));
        return { success: true };
      }),

    // Remover todos os encaminhamentos destinados ao usuário logado
    removerTodos: protectedProcedure
      .mutation(async ({ ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Banco de dados não disponível");
        const email = ctx.user?.email ?? "";
        await db
          .delete(encaminhamentos)
          .where(eq(encaminhamentos.reguladorEmail, email));
        return { success: true };
      }),

    // Encaminhar agenda para reguladores (admin/monitor)
    encaminhar: protectedProcedure
      .input(z.object({
        agendaId: z.number(),
        agendaNome: z.string(),
        municipio: z.string().optional(),
        central: z.string().optional(),
        especialidade: z.string(),
        reguladores: z.array(z.object({
          email: z.string(),
          nome: z.string(),
        })),
      }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new Error("Banco de dados não disponível");

        const encaminhadoPorEmail = ctx.user?.email ?? "";
        const encaminhadoPorNome = ctx.user?.name ?? "";

        // Remover encaminhamentos anteriores desta agenda
        await db
          .delete(encaminhamentos)
          .where(eq(encaminhamentos.agendaId, input.agendaId));

        if (input.reguladores.length === 0) return { success: true };

        // Inserir novos encaminhamentos
        await db.insert(encaminhamentos).values(
          input.reguladores.map(reg => ({
            agendaId: input.agendaId,
            agendaNome: input.agendaNome,
            municipio: input.municipio ?? null,
            central: input.central ?? null,
            especialidade: input.especialidade,
            reguladorEmail: reg.email,
            reguladorNome: reg.nome,
            encaminhadoPorEmail,
            encaminhadoPorNome,
          }))
        );

        return { success: true };
      }),

    // Auto-encaminhamento: regulador encaminha agenda para si mesmo (toggle)
    autoEncaminhar: protectedProcedure
      .input(z.object({
        agendaId: z.number(),
        agendaNome: z.string(),
        municipio: z.string().optional(),
        central: z.string().optional(),
        especialidade: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new Error("Banco de dados não disponível");

        const email = ctx.user?.email ?? "";
        const nome = ctx.user?.name ?? "";

        // Verificar se já existe encaminhamento para este usuário nesta agenda
        const existing = await db
          .select()
          .from(encaminhamentos)
          .where(and(
            eq(encaminhamentos.agendaId, input.agendaId),
            eq(encaminhamentos.reguladorEmail, email)
          ))
          .limit(1);

        if (existing.length > 0) {
          // Já existe: remover (toggle off)
          await db
            .delete(encaminhamentos)
            .where(and(
              eq(encaminhamentos.agendaId, input.agendaId),
              eq(encaminhamentos.reguladorEmail, email)
            ));
          return { action: 'removed' };
        } else {
          // Não existe: inserir (toggle on)
          await db.insert(encaminhamentos).values({
            agendaId: input.agendaId,
            agendaNome: input.agendaNome,
            municipio: input.municipio ?? null,
            central: input.central ?? null,
            especialidade: input.especialidade,
            reguladorEmail: email,
            reguladorNome: nome,
            encaminhadoPorEmail: email,
            encaminhadoPorNome: nome,
          });
          return { action: 'added' };
        }
      }),
  }),

  checkIns: router({
    // Buscar check-ins do usuário logado (com flags atualizadas via JOIN)
    getMeus: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return [];
      const email = ctx.user?.email ?? "";
      return db
        .select({
          id: checkIns.id,
          // Retorna o ID ATUAL de regulacao_data (não o agendaId salvo no check-in,
          // que pode estar desatualizado após uma sync DELETE+INSERT).
          agendaId: regulacaoData.id,
          agendaNome: checkIns.agendaNome,
          municipio: checkIns.municipio,
          especialidade: checkIns.especialidade,
          central: checkIns.central,
          // Dados numéricos atualizados via JOIN com regulacao_data
          cotas: regulacaoData.cotas,
          autorizadas: regulacaoData.autorizadas,
          autCotas: regulacaoData.autCotas,
          saldo: regulacaoData.saldo,
          aguardando: regulacaoData.aguardando,
          aguardando7d: regulacaoData.aguardando7d,
          aguardando28d: regulacaoData.aguardando28d,
          aguardando90d: regulacaoData.aguardando90d,
          indexRegula: regulacaoData.indexRegula,
          flagIndex: regulacaoData.flagIndex,
          corIndex: regulacaoData.corIndex,
          flagAutCotas: regulacaoData.flagAutCotas,
          corAutCotas: regulacaoData.corAutCotas,
          usuarioEmail: checkIns.usuarioEmail,
          usuarioNome: checkIns.usuarioNome,
          createdAt: checkIns.createdAt,
        })
        .from(checkIns)
        .leftJoin(
          regulacaoData,
          and(
            eq(checkIns.agendaNome, regulacaoData.agenda),
            sql`${checkIns.municipio} IS NOT DISTINCT FROM ${regulacaoData.municipio}`,
            sql`${checkIns.central} IS NOT DISTINCT FROM ${regulacaoData.central}`
          )
        )
        .where(and(
          eq(checkIns.usuarioEmail, email),
          sql`(${checkIns.createdAt} AT TIME ZONE 'America/Sao_Paulo')::date = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date`
        ))
        .orderBy(desc(checkIns.createdAt));
    }),

    // Buscar check-ins ativos para um conjunto de agendas (para exibir quem está regulando em Minhas Agendas)
    getPorAgendas: protectedProcedure
      .input(z.object({ agendaIds: z.array(z.number()) }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db || input.agendaIds.length === 0) return {};
        // O frontend passa IDs atuais de regulacao_data (row[17]).
        // Fazemos JOIN para resolver o ID atual e filtrar corretamente,
        // mesmo que checkIns.agendaId esteja desatualizado após uma sync.
        const rows = await db
          .select({
            agendaId: regulacaoData.id,
            usuarioEmail: checkIns.usuarioEmail,
            usuarioNome: checkIns.usuarioNome,
          })
          .from(checkIns)
          .innerJoin(
            regulacaoData,
            and(
              eq(checkIns.agendaNome, regulacaoData.agenda),
              sql`${checkIns.municipio} IS NOT DISTINCT FROM ${regulacaoData.municipio}`,
              sql`${checkIns.central} IS NOT DISTINCT FROM ${regulacaoData.central}`
            )
          )
          .where(inArray(regulacaoData.id, input.agendaIds));
        // Agrupar por agendaId atual
        const grouped: Record<number, { usuarioEmail: string; usuarioNome: string }[]> = {};
        for (const row of rows) {
          if (row.agendaId == null) continue;
          if (!grouped[row.agendaId]) grouped[row.agendaId] = [];
          grouped[row.agendaId].push({ usuarioEmail: row.usuarioEmail, usuarioNome: row.usuarioNome });
        }
        return grouped;
      }),

    // Buscar todos os check-ins (para exibir na tabela — coluna "Regulando")
    getAll: protectedProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      return db
        .select({
          id: checkIns.id,
          // Retorna o ID ATUAL de regulacao_data (não o agendaId salvo no check-in,
          // que pode estar desatualizado após uma sync DELETE+INSERT).
          // O frontend usa esse valor para indexar checkInsPorAgenda por row[17].
          agendaId: regulacaoData.id,
          agendaNome: checkIns.agendaNome,
          municipio: checkIns.municipio,
          especialidade: checkIns.especialidade,
          central: checkIns.central,
          // Dados numéricos atualizados via JOIN com regulacao_data
          cotas: regulacaoData.cotas,
          autorizadas: regulacaoData.autorizadas,
          autCotas: regulacaoData.autCotas,
          saldo: regulacaoData.saldo,
          aguardando: regulacaoData.aguardando,
          aguardando7d: regulacaoData.aguardando7d,
          aguardando28d: regulacaoData.aguardando28d,
          aguardando90d: regulacaoData.aguardando90d,
          indexRegula: regulacaoData.indexRegula,
          flagIndex: regulacaoData.flagIndex,
          corIndex: regulacaoData.corIndex,
          flagAutCotas: regulacaoData.flagAutCotas,
          corAutCotas: regulacaoData.corAutCotas,
          usuarioEmail: checkIns.usuarioEmail,
          usuarioNome: checkIns.usuarioNome,
          createdAt: checkIns.createdAt,
        })
        .from(checkIns)
        .leftJoin(
          regulacaoData,
          and(
            eq(checkIns.agendaNome, regulacaoData.agenda),
            sql`${checkIns.municipio} IS NOT DISTINCT FROM ${regulacaoData.municipio}`,
            sql`${checkIns.central} IS NOT DISTINCT FROM ${regulacaoData.central}`
          )
        )
        .where(sql`(${checkIns.createdAt} AT TIME ZONE 'America/Sao_Paulo')::date = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date`)
        .orderBy(desc(checkIns.createdAt));
    }),

    // Fazer check-in ou check-out em uma agenda (toggle)
    checkIn: protectedProcedure
      .input(z.object({
        agendaId: z.number(),
        agendaNome: z.string(),
        municipio: z.string().optional(),
        especialidade: z.string(),
        central: z.string().optional(),
        cotas: z.number().optional(),
        saldo: z.number().optional(),
        aguardando: z.number().optional(),
        indexRegula: z.number().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new Error("Banco de dados não disponível");

        const usuarioEmail = ctx.user?.email ?? "";
        const usuarioNome = ctx.user?.name ?? "";

        // Verificar se já existe check-in desta agenda para este usuário.
        // Usamos agendaNome+municipio+central (chaves estáveis) em vez de agendaId,
        // pois o agendaId salvo no check-in pode estar desatualizado após uma sync
        // DELETE+INSERT que recria os autoincrement IDs da regulacao_data.
        const existing = await db
          .select()
          .from(checkIns)
          .where(and(
            eq(checkIns.agendaNome, input.agendaNome),
            sql`${checkIns.municipio} IS NOT DISTINCT FROM ${input.municipio ?? null}`,
            sql`${checkIns.central} IS NOT DISTINCT FROM ${input.central ?? null}`,
            eq(checkIns.usuarioEmail, usuarioEmail)
          ))
          .limit(1);

        if (existing.length > 0) {
          // Já tem check-in: fazer check-out (remover)
          await db
            .delete(checkIns)
            .where(and(
              eq(checkIns.agendaNome, input.agendaNome),
              sql`${checkIns.municipio} IS NOT DISTINCT FROM ${input.municipio ?? null}`,
              sql`${checkIns.central} IS NOT DISTINCT FROM ${input.central ?? null}`,
              eq(checkIns.usuarioEmail, usuarioEmail)
            ));
          return { action: "checkout" as const, bloqueado: false, reguladores: [] };
        }

        // Verificar quantos check-ins existem para esta agenda (de outros usuários)
        // Também por chaves estáveis para consistência pós-sync.
        const checkInsAgenda = await db
          .select({
            usuarioNome: checkIns.usuarioNome,
            usuarioEmail: checkIns.usuarioEmail,
          })
          .from(checkIns)
          .where(and(
            eq(checkIns.agendaNome, input.agendaNome),
            sql`${checkIns.municipio} IS NOT DISTINCT FROM ${input.municipio ?? null}`,
            sql`${checkIns.central} IS NOT DISTINCT FROM ${input.central ?? null}`
          ));

        const LIMITE_CHECKINS = 2;
        if (checkInsAgenda.length >= LIMITE_CHECKINS) {
          // Agenda já está com o limite de reguladores ativos
          return {
            action: "bloqueado" as const,
            bloqueado: true,
            reguladores: checkInsAgenda.map(c => c.usuarioNome),
          };
        }

        // Fazer check-in
        await db.insert(checkIns).values({
          agendaId: input.agendaId,
          agendaNome: input.agendaNome,
          municipio: input.municipio,
          especialidade: input.especialidade,
          central: input.central,
          cotas: input.cotas,
          saldo: input.saldo,
          aguardando: input.aguardando,
          indexRegula: input.indexRegula,
          usuarioEmail,
          usuarioNome,
        });

        // Histórico permanente (check_ins é apagada no check-out e após 24h)
        await registrarEventoAtividade({
          email: usuarioEmail, nome: usuarioNome, tipo: "checkin",
          agendaNome: input.agendaNome, municipio: input.municipio,
          central: input.central, especialidade: input.especialidade,
        });

        return { action: "checkin" as const, bloqueado: false, reguladores: [] };
      }),

    // Remover todos os check-ins do usuário (chamado no logout)
    clearMeus: protectedProcedure.mutation(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return { success: false };
      const email = ctx.user?.email ?? "";
      await db
        .delete(checkIns)
        .where(eq(checkIns.usuarioEmail, email));
      return { success: true };
    }),

    // Buscar agendas relacionadas (mesma especialidade + central/municipio) e recursos da especialidade
    getRelacionadas: protectedProcedure
      .input(z.object({
        especialidade: z.string(),
        central: z.string().optional(),
        municipio: z.string().optional(),
        agendaIdExcluir: z.number(),
        agendaNomeExcluir: z.string().optional(),
      }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return { agendas: [], prioridades: [], protocolos: [] };

        // Normalizar especialidade (pode ser composta, ex: "Fisiatria, Reumatologia")
        const especialidades = input.especialidade
          .split(/[,;/]+/)
          .map(e => e.trim().toLowerCase())
          .filter(Boolean);

        // Buscar todas as agendas do banco PRIMEIRO (necessário para resolver nomeAgenda)
        const todasAgendas = await db
          .select()
          .from(regulacaoData)
          .orderBy(sql`${regulacaoData.indexRegula} DESC NULLS LAST`);

        // Verificar se há configuração personalizada de agendas relacionadas.
        // A config é salva por nome de agenda (não por ID), pois a mesma agenda
        // existe em múltiplas centrais e a config deve ser compartilhada entre elas.
        // Usar nome direto se disponível (mais robusto após ressync que muda IDs)
        const agendaEmRegulacao = todasAgendas.find(a => a.id === input.agendaIdExcluir);
        const nomeAgendaEmRegulacao = input.agendaNomeExcluir || agendaEmRegulacao?.agenda || '';

        const configPersonalizada = nomeAgendaEmRegulacao
          ? await db
              .select()
              .from(agendasRelacionadasConfig)
              .where(eq(agendasRelacionadasConfig.agendaNome, nomeAgendaEmRegulacao))
              .limit(1)
          : [];

        let agendasRelacionadas;

        if (configPersonalizada.length > 0) {
          // Usar nomes configurados + agendas com o mesmo nome da agenda em regulação,
          // filtrados pela central do check-in
          let nomesConfigurados: string[] = [];
          try { nomesConfigurados = JSON.parse(configPersonalizada[0].relacionadasNomes); } catch { nomesConfigurados = []; }

          // Sempre incluir agendas com o mesmo nome (outras centrais/municípios da mesma agenda)
          const nomesValidos = new Set([...nomesConfigurados, nomeAgendaEmRegulacao].filter(Boolean));

          agendasRelacionadas = todasAgendas
            .filter(a => {
              if (!nomesValidos.has(a.agenda ?? '')) return false;
              // Filtrar por central (mostrar apenas agendas da mesma central)
              if (input.central && a.central !== input.central) return false;
              // Excluir a própria agenda em regulação
              if (a.id === input.agendaIdExcluir) return false;
              return true;
            })
            .map(a => ({
              id: a.id,
              agenda: a.agenda,
              municipio: a.municipio,
              central: a.central,
              cotas: a.cotas,
              saldo: a.saldo,
              aguardando: a.aguardando,
              autorizadas: a.autorizadas,
              autCotas: a.autCotas,
              indexRegula: a.indexRegula,
              especialidade: a.especialidade,
              corIndex: a.corIndex,
              flagIndex: a.flagIndex,
              flagAutCotas: a.flagAutCotas,
              corAutCotas: a.corAutCotas,
            }));
        } else {
          // Comportamento padrão: filtrar por especialidade e, se disponível, por região (municipio ou central)
          agendasRelacionadas = todasAgendas
            .filter(a => {
              if (a.id === input.agendaIdExcluir) return false;
              // Filtrar por central se informada
              if (input.central && a.central !== input.central) return false;
              // Filtrar por município se informado (e sem central)
              if (!input.central && input.municipio && a.municipio !== input.municipio) return false;
              // Incluir agendas com o mesmo nome (mesma agenda em outros municípios da central)
              if (a.agenda === nomeAgendaEmRegulacao) return true;
              // Ou agendas da mesma especialidade
              const espAgenda = (a.especialidade ?? "").split(/[,;/]+/).map(e => e.trim().toLowerCase());
              return especialidades.some(e => espAgenda.includes(e));
            })
            .map(a => ({
              id: a.id,
              agenda: a.agenda,
              municipio: a.municipio,
              central: a.central,
              cotas: a.cotas,
              saldo: a.saldo,
              aguardando: a.aguardando,
              autorizadas: a.autorizadas,
              autCotas: a.autCotas,
              indexRegula: a.indexRegula,
              especialidade: a.especialidade,
              corIndex: a.corIndex,
              flagIndex: a.flagIndex,
              flagAutCotas: a.flagAutCotas,
              corAutCotas: a.corAutCotas,
            }));
        }

        // Buscar configuração de protocolos/prioridades específica da agenda
        // (tabela agenda_protocolos, configurada na aba Agendas Relacionadas)
        let prioridadesRelacionadas: typeof prioridades.$inferSelect[] = [];
        let protocolosRelacionados: typeof protocolos.$inferSelect[] = [];

        if (nomeAgendaEmRegulacao) {
          const configProto = await db
            .select()
            .from(agendaProtocolos)
            .where(eq(agendaProtocolos.agendaNome, nomeAgendaEmRegulacao))
            .limit(1);

          if (configProto.length > 0) {
            // Usar configuração específica da agenda
            let nomesProto: string[] = [];
            let nomesPrio: string[] = [];
            try { nomesProto = JSON.parse(configProto[0].protocolosNomes); } catch {}
            try { nomesPrio = JSON.parse(configProto[0].prioridadesNomes); } catch {}

            if (nomesPrio.length > 0) {
              const todasPrio = await db.select().from(prioridades).orderBy(asc(prioridades.nomeArquivo));
              prioridadesRelacionadas = todasPrio.filter(p => {
                const label = p.nomeArquivo ?? p.grandeGrupo ?? '';
                return nomesPrio.includes(label);
              });
            }

            if (nomesProto.length > 0) {
              const todosProto = await db.select().from(protocolos).orderBy(asc(protocolos.nome));
              protocolosRelacionados = todosProto.filter(p => nomesProto.includes(p.nome ?? ''));
            }
          } else {
            // Sem configuração: fallback por especialidade (comportamento anterior)
            const todasPrioridades = await db.select().from(prioridades).orderBy(asc(prioridades.nomeArquivo));
            prioridadesRelacionadas = todasPrioridades.filter(p => {
              const grupo = (p.grandeGrupo ?? "").toLowerCase();
              return especialidades.some(e => grupo.includes(e) || e.includes(grupo));
            });
            const todosProtocolos = await db.select().from(protocolos).orderBy(asc(protocolos.nome));
            protocolosRelacionados = todosProtocolos.filter(p => {
              const nome = (p.nome ?? "").toLowerCase();
              return especialidades.some(e => nome.includes(e) || e.includes(nome.split(" ")[0]));
            });
          }
        }

        return {
          agendas: agendasRelacionadas,
          prioridades: prioridadesRelacionadas,
          protocolos: protocolosRelacionados,
        };
      }),
  }),

  // ─── Agendas Concluídas ──────────────────────────────────────────────────────
  agendasConcluidas: router({
    // Buscar agendas concluídas do usuário logado
    getMeus: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return [];
      const email = ctx.user?.email ?? "";
      // Retornar apenas as concluídas de hoje no horário de Brasília (UTC-3)
      return db
        .select()
        .from(agendasConcluidas)
        .where(and(
          eq(agendasConcluidas.usuarioEmail, email),
          sql`(concluido_em AT TIME ZONE 'America/Sao_Paulo')::date = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date`
        ))
        .orderBy(desc(agendasConcluidas.concluidoEm));
    }),

    // Registrar agenda como concluída (após check-out do check-in ativo)
    concluir: protectedProcedure
      .input(z.object({
        agendaId: z.number(),
        agendaNome: z.string(),
        municipio: z.string().optional(),
        especialidade: z.string(),
        central: z.string().optional(),
        cotas: z.number().optional(),
        saldo: z.number().optional(),
        aguardando: z.number().optional(),
        indexRegula: z.number().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new Error("Banco de dados não disponível");

        const usuarioEmail = ctx.user?.email ?? "";
        const usuarioNome = ctx.user?.name ?? "";

        // 1. Fazer check-out (remover check-in ativo).
        // Deletamos por agendaNome+municipio+central (chaves estáveis) em vez de agendaId,
        // pois o ID salvo no check-in pode estar desatualizado após uma sync.
        await db
          .delete(checkIns)
          .where(and(
            eq(checkIns.agendaNome, input.agendaNome),
            sql`${checkIns.municipio} IS NOT DISTINCT FROM ${input.municipio ?? null}`,
            sql`${checkIns.central} IS NOT DISTINCT FROM ${input.central ?? null}`,
            eq(checkIns.usuarioEmail, usuarioEmail)
          ));

        // 2. Remover o encaminhamento associado (sai de "Encaminhadas para mim").
        // Idem: por chaves estáveis.
        await db
          .delete(encaminhamentos)
          .where(and(
            eq(encaminhamentos.agendaNome, input.agendaNome),
            sql`${encaminhamentos.municipio} IS NOT DISTINCT FROM ${input.municipio ?? null}`,
            sql`${encaminhamentos.central} IS NOT DISTINCT FROM ${input.central ?? null}`,
            eq(encaminhamentos.reguladorEmail, usuarioEmail)
          ));

        // 3. Registrar na tabela de concluídas
        await db.insert(agendasConcluidas).values({
          agendaId: input.agendaId,
          agendaNome: input.agendaNome,
          municipio: input.municipio,
          especialidade: input.especialidade,
          central: input.central,
          cotas: input.cotas,
          saldo: input.saldo,
          aguardando: input.aguardando,
          indexRegula: input.indexRegula,
          usuarioEmail,
          usuarioNome,
        });

        // 4. Histórico permanente (não é apagado por "limpar" nem por reabertura)
        await registrarEventoAtividade({
          email: usuarioEmail, nome: usuarioNome, tipo: "conclusao",
          agendaNome: input.agendaNome, municipio: input.municipio,
          central: input.central, especialidade: input.especialidade,
        });

        return { success: true };
      }),

    // Limpar todas as agendas concluídas do usuário
    limpar: protectedProcedure.mutation(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return { success: false };
      const email = ctx.user?.email ?? "";
      await db
        .delete(agendasConcluidas)
        .where(eq(agendasConcluidas.usuarioEmail, email));
      return { success: true };
    }),
  }),

  // ─── Configuração de Reguladores (admin/monitor) ────────────────────────────
  reguladorConfig: router({
    /**
     * Listar todos os reguladores com suas configurações (especialidades + agendas filtro + favoritas).
     * Acessível apenas por admin/monitor.
     */
    listarTodos: protectedProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];

      // Buscar todos os reguladores ativos
      const regs = await db
        .select()
        .from(reguladores)
        .where(eq(reguladores.ativo, "sim"))
        .orderBy(asc(reguladores.nome));

      // Buscar todas as configs
      const configs = await db.select().from(reguladorConfig);
      const configMap = new Map(configs.map(c => [c.reguladorEmail, c]));

      // Buscar todas as favoritas agrupadas por email
      const favs = await db.select().from(agendasFavoritas);
      const favMap = new Map<string, typeof favs>();
      for (const fav of favs) {
        if (!favMap.has(fav.reguladorEmail)) favMap.set(fav.reguladorEmail, []);
        favMap.get(fav.reguladorEmail)!.push(fav);
      }

      return regs.map(reg => {
        const config = configMap.get(reg.email);
        const favoritas = favMap.get(reg.email) ?? [];
        return {
          id: reg.id,
          nome: reg.nome,
          email: reg.email,
          perfil: reg.perfil,
          vinculo: reg.vinculo,
          especialidades: config?.especialidades ?? "",
          agendasFiltro: config?.agendasFiltro ?? "",
          favoritas: favoritas.map(f => ({
            id: f.id,
            agendaId: f.agendaId,
            agendaNome: f.agendaNome,
            municipio: f.municipio ?? "",
            central: f.central ?? "",
            especialidade: f.especialidade ?? "",
          })),
        };
      });
    }),

    /**
     * Atualizar especialidades e agendas filtro de um regulador.
     */
    atualizarConfig: protectedProcedure
      .input(z.object({
        reguladorEmail: z.string().email(),
        especialidades: z.string(),
        agendasFiltro: z.string(),
      }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Banco de dados não disponível");

        // Upsert: inserir ou atualizar
        const existing = await db
          .select()
          .from(reguladorConfig)
          .where(eq(reguladorConfig.reguladorEmail, input.reguladorEmail))
          .limit(1);

        if (existing.length > 0) {
          await db
            .update(reguladorConfig)
            .set({
              especialidades: input.especialidades,
              agendasFiltro: input.agendasFiltro,
            })
            .where(eq(reguladorConfig.reguladorEmail, input.reguladorEmail));
        } else {
          await db.insert(reguladorConfig).values({
            reguladorEmail: input.reguladorEmail,
            especialidades: input.especialidades,
            agendasFiltro: input.agendasFiltro,
          });
        }

        return { success: true };
      }),

    /**
     * Adicionar agenda favorita para um regulador.
     */
    adicionarFavorita: protectedProcedure
      .input(z.object({
        reguladorEmail: z.string().email(),
        agendaId: z.number(),
        agendaNome: z.string(),
        municipio: z.string().optional(),
        central: z.string().optional(),
        especialidade: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new Error("Banco de dados não disponível");

        // Reguladores só podem adicionar favoritas para si mesmos
        const userEmail = ctx.user?.email?.toLowerCase() ?? '';
        const meReg = await db.select({ perfil: reguladores.perfil })
          .from(reguladores).where(eq(reguladores.email, userEmail)).limit(1);
        const meuPerfil = (meReg[0]?.perfil ?? '').toLowerCase();
        const isAdmin = meuPerfil.includes('administrador') || meuPerfil.includes('monitoramento');
        if (!isAdmin && userEmail !== input.reguladorEmail.toLowerCase()) {
          throw new Error('Reguladores só podem editar suas próprias agendas favoritas');
        }

        // Verificar se já existe
        const existing = await db
          .select()
          .from(agendasFavoritas)
          .where(and(
            eq(agendasFavoritas.reguladorEmail, input.reguladorEmail),
            eq(agendasFavoritas.agendaId, input.agendaId)
          ))
          .limit(1);

        if (existing.length > 0) return { success: true, alreadyExists: true };

        await db.insert(agendasFavoritas).values({
          reguladorEmail: input.reguladorEmail,
          agendaId: input.agendaId,
          agendaNome: input.agendaNome,
          municipio: input.municipio ?? "",
          central: input.central ?? "",
          especialidade: input.especialidade ?? "",
        });

        return { success: true, alreadyExists: false };
      }),

    /**
     * Remover agenda favorita de um regulador.
     */
    removerFavorita: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new Error("Banco de dados não disponível");

        // Reguladores só podem remover suas próprias favoritas
        const userEmail = ctx.user?.email?.toLowerCase() ?? '';
        const meReg = await db.select({ perfil: reguladores.perfil })
          .from(reguladores).where(eq(reguladores.email, userEmail)).limit(1);
        const meuPerfil = (meReg[0]?.perfil ?? '').toLowerCase();
        const isAdmin = meuPerfil.includes('administrador') || meuPerfil.includes('monitoramento');
        if (!isAdmin) {
          // Verificar se a favorita pertence ao próprio usuário
          const fav = await db.select({ reguladorEmail: agendasFavoritas.reguladorEmail })
            .from(agendasFavoritas).where(eq(agendasFavoritas.id, input.id)).limit(1);
          if (fav.length > 0 && fav[0].reguladorEmail.toLowerCase() !== userEmail) {
            throw new Error('Reguladores só podem remover suas próprias agendas favoritas');
          }
        }

        await db.delete(agendasFavoritas).where(eq(agendasFavoritas.id, input.id));
        return { success: true };
      }),

    /**
     * Atualizar o perfil de um regulador (regulador | consultor | monitoramento | administrador).
     * Apenas admin e monitor podem alterar perfis.
     */
    atualizarDados: protectedProcedure
      .input(z.object({
        reguladorEmail: z.string().email(),
        nome: z.string().min(1),
        novoEmail: z.string().email().optional(),
        vinculo: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new Error('Banco de dados não disponível');
        const userEmail = ctx.user?.email ?? '';
        const meReg = await db.select({ perfil: reguladores.perfil })
          .from(reguladores).where(eq(reguladores.email, userEmail)).limit(1);
        const meuPerfil = (meReg[0]?.perfil ?? '').toLowerCase();
        const temPermissao = meuPerfil.includes('administrador') || meuPerfil.includes('monitoramento');
        if (!temPermissao) throw new Error('Sem permissão para alterar dados de reguladores');
        await db.update(reguladores)
          .set({
            nome: input.nome,
            ...(input.novoEmail ? { email: input.novoEmail } : {}),
            ...(input.vinculo !== undefined ? { vinculo: input.vinculo } : {}),
          })
          .where(eq(reguladores.email, input.reguladorEmail));
        return { success: true };
      }),

    atualizarPerfil: protectedProcedure
      .input(z.object({
        reguladorEmail: z.string().email(),
        // Aceita string livre para suportar múltiplos perfis separados por vírgula
        // ex: "regulador, monitoramento" ou apenas "administrador"
        perfil: z.string().min(1),
      }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new Error('Banco de dados não disponível');
        // Verificar se o usuário logado é admin ou monitor
        const userEmail = ctx.user?.email ?? '';
        const meReg = await db.select({ perfil: reguladores.perfil })
          .from(reguladores)
          .where(eq(reguladores.email, userEmail))
          .limit(1);
        const meuPerfil = (meReg[0]?.perfil ?? '').toLowerCase();
        const temPermissao = meuPerfil.includes('administrador') || meuPerfil.includes('monitoramento');
        if (!temPermissao) throw new Error('Sem permissão para alterar perfis');
        await db.update(reguladores)
          .set({ perfil: input.perfil })
          .where(eq(reguladores.email, input.reguladorEmail));
        return { success: true };
      }),

    /**
     * Buscar configuração do regulador logado (para aplicar filtros na aba Regulação).
     */
    meuConfig: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return null;
      const email = ctx.user?.email ?? "";

      const config = await db
        .select()
        .from(reguladorConfig)
        .where(eq(reguladorConfig.reguladorEmail, email))
        .limit(1);

      const favoritas = await db
        .select()
        .from(agendasFavoritas)
        .where(eq(agendasFavoritas.reguladorEmail, email));

      return {
        especialidades: config[0]?.especialidades ?? "",
        agendasFiltro: config[0]?.agendasFiltro ?? "",
        favoritas: favoritas.map(f => ({
          id: f.id,
          agendaId: f.agendaId,
          agendaNome: f.agendaNome,
          municipio: f.municipio ?? "",
          central: f.central ?? "",
          especialidade: f.especialidade ?? "",
        })),
      };
    }),

    /**
     * Criar um novo regulador manualmente (sem depender da planilha).
     * Apenas admin/monitor podem criar.
     */
    criar: protectedProcedure
      .input(z.object({
        nome: z.string().min(2, "Nome muito curto"),
        email: z.string().email("E-mail inválido"),
        perfil: z.string().default("regulador"),
        vinculo: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Banco indisponível");
        // Verificar se o e-mail já existe
        const existing = await db
          .select({ id: reguladores.id })
          .from(reguladores)
          .where(eq(reguladores.email, input.email))
          .limit(1);
        if (existing.length > 0) {
          throw new Error("Já existe um regulador com este e-mail");
        }
        await db.insert(reguladores).values({
          nome: input.nome,
          email: input.email,
          perfil: input.perfil,
          vinculo: input.vinculo ?? null,
          ativo: "sim",
        });
        return { success: true };
      }),

    /**
     * Excluir (desativar) um regulador pelo ID.
     * Apenas admin/monitor podem excluir.
     */
    excluir: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Banco indisponível");
        await db
          .update(reguladores)
          .set({ ativo: "nao" })
          .where(eq(reguladores.id, input.id));
        return { success: true };
      }),
  }),

  // ─── Agendas Relacionadas Config ─────────────────────────────────────────────
  agendasRelacionadas: router({
    /**
     * Buscar configuração de agendas relacionadas para uma agenda específica.
     * Se não houver configuração salva, retorna todas as agendas da mesma especialidade.
     * Usa agendaNome como chave (IDs são voláteis — mudam a cada sync).
     */
    getConfig: protectedProcedure
      .input(z.object({
        agendaId: z.number(),
        especialidade: z.string(),
      }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return { relacionadasNomes: [], usandoPadrao: true };

        // Buscar o nome da agenda pelo ID
        const agendaRow = await db
          .select({ agenda: regulacaoData.agenda })
          .from(regulacaoData)
          .where(eq(regulacaoData.id, input.agendaId))
          .limit(1);

        const nomeAgenda = agendaRow[0]?.agenda ?? '';

        // Verificar se há configuração salva pelo nome
        const config = nomeAgenda
          ? await db
              .select()
              .from(agendasRelacionadasConfig)
              .where(eq(agendasRelacionadasConfig.agendaNome, nomeAgenda))
              .limit(1)
          : [];

        if (config.length > 0) {
          // Retornar os nomes diretamente — estáveis entre sincronizações
          let nomes: string[] = [];
          try { nomes = JSON.parse(config[0].relacionadasNomes); } catch { nomes = []; }
          return { relacionadasNomes: nomes, usandoPadrao: false };
        }

        // Sem configuração: retornar nomes de todas da mesma especialidade (exceto a própria)
        const todasEspecialidade = await db
          .select({ id: regulacaoData.id, agenda: regulacaoData.agenda })
          .from(regulacaoData)
          .where(eq(regulacaoData.especialidade, input.especialidade));

        // Deduplica por nome para o frontend não lidar com duplicatas
        const nomesVistos = new Set<string>();
        const nomesEsp: string[] = [];
        for (const r of todasEspecialidade) {
          if (r.id === input.agendaId) continue;
          const nome = r.agenda ?? '';
          if (nome && !nomesVistos.has(nome)) {
            nomesVistos.add(nome);
            nomesEsp.push(nome);
          }
        }

        return { relacionadasNomes: nomesEsp, usandoPadrao: true };
      }),

    /**
     * Listar todas as configurações de agendas relacionadas (para a aba de administração).
     */
    listarConfigs: protectedProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      return db
        .select()
        .from(agendasRelacionadasConfig)
        .orderBy(asc(agendasRelacionadasConfig.agendaNome));
    }),

    /**
     * Salvar/atualizar configuração de agendas relacionadas para uma agenda.
     * Salva por agendaNome (chave estável) e armazena nomes das relacionadas
     * (não IDs, que são voláteis e mudam a cada sync do Google Sheets).
     */
    salvarConfig: protectedProcedure
      .input(z.object({
        agendaNome: z.string(),
        especialidade: z.string().optional(),
        relacionadasNomes: z.array(z.string()),
      }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Banco de dados não disponível");

        const nomesJson = JSON.stringify(input.relacionadasNomes);

        const existing = await db
          .select()
          .from(agendasRelacionadasConfig)
          .where(eq(agendasRelacionadasConfig.agendaNome, input.agendaNome))
          .limit(1);

        if (existing.length > 0) {
          await db
            .update(agendasRelacionadasConfig)
            .set({ relacionadasNomes: nomesJson, especialidade: input.especialidade ?? '' })
            .where(eq(agendasRelacionadasConfig.agendaNome, input.agendaNome));
        } else {
          await db.insert(agendasRelacionadasConfig).values({
            agendaNome: input.agendaNome,
            especialidade: input.especialidade ?? '',
            relacionadasNomes: nomesJson,
          });
        }

        return { success: true };
      }),

    /**
     * Resetar configuração de uma agenda (voltar ao padrão: todas da mesma especialidade).
     */
    resetarConfig: protectedProcedure
      .input(z.object({ agendaNome: z.string() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Banco de dados não disponível");
        await db
          .delete(agendasRelacionadasConfig)
          .where(eq(agendasRelacionadasConfig.agendaNome, input.agendaNome));
        return { success: true };
      }),

    /**
     * Listar todas as agendas disponíveis (para o dropdown de seleção).
     */
      listarTodasAgendas: protectedProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      const agendas = await db
        .select({
          id: regulacaoData.id,
          agenda: regulacaoData.agenda,
          municipio: regulacaoData.municipio,
          central: regulacaoData.central,
          especialidade: regulacaoData.especialidade,
        })
        .from(regulacaoData)
        .orderBy(asc(regulacaoData.agenda));
      // Deduplica por nome+municipio+central
      const seen = new Set<string>();
      return agendas.filter(a => {
        const key = `${a.agenda}|${a.municipio}|${a.central}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }),
  }),

  // ─── Sem Cotas (admin/monitor) ───────────────────────────────────────────────
  semCotas: router({
    /**
     * Listar todos os registros da aba Sem Cotas com filtros opcionais.
     */
    listar: protectedProcedure
      .input(z.object({
        central: z.string().optional(),
        especialidade: z.string().optional(),
      }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return { rows: [], novas: [] };

        const rows = await db
          .select()
          .from(semCotas)
          .orderBy(asc(semCotas.central), asc(semCotas.especialidade));

        // Aplicar filtros em memória
        const filtered = rows.filter(r => {
          if (input.central && r.central !== input.central) return false;
          if (input.especialidade) {
            const esp = (r.especialidade ?? '').toLowerCase();
            if (!esp.includes(input.especialidade.toLowerCase())) return false;
          }
          return true;
        });

        const novas = filtered.filter(r => r.isNova === 'sim');
        return { rows: filtered, novas };
      }),

    /**
     * Listar apenas agendas novas (isNova = 'sim') com createdAt
     */
    listarNovas: protectedProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      return db
        .select()
        .from(semCotas)
        .where(eq(semCotas.isNova, 'sim'))
        .orderBy(desc(semCotas.updatedAt));
    }),

    /**
     * Marcar uma agenda como não-nova (check individual)
     */
    marcarNaoNova: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error('Banco não disponível');
        await db.update(semCotas).set({ isNova: 'nao' }).where(eq(semCotas.id, input.id));
        return { success: true };
      }),

    /**
     * Marcar todas as agendas novas como não-novas
     */
    marcarTodasNaoNovas: protectedProcedure.mutation(async () => {
      const db = await getDb();
      if (!db) throw new Error('Banco não disponível');
      const result = await db.update(semCotas).set({ isNova: 'nao' }).where(eq(semCotas.isNova, 'sim'));
      return { count: result.rowCount ?? 0 };
    }),

    /**
     * Sincronizar manualmente a aba Sem Cotas.
     */
    sincronizar: protectedProcedure.mutation(async () => {
      const count = await syncSemCotasToDb();
      return { count };
    }),

    /**
     * Retorna os valores únicos de Central e Especialidade para os filtros.
     */
    getFiltros: protectedProcedure.query(async () => {
      const db = await getDb();
      if (!db) return { centrais: [], especialidades: [] };

      const rows = await db
        .select({
          central: semCotas.central,
          especialidadeCategoria: semCotas.especialidadeCategoria,
        })
        .from(semCotas);

      const centraisSet = new Set<string>();
      const especialidadesSet = new Set<string>();
      for (const r of rows) {
        if (r.central) centraisSet.add(r.central);
        if (r.especialidadeCategoria) especialidadesSet.add(r.especialidadeCategoria);
      }

      // Ordenar centrais na ordem padrão: CRA, 1CRS..18CRS
      const ordemCentral = ['CRA','1CRS','2CRS','3CRS','4CRS','5CRS','6CRS','7CRS','8CRS','9CRS','10CRS','11CRS','12CRS','13CRS','14CRS','15CRS','16CRS','17CRS','18CRS'];
      const centrais = Array.from(centraisSet).sort((a, b) => {
        const ia = ordemCentral.indexOf(a);
        const ib = ordemCentral.indexOf(b);
        if (ia !== -1 && ib !== -1) return ia - ib;
        if (ia !== -1) return -1;
        if (ib !== -1) return 1;
        return a.localeCompare(b);
      });

      const especialidades = Array.from(especialidadesSet).sort();
      return { centrais, especialidades };
    }),
  }),

  // ─── Configuração por Agenda (protocolos, observações) ──────────────────────
  agendaConfig: router({

    // Buscar configuração de protocolos/prioridades de uma agenda
    getProtocolos: protectedProcedure
      .input(z.object({ agendaNome: z.string() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return { protocolosNomes: [], prioridadesNomes: [] };
        const rows = await db.select().from(agendaProtocolos)
          .where(eq(agendaProtocolos.agendaNome, input.agendaNome)).limit(1);
        if (!rows.length) return { protocolosNomes: [], prioridadesNomes: [] };
        let protocolosNomes: string[] = [];
        let prioridadesNomes: string[] = [];
        try { protocolosNomes = JSON.parse(rows[0].protocolosNomes); } catch {}
        try { prioridadesNomes = JSON.parse(rows[0].prioridadesNomes); } catch {}
        return { protocolosNomes, prioridadesNomes };
      }),

    // Salvar configuração de protocolos/prioridades de uma agenda
    salvarProtocolos: protectedProcedure
      .input(z.object({
        agendaNome: z.string(),
        protocolosNomes: z.array(z.string()),
        prioridadesNomes: z.array(z.string()),
      }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error('Banco não disponível');
        const existing = await db.select().from(agendaProtocolos)
          .where(eq(agendaProtocolos.agendaNome, input.agendaNome)).limit(1);
        const protJson = JSON.stringify(input.protocolosNomes ?? []);
        const prioJson = JSON.stringify(input.prioridadesNomes ?? []);
        if (existing.length > 0) {
          await db.update(agendaProtocolos)
            .set({ protocolosNomes: protJson, prioridadesNomes: prioJson })
            .where(eq(agendaProtocolos.agendaNome, input.agendaNome));
        } else {
          await db.insert(agendaProtocolos).values({
            agendaNome: input.agendaNome,
            protocolosNomes: protJson || '[]',
            prioridadesNomes: prioJson || '[]',
          });
        }
        return { success: true };
      }),

    // Buscar observação de uma agenda para uma central específica
    getObservacao: protectedProcedure
      .input(z.object({ agendaNome: z.string(), central: z.string() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return { observacao: '' };
        const rows = await db.select().from(agendaObservacoes)
          .where(and(
            eq(agendaObservacoes.agendaNome, input.agendaNome),
            eq(agendaObservacoes.central, input.central)
          )).limit(1);
        return { observacao: rows[0]?.observacao ?? '' };
      }),

    // Buscar todas as observações de uma agenda (todas as centrais)
    getTodasObservacoes: protectedProcedure
      .input(z.object({ agendaNome: z.string() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return [];
        return db.select().from(agendaObservacoes)
          .where(eq(agendaObservacoes.agendaNome, input.agendaNome))
          .orderBy(agendaObservacoes.central);
      }),

    // Salvar observação para uma agenda+central
    salvarObservacao: protectedProcedure
      .input(z.object({
        agendaNome: z.string(),
        central: z.string(),
        observacao: z.string(),
      }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error('Banco não disponível');
        const existing = await db.select().from(agendaObservacoes)
          .where(and(
            eq(agendaObservacoes.agendaNome, input.agendaNome),
            eq(agendaObservacoes.central, input.central)
          )).limit(1);
        if (existing.length > 0) {
          await db.update(agendaObservacoes)
            .set({ observacao: input.observacao })
            .where(and(
              eq(agendaObservacoes.agendaNome, input.agendaNome),
              eq(agendaObservacoes.central, input.central)
            ));
        } else if (input.observacao.trim()) {
          await db.insert(agendaObservacoes).values({
            agendaNome: input.agendaNome,
            central: input.central,
            observacao: input.observacao,
          });
        }
        return { success: true };
      }),

    // Deletar observação de uma agenda+central
    deletarObservacao: protectedProcedure
      .input(z.object({ agendaNome: z.string(), central: z.string() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error('Banco não disponível');
        await db.delete(agendaObservacoes)
          .where(and(
            eq(agendaObservacoes.agendaNome, input.agendaNome),
            eq(agendaObservacoes.central, input.central)
          ));
        return { success: true };
      }),
  }),

  recados: router({
    // Listar todos os recados (histórico) — apenas admins
    listar: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return [];
      const userEmail = ctx.user?.email?.toLowerCase() ?? "";
      const reg = await db.select({ perfil: reguladores.perfil }).from(reguladores).where(eq(reguladores.email, userEmail)).limit(1);
      const perfil = (reg[0]?.perfil ?? "").toLowerCase();
      if (!perfil.includes("administrador")) return [];
      return db.select().from(recados).orderBy(desc(recados.criadoEm));
    }),

    // Criar novo recado — apenas admins
    criar: protectedProcedure
      .input(z.object({ titulo: z.string().min(1), mensagem: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new Error("Banco não disponível");
        const userEmail = ctx.user?.email?.toLowerCase() ?? "";
        const reg = await db.select({ perfil: reguladores.perfil, nome: reguladores.nome }).from(reguladores).where(eq(reguladores.email, userEmail)).limit(1);
        const perfil = (reg[0]?.perfil ?? "").toLowerCase();
        if (!perfil.includes("administrador")) throw new Error("Acesso restrito a administradores");
        await db.insert(recados).values({
          titulo: input.titulo,
          mensagem: input.mensagem,
          autorEmail: userEmail,
          autorNome: reg[0]?.nome ?? ctx.user?.name ?? "",
          ativo: 1,
        });
        return { success: true };
      }),

    // Buscar recado ativo não lido pelo usuário atual
    getPendente: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return null;
      const userEmail = ctx.user?.email?.toLowerCase() ?? "";
      // Buscar recado ativo mais recente que o usuário ainda não leu
      const jaLidos = await db
        .select({ recadoId: recadosLidos.recadoId })
        .from(recadosLidos)
        .where(eq(recadosLidos.usuarioEmail, userEmail));
      const idsLidos = jaLidos.map(l => l.recadoId);
      const query = db
        .select()
        .from(recados)
        .where(eq(recados.ativo, 1))
        .orderBy(desc(recados.criadoEm))
        .limit(1);
      const todos = await query;
      if (todos.length === 0) return null;
      const ultimo = todos[0];
      if (idsLidos.includes(ultimo.id)) return null;
      return ultimo;
    }),

    // Marcar recado como lido
    marcarLido: protectedProcedure
      .input(z.object({ recadoId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new Error("Banco não disponível");
        const userEmail = ctx.user?.email?.toLowerCase() ?? "";
        await db.insert(recadosLidos).values({
          recadoId: input.recadoId,
          usuarioEmail: userEmail,
        }).onConflictDoUpdate({ target: [recadosLidos.recadoId, recadosLidos.usuarioEmail], set: { lidoEm: sql`NOW()` } });
        return { success: true };
      }),

    // Editar título/mensagem de um recado — apenas admins.
    // Obs.: quem já clicou em "Ciente" não vê o recado de novo; para reexibir a
    // todos, envie um recado novo.
    editar: protectedProcedure
      .input(z.object({ id: z.number(), titulo: z.string().min(1), mensagem: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new Error("Banco não disponível");
        const userEmail = ctx.user?.email?.toLowerCase() ?? "";
        const reg = await db.select({ perfil: reguladores.perfil }).from(reguladores).where(eq(reguladores.email, userEmail)).limit(1);
        const perfil = (reg[0]?.perfil ?? "").toLowerCase();
        if (!perfil.includes("administrador")) throw new Error("Acesso restrito a administradores");
        await db.update(recados).set({ titulo: input.titulo, mensagem: input.mensagem }).where(eq(recados.id, input.id));
        return { success: true };
      }),

    // Desativar recado — apenas admins
    desativar: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new Error("Banco não disponível");
        const userEmail = ctx.user?.email?.toLowerCase() ?? "";
        const reg = await db.select({ perfil: reguladores.perfil }).from(reguladores).where(eq(reguladores.email, userEmail)).limit(1);
        const perfil = (reg[0]?.perfil ?? "").toLowerCase();
        if (!perfil.includes("administrador")) throw new Error("Acesso restrito a administradores");
        await db.update(recados).set({ ativo: 0 }).where(eq(recados.id, input.id));
        return { success: true };
      }),
  }),

  // ── Configurações do portal: legenda da aba Início + limites das sinalizações ──
  // Guardadas como JSON na tabela configuracoes_portal (chave 'legenda').
  configPortal: router({
    // Qualquer usuário logado lê (as tabelas usam os limites para colorir).
    // null = nada salvo ainda → o cliente usa LEGENDA_PADRAO (shared/legenda.ts).
    getLegenda: protectedProcedure.query(async () => {
      const db = await getDb();
      if (!db) return null;
      const res = (await db.execute(sql`
        SELECT valor, atualizado_em, atualizado_por FROM configuracoes_portal WHERE chave = 'legenda' LIMIT 1
      `)) as unknown as { rows: { valor: string; atualizado_em: Date | string; atualizado_por: string | null }[] };
      const row = res.rows[0];
      if (!row) return null;
      let bruto: unknown = null;
      try { bruto = JSON.parse(row.valor); } catch { return null; }
      return {
        config: normalizarLegenda(bruto),
        atualizadoEm: new Date(row.atualizado_em).toISOString(),
        atualizadoPor: row.atualizado_por,
      };
    }),

    // Salvar — apenas administradores
    salvarLegenda: protectedProcedure
      .input(z.object({ config: z.unknown() }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new Error("Banco não disponível");
        const userEmail = ctx.user?.email?.toLowerCase() ?? "";
        const reg = await db.select({ perfil: reguladores.perfil, nome: reguladores.nome }).from(reguladores).where(eq(reguladores.email, userEmail)).limit(1);
        const perfil = (reg[0]?.perfil ?? "").toLowerCase();
        if (!perfil.includes("administrador")) throw new Error("Acesso restrito a administradores");
        const config = normalizarLegenda(input.config);
        const erro = validarLegenda(config);
        if (erro) throw new Error(erro);
        const autor = reg[0]?.nome || userEmail;
        await db.execute(sql`
          INSERT INTO configuracoes_portal (chave, valor, atualizado_por)
          VALUES ('legenda', ${JSON.stringify(config)}, ${autor})
          ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_por = EXCLUDED.atualizado_por, atualizado_em = CURRENT_TIMESTAMP
        `);
        return { success: true };
      }),

    // Voltar ao padrão (apaga a configuração salva) — apenas administradores
    restaurarLegenda: protectedProcedure.mutation(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Banco não disponível");
      const userEmail = ctx.user?.email?.toLowerCase() ?? "";
      const reg = await db.select({ perfil: reguladores.perfil }).from(reguladores).where(eq(reguladores.email, userEmail)).limit(1);
      const perfil = (reg[0]?.perfil ?? "").toLowerCase();
      if (!perfil.includes("administrador")) throw new Error("Acesso restrito a administradores");
      await db.execute(sql`DELETE FROM configuracoes_portal WHERE chave = 'legenda'`);
      return { success: true };
    }),
  }),

  loginLog: router({
    // Listar todos os registros de login/logout (admin e monitoramento apenas)
    // Filtro de período opcional (desde/ate em ISO) — os demais filtros
    // (nome, e-mail, status) são feitos no navegador.
    listar: protectedProcedure
      .input(z.object({
        limite: z.number().int().min(1).max(20000).optional(),
        desde: z.string().optional(), // ISO — login a partir desta data/hora
        ate: z.string().optional(),   // ISO — login até esta data/hora
      }))
      .query(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) return [];
        // Verificar perfil do solicitante
        const userEmail = ctx.user?.email?.toLowerCase() ?? '';
        const reg = await db.select({ perfil: reguladores.perfil }).from(reguladores).where(eq(reguladores.email, userEmail)).limit(1);
        const perfil = (reg[0]?.perfil ?? '').toLowerCase();
        if (!perfil.includes('administrador') && !perfil.includes('monitoramento')) return [];
        await encerrarSessoesInativas();
        const condicoes = [];
        if (input.desde) condicoes.push(gte(loginLog.loginAt, new Date(input.desde)));
        if (input.ate) condicoes.push(lte(loginLog.loginAt, new Date(input.ate)));
        return db
          .select()
          .from(loginLog)
          .where(condicoes.length ? and(...condicoes) : undefined)
          .orderBy(desc(loginLog.loginAt))
          .limit(input.limite ?? 500);
      }),
  }),

  /**
   * Relatório de uso do portal por regulador (admin/monitoramento) — combina
   * sessões (heartbeat) com o histórico permanente de check-ins e conclusões.
   */
  usoPortal: router({
    relatorio: protectedProcedure
      .input(z.object({ dias: z.number().int().min(1).max(365) }))
      .query(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) return [];
        const userEmail = ctx.user?.email?.toLowerCase() ?? '';
        const reg = await db.select({ perfil: reguladores.perfil }).from(reguladores).where(eq(reguladores.email, userEmail)).limit(1);
        const perfil = (reg[0]?.perfil ?? '').toLowerCase();
        if (!perfil.includes('administrador') && !perfil.includes('monitoramento')) return [];
        return relatorioUso(input.dias);
      }),
  }),

  /**
   * Condutas do GERCON — respostas/referências padronizadas por situação clínica,
   * usadas pelos reguladores para instruir consultorias. Dados sincronizados a
   * partir de uma consulta SQL no Metabase (ver server/syncMetabase.ts).
   */
  condutas: router({
    // Lista completa — o filtro/busca é feito no cliente (dataset pequeno, ~algumas centenas de linhas)
    listar: protectedProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      return db
        .select({
          id: condutasGercon.id,
          especialidade: condutasGercon.especialidade,
          situacao: condutasGercon.situacao,
          ciapCid: condutasGercon.ciapCid,
          conduta: condutasGercon.conduta,
          referencias: condutasGercon.referencias,
        })
        .from(condutasGercon)
        .orderBy(asc(condutasGercon.situacao));
    }),

    // Sincronizar manualmente com o Metabase
    sincronizar: protectedProcedure.mutation(async () => {
      const count = await syncCondutasGerconComLog();
      return { success: true, count };
    }),

    // Importar manualmente a partir de um CSV exportado do banco (alternativa
    // temporária enquanto o acesso ao Metabase não é liberado)
    importarCsv: protectedProcedure
      .input(z.object({ csv: z.string().min(1) }))
      .mutation(async ({ input }) => {
        const count = await importCondutasGerconFromCsvComLog(input.csv);
        return { success: true, count };
      }),

    // Data/hora da última sincronização bem-sucedida
    ultimaSincronizacao: publicProcedure.query(async () => {
      const db = await getDb();
      if (!db) return null;
      const rows = await db
        .select({ syncedAt: condutasGerconSyncLog.syncedAt, rowCount: condutasGerconSyncLog.rowCount })
        .from(condutasGerconSyncLog)
        .where(eq(condutasGerconSyncLog.status, "success"))
        .orderBy(desc(condutasGerconSyncLog.syncedAt))
        .limit(1);
      return rows[0] ?? null;
    }),

    // Histórico de sincronizações (para diagnóstico de falhas)
    historicoSincronizacao: protectedProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      return db
        .select()
        .from(condutasGerconSyncLog)
        .orderBy(desc(condutasGerconSyncLog.syncedAt))
        .limit(10);
    }),
  }),

  /**
   * Aba de TESTE/EXPLORAÇÃO do banco "plataforma-backend" (Postgres, host
   * 143.54.31.135) — usada para descobrir a estrutura real das tabelas e
   * comparar com o que já está em condutas_gercon, antes de decidir se vale
   * a pena integrar esse banco ao fluxo de sincronização automática.
   */
  plataformaBackend: router({
    testarQuery: protectedProcedure
      .input(z.object({ sql: z.string().min(1) }))
      .mutation(async ({ input }) => {
        return testarQueryPlataformaBackend(input.sql);
      }),
  }),

  /**
   * Ferramenta genérica de diagnóstico de rede — testa se o Railway consegue
   * abrir uma conexão TCP crua com qualquer host:porta (equivalente a
   * `nc -zv host port`), útil para diferenciar bloqueio de rede/VPN de
   * problema de credencial/config em qualquer uma das integrações externas
   * (sesdw, Metabase, plataforma-backend, etc.).
   */
  diagnosticoRede: router({
    testarTcp: protectedProcedure
      .input(z.object({ host: z.string().min(1), port: z.number().int().min(1).max(65535) }))
      .mutation(async ({ input }) => {
        return testarConectividadeTcp(input.host, input.port);
      }),
  }),

});
export type AppRouter = typeof appRouter;
