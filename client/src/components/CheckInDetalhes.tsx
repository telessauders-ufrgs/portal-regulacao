import { useState } from 'react';
import { ChevronDown, ChevronUp, Loader2, FileText, ListOrdered, ExternalLink, TrendingDown, ChevronsUpDown, Columns2, X } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { getCorRowStyle, getCorBadgeStyle, getFilaCotasInfo, getClasseIndex } from '@/lib/corAgenda';
import { useLegenda } from '@/hooks/useLegenda';

interface CheckInDetalhesProps {
  agendaId: number;
  agendaNome?: string;
  especialidade: string;
  central?: string | null;
  municipio?: string | null;
  autoExpandir?: boolean;
}

/** Célula de Fila/Cotas com o mesmo destaque da Lista de agendas (limite configurável). */
function CelulaFilaCotas({ raw }: { raw: unknown }) {
  const legenda = useLegenda();
  const fc = getFilaCotasInfo(raw, legenda);
  return (
    <span title={fc.frase ? `${fc.icone} ${fc.frase}` : undefined}
      className={`inline-block px-1 rounded font-semibold cursor-default ${fc.badgeClass}`}>
      {fc.texto}
    </span>
  );
}

export default function CheckInDetalhes({ agendaId, agendaNome, especialidade, central, municipio, autoExpandir = false }: CheckInDetalhesProps) {
  const [expandido, setExpandido] = useState(autoExpandir);
  type SortCol = 'agenda' | 'municipio' | 'cotas' | 'saldo' | 'aguardando' | 'autorizadas' | 'autCotas' | 'indexRegula';
  const [sortCol, setSortCol] = useState<SortCol>('indexRegula');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const handleSortCol = (col: SortCol) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('desc'); }
  };

  // Filtro de central para split view
  const [centralSplit, setCentralSplit] = useState<string | null>(null);

  // Query sem filtro de central — busca todas as centrais disponíveis para o seletor
  const { data: dataTodasCentrais } = trpc.checkIns.getRelacionadas.useQuery(
    {
      especialidade,
      // sem central — retorna agendas de todas as centrais
      municipio: undefined,
      agendaIdExcluir: agendaId,
      agendaNomeExcluir: agendaNome,
    },
    { enabled: expandido }
  );

  // Query da central selecionada no split view
  const { data: dataSplit, isLoading: isLoadingSplit } = trpc.checkIns.getRelacionadas.useQuery(
    {
      especialidade,
      central: centralSplit ?? undefined,
      municipio: municipio ?? undefined,
      agendaIdExcluir: agendaId,
      agendaNomeExcluir: agendaNome,
    },
    { enabled: expandido && !!centralSplit }
  );
  const agendasSplitRaw = dataSplit?.agendas ?? [];

  const { data: obsData } = trpc.agendaConfig.getObservacao.useQuery(
    { agendaNome: agendaNome ?? '', central: central ?? '' },
    { enabled: !!agendaNome && !!central }
  );

  const observacao = obsData?.observacao ?? '';

  const { data, isLoading } = trpc.checkIns.getRelacionadas.useQuery(
    {
      especialidade,
      central: central ?? undefined,
      municipio: municipio ?? undefined,
      agendaIdExcluir: agendaId,
      agendaNomeExcluir: agendaNome,
    },
    {
      enabled: expandido, // só busca quando o painel está aberto
    }
  );

  const agendasRaw = data?.agendas ?? [];

  // Centrais únicas disponíveis para o seletor — na mesma ordem da Lista de Agendas
  const ORDEM_CENTRAL = ['CRA','1CRS','2CRS','3CRS','4CRS','5CRS','6CRS','7CRS','8CRS',
    '9CRS','10CRS','11CRS','12CRS','13CRS','14CRS','15CRS','16CRS','17CRS','18CRS'];
  const centraisDisponiveis = [...new Set(
    (dataTodasCentrais?.agendas ?? [])
      .map(a => a.central)
      .filter((c): c is string => !!c && c !== central)
  )].sort((a, b) => {
    const ia = ORDEM_CENTRAL.indexOf(a);
    const ib = ORDEM_CENTRAL.indexOf(b);
    const posA = ia === -1 ? 999 : ia;
    const posB = ib === -1 ? 999 : ib;
    return posA - posB;
  });
  const prioridadesList = data?.prioridades ?? [];
  const protocolosList = data?.protocolos ?? [];

  const agendas = [...agendasRaw].sort((a, b) => {
    const parseNum = (v: unknown) => {
      const n = parseFloat(String(v ?? '').replace(/\./g, '').replace(',', '.'));
      return isNaN(n) ? 0 : n;
    };
    let av: number | string, bv: number | string;
    if (sortCol === 'agenda') { av = a.agenda ?? ''; bv = b.agenda ?? ''; }
    else if (sortCol === 'municipio') { av = a.municipio ?? ''; bv = b.municipio ?? ''; }
    else if (sortCol === 'autCotas') { av = parseNum(a.autCotas); bv = parseNum(b.autCotas); }
    else { av = (a[sortCol] as number) ?? 0; bv = (b[sortCol] as number) ?? 0; }
    if (typeof av === 'number' && typeof bv === 'number') return sortDir === 'desc' ? bv - av : av - bv;
    return sortDir === 'desc' ? String(bv).localeCompare(String(av), 'pt-BR') : String(av).localeCompare(String(bv), 'pt-BR');
  });

  // Cores do Index pelos limites configuráveis (aba Recados e Legenda)
  const legenda = useLegenda();
  const getIndexColor = (value: number | null | undefined): string =>
    !value ? 'text-muted-foreground' : getClasseIndex(value, 'texto', legenda);
  const getBgIndex = (value: number | null | undefined): string =>
    !value ? 'bg-muted/50' : getClasseIndex(value, 'fundo', legenda);

  return (
    <div className="border-t border-border/50">
      {/* Botão de expandir + observação em destaque (sempre visível, mesmo com o painel fechado) */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2 bg-secondary/10">
        <button
          onClick={() => setExpandido(v => !v)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors shrink-0 rounded px-1 py-0.5 -ml-1"
        >
          <TrendingDown size={12} />
          Ver agendas relacionadas · protocolo · lista de prioridades
          {expandido ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>

        {observacao && (
          <div className="flex items-start gap-1.5 px-2.5 py-1 rounded-md bg-amber-100 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-200 flex-1 min-w-[200px]">
            <svg className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-xs font-medium whitespace-pre-wrap">{observacao}</p>
          </div>
        )}
      </div>

      {/* Painel expandido */}
      {expandido && (
        <div className="px-4 pb-4 pt-1 bg-secondary/20 space-y-4">

          {isLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 size={18} className="animate-spin text-muted-foreground" />
              <span className="ml-2 text-xs text-muted-foreground">Carregando dados...</span>
            </div>
          ) : (
            <>
              {/* ── Recursos da especialidade ── */}
              {(prioridadesList.length > 0 || protocolosList.length > 0) && (
                <div className="flex flex-wrap gap-2">
                  {prioridadesList.map(p => (
                    <a
                      key={p.id}
                      href={p.linkUrl ?? '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-blue-100 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors border border-blue-200 dark:border-blue-800"
                    >
                      <ListOrdered size={11} />
                      {p.nomeArquivo ?? 'Lista de Prioridades'}
                      <ExternalLink size={10} className="opacity-60" />
                    </a>
                  ))}
                  {protocolosList.map(p => (
                    <a
                      key={p.id}
                      href={p.linkUrl ?? '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-purple-100 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-900/50 transition-colors border border-purple-200 dark:border-purple-800"
                    >
                      <FileText size={11} />
                      {p.nome}
                      <ExternalLink size={10} className="opacity-60" />
                    </a>
                  ))}
                </div>
              )}

              {prioridadesList.length === 0 && protocolosList.length === 0 && (
                <p className="text-xs text-muted-foreground italic">
                  Nenhum protocolo ou lista de prioridades cadastrado para esta especialidade.
                </p>
              )}

              {/* ── Agendas relacionadas ── */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-semibold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <TrendingDown size={12} />
                    Agendas da mesma especialidade{central ? ` · ${central}` : ''} — ordenadas por índice
                  </h4>
                  {/* Seletor de central para split view — dropdown */}
                  {centraisDisponiveis.length > 0 && (
                    <div className="flex items-center gap-1.5">
                      <Columns2 size={11} className="text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">Comparar:</span>
                      <select
                        value={centralSplit ?? ''}
                        onChange={e => setCentralSplit(e.target.value || null)}
                        className="text-xs px-2 py-0.5 rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                      >
                        <option value="">— central —</option>
                        {centraisDisponiveis.map(c => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                      {centralSplit && (
                        <button
                          onClick={() => setCentralSplit(null)}
                          className="text-muted-foreground hover:text-foreground transition-colors"
                          title="Remover comparação"
                        >
                          <X size={11} />
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <div className={centralSplit ? "grid grid-cols-2 gap-3" : ""}>
                {/* Tabela principal */}
                <div>
                {centralSplit && <p className="text-xs font-medium text-muted-foreground mb-1">{central ?? 'Central atual'}</p>}
                {agendas.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">
                    Nenhuma outra agenda encontrada com os mesmos critérios.
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-md border border-border">
                    <table className="w-full text-[10px] border-collapse">
                      <thead className="bg-secondary">
                        <tr>
                          {([
                            // Mesma ordem da Lista de agendas: Agenda, Município, Fila/Cotas, Índice, Cotas, Saldo, Aguardando, Autorizadas
                            // (Central é omitida porque todas as linhas são da mesma central)
                            { label: 'Agenda', col: 'agenda' as SortCol },
                            { label: 'Município', col: 'municipio' as SortCol },
                            { label: 'Fila/Cotas', col: 'autCotas' as SortCol },
                            { label: 'Índice', col: 'indexRegula' as SortCol },
                            { label: 'Cotas', col: 'cotas' as SortCol },
                            { label: 'Saldo', col: 'saldo' as SortCol },
                            { label: 'Aguardando', col: 'aguardando' as SortCol },
                            { label: 'Autorizadas', col: 'autorizadas' as SortCol },
                          ]).map(({ label, col }) => (
                            <th
                              key={col}
                              onClick={() => handleSortCol(col)}
                              className={`px-2 py-1 font-semibold text-foreground cursor-pointer hover:bg-muted transition-colors select-none text-[10px] ${col === 'agenda' || col === 'municipio' ? 'text-left' : 'text-center'}`}
                            >
                              <div className={`flex items-center gap-1 ${col === 'agenda' || col === 'municipio' ? '' : 'justify-center'}`}>
                                {label}
                                {sortCol === col
                                  ? sortDir === 'desc' ? <ChevronDown size={11} className="text-primary" /> : <ChevronUp size={11} className="text-primary" />
                                  : <ChevronsUpDown size={11} className="text-muted-foreground/50" />
                                }
                              </div>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {agendas.map((a) => {
                          const corRowStyle = getCorRowStyle(a.corIndex);
                          const corBadgeStyle = getCorBadgeStyle(a.corIndex);
                          return (
                          <tr
                            key={a.id}
                            className={`border-t border-border/50 ${getBgIndex(a.indexRegula)} hover:opacity-90 transition-opacity`}
                            style={corRowStyle}
                          >
                            <td className="px-2 py-0.5 font-medium text-foreground">
                              <div className="flex items-center gap-1.5">
                                {a.corIndex && <span style={corBadgeStyle} title={a.corIndex} />}
                                {a.agenda ?? '—'}
                              </div>
                            </td>
                            <td className="px-2 py-0.5 text-left text-muted-foreground">{a.municipio ?? '—'}</td>
                            <td className="px-2 py-0.5 text-center"><CelulaFilaCotas raw={a.autCotas} /></td>
                            <td className={`px-2 py-0.5 text-center ${getIndexColor(a.indexRegula)}`}>
                              {a.indexRegula != null ? a.indexRegula.toFixed(2) : '—'}
                            </td>
                            <td className="px-2 py-0.5 text-center text-foreground">{a.cotas ?? '—'}</td>
                            <td className="px-2 py-0.5 text-center text-foreground">{a.saldo ?? '—'}</td>
                            <td className="px-2 py-0.5 text-center text-foreground">{a.aguardando ?? '—'}</td>
                            <td className="px-2 py-0.5 text-center text-foreground">{a.autorizadas ?? '—'}</td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                </div>

                {/* Tabela split — central selecionada */}
                {centralSplit && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">{centralSplit}</p>
                    {isLoadingSplit ? (
                      <div className="flex items-center justify-center py-4">
                        <Loader2 size={16} className="animate-spin text-muted-foreground" />
                      </div>
                    ) : agendasSplitRaw.length === 0 ? (
                      <p className="text-xs text-muted-foreground italic">Nenhuma agenda encontrada para {centralSplit}.</p>
                    ) : (
                      <div className="overflow-x-auto rounded-md border border-border">
                        <table className="w-full text-[10px] border-collapse">
                          <thead className="bg-secondary">
                            <tr>
                              {(['Agenda','Município','Fila/Cotas','Índice','Cotas','Saldo','Aguardando','Autorizadas']).map(label => (
                                <th key={label} className={`px-2 py-1 font-semibold text-foreground text-[10px] ${label === 'Agenda' || label === 'Município' ? 'text-left' : 'text-center'}`}>{label}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {agendasSplitRaw.map((a) => {
                              const corRowStyle = getCorRowStyle(a.corIndex);
                              const corBadgeStyle = getCorBadgeStyle(a.corIndex);
                              return (
                                <tr key={a.id} className={`border-t border-border/50 ${getBgIndex(a.indexRegula)} hover:opacity-90`} style={corRowStyle}>
                                  <td className="px-2 py-0.5 font-medium text-foreground">
                                    <div className="flex items-center gap-1.5">
                                      {a.corIndex && <span style={corBadgeStyle} title={a.corIndex} />}
                                      {a.agenda ?? '—'}
                                    </div>
                                  </td>
                                  <td className="px-2 py-0.5 text-muted-foreground">{a.municipio ?? '—'}</td>
                                  <td className="px-2 py-0.5 text-center"><CelulaFilaCotas raw={a.autCotas} /></td>
                                  <td className={`px-2 py-0.5 text-center ${getIndexColor(a.indexRegula)}`}>
                                    {a.indexRegula != null ? a.indexRegula.toFixed(2) : '—'}
                                  </td>
                                  <td className="px-2 py-0.5 text-center">{a.cotas ?? '—'}</td>
                                  <td className="px-2 py-0.5 text-center">{a.saldo ?? '—'}</td>
                                  <td className="px-2 py-0.5 text-center">{a.aguardando ?? '—'}</td>
                                  <td className="px-2 py-0.5 text-center">{a.autorizadas ?? '—'}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
