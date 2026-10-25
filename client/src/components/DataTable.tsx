import { memo, useMemo, useCallback, useState } from 'react';
import { ChevronUp, ChevronDown, ChevronRight, Lock, LogIn, Download, Eye, EyeOff, ChevronsUpDown, ChevronsDownUp } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import EncaminharCell from './EncaminharCell';
import EncaminharGrupoCell from './EncaminharGrupoCell';
import AutoEncaminharCell from './AutoEncaminharCell';
import AutoEncaminharGrupoCell from './AutoEncaminharGrupoCell';
import CheckInCell from './CheckInCell';
import { getCorRowStyle, getCorBadgeStyle, getCorPrioridade, getFilaCotasInfo, getClasseIndex, getFraseIndex } from '@/lib/corAgenda';
import { useLegenda } from '@/hooks/useLegenda';
import type { LegendaConfig } from '@shared/legenda';
import { UltimaAtualizacao } from '@/components/UltimaAtualizacao';

interface DataTableProps {
  headers: string[];
  rows: (string | number)[][];
  checkInAtivoId?: number | null;
  onCheckInLista?: (a: { agendaId: number; agendaNome: string; especialidade: string; central?: string; municipio?: string; cotas?: number; saldo?: number; aguardando?: number; indexRegula?: number; filaCotas?: number; }) => void;
  selectedAgendas: Set<string>;
  selectedCentrais: Set<string>;
  selectedMunicipios?: Set<string>;
  selectedEspecialidades: Set<string>;
  selectedCores?: Set<string>;
  sortColumn: number;
  sortOrder: 'asc' | 'desc';
  onSort: (column: number) => void;
  perfilUsuario: string;
  emailUsuario: string;
  concluidasIds?: number[];
  onConcluir?: () => void;
  onRefresh?: () => void;
  dataUpdatedAt?: number;
}

// Layout: [0]agenda [1]municipio [2]cotas [3]saldo [4]aguardando
// [5]autorizadas [6]autCotas [7]indexRegula [8]>7d [9]>28d [10]>90d
// [11]central [12]especialidade [13]flagIndex [14]corIndex [15]flagAutCotas [16]corAutCotas [17]id

interface Grupo {
  nome: string;
  central: string;
  linhas: (string | number)[][];
}

// ─── Linha individual ─────────────────────────────────────────────────────────
const TableRow = memo(function TableRow({
  row, isAdminOuMonitor, isRegulador, encaminhadosAtuais = [], checkInsAtuais = [],
  reguladoresList = [], emailUsuario, onUpdate, isConcluida, isSubRow = false,
  checkInAtivoId, onCheckInLista, ocultarExtras = false, legenda,
}: {
  legenda: LegendaConfig; // limites/frases configuráveis (Recados e Legenda)
  row: (string | number)[];
  isAdminOuMonitor: boolean;
  isRegulador: boolean;
  encaminhadosAtuais: { reguladorEmail: string; reguladorNome: string }[];
  checkInsAtuais: { usuarioEmail: string; usuarioNome: string }[];
  reguladoresList: { email: string; nome: string }[];
  emailUsuario: string;
  onUpdate: () => void;
  isConcluida: boolean;
  isSubRow?: boolean;
  checkInAtivoId?: number | null;
  onCheckInLista?: (a: { agendaId: number; agendaNome: string; especialidade: string; central?: string; municipio?: string; cotas?: number; saldo?: number; aguardando?: number; indexRegula?: number; filaCotas?: number; }) => void;
  ocultarExtras?: boolean;
}) {
  const agendaId = typeof row[17] === 'number' ? row[17] : 0;
  const cor = String(row[14] ?? '');
  const flagIndex = String(row[13] ?? '');
  const filaCotas = getFilaCotasInfo(row[6], legenda);
  const indexValue = parseFloat(String(row[7])) || 0;

  const corRowStyle = getCorRowStyle(cor);
  const corBadgeStyle = getCorBadgeStyle(cor);

  return (
    <tr className={`border-b border-border transition-colors ${checkInAtivoId === agendaId ? 'bg-blue-900 ring-2 ring-inset ring-blue-400 [&_td]:text-white [&_td]:text-opacity-100 [&_span]:text-white' : isSubRow ? 'bg-muted/30 dark:bg-muted/10 hover:bg-secondary' : isConcluida ? 'opacity-60 bg-emerald-50 dark:bg-emerald-950/20 hover:bg-secondary' : 'hover:bg-secondary'}`}
      style={checkInAtivoId === agendaId || isConcluida || isSubRow ? undefined : corRowStyle}>
      <td className={`py-1.5 text-foreground ${isSubRow ? 'pl-8 pr-2' : 'px-3'}`}>
        {isSubRow ? (
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30 flex-shrink-0" />
            <div className="text-xs text-foreground font-medium">{String(row[0])}</div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            {cor && !isConcluida && <span style={corBadgeStyle} title={cor} />}
            {isConcluida && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-semibold bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                Concluída
              </span>
            )}
            <span className="font-medium text-xs text-foreground">{String(row[0])}</span>
          </div>
        )}
      </td>
      <td className="px-2 py-1.5 text-center text-xs font-medium text-foreground">{String(row[11])}</td>
      <td className="px-2 py-1.5 text-xs text-muted-foreground">{isSubRow ? String(row[1]) : '—'}</td>
      <td className="px-2 py-1.5 text-center">
        {/* Fila/Cotas — destaque pelo limite configurável (padrão 4); frase de orientação no tooltip */}
        <span title={filaCotas.frase ? `${filaCotas.icone} ${filaCotas.frase}` : undefined} className={`inline-block px-1.5 py-0.5 rounded text-xs font-semibold cursor-default ${filaCotas.badgeClass}`}>
          {filaCotas.texto}
        </span>
      </td>
      <td className="px-2 py-1.5 text-center">
        <span title={flagIndex || getFraseIndex(indexValue, legenda) || undefined} className={`inline-block px-1.5 py-0.5 rounded text-xs font-semibold cursor-default ${getClasseIndex(indexValue, 'badge', legenda) || 'text-foreground'}`}>
          {indexValue.toFixed(2)}
        </span>
      </td>
      <td className="px-2 py-1.5 text-center text-xs font-medium text-foreground">{row[8] ? String(row[8]) : '—'}</td>
      <td className="px-2 py-1.5 text-center text-xs font-medium text-foreground">{row[9] ? String(row[9]) : '—'}</td>
      <td className="px-2 py-1.5 text-center text-xs font-medium text-foreground">{row[10] ? String(row[10]) : '—'}</td>
      {(isAdminOuMonitor || isRegulador) && (
        <td className="px-2 py-1.5 text-center">
          {isConcluida ? <span className="text-xs text-muted-foreground italic">bloqueado</span>
          : agendaId > 0 ? (
            isAdminOuMonitor ? (
              <EncaminharCell agendaId={agendaId} agendaNome={String(row[0])}
                municipio={row[1] != null && String(row[1]) !== '' ? String(row[1]) : undefined}
                central={row[11] != null && String(row[11]) !== '' ? String(row[11]) : undefined}
                especialidade={String(row[12])}
                encaminhadosAtuais={encaminhadosAtuais} reguladoresList={reguladoresList} onUpdate={onUpdate} />
            ) : (
              <AutoEncaminharCell agendaId={agendaId} agendaNome={String(row[0])}
                municipio={row[1] != null && String(row[1]) !== '' ? String(row[1]) : undefined}
                central={row[11] != null && String(row[11]) !== '' ? String(row[11]) : undefined}
                especialidade={String(row[12])} emailUsuario={emailUsuario}
                encaminhadosAtuais={encaminhadosAtuais} onUpdate={onUpdate}
                botaoExtra={onCheckInLista ? (
                  <button
                    onClick={() => onCheckInLista({ agendaId, agendaNome: String(row[0]), especialidade: String(row[12]),
                      central: row[11] != null && String(row[11]) !== '' ? String(row[11]) : undefined,
                      municipio: row[1] != null && String(row[1]) !== '' ? String(row[1]) : undefined,
                      cotas: typeof row[2] === 'number' ? row[2] : undefined,
                      saldo: typeof row[3] === 'number' ? row[3] : undefined,
                      aguardando: typeof row[4] === 'number' ? row[4] : undefined,
                      indexRegula: typeof row[7] === 'number' ? row[7] : undefined,
                      filaCotas: (() => { const raw = String(row[6] ?? ''); const v = parseFloat(raw.replace(/\./g, '').replace(',', '.')); return isNaN(v) ? undefined : v; })(),
                    })}
                    className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
                      checkInAtivoId === agendaId
                        ? 'bg-blue-700 text-white'
                        : 'bg-muted text-muted-foreground hover:bg-blue-100 hover:text-blue-700 dark:hover:bg-blue-950/50 dark:hover:text-blue-300'
                    }`}
                    title={checkInAtivoId === agendaId ? 'Fechar painel' : 'Iniciar regulação'}
                  >
                    <LogIn size={11} />
                    {checkInAtivoId === agendaId ? 'Regulando' : 'Check-in'}
                  </button>
                ) : undefined}
              />
            )
          ) : <span className="text-xs text-muted-foreground">—</span>}
        </td>
      )}
      <td className="px-2 py-1.5 text-center">
        {(checkInsAtuais ?? []).length > 0 ? (
          <div className="flex flex-col gap-1 items-center">
            {(checkInsAtuais ?? []).map(ci => (
              <span key={ci.usuarioEmail} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300">
                <svg className="w-2.5 h-2.5 flex-shrink-0" fill="currentColor" viewBox="0 0 8 8"><circle cx="4" cy="4" r="3" /></svg>
                {ci.usuarioNome || ci.usuarioEmail}
              </span>
            ))}
          </div>
        ) : <span className="text-xs text-muted-foreground">—</span>}
      </td>
      {!ocultarExtras && (
        <>
          <td className="px-2 py-1.5 text-center text-xs font-medium text-foreground">{String(row[2])}</td>
          <td className="px-2 py-1.5 text-center text-xs font-medium text-foreground">{String(row[3])}</td>
          <td className="px-2 py-1.5 text-center text-xs font-medium text-foreground">{String(row[4])}</td>
          <td className="px-2 py-1.5 text-center text-xs font-medium text-foreground">{String(row[5])}</td>
        </>
      )}
    </tr>
  );
});

// ─── Linha de grupo ───────────────────────────────────────────────────────────
const GrupoRow = memo(function GrupoRow({
  grupo, isExpanded, onToggle, isAdminOuMonitor, isRegulador,
  encaminhamentosPorAgenda = new Map(), checkInsPorAgenda = new Map(), reguladoresList = [],
  emailUsuario, onUpdate, concluidasSet,
  checkInAtivoId: checkInAtivoIdProp, onCheckInLista: onCheckInListaProp,
  ocultarExtras = false, legenda,
}: {
  legenda: LegendaConfig;
  grupo: Grupo;
  isExpanded: boolean;
  onToggle: () => void;
  isAdminOuMonitor: boolean;
  isRegulador: boolean;
  encaminhamentosPorAgenda: Map<number, { reguladorEmail: string; reguladorNome: string }[]>;
  checkInsPorAgenda: Map<number, { usuarioEmail: string; usuarioNome: string }[]>;
  reguladoresList: { email: string; nome: string }[];
  emailUsuario: string;
  onUpdate: () => void;
  concluidasSet: Set<number>;
  checkInAtivoId?: number | null;
  onCheckInLista?: (a: { agendaId: number; agendaNome: string; especialidade: string; central?: string; municipio?: string; cotas?: number; saldo?: number; aguardando?: number; indexRegula?: number; filaCotas?: number; }) => void;
  ocultarExtras?: boolean;
}) {
  const { linhas, nome, central } = grupo;
  const isSingle = linhas.length === 1;

  const totais = useMemo(() => {
    const soma = (idx: number) => linhas.reduce((acc, r) => acc + (parseFloat(String(r[idx])) || 0), 0);
    return { cotas: soma(2), saldo: soma(3), aguardando: soma(4), autorizadas: soma(5), ag7d: soma(8), ag28d: soma(9), ag90d: soma(10) };
  }, [linhas]);

  const corDominante = useMemo(() =>
    linhas.reduce((melhor, r) => {
      const cor = String(r[14] ?? '');
      return getCorPrioridade(cor) < getCorPrioridade(melhor) ? cor : melhor;
    }, String(linhas[0][14] ?? '')), [linhas]);

  const checkInsGrupo = useMemo(() => {
    const vistos = new Set<string>();
    const lista: { usuarioEmail: string; usuarioNome: string }[] = [];
    for (const r of linhas) {
      const id = typeof r[17] === 'number' ? r[17] : 0;
      for (const ci of checkInsPorAgenda.get(id) ?? []) {
        if (!vistos.has(ci.usuarioEmail)) { vistos.add(ci.usuarioEmail); lista.push(ci); }
      }
    }
    return lista;
  }, [linhas, checkInsPorAgenda]);

  const encaminhadosGrupo = useMemo(() => {
    const vistos = new Set<string>();
    const lista: { reguladorEmail: string; reguladorNome: string }[] = [];
    for (const r of linhas) {
      const id = typeof r[17] === 'number' ? r[17] : 0;
      for (const e of encaminhamentosPorAgenda.get(id) ?? []) {
        if (!vistos.has(e.reguladorEmail)) { vistos.add(e.reguladorEmail); lista.push(e); }
      }
    }
    return lista;
  }, [linhas, encaminhamentosPorAgenda]);

  const corRowStyle = getCorRowStyle(corDominante);
  const corBadgeStyle = getCorBadgeStyle(corDominante);
  const todasConcluidas = linhas.every(r => { const id = typeof r[17] === 'number' ? r[17] : 0; return id > 0 && concluidasSet.has(id); });

  const municipioLabel = isSingle ? String(linhas[0][1]) : `${linhas.length} municípios`;

  return (
    <>
      <tr className={`border-b border-border transition-colors ${todasConcluidas ? 'opacity-60 bg-emerald-50 dark:bg-emerald-950/20' : isExpanded ? 'bg-blue-50/60 dark:bg-blue-950/20 hover:bg-blue-50 dark:hover:bg-blue-950/30' : 'bg-card hover:bg-secondary'}`}
        style={todasConcluidas || isExpanded ? undefined : corRowStyle}>
        <td className="px-3 py-1.5 text-foreground">
          <div className="flex items-center gap-2">
            {!isSingle ? (
              <button type="button" onClick={onToggle}
                className={`flex-shrink-0 w-5 h-5 rounded flex items-center justify-center transition-colors ${isExpanded ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-600' : 'bg-muted text-muted-foreground hover:bg-secondary'}`}
                title={isExpanded ? 'Recolher municípios' : 'Expandir municípios'}>
                <ChevronRight size={12} className={`transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
              </button>
            ) : <div className="w-5 flex-shrink-0" />}
            {corDominante && !todasConcluidas && <span style={corBadgeStyle} title={corDominante} />}
            {todasConcluidas && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-semibold bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                Concluída
              </span>
            )}
            <div>
              <div className="font-medium text-xs text-foreground">{nome}</div>
            </div>
          </div>
        </td>
        <td className="px-2 py-1.5 text-center text-xs font-medium text-foreground">{central}</td>
        <td className="px-2 py-1.5 text-xs text-muted-foreground">
          {isSingle ? municipioLabel : (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground text-xs font-medium">{linhas.length} municípios</span>
          )}
        </td>
        <td className="px-2 py-1.5 text-center">
          {isSingle ? (() => {
            // Destaque pela regra do Fila/Cotas (limite configurável), igual às sub-linhas
            const fc = getFilaCotasInfo(linhas[0][6], legenda);
            return (
              <span title={fc.frase ? `${fc.icone} ${fc.frase}` : undefined}
                className={`inline-block px-1.5 py-0.5 rounded text-sm font-semibold cursor-default ${fc.badgeClass}`}>
                {fc.texto}
              </span>
            );
          })() : null}
        </td>
        <td className="px-2 py-1.5 text-center">
          {isSingle ? (
            <span className="text-sm font-semibold text-foreground">
              {(() => { const v = parseFloat(String(linhas[0][7] ?? 0)); return isNaN(v) ? '—' : v.toFixed(2); })()}
            </span>
          ) : null}
        </td>
        <td className="px-2 py-1.5 text-center text-xs font-medium text-foreground">{isSingle ? (totais.ag7d || '—') : ''}</td>
        <td className="px-2 py-1.5 text-center text-xs font-medium text-foreground">{isSingle ? (totais.ag28d || '—') : ''}</td>
        <td className="px-2 py-1.5 text-center text-xs font-medium text-foreground">{isSingle ? (totais.ag90d || '—') : ''}</td>
        {(isAdminOuMonitor || isRegulador) && (
          <td className="px-2 py-1.5 text-center">
            {todasConcluidas ? (
              <span className="text-xs text-muted-foreground italic">bloqueado</span>
            ) : isAdminOuMonitor ? (
              <EncaminharGrupoCell linhas={linhas} encaminhadosGrupo={encaminhadosGrupo} reguladoresList={reguladoresList} onUpdate={onUpdate} />
            ) : (
              <div className="flex flex-row items-center justify-center gap-1 whitespace-nowrap">
                <AutoEncaminharGrupoCell
                  linhas={linhas}
                  emailUsuario={emailUsuario}
                  encaminhamentosPorAgenda={encaminhamentosPorAgenda}
                  onUpdate={onUpdate}
                  concluidasSet={concluidasSet}
                />
                {onCheckInListaProp && isSingle && (() => {
                  const r = linhas[0];
                  const aId = typeof r[17] === 'number' ? r[17] : 0;
                  if (aId === 0) return null;
                  return (
                    <button
                      onClick={() => onCheckInListaProp({
                        agendaId: aId, agendaNome: String(r[0]), especialidade: String(r[12]),
                        central: r[11] != null && String(r[11]) !== '' ? String(r[11]) : undefined,
                        municipio: r[1] != null && String(r[1]) !== '' ? String(r[1]) : undefined,
                        cotas: typeof r[2] === 'number' ? r[2] : undefined,
                        saldo: typeof r[3] === 'number' ? r[3] : undefined,
                        aguardando: typeof r[4] === 'number' ? r[4] : undefined,
                        indexRegula: typeof r[7] === 'number' ? r[7] : undefined,
                        filaCotas: (() => { const raw = String(r[6] ?? ''); const v = parseFloat(raw.replace(/\./g, '').replace(',', '.')); return isNaN(v) ? undefined : v; })(),
                      })}
                      className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
                        checkInAtivoIdProp === aId
                          ? 'bg-blue-700 text-white'
                          : 'bg-muted text-muted-foreground hover:bg-blue-100 hover:text-blue-700 dark:hover:bg-blue-950/50 dark:hover:text-blue-300'
                      }`}
                      title={checkInAtivoIdProp === aId ? 'Fechar painel' : 'Iniciar regulação'}
                    >
                      <LogIn size={11} />
                      {checkInAtivoIdProp === aId ? 'Regulando' : 'Check-in'}
                    </button>
                  );
                })()}
              </div>
            )}
          </td>
        )}
        <td className="px-2 py-1.5 text-center">
          {checkInsGrupo.length > 0 ? (
            <div className="flex flex-col gap-1 items-center">
              {checkInsGrupo.map(ci => (
                <span key={ci.usuarioEmail} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300">
                  <svg className="w-2.5 h-2.5 flex-shrink-0" fill="currentColor" viewBox="0 0 8 8"><circle cx="4" cy="4" r="3" /></svg>
                  {ci.usuarioNome || ci.usuarioEmail}
                </span>
              ))}
            </div>
          ) : <span className="text-xs text-muted-foreground">—</span>}
        </td>
        {!ocultarExtras && (
          <>
            <td className="px-2 py-1.5 text-center text-xs font-medium text-foreground">{isSingle ? (totais.cotas || '—') : ''}</td>
            <td className="px-2 py-1.5 text-center text-xs font-medium text-foreground">{isSingle ? (totais.saldo || '—') : ''}</td>
            <td className="px-2 py-1.5 text-center text-xs font-medium text-foreground">{isSingle ? (totais.aguardando || '—') : ''}</td>
            <td className="px-2 py-1.5 text-center text-xs font-medium text-foreground">{isSingle ? (totais.autorizadas || '—') : ''}</td>
          </>
        )}
      </tr>
      {isExpanded && !isSingle && (linhas ?? []).map(row => {
        if (!row || !Array.isArray(row)) return null;
        const agendaId = typeof row[17] === 'number' ? row[17] : 0;
        const isConcluida = agendaId > 0 && concluidasSet.has(agendaId);
        return (
          <TableRow key={agendaId > 0 ? agendaId : String(row[1])} row={row}
            isAdminOuMonitor={isAdminOuMonitor} isRegulador={isRegulador}
            encaminhadosAtuais={encaminhamentosPorAgenda.get(agendaId) ?? []}
            checkInsAtuais={checkInsPorAgenda.get(agendaId) ?? []}
            reguladoresList={reguladoresList ?? []} emailUsuario={emailUsuario}
            onUpdate={onUpdate} isConcluida={isConcluida} isSubRow
            checkInAtivoId={checkInAtivoIdProp} onCheckInLista={onCheckInListaProp} ocultarExtras={ocultarExtras} legenda={legenda} />
        );
      })}
    </>
  );
});

// ─── Componente principal ─────────────────────────────────────────────────────
export default function DataTable({
  headers, rows, selectedAgendas, selectedCentrais, selectedEspecialidades, selectedCores = new Set(),
  selectedMunicipios = new Set(),
  sortColumn, sortOrder, onSort, perfilUsuario, emailUsuario,
  concluidasIds = [], onConcluir, onRefresh, dataUpdatedAt,
  checkInAtivoId, onCheckInLista,
}: DataTableProps) {
  const concluidasSet = useMemo(() => new Set(concluidasIds), [concluidasIds]);
  const legenda = useLegenda(); // limites de Fila/Cotas e Index configuráveis
  const perfilLower = perfilUsuario.toLowerCase();
  const isAdminOuMonitor = perfilLower.includes('administrador') || perfilLower.includes('monitoramento');
  const isRegulador = perfilLower.includes('regulador') || perfilLower.includes('consultor');

  // Expansão dos grupos (agendas com vários municípios).
  // `todasExpandidas` define o padrão (lembrado no navegador); `expandidos` guarda
  // as EXCEÇÕES clicadas individualmente — assim o botão "Expandir todas" também
  // vale para agendas que aparecem depois (troca de filtro, atualização de dados).
  const [todasExpandidas, setTodasExpandidas] = useState<boolean>(() => {
    try { return localStorage.getItem('lista-agendas-expandir-todas') === '1'; } catch { return false; }
  });
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());
  const toggleGrupo = useCallback((chave: string) => {
    setExpandidos(prev => { const next = new Set(prev); if (next.has(chave)) next.delete(chave); else next.add(chave); return next; });
  }, []);
  const isGrupoExpandido = (chave: string) => todasExpandidas ? !expandidos.has(chave) : expandidos.has(chave);
  const toggleTodasExpandidas = useCallback(() => {
    setTodasExpandidas(prev => {
      const next = !prev;
      try { localStorage.setItem('lista-agendas-expandir-todas', next ? '1' : '0'); } catch { /* ignora */ }
      return next;
    });
    setExpandidos(new Set()); // zera exceções individuais
  }, []);

  const [filtrarBloqueadas, setFiltrarBloqueadas] = useState<"todas" | "bloqueadas" | "livres">("livres");
  const [exportDropdownAberto, setExportDropdownAberto] = useState(false);
  const [colunasExtrasOcultas, setColunasExtrasOcultas] = useState<boolean>(() => {
    try { return localStorage.getItem('lista-agendas-ocultar-extras') === '1'; } catch { return false; }
  });
  const toggleColunasExtras = useCallback(() => {
    setColunasExtrasOcultas(prev => {
      const next = !prev;
      try { localStorage.setItem('lista-agendas-ocultar-extras', next ? '1' : '0'); } catch { /* ignora */ }
      return next;
    });
  }, []);

  const { data: reguladoresList = [] } = trpc.reguladores.listarReguladores.useQuery(undefined, { staleTime: 5 * 60 * 1000, gcTime: 10 * 60 * 1000 });
  const { data: encaminhamentosData = [], refetch: refetchEncaminhamentos } = trpc.encaminhamentos.getAll.useQuery(undefined, { staleTime: 30 * 1000 });
  const { data: checkInsData = [], refetch: refetchCheckIns } = trpc.checkIns.getAll.useQuery(undefined, { staleTime: 30 * 1000 });

  const encaminhamentosPorAgenda = useMemo(() => {
    const map = new Map<number, { reguladorEmail: string; reguladorNome: string }[]>();
    for (const enc of encaminhamentosData) { const list = map.get(enc.agendaId) ?? []; list.push({ reguladorEmail: enc.reguladorEmail, reguladorNome: enc.reguladorNome }); map.set(enc.agendaId, list); }
    return map;
  }, [encaminhamentosData]);

  const checkInsPorAgenda = useMemo(() => {
    const map = new Map<number, { usuarioEmail: string; usuarioNome: string }[]>();
    for (const ci of checkInsData) { const list = map.get(ci.agendaId) ?? []; list.push({ usuarioEmail: ci.usuarioEmail, usuarioNome: ci.usuarioNome }); map.set(ci.agendaId, list); }
    return map;
  }, [checkInsData]);

  const handleUpdate = useCallback(() => { refetchEncaminhamentos(); refetchCheckIns(); onConcluir?.(); }, [refetchEncaminhamentos, refetchCheckIns, onConcluir]);

  const expandirEspecialidades = (valor: string) => valor.split(/[,;]/).map(e => e.trim()).filter(Boolean);

  const filteredRows = useMemo(() => rows.filter(row => {
    const agenda = String(row[0]), central = String(row[11]), espBruta = String(row[12]);
    const municipio = String(row[1]);
    const matchesAgenda = selectedAgendas.size === 0 || selectedAgendas.has(agenda);
    const matchesCentral = selectedCentrais.size === 0 || selectedCentrais.has(central);
    const matchesMunicipio = selectedMunicipios.size === 0 || selectedMunicipios.has(municipio);
    const partes = expandirEspecialidades(espBruta);
    const matchesEsp = selectedEspecialidades.size === 0 || partes.some(p => selectedEspecialidades.has(p));
    const cor = String(row[14] ?? '');
    const matchesCor = selectedCores.size === 0 || selectedCores.has(cor) || (selectedCores.has('Sem cor') && !cor);
    const agendaId = typeof row[17] === 'number' ? row[17] : 0;
    const isBloqueada = agendaId > 0 && concluidasSet.has(agendaId);
    if (filtrarBloqueadas === 'livres' && isBloqueada) return false;
    if (filtrarBloqueadas === 'bloqueadas' && !isBloqueada) return false;
    return matchesAgenda && matchesCentral && matchesMunicipio && matchesEsp && matchesCor;
  }), [rows, selectedAgendas, selectedCentrais, selectedMunicipios, selectedEspecialidades, selectedCores, filtrarBloqueadas, concluidasSet]);

  const grupos = useMemo((): Grupo[] => {
    const mapa = new Map<string, Grupo>();
    for (const row of filteredRows) {
      const nome = String(row[0]), central = String(row[11]), chave = `${nome}|${central}`;
      if (!mapa.has(chave)) mapa.set(chave, { nome, central, linhas: [] });
      mapa.get(chave)!.linhas.push(row);
    }
    const lista = Array.from(mapa.values());

    // Comparador de LINHAS (município a município), usado em dois níveis:
    //  1) ordena as linhas dentro de cada grupo (sub-linhas ao expandir);
    //  2) ordena os grupos pela sua 1ª linha já ordenada — ou seja, cada agenda
    //     agrupada fica posicionada pelo município "mais extremo" na coluna
    //     escolhida (maior valor em ordem decrescente, menor em crescente).
    // Antes, agendas agrupadas eram ordenadas pela SOMA (que fica oculta na
    // linha do grupo) e as sub-linhas não eram ordenadas — por isso a ordenação
    // parecia não funcionar para elas.
    const ORDEM_CENTRAL = ['CRA','1CRS','2CRS','3CRS','4CRS','5CRS','6CRS','7CRS','8CRS','9CRS','10CRS','11CRS','12CRS','13CRS','14CRS','15CRS','16CRS','17CRS','18CRS'];
    const numCols = [2, 3, 4, 5, 7, 8, 9, 10];
    const getValLinha = (r: (string | number)[]): number | string => {
      if (sortColumn === 14) return getCorPrioridade(String(r[14] ?? ''));
      if (numCols.includes(sortColumn)) return parseFloat(String(r[sortColumn])) || 0;
      if (sortColumn === 6) return getFilaCotasInfo(r[6]).valor ?? 0;
      if (sortColumn === 11) { const i = ORDEM_CENTRAL.indexOf(String(r[11] ?? '')); return i === -1 ? 999 : i; }
      return String(r[sortColumn] ?? '');
    };
    const compararLinhas = (a: (string | number)[], b: (string | number)[]): number => {
      const aVal = getValLinha(a), bVal = getValLinha(b);
      if (typeof aVal === 'number' && typeof bVal === 'number') return sortOrder === 'desc' ? bVal - aVal : aVal - bVal;
      return sortOrder === 'desc' ? String(bVal).localeCompare(String(aVal), 'pt-BR') : String(aVal).localeCompare(String(bVal), 'pt-BR');
    };

    // 1) Ordena as sub-linhas de cada grupo
    for (const g of lista) g.linhas.sort(compararLinhas);

    // 2) Ordena os grupos pela 1ª linha (já ordenada)
    lista.sort((a, b) => {
      // Cor: o grupo usa a cor mais prioritária entre seus municípios (mantido)
      if (sortColumn === 14) {
        const pa = Math.min(...a.linhas.map(r => getCorPrioridade(String(r[14] ?? ''))));
        const pb = Math.min(...b.linhas.map(r => getCorPrioridade(String(r[14] ?? ''))));
        return sortOrder === 'desc' ? pb - pa : pa - pb;
      }
      return compararLinhas(a.linhas[0], b.linhas[0]);
    });
    return lista;
  }, [filteredRows, sortColumn, sortOrder]);

  const SortIcon = ({ col }: { col: number }) =>
    sortColumn === col ? (sortOrder === 'desc' ? <ChevronDown size={16} className="text-primary" /> : <ChevronUp size={16} className="text-primary" />) : null;

  // Colunas fixas sempre visíveis: Agenda, Central, Município, Fila/Cotas, Index, >7d, >28d, >90d, Regulando = 9
  const numCols = 9 + ((isAdminOuMonitor || isRegulador) ? 1 : 0) + (colunasExtrasOcultas ? 0 : 4);

  // Larguras de coluna proporcionais (recalculadas conforme quais colunas estão visíveis,
  // pra distribuição não ficar estranha quando Encaminhar ou as 4 colunas extras somem)
  const colWidths = useMemo(() => {
    const cols: { key: string; weight: number }[] = [
      { key: 'agenda', weight: 3 },
      { key: 'central', weight: 1 },
      { key: 'municipio', weight: 1.6 },
      { key: 'filaCotas', weight: 1 },
      { key: 'index', weight: 1 },
      { key: 'd7', weight: 0.8 },
      { key: 'd28', weight: 0.8 },
      { key: 'd90', weight: 0.8 },
      ...((isAdminOuMonitor || isRegulador) ? [{ key: 'encaminhar', weight: 2.2 }] : []),
      { key: 'regulando', weight: 1.6 },
      ...(!colunasExtrasOcultas ? [
        { key: 'cotas', weight: 1 },
        { key: 'saldo', weight: 1 },
        { key: 'aguardando', weight: 1.8 },
        { key: 'autorizadas', weight: 1.9 },
      ] : []),
    ];
    const total = cols.reduce((s, c) => s + c.weight, 0);
    return cols.map(c => ({ key: c.key, pct: (c.weight / total) * 100 }));
  }, [isAdminOuMonitor, isRegulador, colunasExtrasOcultas]);

  // Exportar tabela filtrada
  const handleExportar = (formato: 'csv' | 'xls') => {
    const cabecalho = ['Agenda','Central','Município','Fila/Cotas','Index','>7d','>28d','>90d','Cotas','Saldo','Aguardando','Autorizadas'];
    const linhasExport = filteredRows.map(r => [
      String(r[0] ?? ''), String(r[11] ?? ''), String(r[1] ?? ''),
      String(r[6] ?? ''), String(r[7] ?? ''), String(r[8] ?? ''), String(r[9] ?? ''), String(r[10] ?? ''),
      String(r[2] ?? ''), String(r[3] ?? ''), String(r[4] ?? ''), String(r[5] ?? ''),
    ]);
    // Linha de totais
    const somaExport = (idx: number) => filteredRows.reduce((acc, r) => acc + (parseFloat(String(r[idx])) || 0), 0);
    const linhaTotais = [
      `Totais (${filteredRows.length} linhas)`, '', '',
      '—', '—', String(somaExport(8)), String(somaExport(9)), String(somaExport(10)),
      String(somaExport(2)), String(somaExport(3)), String(somaExport(4)), String(somaExport(5)),
    ];
    const dados = [cabecalho, ...linhasExport, linhaTotais];

    if (formato === 'csv') {
      const sep = ';';
      const csvContent = dados.map(row => row.map(c => `"${c.replace(/"/g, '""')}"`).join(sep)).join('\n');
      const blob = new Blob(['﻿' + csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'agendas.csv'; a.click();
      URL.revokeObjectURL(url);
    } else {
      // XLS simples via HTML table
      const html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="UTF-8"/></head><body><table>' +
        dados.map(row => '<tr>' + row.map(c => `<td>${c}</td>`).join('') + '</tr>').join('') +
        '</table></body></html>';
      const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'agendas.xls'; a.click();
      URL.revokeObjectURL(url);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-card">
      <div className="px-6 py-4 border-b border-border">
        <h1 className="text-2xl font-semibold text-foreground">Lista de agendas</h1>
        <div className="flex items-center gap-4 mt-1">
          <p className="text-sm text-muted-foreground">
            {grupos.length} agenda{grupos.length !== 1 ? 's' : ''}
            {grupos.length !== filteredRows.length && <span className="ml-1 text-muted-foreground/70">· {filteredRows.length} linha{filteredRows.length !== 1 ? 's' : ''} no total</span>}
          </p>
          {/* Exportar */}
          <div className="relative">
            <button
              onClick={() => setExportDropdownAberto(v => !v)}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border border-border text-muted-foreground hover:bg-muted transition-colors"
              title="Exportar tabela"
            >
              <Download size={11} />
              Exportar
            </button>
            {exportDropdownAberto && (
              <>
                {/* Overlay invisível para fechar ao clicar fora */}
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setExportDropdownAberto(false)}
                />
                <div className="absolute right-0 top-full mt-1 z-50 flex flex-col bg-card border border-border rounded-lg shadow-lg overflow-hidden min-w-[100px]">
                  <button
                    onClick={() => { handleExportar('csv'); setExportDropdownAberto(false); }}
                    className="px-4 py-2 text-xs text-left hover:bg-muted transition-colors"
                  >.CSV</button>
                  <button
                    onClick={() => { handleExportar('xls'); setExportDropdownAberto(false); }}
                    className="px-4 py-2 text-xs text-left hover:bg-muted transition-colors"
                  >.XLS</button>
                </div>
              </>
            )}
          </div>
          <button
            onClick={() => setFiltrarBloqueadas(v =>
              v === 'livres' ? 'bloqueadas' : v === 'bloqueadas' ? 'todas' : 'livres'
            )}
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition-colors ${
              filtrarBloqueadas === 'bloqueadas'
                ? 'bg-red-100 dark:bg-red-950/50 text-red-700 dark:text-red-300 border-red-300 dark:border-red-700'
                : filtrarBloqueadas === 'todas'
                  ? 'bg-muted text-foreground border-border'
                  : 'border-border text-muted-foreground hover:bg-muted'
            }`}
            title={
              filtrarBloqueadas === 'livres' ? 'Clique para ver só as bloqueadas' :
              filtrarBloqueadas === 'bloqueadas' ? 'Clique para ver todas' :
              'Clique para ocultar bloqueadas'
            }
          >
            <Lock size={11} />
            {filtrarBloqueadas === 'livres' ? 'Ocultar bloqueadas' :
             filtrarBloqueadas === 'bloqueadas' ? 'Só bloqueadas' :
             'Todas'}
          </button>
          <button
            onClick={toggleColunasExtras}
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition-colors ${
              colunasExtrasOcultas
                ? 'bg-muted text-foreground border-border'
                : 'border-border text-muted-foreground hover:bg-muted'
            }`}
            title={colunasExtrasOcultas ? 'Mostrar Cotas/Saldo/Aguardando/Autorizadas' : 'Ocultar Cotas/Saldo/Aguardando/Autorizadas'}
          >
            {colunasExtrasOcultas ? <EyeOff size={11} /> : <Eye size={11} />}
            {colunasExtrasOcultas ? 'Colunas ocultas' : 'Ocultar cotas/saldo/aguard./autoriz.'}
          </button>
          {/* Expandir / recolher todas as agendas agrupadas (vários municípios) */}
          <button
            onClick={toggleTodasExpandidas}
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition-colors ${
              todasExpandidas
                ? 'bg-blue-100 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-700'
                : 'border-border text-muted-foreground hover:bg-muted'
            }`}
            title={todasExpandidas ? 'Recolher os municípios de todas as agendas' : 'Mostrar os municípios de todas as agendas agrupadas'}
          >
            {todasExpandidas ? <ChevronsDownUp size={11} /> : <ChevronsUpDown size={11} />}
            {todasExpandidas ? 'Recolher todas' : 'Expandir todas'}
          </button>
          <UltimaAtualizacao compact />
        </div>
      </div>
      <div className="flex-1 overflow-x-auto">
        <table className="w-full border-collapse table-fixed">
          <colgroup>
            {colWidths.map(c => (
              <col key={c.key} style={{ width: `${c.pct}%` }} />
            ))}
          </colgroup>
          <thead className="sticky top-0 bg-secondary z-10">
            <tr>
              <th onClick={() => onSort(0)} className="px-3 py-1.5 text-left text-xs font-semibold text-foreground uppercase tracking-wider border-b border-border cursor-pointer hover:bg-muted transition-colors">
                <div className="flex items-center gap-1 min-w-0"><span className="whitespace-normal leading-tight">Agenda</span><SortIcon col={0} /></div>
              </th>
              <th onClick={() => onSort(11)} className="px-2 py-1.5 text-center text-xs font-semibold text-foreground uppercase tracking-wider border-b border-border cursor-pointer hover:bg-muted transition-colors">
                <div className="flex items-center justify-center gap-1 min-w-0"><span className="whitespace-normal leading-tight">Central</span><SortIcon col={11} /></div>
              </th>
              <th onClick={() => onSort(1)} className="px-2 py-1.5 text-left text-xs font-semibold text-foreground uppercase tracking-wider border-b border-border cursor-pointer hover:bg-muted transition-colors">
                <div className="flex items-center gap-1 min-w-0"><span className="whitespace-normal leading-tight">Município</span><SortIcon col={1} /></div>
              </th>
              {[{label:'Fila/Cotas',col:6},{label:'Index',col:7},{label:'>7d',col:8},{label:'>28d',col:9},{label:'>90d',col:10}].map(({label,col}) => (
                <th key={col} onClick={() => onSort(col)} className="px-2 py-1.5 text-center text-xs font-semibold text-foreground uppercase tracking-wider border-b border-border cursor-pointer hover:bg-muted transition-colors">
                  <div className="flex items-center justify-center gap-1 min-w-0"><span className="whitespace-normal leading-tight text-center">{label}</span><SortIcon col={col} /></div>
                </th>
              ))}
              {(isAdminOuMonitor || isRegulador) && <th className="px-2 py-1.5 text-center text-xs font-semibold text-foreground uppercase tracking-wider border-b border-border">Encaminhar</th>}
              <th className="px-2 py-1.5 text-center text-xs font-semibold text-foreground uppercase tracking-wider border-b border-border">Regulando</th>
              {!colunasExtrasOcultas && [{label:'Cotas',col:2},{label:'Saldo',col:3},{label:'Aguardando',col:4},{label:'Autorizadas',col:5}].map(({label,col}) => (
                <th key={col} onClick={() => onSort(col)} className="px-2 py-1.5 text-center text-xs font-semibold text-foreground uppercase tracking-wider border-b border-border cursor-pointer hover:bg-muted transition-colors">
                  <div className="flex items-center justify-center gap-1 min-w-0"><span className="whitespace-normal leading-tight text-center">{label}</span><SortIcon col={col} /></div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grupos.length === 0 ? (
              <tr><td colSpan={numCols} className="px-6 py-8 text-center"><p className="text-muted-foreground">Nenhum resultado encontrado</p></td></tr>
            ) : grupos.map(grupo => {
              const chave = `${grupo.nome}|${grupo.central}`;
              return (
                <GrupoRow key={chave} grupo={grupo} isExpanded={isGrupoExpandido(chave)} onToggle={() => toggleGrupo(chave)}
                  isAdminOuMonitor={isAdminOuMonitor} isRegulador={isRegulador}
                  encaminhamentosPorAgenda={encaminhamentosPorAgenda} checkInsPorAgenda={checkInsPorAgenda}
                  reguladoresList={reguladoresList} emailUsuario={emailUsuario}
                  onUpdate={handleUpdate} concluidasSet={concluidasSet}
                  checkInAtivoId={checkInAtivoId} onCheckInLista={onCheckInLista} ocultarExtras={colunasExtrasOcultas} legenda={legenda} />
              );
            })}
          </tbody>
          {/* Linha de totais */}
          {(() => {
            const soma = (idx: number) => filteredRows.reduce((acc, r) => acc + (parseFloat(String(r[idx])) || 0), 0);
            const totaisTabela = {
              cotas: soma(2), saldo: soma(3), aguardando: soma(4),
              autorizadas: soma(5), ag7d: soma(8), ag28d: soma(9), ag90d: soma(10),
            };
            // Colunas da tabela (em ordem):
            // Agenda | Central | Município | Fila/Cotas | Index | >7d | >28d | >90d | [Encaminhar] | Regulando | Cotas | Saldo | Aguardando | Autorizadas
            // colSpan do label cobre: Agenda + Central + Município = 3
            const colSpanLabel = 3;
            const fmt = (v: number) => v > 0 ? v.toLocaleString('pt-BR') : '—';
            return (
              <tfoot>
                <tr className="border-t-2 border-primary/40 bg-muted/60 font-semibold">
                  <td className="px-3 py-1.5 text-xs text-foreground" colSpan={colSpanLabel}>
                    Totais ({grupos.length} agenda{grupos.length !== 1 ? 's' : ''})
                  </td>
                  <td className="px-2 py-1.5 text-center text-xs text-muted-foreground">—</td>
                  <td className="px-2 py-1.5 text-center text-xs text-muted-foreground">—</td>
                  <td className="px-2 py-1.5 text-center text-xs text-foreground">{fmt(totaisTabela.ag7d)}</td>
                  <td className="px-2 py-1.5 text-center text-xs text-foreground">{fmt(totaisTabela.ag28d)}</td>
                  <td className="px-2 py-1.5 text-center text-xs text-foreground">{fmt(totaisTabela.ag90d)}</td>
                  {(isAdminOuMonitor || isRegulador) && <td className="px-2 py-1.5 text-center text-xs text-muted-foreground">—</td>}
                  <td className="px-2 py-1.5 text-center text-xs text-muted-foreground">—</td>
                  {!colunasExtrasOcultas && (
                    <>
                      <td className="px-2 py-1.5 text-center text-xs text-foreground">{fmt(totaisTabela.cotas)}</td>
                      <td className="px-2 py-1.5 text-center text-xs text-foreground">{fmt(totaisTabela.saldo)}</td>
                      <td className="px-2 py-1.5 text-center text-xs text-foreground">{fmt(totaisTabela.aguardando)}</td>
                      <td className="px-2 py-1.5 text-center text-xs text-foreground">{fmt(totaisTabela.autorizadas)}</td>
                    </>
                  )}
                </tr>
              </tfoot>
            );
          })()}
        </table>
      </div>
    </div>
  );
}
