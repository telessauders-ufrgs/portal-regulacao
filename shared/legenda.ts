/**
 * shared/legenda.ts — Legenda do portal e limites das sinalizações
 *
 * Usado pelo servidor (validar/salvar) e pelo cliente (exibir e colorir tabelas).
 *
 * O que é configurável pela aba "Recados e Legenda" (administradores):
 *  - textos da seção "Aprenda a interpretar as informações..." da aba Início;
 *  - limite do Fila/Cotas (padrão 4) e as duas frases de orientação;
 *  - os três limites do Index (padrão 3 / 2 / 1) e as quatro frases.
 *
 * Os limites alimentam os destaques de TODAS as tabelas do portal (Lista de
 * agendas, Minhas agendas, agendas relacionadas, Monitor de check-ins) e a
 * frase de alerta do check-in. A cor da linha que vem da planilha (corIndex)
 * NÃO é afetada — ela é calculada na origem dos dados.
 *
 * Enquanto nada for salvo no banco, vale LEGENDA_PADRAO.
 */

export type TermoId =
  | 'agenda' | 'central' | 'municipio' | 'filaCotas' | 'index'
  | 'd7' | 'd28' | 'd90' | 'cotas' | 'saldo' | 'aguardando' | 'autorizadas';

export interface LegendaTermo {
  id: TermoId;
  termo: string;      // rótulo exibido (ex.: "FILA/COTAS")
  descricao: string;  // explicação exibida na aba Início
}

export interface LegendaConfig {
  titulo: string;
  subtitulo: string;
  filaCotas: {
    limite: number;      // ≤ limite → ⏩ ; > limite → ⚠️
    fraseBaixa: string;  // frase para ≤ limite
    fraseAlta: string;   // frase para > limite
  };
  index: {
    critico: number;     // > critico → vermelho
    alto: number;        // > alto    → laranja
    atencao: number;     // > atencao → amarelo ; ≤ atencao → sem destaque
    fraseCritico: string;
    fraseAlto: string;
    fraseAtencao: string;
    fraseNormal: string;
  };
  termos: LegendaTermo[];
}

export const LEGENDA_PADRAO: LegendaConfig = {
  titulo: 'Aprenda a interpretar as informações do Portal de Monitoramento 👇🏽',
  subtitulo: 'Significado de cada coluna da Lista de agendas e como usar os indicadores para decidir a regulação.',
  filaCotas: {
    limite: 4,
    fraseBaixa: 'Autorize o que for pertinente à especialidade e ao prestador indicado. Não faça consultoria ativa, não use aguarda matriciamento ou pendente para pedir informações sobre prioridade.',
    fraseAlta: 'Aplique os critérios do protocolo. Utilize a consultoria ativa, o status Pendente ou Aguarda Matriciamento (nas especialidades disponíveis no 0800) para solicitar as informações necessárias ao cumprimento dos critérios do protocolo e à definição da prioridade.',
  },
  index: {
    critico: 3,
    alto: 2,
    atencao: 1,
    fraseCritico: 'Situação crítica para perda de consultas. Esta agenda deve ser regulada prioritariamente. Avalie a relação FILA/COTAS para decidir a flexibilidade da regulação.',
    fraseAlto: 'Alta oferta de consultas. A agenda deve ser regulada com brevidade.',
    fraseAtencao: 'Não há casos autorizados suficientes para cobrir a oferta do mês. Priorize a regulação dessas agendas após terminar a regulação das agendas em vermelho e laranja.',
    fraseNormal: 'Seguir pelo tempo de espera: agendas com mais de 90 dias e mais de 28 dias aguardando regulação.',
  },
  termos: [
    { id: 'agenda', termo: 'AGENDA', descricao: 'Nome da agenda no GERCON.' },
    { id: 'central', termo: 'CENTRAL', descricao: 'Central de regulação no GERCON.' },
    { id: 'municipio', termo: 'MUNICÍPIO', descricao: 'Município que oferece a agenda, conforme regionalização configurada no GERCON. Ao expandir a linha da agenda visualizamos cada município que a oferece. Uma linha com esse campo em branco irá aparecer sempre que houver solicitações sem município ou com uma instituição indicada; estes casos são contabilizados como município nulo.' },
    { id: 'filaCotas', termo: 'FILA/COTAS', descricao: 'Relação entre a quantidade de casos autorizados e em aguarda regulação/reavaliação/reversão pela quantidade de cotas disponíveis no mês vigente. Quanto maior o número, mais tempo o paciente demora para consultar.' },
    { id: 'index', termo: 'INDEX', descricao: 'Cálculo que leva em conta o saldo do mês vigente, a quantidade de casos aguardando regulação e a quantidade de casos autorizados, para sinalizar em quais agendas se corre o risco de perder consultas, por falta de casos autorizados.' },
    { id: 'd7', termo: '> 7D', descricao: 'Número de casos aguardando a primeira regulação há mais de 7 dias. Monitorado em agendas "tempo sensível" como oncologias e PNAR.' },
    { id: 'd28', termo: '> 28D', descricao: 'Número de casos aguardando a primeira regulação há mais de 28 dias. Monitorado em todas as agendas como uma das metas pactuadas com a SES/RS. Clique sobre ">28D" para ordenar as linhas a partir do maior número de casos.' },
    { id: 'd90', termo: '> 90D', descricao: 'Número de casos aguardando a primeira regulação há mais de 90 dias. Agendas com atraso crítico para primeira regulação. Clique sobre ">90D" para ordenar as linhas a partir do maior número de casos.' },
    { id: 'cotas', termo: 'COTAS', descricao: 'Total de consultas na especialidade no mês vigente. Este dado é informado pelos prestadores e não varia ao longo do mês.' },
    { id: 'saldo', termo: 'SALDO', descricao: 'Número de consultas ainda disponíveis no mês vigente. Este número vai diminuindo ao longo do mês, conforme as consultas são agendadas.' },
    { id: 'aguardando', termo: 'AGUARDANDO', descricao: 'Casos com a situação Aguardando Regulação, Reavaliação ou Reversão na respectiva central, especialidade e município indicado.' },
    { id: 'autorizadas', termo: 'AUTORIZADAS', descricao: 'Casos com a situação Autorizada e Autorização Automática na respectiva central, especialidade e município indicado.' },
  ],
};

const texto = (v: unknown, padrao: string) => (typeof v === 'string' && v.trim() !== '' ? v : padrao);
const numero = (v: unknown, padrao: number) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : padrao;
};

/**
 * Completa uma configuração parcial/antiga com os valores padrão.
 * Campos ausentes ou inválidos voltam ao padrão; termos seguem a ordem padrão.
 */
export function normalizarLegenda(raw: unknown): LegendaConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const P = LEGENDA_PADRAO;
  const fc = (r.filaCotas ?? {}) as Record<string, unknown>;
  const ix = (r.index ?? {}) as Record<string, unknown>;
  const termosRaw: any[] = Array.isArray(r.termos) ? r.termos : [];
  return {
    titulo: texto(r.titulo, P.titulo),
    subtitulo: typeof r.subtitulo === 'string' ? r.subtitulo : P.subtitulo,
    filaCotas: {
      limite: numero(fc.limite, P.filaCotas.limite),
      fraseBaixa: texto(fc.fraseBaixa, P.filaCotas.fraseBaixa),
      fraseAlta: texto(fc.fraseAlta, P.filaCotas.fraseAlta),
    },
    index: {
      critico: numero(ix.critico, P.index.critico),
      alto: numero(ix.alto, P.index.alto),
      atencao: numero(ix.atencao, P.index.atencao),
      fraseCritico: texto(ix.fraseCritico, P.index.fraseCritico),
      fraseAlto: texto(ix.fraseAlto, P.index.fraseAlto),
      fraseAtencao: texto(ix.fraseAtencao, P.index.fraseAtencao),
      fraseNormal: texto(ix.fraseNormal, P.index.fraseNormal),
    },
    termos: P.termos.map(t => {
      const salvo = termosRaw.find(x => x && x.id === t.id);
      return { id: t.id, termo: texto(salvo?.termo, t.termo), descricao: texto(salvo?.descricao, t.descricao) };
    }),
  };
}

/** Retorna uma mensagem de erro, ou null se a configuração for válida. */
export function validarLegenda(c: LegendaConfig): string | null {
  if (!(c.filaCotas.limite > 0)) return 'O limite de Fila/Cotas precisa ser maior que zero.';
  if (!(c.index.critico > c.index.alto && c.index.alto > c.index.atencao)) {
    return 'Os limites do Index precisam ser decrescentes: crítico > alto > atenção.';
  }
  if (c.index.atencao < 0) return 'O limite de atenção do Index não pode ser negativo.';
  return null;
}

/** Formata um limite para exibição pt-BR (ex.: 4 → "4,00"). */
export function formatarLimite(n: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
