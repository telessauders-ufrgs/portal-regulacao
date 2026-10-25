/**
 * Utilitário para aplicar destaque visual por cor nas agendas.
 * A cor vem da coluna O da planilha (campo `cor` no banco).
 * Suporta nomes em português (masculino e feminino) e inglês, em qualquer capitalização.
 * Exemplos de valores no banco: "VERMELHA", "AMARELA", "VERDE"
 */

import type { CSSProperties } from 'react';
import { LEGENDA_PADRAO, type LegendaConfig } from '@shared/legenda';

/** Normaliza o valor de cor para comparação */
function norm(cor: string | null | undefined): string {
  return (cor ?? "").toLowerCase().trim();
}

/** Detecta a cor canônica a partir do valor em português/inglês */
function detectCor(cor: string | null | undefined): string | null {
  const c = norm(cor);
  if (!c) return null;
  if (c.includes("vermelh") || c.includes("red"))                         return "red";
  if (c.includes("laranj") || c.includes("orange"))                       return "orange";
  if (c.includes("amarela") || c.includes("amarelo") || c.includes("yellow")) return "yellow";
  if (c.includes("verde") || c.includes("green"))                         return "green";
  if (c.includes("azul") || c.includes("blue"))                           return "blue";
  if (c.includes("roxo") || c.includes("roxa") || c.includes("purple") || c.includes("violeta")) return "purple";
  if (c.includes("rosa") || c.includes("pink"))                           return "pink";
  if (c.includes("cinza") || c.includes("gray") || c.includes("grey"))    return "gray";
  if (c.includes("branco") || c.includes("branca") || c.includes("white")) return "white";
  if (c.includes("preto") || c.includes("preta") || c.includes("black"))  return "black";
  return null; // valor desconhecido — pode ser CSS direto
}

/** Mapa de cor canônica → valor hex */
const HEX_MAP: Record<string, string> = {
  red:    "#ef4444",
  orange: "#f97316",
  yellow: "#eab308",
  green:  "#22c55e",
  blue:   "#3b82f6",
  purple: "#a855f7",
  pink:   "#ec4899",
  gray:   "#9ca3af",
  white:  "#f1f5f9",
  black:  "#1e293b",
};

/** Retorna o valor hex da cor, ou o valor CSS direto se não mapeado */
function getHex(cor: string | null | undefined): string | null {
  if (!cor) return null;
  const canonical = detectCor(cor);
  if (canonical) return HEX_MAP[canonical] ?? null;
  // Tenta usar como valor CSS direto (ex: "#ff0000")
  const c = cor.trim();
  if (c.startsWith("#") || c.startsWith("rgb")) return c;
  return null;
}

/**
 * Retorna estilo inline para a linha da tabela:
 * borda lateral mais espessa e fundo levemente colorido.
 */
export function getCorRowStyle(cor: string | null | undefined): CSSProperties {
  const hex = getHex(cor);
  if (!hex) return {};
  return {
    borderLeft: `5px solid ${hex}`,
    backgroundColor: `${hex}18`, // ~10% de opacidade
  };
}

/**
 * Retorna estilo inline para o badge circular ao lado do nome da agenda.
 * Badge maior (14×14px) para maior visibilidade.
 */
export function getCorBadgeStyle(cor: string | null | undefined): CSSProperties {
  const hex = getHex(cor);
  if (!hex) return {};
  return {
    backgroundColor: hex,
    width: "14px",
    height: "14px",
    borderRadius: "50%",
    display: "inline-block",
    flexShrink: 0,
    boxShadow: `0 0 0 2px ${hex}40`,
  };
}

/** Ordem de prioridade das cores para agrupamento (menor = mais prioritário) */
const COR_PRIORIDADE: Record<string, number> = {
  red:    1,
  orange: 2,
  yellow: 3,
  green:  4,
  blue:   5,
  purple: 6,
  pink:   7,
  gray:   8,
  white:  9,
  black:  10,
};

/**
 * Retorna a prioridade numérica da cor para ordenação.
 * Cores desconhecidas ou ausentes recebem prioridade máxima (999).
 */
export function getCorPrioridade(cor: string | null | undefined): number {
  const canonical = detectCor(cor);
  if (!canonical) return 999;
  return COR_PRIORIDADE[canonical] ?? 999;
}

/**
 * Retorna a classe Tailwind de borda lateral (para uso em className).
 * Mantido por compatibilidade — prefira getCorRowStyle quando possível.
 */
export function getCorBorderClass(_cor: string | null | undefined): string {
  return ""; // lógica migrada para getCorRowStyle (inline style)
}

/**
 * Retorna o estilo inline de borda lateral (legado).
 * @deprecated Use getCorRowStyle que também aplica fundo colorido.
 */
export function getCorBorderStyle(cor: string | null | undefined): CSSProperties {
  return getCorRowStyle(cor);
}

// ─── Fila/Cotas e Index: regras de destaque ──────────────────────────────────
// Os limites e frases vêm da configuração da legenda (aba "Recados e Legenda",
// hook useLegenda). Sem configuração salva, valem os padrões de shared/legenda.ts:
//   Fila/Cotas ≤ 4 → ⏩ regulação mais flexível ;  > 4 → ⚠️ critérios do protocolo
//   Index > 3 vermelho · > 2 laranja · > 1 amarelo · ≤ 1 sem destaque


export const FILA_COTAS_LIMITE = LEGENDA_PADRAO.filaCotas.limite;
export const FRASE_FILA_COTAS_BAIXA = LEGENDA_PADRAO.filaCotas.fraseBaixa;
export const FRASE_FILA_COTAS_ALTA = LEGENDA_PADRAO.filaCotas.fraseAlta;

/** Converte o Fila/Cotas (string pt-BR como "21,2" ou número) em número. */
export function parseFilaCotas(raw: unknown): number | undefined {
  if (raw == null || raw === '') return undefined;
  if (typeof raw === 'number') return isNaN(raw) ? undefined : raw;
  const v = parseFloat(String(raw).replace(/\./g, '').replace(',', '.'));
  return isNaN(v) ? undefined : v;
}

/**
 * Informações de exibição do Fila/Cotas: valor formatado, classes do "badge"
 * da célula, ícone e frase de orientação (usada no title/tooltip e nos alertas).
 * `cfg` = legenda configurada (useLegenda); se omitido, usa o padrão.
 */
export function getFilaCotasInfo(raw: unknown, cfg: LegendaConfig = LEGENDA_PADRAO): {
  valor: number | undefined;
  texto: string;
  alta: boolean | null;
  icone: string;
  frase: string;
  badgeClass: string;
} {
  const valor = parseFilaCotas(raw);
  if (valor === undefined) {
    return { valor, texto: raw != null && raw !== '' ? String(raw) : '—', alta: null, icone: '', frase: '', badgeClass: 'text-foreground' };
  }
  const alta = valor > cfg.filaCotas.limite;
  return {
    valor,
    texto: valor.toFixed(2),
    alta,
    icone: alta ? '⚠️' : '⏩',
    frase: alta ? cfg.filaCotas.fraseAlta : cfg.filaCotas.fraseBaixa,
    badgeClass: alta
      ? 'bg-amber-100 dark:bg-amber-950/50 text-amber-900 dark:text-amber-200 ring-1 ring-inset ring-amber-400 dark:ring-amber-700'
      : 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-900 dark:text-emerald-200 ring-1 ring-inset ring-emerald-400 dark:ring-emerald-700',
  };
}

export type NivelIndex = 'critico' | 'alto' | 'atencao' | 'normal' | null;

/** Classifica o Index pelos limites configurados (null = sem valor). */
export function getNivelIndex(valor: number | null | undefined, cfg: LegendaConfig = LEGENDA_PADRAO): NivelIndex {
  if (valor == null || isNaN(valor)) return null;
  if (valor > cfg.index.critico) return 'critico';
  if (valor > cfg.index.alto) return 'alto';
  if (valor > cfg.index.atencao) return 'atencao';
  return 'normal';
}

/** Frase da legenda correspondente ao nível do Index (para tooltip). */
export function getFraseIndex(valor: number | null | undefined, cfg: LegendaConfig = LEGENDA_PADRAO): string {
  const n = getNivelIndex(valor, cfg);
  if (n === 'critico') return cfg.index.fraseCritico;
  if (n === 'alto') return cfg.index.fraseAlto;
  if (n === 'atencao') return cfg.index.fraseAtencao;
  if (n === 'normal') return cfg.index.fraseNormal;
  return '';
}

/**
 * Classes de cor do Index por nível, em três "estilos" usados no portal:
 *  - 'badge'  : fundo + texto (células da Lista de agendas / Minhas agendas)
 *  - 'texto'  : só cor do texto (agendas relacionadas)
 *  - 'fundo'  : só fundo leve da linha (agendas relacionadas)
 */
export function getClasseIndex(valor: number | null | undefined, estilo: 'badge' | 'texto' | 'fundo', cfg: LegendaConfig = LEGENDA_PADRAO): string {
  const n = getNivelIndex(valor, cfg);
  const mapa = {
    badge: {
      critico: 'bg-red-100 dark:bg-red-950/50 text-red-900 dark:text-red-300',
      alto: 'bg-orange-100 dark:bg-orange-950/50 text-orange-900 dark:text-orange-300',
      atencao: 'bg-yellow-100 dark:bg-yellow-950/50 text-yellow-900 dark:text-yellow-300',
      normal: '',
    },
    texto: {
      critico: 'text-red-600 dark:text-red-400 font-bold',
      alto: 'text-orange-600 dark:text-orange-400 font-semibold',
      atencao: 'text-yellow-600 dark:text-yellow-400',
      normal: 'text-muted-foreground',
    },
    fundo: {
      critico: 'bg-red-50 dark:bg-red-950/30',
      alto: 'bg-orange-50 dark:bg-orange-950/30',
      atencao: 'bg-yellow-50 dark:bg-yellow-950/30',
      normal: 'bg-muted/30',
    },
  } as const;
  if (n === null) return estilo === 'texto' ? 'text-muted-foreground' : estilo === 'fundo' ? 'bg-muted/50' : '';
  return mapa[estilo][n];
}
