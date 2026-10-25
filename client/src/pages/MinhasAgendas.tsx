import React from 'react';
import { LogIn, LogOut, Loader2, ClipboardList, Send, CheckCircle2, Trash2, Flag, CheckCheck, XCircle, Users } from 'lucide-react';
import { getCorRowStyle, getCorBadgeStyle, getFilaCotasInfo, getClasseIndex, getFraseIndex } from '@/lib/corAgenda';
import { useLegenda } from '@/hooks/useLegenda';
import CheckInDetalhes from '@/components/CheckInDetalhes';
import { trpc } from '@/lib/trpc';
import { Link } from 'wouter';
import { Settings, Map as MapIcon } from 'lucide-react';
import MapaRegioesSaude from '@/components/MapaRegioesSaude';
import { useRegulador } from '@/contexts/ReguladorContext';
import { UltimaAtualizacao } from '@/components/UltimaAtualizacao';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

// ─── Componente de linha de agenda ───────────────────────────────────────────

interface AgendaRowProps {
  agendaId: number;
  agendaNome: string;
  municipio?: string | null;
  central?: string | null;
  cotas?: number | null;
  autorizadas?: number | null;
  autCotas?: string | null;
  saldo?: number | null;
  aguardando?: number | null;
  aguardando7d?: number | null;
  aguardando28d?: number | null;
  aguardando90d?: number | null;
  indexRegula?: number | null;
  flagIndex?: string | null;
  corIndex?: string | null;
  flagAutCotas?: string | null;
  corAutCotas?: string | null;
  temCheckIn: boolean;
  reguladoresAtivos?: { usuarioEmail: string; usuarioNome: string }[];
  encaminhadoPor?: string | null;
  concluidoEm?: Date | null;
  createdAt: Date;
  onCheckIn?: () => void;
  onRemover?: () => void;
  onConcluir?: () => void;
  isCheckInPending: boolean;
  isRemoverPending: boolean;
  isConcluirPending?: boolean;
  // Controles de colunas extras (após Flags)
  showEncaminhadoPor?: boolean;
  showConcluidoEm?: boolean;
  showCheckIn?: boolean;
  showConcluir?: boolean;
  showStatus?: boolean;
  isConcluida?: boolean;
  dateLabel?: string;
}

function AgendaRow({
  agendaNome,
  municipio,
  central,
  cotas,
  autorizadas,
  autCotas,
  saldo,
  aguardando,
  aguardando7d,
  aguardando28d,
  aguardando90d,
  indexRegula,
  flagIndex,
  corIndex,
  flagAutCotas,
  temCheckIn,
  reguladoresAtivos,
  encaminhadoPor,
  concluidoEm,
  createdAt,
  onCheckIn,
  onRemover,
  onConcluir,
  isCheckInPending,
  isRemoverPending,
  isConcluirPending = false,
  showEncaminhadoPor = false,
  showConcluidoEm = false,
  showCheckIn = false,
  showConcluir = false,
  showStatus = false,
  isConcluida = false,
  dateLabel = 'Check-in em',
}: AgendaRowProps) {
  // Limites de Fila/Cotas e Index configuráveis (aba Recados e Legenda)
  const legenda = useLegenda();
  const getBadgeColor = (value: number | null | undefined): string =>
    (!value ? '' : getClasseIndex(value, 'badge', legenda)) || 'bg-muted text-muted-foreground';

  const dateDisplay = showConcluidoEm && concluidoEm
    ? new Date(concluidoEm).toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })
    : new Date(createdAt).toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });

  const corRowStyle = getCorRowStyle(corIndex);
  const corBadgeStyle = getCorBadgeStyle(corIndex);

  return (
    <tr
      className={`border-t border-border hover:bg-secondary/50 transition-colors ${isConcluida ? 'opacity-75' : ''}`}
      style={corRowStyle}
    >
      {/* Agenda */}
      <td className="px-2 py-1.5">
        <div className="font-medium text-xs text-foreground flex items-center gap-2">
          {corIndex && <span style={corBadgeStyle} title={corIndex} />}
          {agendaNome}
        </div>
        {reguladoresAtivos && reguladoresAtivos.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {reguladoresAtivos.map(r => (
              <span
                key={r.usuarioEmail}
                title={r.usuarioEmail}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 dark:bg-green-950/50 text-green-700 dark:text-green-300"
              >
                <Users size={9} />
                {r.usuarioNome.split(' ')[0]}
              </span>
            ))}
          </div>
        )}
      </td>
      {/* Ordem igual à Lista de agendas:
          Agenda | Central | Município | Fila/Cotas | Index | >7d | >28d | >90d | [contextuais] | Cotas | Saldo | Aguardando | Autorizadas */}
      {/* Central */}
      <td className="px-2 py-1.5 text-center text-xs text-foreground">{central ?? '—'}</td>
      {/* Município */}
      <td className="px-2 py-1.5 text-xs text-muted-foreground">{municipio ?? '—'}</td>
      {/* Fila/Cotas — destaque pela regra ≤ 4 (⏩) / > 4 (⚠️) */}
      <td className="px-2 py-1.5 text-center">
        {(() => {
          const fc = getFilaCotasInfo(autCotas, legenda);
          return (
            <span
              title={fc.frase ? `${fc.icone} ${fc.frase}` : (flagAutCotas || undefined)}
              className={`inline-block px-1.5 py-0.5 rounded text-xs font-semibold cursor-default ${fc.badgeClass}`}
            >
              {fc.texto}
            </span>
          );
        })()}
      </td>
      {/* IndexRegula */}
      <td className="px-2 py-1.5 text-center">
        <span
          title={flagIndex || getFraseIndex(indexRegula, legenda) || undefined}
          className={`inline-block px-1.5 py-0.5 rounded text-xs cursor-default ${getBadgeColor(indexRegula)}`}
        >
          {indexRegula != null ? indexRegula.toFixed(2) : '—'}
        </span>
      </td>
      {/* >7d */}
      <td className="px-2 py-1.5 text-center text-xs font-medium text-foreground">{aguardando7d ?? '—'}</td>
      {/* >28d */}
      <td className="px-2 py-1.5 text-center text-xs font-medium text-foreground">{aguardando28d ?? '—'}</td>
      {/* >90d */}
      <td className="px-2 py-1.5 text-center text-xs font-medium text-foreground">{aguardando90d ?? '—'}</td>

      {/* ── Colunas extras contextuais (após Flags) ── */}

      {/* Encaminhado por — só em "Encaminhadas para mim" */}
      {showEncaminhadoPor && (
        <td className="px-2 py-1.5 text-center text-xs text-muted-foreground">
          {encaminhadoPor === 'Favorita' ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-700">
              ⭐ Favorita
            </span>
          ) : (
            encaminhadoPor ?? '—'
          )}
        </td>
      )}
      {/* Data */}
      <td className="px-2 py-1.5 text-center text-xs text-muted-foreground">{dateDisplay}</td>
      {/* Check-in/out */}
      {showCheckIn && onCheckIn !== undefined && (
        <td className="px-2 py-1.5 text-center">
          <button
            onClick={onCheckIn}
            disabled={isCheckInPending}
            title={temCheckIn ? 'Fazer check-out desta agenda' : 'Fazer check-in nesta agenda'}
            className={`flex items-center gap-1 mx-auto px-2 py-1 rounded text-xs font-medium transition-colors disabled:opacity-50 ${
              temCheckIn
                ? 'bg-red-100 dark:bg-red-950/50 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/50'
                : 'bg-green-100 dark:bg-green-950/50 text-green-700 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-900/50'
            }`}
          >
            {isCheckInPending ? (
              <Loader2 size={11} className="animate-spin" />
            ) : temCheckIn ? (
              <LogOut size={11} />
            ) : (
              <LogIn size={11} />
            )}
            {temCheckIn ? 'Check-out' : 'Check-in'}
          </button>
        </td>
      )}
      {/* Concluído — só em Check-ins ativos */}
      {showConcluir && onConcluir !== undefined && (
        <td className="px-2 py-1.5 text-center">
          <button
            onClick={onConcluir}
            disabled={isConcluirPending}
            title="Marcar agenda como concluída"
            className="flex items-center gap-1 mx-auto px-2 py-1 rounded text-xs font-medium transition-colors disabled:opacity-50 bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 dark:hover:bg-emerald-900/50"
          >
            {isConcluirPending ? <Loader2 size={11} className="animate-spin" /> : <CheckCheck size={11} />}
            Concluído
          </button>
        </td>
      )}
      {/* Status — só em Agendas concluídas */}
      {showStatus && (
        <td className="px-2 py-1.5 text-center">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 size={10} />
            Concluído
          </span>
        </td>
      )}

      {/* ── Colunas finais (mesmas da Lista de agendas) ── */}
      <td className="px-2 py-1.5 text-center text-xs font-medium text-foreground">{cotas ?? '—'}</td>
      <td className="px-2 py-1.5 text-center text-xs font-medium text-foreground">{saldo ?? '—'}</td>
      <td className="px-2 py-1.5 text-center text-xs font-medium text-foreground">{aguardando ?? '—'}</td>
      <td className="px-2 py-1.5 text-center text-xs font-medium text-foreground">{autorizadas ?? '—'}</td>
    </tr>
  );
}

// ─── Cabeçalho da tabela ─────────────────────────────────────────────────────
// Mesma ordem da Lista de agendas:
// Agenda | Central | Município | Fila/Cotas | Index | >7d | >28d | >90d
//   | contextuais: Encaminhado por? | Data | Check-in? | Ação? | Status?
//   | Cotas | Saldo | Aguardando | Autorizadas

function TableHeader({
  showEncaminhadoPor = false,
  showCheckIn = false,
  showConcluir = false,
  showStatus = false,
  dateLabel = 'Check-in em',
}: {
  showEncaminhadoPor?: boolean;
  showCheckIn?: boolean;
  showConcluir?: boolean;
  showStatus?: boolean;
  dateLabel?: string;
}) {
  return (
    <thead className="bg-secondary">
      <tr>
        {/* Colunas fixas — mesma ordem da aba Lista de agendas */}
        <th className="px-2 py-1.5 text-left text-xs font-semibold text-foreground uppercase tracking-wider">Agenda</th>
        <th className="px-2 py-1.5 text-center text-xs font-semibold text-foreground uppercase tracking-wider">Central</th>
        <th className="px-2 py-1.5 text-left text-xs font-semibold text-foreground uppercase tracking-wider">Município</th>
        <th className="px-2 py-1.5 text-center text-xs font-semibold text-foreground uppercase tracking-wider">Fila/Cotas</th>
        <th className="px-2 py-1.5 text-center text-xs font-semibold text-foreground uppercase tracking-wider">Index</th>
        <th className="px-2 py-1.5 text-center text-xs font-semibold text-foreground uppercase tracking-wider">&gt;7d</th>
        <th className="px-2 py-1.5 text-center text-xs font-semibold text-foreground uppercase tracking-wider">&gt;28d</th>
        <th className="px-2 py-1.5 text-center text-xs font-semibold text-foreground uppercase tracking-wider">&gt;90d</th>
        {/* Colunas extras contextuais */}
        {showEncaminhadoPor && (
          <th className="px-2 py-1.5 text-center text-xs font-semibold text-foreground uppercase tracking-wider">Encaminhado por</th>
        )}
        <th className="px-2 py-1.5 text-center text-xs font-semibold text-foreground uppercase tracking-wider">{dateLabel}</th>
        {showCheckIn && (
          <th className="px-2 py-1.5 text-center text-xs font-semibold text-foreground uppercase tracking-wider">Check-in</th>
        )}
        {showConcluir && (
          <th className="px-2 py-1.5 text-center text-xs font-semibold text-foreground uppercase tracking-wider">Ação</th>
        )}
        {showStatus && (
          <th className="px-2 py-1.5 text-center text-xs font-semibold text-foreground uppercase tracking-wider">Status</th>
        )}
        {/* Colunas finais — iguais às da Lista de agendas */}
        <th className="px-2 py-1.5 text-center text-xs font-semibold text-foreground uppercase tracking-wider">Cotas</th>
        <th className="px-2 py-1.5 text-center text-xs font-semibold text-foreground uppercase tracking-wider">Saldo</th>
        <th className="px-2 py-1.5 text-center text-xs font-semibold text-foreground uppercase tracking-wider">Aguardando</th>
        <th className="px-2 py-1.5 text-center text-xs font-semibold text-foreground uppercase tracking-wider">Autorizadas</th>
      </tr>
    </thead>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function MinhasAgendas() {
  const { perfilAtivo, regulador } = useRegulador();
  const perfilNorm = (perfilAtivo ?? regulador?.perfil ?? '').toLowerCase();
  const isAdminOuMonitor = perfilNorm.includes('administrador') || perfilNorm.includes('monitoramento');

  const { data: checkIns = [], isLoading: loadingCheckIns, refetch: refetchCheckIns, dataUpdatedAt: checkInsUpdatedAt } =
    trpc.checkIns.getMeus.useQuery();

  const { data: encaminhadas = [], isLoading: loadingEncaminhadas, refetch: refetchEncaminhadas, dataUpdatedAt: encaminhadasUpdatedAt } =
    trpc.encaminhamentos.getMinhas.useQuery();

  const { data: concluidas = [], isLoading: loadingConcluidas, refetch: refetchConcluidas } =
    trpc.agendasConcluidas.getMeus.useQuery();

  const removerEncaminhamentoMutation = trpc.encaminhamentos.removerMeu.useMutation();

  const utils = trpc.useUtils();

  const autoEncaminharMutation = trpc.encaminhamentos.autoEncaminhar.useMutation({
    onSuccess: () => {
      // Após recriar o encaminhamento, atualizar a lista
      utils.encaminhamentos.getMinhas.invalidate();
    },
  });

  const checkInMutation = trpc.checkIns.checkIn.useMutation({
    onSuccess: (result, variables) => {
      if (result.action === 'checkin') {
        // Check-in: remover o encaminhamento correspondente
        const enc = encaminhadas.find(e => e.agendaId === variables.agendaId);
        if (enc) {
          removerEncaminhamentoMutation.mutate({ id: enc.id });
        }
      } else if (result.action === 'checkout') {
        // Checkout: recriar encaminhamento em background (sem aguardar)
        autoEncaminharMutation.mutate({
          agendaId: variables.agendaId,
          agendaNome: variables.agendaNome,
          municipio: variables.municipio,
          central: variables.central,
          especialidade: variables.especialidade,
        });
      }
      // Atualizar ambas as listas imediatamente
      utils.checkIns.getMeus.invalidate();
      utils.encaminhamentos.getMinhas.invalidate();
    },
  });

  const concluirMutation = trpc.agendasConcluidas.concluir.useMutation({
    onSuccess: () => {
      utils.checkIns.getMeus.invalidate();
      utils.encaminhamentos.getMinhas.invalidate();
      utils.agendasConcluidas.getMeus.invalidate();
      // Invalidar dados da Regulação para atualizar o status de concluída imediatamente
      utils.sheets.getData.invalidate();
    },
  });

  const limparConcluidasMutation = trpc.agendasConcluidas.limpar.useMutation({
    onSuccess: () => { refetchConcluidas(); },
  });

  const limparEncaminhadasMutation = trpc.encaminhamentos.removerTodos.useMutation({
    onSuccess: () => { refetchEncaminhadas(); },
  });

  const handleCheckIn = (enc: {
    agendaId: number; agendaNome: string; municipio?: string | null;
    especialidade?: string; central?: string | null; cotas?: number | null;
    saldo?: number | null; aguardando?: number | null; indexRegula?: number | null;
  }) => {
    checkInMutation.mutate({
      agendaId: enc.agendaId, agendaNome: enc.agendaNome,
      municipio: enc.municipio ?? undefined, especialidade: enc.especialidade ?? '',
      central: enc.central ?? undefined, cotas: enc.cotas ?? undefined,
      saldo: enc.saldo ?? undefined, aguardando: enc.aguardando ?? undefined,
      indexRegula: enc.indexRegula ?? undefined,
    });
  };

  const handleCheckOut = (ci: {
    agendaId: number; agendaNome: string; municipio?: string | null;
    especialidade: string; central?: string | null; cotas?: number | null;
    saldo?: number | null; aguardando?: number | null; indexRegula?: number | null;
  }) => {
    checkInMutation.mutate({
      agendaId: ci.agendaId, agendaNome: ci.agendaNome,
      municipio: ci.municipio ?? undefined, especialidade: ci.especialidade,
      central: ci.central ?? undefined, cotas: ci.cotas ?? undefined,
      saldo: ci.saldo ?? undefined, aguardando: ci.aguardando ?? undefined,
      indexRegula: ci.indexRegula ?? undefined,
    });
  };

  const handleConcluir = (ci: {
    agendaId: number; agendaNome: string; municipio?: string | null;
    especialidade: string; central?: string | null; cotas?: number | null;
    saldo?: number | null; aguardando?: number | null; indexRegula?: number | null;
  }) => {
    concluirMutation.mutate({
      agendaId: ci.agendaId, agendaNome: ci.agendaNome,
      municipio: ci.municipio ?? undefined, especialidade: ci.especialidade,
      central: ci.central ?? undefined, cotas: ci.cotas ?? undefined,
      saldo: ci.saldo ?? undefined, aguardando: ci.aguardando ?? undefined,
      indexRegula: ci.indexRegula ?? undefined,
    });
  };

  const handleConcluirEncaminhada = (enc: {
    agendaId: number; agendaNome: string; municipio?: string | null;
    especialidade?: string; central?: string | null; cotas?: number | null;
    saldo?: number | null; aguardando?: number | null; indexRegula?: number | null;
  }) => {
    concluirMutation.mutate({
      agendaId: enc.agendaId, agendaNome: enc.agendaNome,
      municipio: enc.municipio ?? undefined, especialidade: enc.especialidade ?? '',
      central: enc.central ?? undefined, cotas: enc.cotas ?? undefined,
      saldo: enc.saldo ?? undefined, aguardando: enc.aguardando ?? undefined,
      indexRegula: enc.indexRegula ?? undefined,
    });
  };

  // Janela do mapa das regiões de saúde — abre só quando o usuário clica em "RS"
  // num check-in ativo. Uma única janela para a página; guarda o município da agenda clicada.
  const legenda = useLegenda();
  const [mapa, setMapa] = React.useState<{ aberto: boolean; municipio: string | null }>({ aberto: false, municipio: null });

  const isLoading = loadingCheckIns || loadingEncaminhadas || loadingConcluidas;
  const checkInIds = new Set(checkIns.map(ci => ci.agendaId));
  const totalAguardandoConcluidas = concluidas.reduce((acc, c) => acc + (c.aguardando ?? 0), 0);

  // IDs de todas as agendas visíveis (check-ins + encaminhadas) para buscar quem está regulando
  const todasAgendaIds = React.useMemo(() => {
    const ids = new Set<number>();
    checkIns.forEach(ci => ids.add(ci.agendaId));
    encaminhadas.forEach(enc => ids.add(enc.agendaId));
    return Array.from(ids);
  }, [checkIns, encaminhadas]);

  const { data: checkInsPorAgenda = {} } = trpc.checkIns.getPorAgendas.useQuery(
    { agendaIds: todasAgendaIds },
    { enabled: todasAgendaIds.length > 0, refetchInterval: 60_000 }
  );

  const handleRefresh = () => {
    utils.checkIns.getMeus.invalidate();
    utils.encaminhamentos.getMinhas.invalidate();
    refetchConcluidas();
  };


  // Agrupar encaminhadas por nome+central para check-in em grupo (item 8)
  const gruposEncaminhadas = React.useMemo(() => {
    const mapa = new Map<string, typeof encaminhadas>();
    encaminhadas.forEach(enc => {
      const chave = `${enc.agendaNome}|${enc.central ?? ''}`;
      const grupo = mapa.get(chave) ?? [];
      grupo.push(enc);
      mapa.set(chave, grupo);
    });
    return Array.from(mapa.values());
  }, [encaminhadas]);

  const handleCheckInGrupo = (grupo: typeof encaminhadas) => {
    grupo.forEach(enc => {
      if (!checkInIds.has(enc.agendaId)) {
        handleCheckIn(enc);
      }
    });
  };

  return (
    <div className="flex-1 flex flex-col bg-background min-h-screen">
      {/* Header */}
      <div className="px-6 py-5 border-b border-border bg-card">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <ClipboardList size={20} className="text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-foreground">Minhas Agendas</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Check-ins ativos e agendas encaminhadas para você
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <UltimaAtualizacao />
          </div>
        </div>
      </div>

      <div className="flex-1 p-6 space-y-8">

        {/* ── Seção 1: Check-ins ativos ── */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle2 size={18} className="text-green-600 dark:text-green-400" />
            <h2 className="text-lg font-semibold text-foreground">Check-ins ativos</h2>
            <span className="ml-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 dark:bg-green-950/50 text-green-700 dark:text-green-300">
              {checkIns.length}
            </span>
          </div>

          {loadingCheckIns ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 size={24} className="animate-spin text-muted-foreground" />
            </div>
          ) : checkIns.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center rounded-lg border border-dashed border-border bg-card">
              <ClipboardList size={24} className="text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">Você não tem check-ins ativos no momento.</p>
              <p className="text-xs text-muted-foreground mt-1">
                Acesse a aba <strong>Regulação</strong> e clique em "Check-in" em uma agenda.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full border-collapse">
                <TableHeader
                  showCheckIn={true}
                  showConcluir={true}
                  dateLabel="Check-in em"
                />
                <tbody>
                  {checkIns.map((ci) => (
                    <React.Fragment key={ci.id}>
                      <AgendaRow
                        agendaId={ci.agendaId}
                        agendaNome={ci.agendaNome}
                        municipio={ci.municipio}
                        central={ci.central}
                        cotas={ci.cotas}
                        autorizadas={(ci as any).autorizadas}
                        autCotas={(ci as any).autCotas}
                        saldo={ci.saldo}
                        aguardando={ci.aguardando}
                        aguardando7d={ci.aguardando7d}
                        aguardando28d={ci.aguardando28d}
                        aguardando90d={ci.aguardando90d}
                        indexRegula={ci.indexRegula}
                        flagIndex={(ci as any).flagIndex}
                        corIndex={(ci as any).corIndex}
                        flagAutCotas={(ci as any).flagAutCotas}
                        corAutCotas={(ci as any).corAutCotas}
                        temCheckIn={true}
                        reguladoresAtivos={checkInsPorAgenda[ci.agendaId] ?? []}
                        createdAt={ci.createdAt}
                        onCheckIn={() => handleCheckOut(ci)}
                        onConcluir={() => handleConcluir(ci)}
                        isCheckInPending={checkInMutation.isPending}
                        isRemoverPending={false}
                        isConcluirPending={concluirMutation.isPending}
                        showCheckIn={true}
                        showConcluir={true}
                        dateLabel="Check-in em"
                      />
                      <tr key={`detalhes-${ci.id}`}>
                        {/* Check-ins ativos: 8 fixas + Data + Check-in + Ação + 4 finais = 15 */}
                        <td colSpan={15} className="p-0">
                          {/* Frase de alerta pela regra Fila/Cotas (mesma da barra azul da Lista de agendas)
                              + botão "RS" que abre o mapa das regiões de saúde sob demanda */}
                          {(() => {
                            const fc = getFilaCotasInfo((ci as any).autCotas, legenda);
                            const cores = fc.alta === null
                              ? 'bg-muted/40 text-muted-foreground border-border'
                              : fc.alta
                                ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-100 border-amber-300 dark:border-amber-800'
                                : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-100 border-emerald-300 dark:border-emerald-800';
                            return (
                              <div className={`flex items-start gap-3 px-4 py-1.5 text-xs font-medium leading-snug border-t ${cores}`}>
                                <span className="flex-1 min-w-0">{fc.alta !== null ? `${fc.icone} ${fc.frase}` : ''}</span>
                                <button
                                  onClick={() => setMapa({ aberto: true, municipio: ci.municipio ?? null })}
                                  className="shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-md border border-blue-300 dark:border-blue-700 bg-white/70 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/50 transition-colors"
                                  title="Ver mapa das regiões de saúde do RS (macro / CRS / região)"
                                >
                                  <MapIcon size={12} />
                                  RS
                                </button>
                              </div>
                            );
                          })()}
                          <CheckInDetalhes
                            agendaId={ci.agendaId}
                            agendaNome={ci.agendaNome}
                            especialidade={ci.especialidade}
                            central={ci.central}
                            municipio={ci.municipio}
                          />
                          {isAdminOuMonitor && (
                            <div className="px-4 py-2 bg-muted/30 border-t border-border flex justify-end">
                              <Link href={`/agendas-relacionadas?agenda=${encodeURIComponent(ci.agendaNome)}`}>
                                <a className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors px-2.5 py-1.5 rounded-md hover:bg-muted">
                                  <Settings size={12} />
                                  Configurar agenda
                                </a>
                              </Link>
                            </div>
                          )}
                        </td>
                      </tr>
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ── Seção 2: Encaminhadas para mim ── */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Send size={18} className="text-blue-600 dark:text-blue-400" />
              <h2 className="text-lg font-semibold text-foreground">Encaminhadas para mim</h2>
              <span className="ml-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300">
                {encaminhadas.length}
              </span>
            </div>
            {encaminhadas.length > 0 && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button
                    disabled={limparEncaminhadasMutation.isPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-md transition-colors disabled:opacity-50"
                  >
                    {limparEncaminhadasMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />}
                    Limpar encaminhadas
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Limpar agendas encaminhadas?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Esta ação removerá todas as {encaminhadas.length} agenda{encaminhadas.length !== 1 ? 's' : ''} encaminhada{encaminhadas.length !== 1 ? 's' : ''} para você. Esta operação não pode ser desfeita.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={() => limparEncaminhadasMutation.mutate()} className="bg-red-600 hover:bg-red-700 text-white">
                      Sim, limpar
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>

          {loadingEncaminhadas ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 size={24} className="animate-spin text-muted-foreground" />
            </div>
          ) : encaminhadas.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center rounded-lg border border-dashed border-border bg-card">
              <Send size={24} className="text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">Nenhuma agenda foi encaminhada para você ainda.</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full border-collapse">
                <TableHeader
                  showEncaminhadoPor={true}
                  showCheckIn={true}
                  showConcluir={true}
                  dateLabel="Encaminhado em"
                />
                <tbody>
                  {gruposEncaminhadas.map((grupo) => {
                    const isGrupo = grupo.length > 1;
                    const primeiroEnc = grupo[0];
                    const todasComCheckIn = grupo.every(e => checkInIds.has(e.agendaId));
                    return (
                      <React.Fragment key={`grupo-${primeiroEnc.agendaNome}|${primeiroEnc.central}`}>
                        {/* Linha de cabeçalho do grupo (quando há múltiplos municípios) */}
                        {isGrupo && (
                          <tr className="bg-blue-50/60 dark:bg-blue-950/20 border-t-2 border-blue-200 dark:border-blue-800">
                            <td colSpan={3} className="px-4 py-2">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-sm text-foreground">{primeiroEnc.agendaNome}</span>
                                <span className="text-xs text-muted-foreground">· {primeiroEnc.central}</span>
                                <span className="px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 text-xs font-medium">{grupo.length} municípios</span>
                              </div>
                            </td>
                            {/* Fila/Cotas…>90d (5) + Encaminhado por + Data = 7 */}
                            <td colSpan={7} />
                            {/* Coluna Check-in */}
                            <td className="px-4 py-2 text-center">
                              {!todasComCheckIn && (
                                <button
                                  onClick={() => handleCheckInGrupo(grupo)}
                                  disabled={checkInMutation.isPending}
                                  className="flex items-center gap-1 mx-auto px-2 py-1 rounded text-xs font-medium bg-green-100 dark:bg-green-950/50 text-green-700 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-900/50 transition-colors disabled:opacity-50 whitespace-nowrap"
                                >
                                  {checkInMutation.isPending ? <Loader2 size={11} className="animate-spin" /> : <LogIn size={11} />}
                                  Check-in em grupo
                                </button>
                              )}
                            </td>
                            {/* Ação + Cotas/Saldo/Aguardando/Autorizadas = 5 */}
                            <td colSpan={5} />
                          </tr>
                        )}
                        {/* Linhas individuais do grupo */}
                        {grupo.map((enc) => (
                          <AgendaRow
                            key={enc.id}
                            agendaId={enc.agendaId}
                            agendaNome={enc.agendaNome}
                            municipio={enc.municipio}
                            central={enc.central}
                            cotas={enc.cotas}
                            saldo={enc.saldo}
                            aguardando={enc.aguardando}
                            aguardando7d={enc.aguardando7d}
                            aguardando28d={enc.aguardando28d}
                            aguardando90d={enc.aguardando90d}
                            autorizadas={enc.autorizadas}
                            autCotas={enc.autCotas}
                            indexRegula={enc.indexRegula}
                            flagIndex={enc.flagIndex}
                            corIndex={enc.corIndex}
                            flagAutCotas={enc.flagAutCotas}
                            corAutCotas={enc.corAutCotas}
                            temCheckIn={checkInIds.has(enc.agendaId)}
                            reguladoresAtivos={checkInsPorAgenda[enc.agendaId] ?? []}
                            encaminhadoPor={enc.encaminhadoPorNome}
                            createdAt={enc.createdAt}
                            onCheckIn={() => handleCheckIn({
                              agendaId: enc.agendaId, agendaNome: enc.agendaNome,
                              municipio: enc.municipio, especialidade: enc.especialidade,
                              central: enc.central, cotas: enc.cotas,
                              saldo: enc.saldo, aguardando: enc.aguardando,
                              indexRegula: enc.indexRegula,
                            })}
                            onConcluir={() => handleConcluirEncaminhada(enc)}
                            isCheckInPending={checkInMutation.isPending}
                            isRemoverPending={false}
                            isConcluirPending={concluirMutation.isPending}
                            showEncaminhadoPor={true}
                            showCheckIn={true}
                            showConcluir={true}
                            dateLabel="Encaminhado em"
                          />
                        ))}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ── Seção 3: Agendas concluídas ── */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <CheckCheck size={18} className="text-emerald-600 dark:text-emerald-400" />
              <h2 className="text-lg font-semibold text-foreground">Agendas concluídas</h2>
              <span className="ml-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300">
                {concluidas.length}
              </span>
            </div>
            {concluidas.length > 0 && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button
                    disabled={limparConcluidasMutation.isPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-md transition-colors disabled:opacity-50"
                  >
                    {limparConcluidasMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />}
                    Limpar agendas concluídas
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Limpar agendas concluídas?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Esta ação removerá todas as {concluidas.length} agenda{concluidas.length !== 1 ? 's' : ''} concluída{concluidas.length !== 1 ? 's' : ''} do seu histórico. Esta operação não pode ser desfeita.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={() => limparConcluidasMutation.mutate()} className="bg-red-600 hover:bg-red-700 text-white">
                      Sim, limpar
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>

          {loadingConcluidas ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 size={24} className="animate-spin text-muted-foreground" />
            </div>
          ) : concluidas.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center rounded-lg border border-dashed border-border bg-card">
              <CheckCheck size={24} className="text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">Nenhuma agenda concluída ainda.</p>
              <p className="text-xs text-muted-foreground mt-1">
                Clique em <strong>"Concluído"</strong> em um check-in ativo para registrá-lo aqui.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full border-collapse">
                <TableHeader
                  showStatus={true}
                  dateLabel="Concluído em"
                />
                <tbody>
                  {concluidas.map((c) => (
                    <AgendaRow
                      key={c.id}
                      agendaId={c.agendaId}
                      agendaNome={c.agendaNome}
                      municipio={c.municipio}
                      central={c.central}
                      cotas={c.cotas}
                      saldo={c.saldo}
                      aguardando={c.aguardando}
                      aguardando7d={(c as any).aguardando7d}
                      aguardando28d={(c as any).aguardando28d}
                      aguardando90d={(c as any).aguardando90d}
                      indexRegula={c.indexRegula}
                      flagIndex={(c as any).flagIndex}
                      corIndex={(c as any).corIndex}
                      flagAutCotas={(c as any).flagAutCotas}
                      corAutCotas={(c as any).corAutCotas}
                      temCheckIn={false}
                      concluidoEm={c.concluidoEm}
                      createdAt={c.concluidoEm}
                      isCheckInPending={false}
                      isRemoverPending={false}
                      showConcluidoEm={true}
                      showStatus={true}
                      isConcluida={true}
                      dateLabel="Concluído em"
                    />
                  ))}
                </tbody>
                {/* Rodapé com soma total de Aguardando */}
                {/* 14 colunas: 8 fixas + Data + Status + Cotas + Saldo + Aguardando(13ª) + Autorizadas */}
                <tfoot className="bg-emerald-50 dark:bg-emerald-950/20 border-t-2 border-emerald-200 dark:border-emerald-800">
                  <tr>
                    <td colSpan={12} className="px-4 py-3 text-right text-xs font-semibold text-emerald-700 dark:text-emerald-300 uppercase tracking-wider">
                      Total Aguardando (produtividade):
                    </td>
                    <td className="px-4 py-3 text-center text-sm font-bold text-emerald-700 dark:text-emerald-300">
                      {totalAguardandoConcluidas}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>

      </div>

      {/* Mapa das regiões de saúde — fechado até o usuário clicar em "RS" */}
      <MapaRegioesSaude
        open={mapa.aberto}
        onOpenChange={(v) => setMapa(m => ({ ...m, aberto: v }))}
        municipio={mapa.municipio}
      />
    </div>
  );
}
