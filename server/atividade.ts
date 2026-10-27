import { sql } from "drizzle-orm";
import { getDb } from "./db";

/**
 * Controle de sessões por HEARTBEAT.
 *
 * O navegador envia um sinal periódico apenas quando há interação real com o
 * portal (mouse, teclado, clique, rolagem) e a aba está visível. Cada sinal
 * atualiza `ultima_atividade_at` da sessão aberta.
 *
 * Uma sessão termina quando fica mais de INATIVIDADE_MIN minutos sem sinal.
 * O fim registrado é o horário do último sinal — ou seja, a duração reflete
 * o tempo real de uso, e não o tempo em que a aba ficou esquecida aberta.
 */
export const INATIVIDADE_MIN = 30;

/** Formato do resultado de db.execute no Postgres (node-postgres): { rows: [...] } */
type Rows<T> = { rows: T[] };

/** Intervalo de N minutos/dias para usar dentro de sql`` (Postgres). */
const minutos = (n: number) => sql`make_interval(mins => ${n}::int)`;
const intervaloDeDias = (n: number) => sql`make_interval(days => ${n}::int)`;

/** Registra atividade do usuário: estende a sessão aberta ou abre uma nova. */
export async function registrarAtividadeSessao(email: string, nome: string | null): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const e = email.toLowerCase();

  const res = (await db.execute(sql`
    SELECT id FROM login_log
    WHERE regulador_email = ${e}
      AND logout_at IS NULL
      AND COALESCE(ultima_atividade_at, login_at) > NOW() - ${minutos(INATIVIDADE_MIN)}
    ORDER BY login_at DESC
    LIMIT 1
  `)) as unknown as Rows<{ id: number }>;

  const aberta = res.rows[0];
  if (aberta) {
    await db.execute(sql`UPDATE login_log SET ultima_atividade_at = NOW() WHERE id = ${aberta.id}`);
    return;
  }

  // Nenhuma sessão ativa: encerra eventuais sessões inativas no horário da última atividade
  await db.execute(sql`
    UPDATE login_log
    SET logout_at = COALESCE(ultima_atividade_at, login_at)
    WHERE regulador_email = ${e} AND logout_at IS NULL
  `);
  await db.execute(sql`
    INSERT INTO login_log (regulador_email, regulador_nome, login_at, ultima_atividade_at)
    VALUES (${e}, ${nome}, NOW(), NOW())
  `);
}

/** Encerra (de todos os usuários) sessões que passaram do limite de inatividade. */
export async function encerrarSessoesInativas(): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.execute(sql`
    UPDATE login_log
    SET logout_at = COALESCE(ultima_atividade_at, login_at)
    WHERE logout_at IS NULL
      AND COALESCE(ultima_atividade_at, login_at) <= NOW() - ${minutos(INATIVIDADE_MIN)}
  `);
}

/** Grava um evento no histórico permanente de atividade. Nunca lança erro. */
export async function registrarEventoAtividade(evento: {
  email: string;
  nome?: string | null;
  tipo: "checkin" | "conclusao";
  agendaNome?: string | null;
  municipio?: string | null;
  central?: string | null;
  especialidade?: string | null;
}): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db.execute(sql`
      INSERT INTO atividade_log (usuario_email, usuario_nome, tipo, agenda_nome, municipio, central, especialidade)
      VALUES (${evento.email.toLowerCase()}, ${evento.nome ?? null}, ${evento.tipo},
              ${evento.agendaNome ?? null}, ${evento.municipio ?? null}, ${evento.central ?? null}, ${evento.especialidade ?? null})
    `);
  } catch (err) {
    console.warn("[Atividade] Falha ao registrar evento:", err);
  }
}

export interface LinhaRelatorioUso {
  email: string;
  nome: string;
  perfil: string | null;
  sessoes: number;
  minutosNoPortal: number;
  ultimaAtividadePortal: string | null;
  checkins: number;
  conclusoes: number;
  ultimaAtividadeRegulacao: string | null;
}

/** Relatório de uso por regulador ativo, considerando os últimos `dias` dias. */
export async function relatorioUso(dias: number): Promise<LinhaRelatorioUso[]> {
  const db = await getDb();
  if (!db) return [];

  await encerrarSessoesInativas();
  const intervaloDias = intervaloDeDias(dias);

  const regs = (await db.execute(sql`
    SELECT LOWER(email) AS email, nome, perfil FROM reguladores WHERE ativo = 'sim'
  `)) as unknown as Rows<{ email: string; nome: string; perfil: string | null }>;

  const sessoes = (await db.execute(sql`
    SELECT LOWER(regulador_email) AS email,
           COUNT(*) AS sessoes,
           COALESCE(SUM(FLOOR(EXTRACT(EPOCH FROM (COALESCE(logout_at, ultima_atividade_at, login_at) - login_at)) / 60)), 0) AS minutos
    FROM login_log
    WHERE login_at >= NOW() - ${intervaloDias}
    GROUP BY LOWER(regulador_email)
  `)) as unknown as Rows<{ email: string; sessoes: number; minutos: number }>;

  const ultimaPortal = (await db.execute(sql`
    SELECT LOWER(regulador_email) AS email, MAX(COALESCE(ultima_atividade_at, login_at)) AS ultima
    FROM login_log
    GROUP BY LOWER(regulador_email)
  `)) as unknown as Rows<{ email: string; ultima: Date | string | null }>;

  const eventos = (await db.execute(sql`
    SELECT usuario_email AS email,
           COUNT(*) FILTER (WHERE tipo = 'checkin')   AS checkins,
           COUNT(*) FILTER (WHERE tipo = 'conclusao') AS conclusoes
    FROM atividade_log
    WHERE created_at >= NOW() - ${intervaloDias}
    GROUP BY usuario_email
  `)) as unknown as Rows<{ email: string; checkins: number; conclusoes: number }>;

  const ultimaRegulacao = (await db.execute(sql`
    SELECT usuario_email AS email, MAX(created_at) AS ultima
    FROM atividade_log
    GROUP BY usuario_email
  `)) as unknown as Rows<{ email: string; ultima: Date | string | null }>;

  const toIso = (v: Date | string | null | undefined) =>
    v == null ? null : new Date(v).toISOString();

  const mSessoes = new Map(sessoes.rows.map(r => [r.email, r]));
  const mUltPortal = new Map(ultimaPortal.rows.map(r => [r.email, r.ultima]));
  const mEventos = new Map(eventos.rows.map(r => [r.email, r]));
  const mUltReg = new Map(ultimaRegulacao.rows.map(r => [r.email, r.ultima]));

  return regs.rows.map(r => ({
    email: r.email,
    nome: r.nome,
    perfil: r.perfil,
    sessoes: Number(mSessoes.get(r.email)?.sessoes ?? 0),
    minutosNoPortal: Number(mSessoes.get(r.email)?.minutos ?? 0),
    ultimaAtividadePortal: toIso(mUltPortal.get(r.email)),
    checkins: Number(mEventos.get(r.email)?.checkins ?? 0),
    conclusoes: Number(mEventos.get(r.email)?.conclusoes ?? 0),
    ultimaAtividadeRegulacao: toIso(mUltReg.get(r.email)),
  }));
}
