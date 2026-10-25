import { useState, useMemo, useCallback } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import FilterPanel from '@/components/FilterPanel';
import DataTable from '@/components/DataTable';
import CheckInDetalhes from '@/components/CheckInDetalhes';
import { useRegulador } from '@/contexts/ReguladorContext';
import { usePersistedFilters } from '@/hooks/usePersistedFilters';
import { trpc } from '@/lib/trpc';
import { UltimaAtualizacao } from '@/components/UltimaAtualizacao';
import { LogOut, CheckCircle2, Loader2, X, GripHorizontal, Map as MapIcon } from 'lucide-react';
import MapaRegioesSaude from '@/components/MapaRegioesSaude';
import { useLegenda } from '@/hooks/useLegenda';

interface RegulationProps {
  data: (string | number)[][];
  concluidasIds?: number[];
  onConcluir?: () => void;
  onRefresh?: () => void;
  dataUpdatedAt?: number;
}

// Perfis que têm acesso irrestrito a todas as especialidades
const PERFIS_IRRESTRITO = ['monitoramento', 'administrador'];

export default function Regulation({ data, concluidasIds = [], onConcluir, onRefresh, dataUpdatedAt }: RegulationProps) {
  const { regulador, perfilAtivo } = useRegulador();
  const {
    selectedAgendas,
    selectedCentrais,
    selectedEspecialidades,
    sortColumn,
    sortOrder,
    setSelectedAgendas,
    setSelectedCentrais,
    setSelectedEspecialidades,
    setSortColumn,
    setSortOrder,
  } = usePersistedFilters();

  const [selectedCores, setSelectedCores] = useState<Set<string>>(new Set());
  const [selectedMunicipios, setSelectedMunicipios] = useState<Set<string>>(new Set());

  // Check-in ativo na tela de Lista de Agendas
  // Janela do mapa das regiões de saúde — abre só quando o usuário clica no botão "RS"
  const [mapaAberto, setMapaAberto] = useState(false);
  // Limite e frases do Fila/Cotas configuráveis (aba Recados e Legenda)
  const legenda = useLegenda();
  const [checkInAtivo, setCheckInAtivo] = useState<{
    agendaId: number;
    agendaNome: string;
    especialidade: string;
    central?: string;
    municipio?: string;
    cotas?: number;
    saldo?: number;
    aguardando?: number;
    indexRegula?: number;
    filaCotas?: number;
  } | null>(null);
  const [filtrosRecolhidos, setFiltrosRecolhidos] = useState(false);

  const utils = trpc.useUtils();

  const checkInMutation = trpc.checkIns.checkIn.useMutation({
    onSuccess: (data, variables) => {
      if (!data.bloqueado) {
        utils.checkIns.getAll.invalidate();
        utils.checkIns.getMeus.invalidate();
      }
    },
  });

  const checkOutMutation = trpc.checkIns.checkIn.useMutation({
    onSuccess: () => {
      utils.checkIns.getAll.invalidate();
      utils.checkIns.getMeus.invalidate();
      setCheckInAtivo(null);
      setFiltrosRecolhidos(false);
    },
  });

  const concluirMutation = trpc.agendasConcluidas.concluir.useMutation({
    onSuccess: () => {
      utils.checkIns.getAll.invalidate();
      utils.checkIns.getMeus.invalidate();
      utils.agendasConcluidas.getMeus.invalidate();
      onConcluir?.();
      setCheckInAtivo(null);
      setFiltrosRecolhidos(false);
    },
  });

  const handleCheckInLista = useCallback((agenda: {
    agendaId: number; agendaNome: string; especialidade: string;
    central?: string; municipio?: string; cotas?: number;
    saldo?: number; aguardando?: number; indexRegula?: number; filaCotas?: number;
  }) => {
    // Se clicou na mesma agenda — fecha o painel
    if (checkInAtivo?.agendaId === agenda.agendaId) {
      setCheckInAtivo(null);
      setFiltrosRecolhidos(false);
      return;
    }
    setCheckInAtivo(agenda);
    setFiltrosRecolhidos(true);
    checkInMutation.mutate({
      agendaId: agenda.agendaId,
      agendaNome: agenda.agendaNome,
      municipio: agenda.municipio,
      especialidade: agenda.especialidade,
      central: agenda.central,
      cotas: agenda.cotas,
      saldo: agenda.saldo,
      aguardando: agenda.aguardando,
      indexRegula: agenda.indexRegula,
    });
  }, [checkInAtivo, checkInMutation]);

  const handleCheckOutLista = useCallback(() => {
    if (!checkInAtivo) return;
    checkOutMutation.mutate({
      agendaId: checkInAtivo.agendaId,
      agendaNome: checkInAtivo.agendaNome,
      municipio: checkInAtivo.municipio,
      especialidade: checkInAtivo.especialidade,
      central: checkInAtivo.central,
    });
  }, [checkInAtivo, checkOutMutation]);

  const handleConcluirLista = useCallback(() => {
    if (!checkInAtivo) return;
    concluirMutation.mutate({
      agendaId: checkInAtivo.agendaId,
      agendaNome: checkInAtivo.agendaNome,
      municipio: checkInAtivo.municipio ?? null,
      central: checkInAtivo.central ?? null,
      especialidade: checkInAtivo.especialidade,
    });
  }, [checkInAtivo, concluirMutation]);

  // Verifica se o perfil ATIVO tem acesso irrestrito
  const isIrrestrito = useMemo(() => {
    const perfil = perfilAtivo ?? regulador?.perfil ?? null;
    if (!perfil) return false;
    return PERFIS_IRRESTRITO.includes(perfil.toLowerCase());
  }, [regulador, perfilAtivo]);

  // Parseia a lista de agendas responsáveis do regulador (campo agendas, coluna E da planilha)
  // Suporta separadores: vírgula, ponto-e-vírgula, barra, ou múltiplos espaços
  const agendasDoRegulador = useMemo(() => {
    if (!regulador?.agendas) return null;
    const lista = regulador.agendas
      .split(/[,;\/]|\s{2,}/)
      .map(a => a.trim().toLowerCase())
      .filter(Boolean);
    return lista.length > 0 ? lista : null;
  }, [regulador]);

  // Buscar dicionário de especialidades (agenda → especialidade)
  const { data: dicionario = [] } = trpc.dicionario.getAll.useQuery();
  const { data: coresDisponiveis = [] } = trpc.sheets.getCoresDisponiveis.useQuery(undefined, { staleTime: 5 * 60 * 1000 });

  // Mapa normalizado: nome_agenda_lower → especialidade_lower
  const mapaAgendaEspecialidade = useMemo(() => {
    const mapa = new Map<string, string>();
    dicionario.forEach(d => {
      mapa.set(d.agenda.trim().toLowerCase(), d.especialidade.trim().toLowerCase());
    });
    return mapa;
  }, [dicionario]);

  // Filtra os dados com base nas agendas responsáveis (se houver) e no Grande Grupo
  const dadosFiltradosPorPerfil = useMemo(() => {
    if (isIrrestrito) return data;

    // Parsear os grupos do regulador
    const gruposDoRegulador = regulador?.grandeGrupo
      ? regulador.grandeGrupo.split(/[,;\/]/).map(g => g.trim().toLowerCase()).filter(Boolean)
      : [];

    if (gruposDoRegulador.length === 0 && !agendasDoRegulador) return data;

    // Se há agendas específicas E dicionário carregado, aplicar lógica por grupo
    if (agendasDoRegulador && agendasDoRegulador.length > 0 && mapaAgendaEspecialidade.size > 0) {
      // Descobrir quais grupos têm agendas específicas definidas
      // Para cada agenda específica, encontrar sua especialidade no dicionário
      const gruposComAgendaEspecifica = new Set<string>();
      agendasDoRegulador.forEach(nomeAgenda => {
        const esp = mapaAgendaEspecialidade.get(nomeAgenda);
        if (esp) {
          // Encontrar qual grupo do regulador corresponde a essa especialidade
          gruposDoRegulador.forEach(grupo => {
            if (esp.includes(grupo) || grupo.includes(esp)) {
              gruposComAgendaEspecifica.add(grupo);
            }
          });
        }
      });

      return data.filter(row => {
        const nomeAgenda = String(row[0]).trim().toLowerCase();
        const especialidade = String(row[12]).trim().toLowerCase();

        // Verificar a qual grupo do regulador esta linha pertence
        const gruposDaLinha = gruposDoRegulador.filter(grupo =>
          especialidade.includes(grupo) || grupo.includes(especialidade)
        );

        if (gruposDaLinha.length === 0) return false;

        // Para cada grupo da linha, verificar se tem agendas específicas
        return gruposDaLinha.some(grupo => {
          if (gruposComAgendaEspecifica.has(grupo)) {
            // Grupo tem agendas específicas: mostrar apenas as listadas
            return agendasDoRegulador.some(ag => ag === nomeAgenda);
          } else {
            // Grupo sem agendas específicas: mostrar todas as agendas do grupo
            return true;
          }
        });
      });
    }

    // Sem agendas específicas: filtrar apenas por Grande Grupo
    if (gruposDoRegulador.length > 0) {
      return data.filter(row => {
        const especialidade = String(row[12]).toLowerCase();
        return gruposDoRegulador.some(grupo => especialidade.includes(grupo));
      });
    }

    return data;
  }, [data, regulador, isIrrestrito, agendasDoRegulador, mapaAgendaEspecialidade]);

  // Ordem personalizada das Centrais: CRA primeiro, depois NºCRS em ordem numérica
  const ORDEM_CENTRAIS = ['CRA', '1CRS', '2CRS', '3CRS', '4CRS', '5CRS', '6CRS', '7CRS', '8CRS', '9CRS', '10CRS', '11CRS', '12CRS', '13CRS', '14CRS', '15CRS', '16CRS', '17CRS', '18CRS'];

  const sortCentrais = (lista: string[]): string[] => {
    return [...lista].sort((a, b) => {
      const ia = ORDEM_CENTRAIS.indexOf(a);
      const ib = ORDEM_CENTRAIS.indexOf(b);
      // Se ambos estão na lista de ordem, usar a posição definida
      if (ia !== -1 && ib !== -1) return ia - ib;
      // Se só um está, ele vem primeiro
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      // Demais valores em ordem alfabética
      return a.localeCompare(b);
    });
  };

  // Utilitário: expande um valor de especialidade composto em partes individuais
  // Suporta separadores: vírgula e ponto-e-vírgula
  const expandirEspecialidades = (valor: string): string[] => {
    return valor
      .split(/[,;]/)
      .map(e => e.trim())
      .filter(Boolean);
  };

  // Todas as opções únicas de filtro (sem cascata) — base para Especialidade e Central
  // Especialidades compostas (ex: "Fisiatria, Reumatologia") são expandidas em itens individuais
  const { centrais, especialidades, municipios } = useMemo(() => {
    const centraisSet = new Set<string>();
    const especialidadesSet = new Set<string>();
    const municipiosSet = new Set<string>();

    dadosFiltradosPorPerfil.forEach(row => {
      const central = String(row[11]);
      const municipio = String(row[1]);
      if (central) centraisSet.add(central);
      if (municipio) municipiosSet.add(municipio);
      expandirEspecialidades(String(row[12])).forEach(esp => { if (esp) especialidadesSet.add(esp); });
    });

    return {
      centrais: sortCentrais(Array.from(centraisSet)),
      especialidades: Array.from(especialidadesSet).sort(),
      municipios: Array.from(municipiosSet).sort(),
    };
  }, [dadosFiltradosPorPerfil]);

  // Agendas em cascata: filtradas pelas especialidades selecionadas (e centrais selecionadas)
  // Considera que uma linha pode ter múltiplas especialidades separadas por vírgula
  const agendas = useMemo(() => {
    const agendasSet = new Set<string>();

    dadosFiltradosPorPerfil.forEach(row => {
      const especialidadesBruto = String(row[12]);
      const central = String(row[11]);

      const partes = expandirEspecialidades(especialidadesBruto);
      const matchEsp =
        selectedEspecialidades.size === 0 ||
        partes.some(p => selectedEspecialidades.has(p));
      const matchCentral =
        selectedCentrais.size === 0 || selectedCentrais.has(central);

      if (matchEsp && matchCentral) {
        agendasSet.add(String(row[0]));
      }
    });

    return Array.from(agendasSet).sort();
  }, [dadosFiltradosPorPerfil, selectedEspecialidades, selectedCentrais, selectedCores]);

  const headers = [
    'Agenda',
    'Município',
    'Cotas',
    'Saldo',
    'Aguardando',
    'Autorizadas',
    'Fila/Cotas',
    'IndexRegula',
    'Central',
    'Especialidade',
  ];

  const handleSort = (column: number) => {
    if (sortColumn === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortOrder('desc' as const);
    }
  };

  const perfilUsuario = perfilAtivo ?? regulador?.perfil ?? '';
  const isRegulador = perfilUsuario.toLowerCase().includes('regulador') || perfilUsuario.toLowerCase().includes('consultor');

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      {/* Aviso de restrição por perfil */}
      {!isIrrestrito && regulador?.grandeGrupo && (
        <div className="absolute top-2 right-4 z-10">
          <div className="bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 text-xs px-3 py-1.5 rounded-full flex items-center gap-1.5">
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
            Exibindo especialidades de: <strong>{regulador.grandeGrupo}</strong>
          </div>
        </div>
      )}

      {checkInAtivo ? (
        /* Layout com painel de detalhes — PanelGroup redimensionável */
        <PanelGroup direction="vertical" className="flex-1 min-h-0">

          {/* Painel superior — tabela (sem filtros para dar espaço) */}
          <Panel defaultSize={45} minSize={20} maxSize={75}>
            <div className="flex h-full min-h-0">
              <DataTable
                headers={headers}
                rows={dadosFiltradosPorPerfil}
                selectedAgendas={selectedAgendas}
                selectedCentrais={selectedCentrais}
                selectedEspecialidades={selectedEspecialidades}
                selectedMunicipios={selectedMunicipios}
                selectedCores={selectedCores}
                sortColumn={sortColumn}
                sortOrder={sortOrder}
                onSort={handleSort}
                perfilUsuario={perfilUsuario}
                emailUsuario={regulador?.email ?? ''}
                concluidasIds={concluidasIds}
                onConcluir={onConcluir}
                onRefresh={onRefresh}
                dataUpdatedAt={dataUpdatedAt}
                checkInAtivoId={checkInAtivo.agendaId}
                onCheckInLista={isRegulador ? handleCheckInLista : undefined}
              />
            </div>
          </Panel>

          {/* Handle arrastável */}
          <PanelResizeHandle className="group relative h-2 bg-border hover:bg-primary/40 transition-colors cursor-row-resize flex items-center justify-center">
            <div className="flex items-center gap-1 text-muted-foreground group-hover:text-primary transition-colors">
              <GripHorizontal size={14} />
            </div>
          </PanelResizeHandle>

          {/* Painel inferior — detalhes do check-in */}
          <Panel defaultSize={55} minSize={25}>
            <div className="flex flex-col h-full min-h-0 bg-background">
              {/* Barra de controle */}
              <div className="flex items-center justify-between px-4 py-2 bg-blue-950 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5 text-sm font-semibold text-white">
                    <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                    Em regulação: {checkInAtivo.agendaNome}
                    {checkInAtivo.municipio && (
                      <span className="text-blue-300 font-normal text-xs">— {checkInAtivo.municipio}</span>
                    )}
                    {checkInAtivo.central && (
                      <span className="text-blue-300 font-normal text-xs">· {checkInAtivo.central}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs">
                    {checkInAtivo.cotas !== undefined && (
                      <span className="px-2 py-0.5 rounded bg-blue-900/60 text-blue-100 font-medium">
                        Cotas: <strong className="text-white">{checkInAtivo.cotas}</strong>
                      </span>
                    )}
                    {checkInAtivo.saldo !== undefined && (
                      <span className="px-2 py-0.5 rounded bg-blue-900/60 text-blue-100 font-medium">
                        Saldo: <strong className="text-white">{checkInAtivo.saldo}</strong>
                      </span>
                    )}
                    {checkInAtivo.aguardando !== undefined && (
                      <span className="px-2 py-0.5 rounded bg-blue-900/60 text-blue-100 font-medium">
                        Aguardando: <strong className="text-white">{checkInAtivo.aguardando}</strong>
                      </span>
                    )}
                    {checkInAtivo.indexRegula !== undefined && (
                      <span className="px-2 py-0.5 rounded bg-blue-900/60 text-blue-100 font-medium">
                        Índice: <strong className="text-white">{checkInAtivo.indexRegula.toFixed(2)}</strong>
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCheckOutLista}
                    disabled={checkOutMutation.isPending || concluirMutation.isPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-slate-700 text-white text-xs font-medium hover:bg-slate-600 disabled:opacity-50 transition-colors"
                  >
                    {checkOutMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <LogOut size={12} />}
                    Check-out
                  </button>
                  <button
                    onClick={handleConcluirLista}
                    disabled={concluirMutation.isPending || checkOutMutation.isPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-green-600 text-white text-xs font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
                  >
                    {concluirMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                    Concluído
                  </button>
                  {/* Mapa das regiões de saúde — somente sob demanda */}
                  <button
                    onClick={() => setMapaAberto(true)}
                    className="flex items-center gap-1 px-2 py-1.5 rounded-md border border-blue-400/60 text-blue-100 hover:text-white hover:bg-slate-700 text-xs font-medium transition-colors"
                    title="Ver mapa das regiões de saúde do RS (macro / CRS / região)"
                  >
                    <MapIcon size={13} />
                    RS
                  </button>
                  <button
                    onClick={() => { setCheckInAtivo(null); setFiltrosRecolhidos(false); }}
                    className="flex items-center gap-1 px-2 py-1.5 rounded-md text-blue-300 hover:text-white hover:bg-slate-700 text-xs transition-colors"
                    title="Fechar painel (mantém check-in ativo)"
                  >
                    <X size={13} />
                  </button>
                </div>
              </div>
              {checkInAtivo.filaCotas !== undefined && (
                <div className={`px-4 py-1.5 text-xs font-medium shrink-0 leading-snug ${
                  checkInAtivo.filaCotas <= legenda.filaCotas.limite
                    ? 'bg-emerald-900/70 text-emerald-100'
                    : 'bg-amber-900/70 text-amber-100'
                }`}>
                  {checkInAtivo.filaCotas <= legenda.filaCotas.limite
                    ? <>⏩ {legenda.filaCotas.fraseBaixa}</>
                    : <>⚠️ {legenda.filaCotas.fraseAlta}</>}
                </div>
              )}
              {/* Conteúdo */}
              <div className="flex-1 overflow-y-auto p-4">
                <CheckInDetalhes
                  agendaId={checkInAtivo.agendaId}
                  agendaNome={checkInAtivo.agendaNome}
                  especialidade={checkInAtivo.especialidade}
                  central={checkInAtivo.central}
                  municipio={checkInAtivo.municipio}
                  autoExpandir
                />
              </div>
              {/* Janela do mapa — fica fechada até o usuário pedir */}
              <MapaRegioesSaude
                open={mapaAberto}
                onOpenChange={setMapaAberto}
                municipio={checkInAtivo.municipio}
              />
            </div>
          </Panel>
        </PanelGroup>
      ) : (
        /* Layout normal — filtros + tabela */
        <div className="flex flex-1 min-h-0">
          <FilterPanel
            agendas={agendas}
            centrais={centrais}
            especialidades={especialidades}
            municipios={municipios}
            selectedAgendas={selectedAgendas}
            selectedCentrais={selectedCentrais}
            selectedEspecialidades={selectedEspecialidades}
            selectedMunicipios={selectedMunicipios}
            selectedCores={selectedCores}
            onCoresChange={setSelectedCores}
            coresDisponiveis={coresDisponiveis}
            onAgendasChange={setSelectedAgendas}
            onCentraisChange={setSelectedCentrais}
            onEspecialidadesChange={setSelectedEspecialidades}
            onMunicipiosChange={setSelectedMunicipios}
          />
          <DataTable
            headers={headers}
            rows={dadosFiltradosPorPerfil}
            selectedAgendas={selectedAgendas}
            selectedCentrais={selectedCentrais}
            selectedEspecialidades={selectedEspecialidades}
            selectedMunicipios={selectedMunicipios}
            selectedCores={selectedCores}
            sortColumn={sortColumn}
            sortOrder={sortOrder}
            onSort={handleSort}
            perfilUsuario={perfilUsuario}
            emailUsuario={regulador?.email ?? ''}
            concluidasIds={concluidasIds}
            onConcluir={onConcluir}
            onRefresh={onRefresh}
            dataUpdatedAt={dataUpdatedAt}
            checkInAtivoId={null}
            onCheckInLista={isRegulador ? handleCheckInLista : undefined}
          />
        </div>
      )}
    </div>
  );
}
