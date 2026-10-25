import { Activity, Loader2, RefreshCw, UserCheck } from 'lucide-react';
import { getCorRowStyle, getCorBadgeStyle, getClasseIndex } from '@/lib/corAgenda';
import { useLegenda } from '@/hooks/useLegenda';
import { trpc } from '@/lib/trpc';
import { UltimaAtualizacao } from '@/components/UltimaAtualizacao';
import { useMemo, useEffect, useState } from 'react';

export default function MonitorCheckIns() {
  const legenda = useLegenda();
  const [filtroEspecialidade, setFiltroEspecialidade] = useState('');
  const [filtroRegulador, setFiltroRegulador] = useState('');

  const { data: checkIns = [], isLoading, refetch, dataUpdatedAt } =
    trpc.checkIns.getAll.useQuery(undefined, {
      staleTime: 30_000,
      refetchInterval: 60_000, // Atualiza automaticamente a cada 60 segundos
    });

  // Contador regressivo até a próxima atualização
  const [countdown, setCountdown] = useState(60);
  useEffect(() => {
    setCountdown(60);
    const interval = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) return 60;
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [dataUpdatedAt]);

  // Agrupar check-ins por agendaId para mostrar múltiplos reguladores na mesma agenda
  // Opções de filtro
  const especialidadesUnicas = useMemo(() => {
    const s = new Set<string>();
    checkIns.forEach(ci => { if (ci.especialidade) s.add(ci.especialidade); });
    return Array.from(s).sort();
  }, [checkIns]);

  const reguladoresUnicos = useMemo(() => {
    const s = new Set<string>();
    checkIns.forEach(ci => s.add(ci.usuarioNome || ci.usuarioEmail));
    return Array.from(s).sort();
  }, [checkIns]);

  const checkInsFiltrados = useMemo(() => {
    return checkIns.filter(ci => {
      if (filtroEspecialidade && ci.especialidade !== filtroEspecialidade) return false;
      if (filtroRegulador && (ci.usuarioNome || ci.usuarioEmail) !== filtroRegulador) return false;
      return true;
    });
  }, [checkIns, filtroEspecialidade, filtroRegulador]);

  const agendasAgrupadas = useMemo(() => {
    const map = new Map<number, {
      agendaId: number;
      agendaNome: string;
      municipio?: string | null;
      central?: string | null;
      cotas?: number | null;
      saldo?: number | null;
      aguardando?: number | null;
      aguardando7d?: number | null;
      aguardando28d?: number | null;
      aguardando90d?: number | null;
      indexRegula?: number | null;
      cor?: string | null;
      reguladores: { nome: string; email: string; desde: Date }[];
    }>();

    for (const ci of checkInsFiltrados) {
      if (!map.has(ci.agendaId)) {
        map.set(ci.agendaId, {
          agendaId: ci.agendaId,
          agendaNome: ci.agendaNome,
          municipio: ci.municipio,
          central: ci.central,
          cotas: ci.cotas,
          saldo: ci.saldo,
          aguardando: ci.aguardando,
          aguardando7d: ci.aguardando7d,
          aguardando28d: ci.aguardando28d,
          aguardando90d: ci.aguardando90d,
          indexRegula: ci.indexRegula,
          cor: (ci as any).cor,
          reguladores: [],
        });
      }
      map.get(ci.agendaId)!.reguladores.push({
        nome: ci.usuarioNome,
        email: ci.usuarioEmail,
        desde: ci.createdAt,
      });
    }

    return Array.from(map.values()).sort((a, b) => {
      // Ordenar por indexRegula decrescente
      const ia = a.indexRegula ?? 0;
      const ib = b.indexRegula ?? 0;
      return ib - ia;
    });
  }, [checkIns]);

  // Cores do Index pelos limites configuráveis (aba Recados e Legenda)
  const getBadgeColor = (value: number | null | undefined): string =>
    (!value ? '' : getClasseIndex(value, 'badge', legenda)) || 'bg-muted text-muted-foreground';

  const totalAtivos = agendasAgrupadas.reduce((s, a) => s + a.reguladores.length, 0);

  return (
    <div className="flex-1 flex flex-col bg-background min-h-screen">
      {/* Header */}
      <div className="px-6 py-5 border-b border-border bg-card">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Activity size={20} className="text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-foreground">Monitor de Check-ins</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Agendas em regulação ativa no momento
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Filtros */}
            <select value={filtroEspecialidade} onChange={e => setFiltroEspecialidade(e.target.value)}
              className="text-sm border border-border rounded-md px-2.5 py-1.5 bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary">
              <option value="">Todas especialidades</option>
              {especialidadesUnicas.map(e => <option key={e} value={e}>{e}</option>)}
            </select>
            <select value={filtroRegulador} onChange={e => setFiltroRegulador(e.target.value)}
              className="text-sm border border-border rounded-md px-2.5 py-1.5 bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary">
              <option value="">Todos reguladores</option>
              {reguladoresUnicos.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            {/* Contador total */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-secondary text-sm text-foreground">
              <UserCheck size={14} className="text-primary" />
              <span className="font-medium">{totalAtivos}</span>
              <span className="text-muted-foreground">check-in{totalAtivos !== 1 ? 's' : ''} ativo{totalAtivos !== 1 ? 's' : ''}</span>
            </div>
            <UltimaAtualizacao compact />
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-muted/50 text-xs text-muted-foreground">
              <RefreshCw size={11} className={isLoading ? 'animate-spin' : ''} />
              <span>Próxima em <span className="font-semibold text-foreground">{countdown}s</span></span>
            </div>
            <button
              onClick={() => { refetch(); setCountdown(60); }}
              disabled={isLoading}
              className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-secondary rounded-md transition-colors disabled:opacity-50"
            >
              <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
              Atualizar
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 p-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={28} className="animate-spin text-muted-foreground" />
          </div>
        ) : agendasAgrupadas.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center rounded-lg border border-dashed border-border bg-card">
            <Activity size={32} className="text-muted-foreground mb-3" />
            <p className="text-base font-medium text-foreground">Nenhuma agenda em regulação</p>
            <p className="text-sm text-muted-foreground mt-1">
              Quando um regulador fizer check-in em uma agenda, ela aparecerá aqui.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full border-collapse">
              <thead className="bg-secondary">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground uppercase tracking-wider">Agenda</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-foreground uppercase tracking-wider">Central</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-foreground uppercase tracking-wider">Cotas</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-foreground uppercase tracking-wider">Saldo</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-foreground uppercase tracking-wider">Aguardando</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-foreground uppercase tracking-wider">&gt;7d</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-foreground uppercase tracking-wider">&gt;28d</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-foreground uppercase tracking-wider">&gt;90d</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-foreground uppercase tracking-wider">Index</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground uppercase tracking-wider">Regulando</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-foreground uppercase tracking-wider">Check-in em</th>
                </tr>
              </thead>
              <tbody>
                {agendasAgrupadas.map((agenda) => {
                  const corRowStyle = getCorRowStyle(agenda.cor);
                  const corBadgeStyle = getCorBadgeStyle(agenda.cor);
                  return (
                  <tr key={agenda.agendaId} className="border-t border-border hover:bg-secondary/50 transition-colors" style={corRowStyle}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-sm text-foreground flex items-center gap-2">
                        {agenda.cor && <span style={corBadgeStyle} title={agenda.cor} />}
                        {agenda.agendaNome}
                      </div>
                      {agenda.municipio && (
                        <div className="text-xs text-muted-foreground mt-0.5">{agenda.municipio}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center text-xs text-foreground">{agenda.central ?? '—'}</td>
                    <td className="px-4 py-3 text-center text-sm font-medium text-foreground">{agenda.cotas ?? '—'}</td>
                    <td className="px-4 py-3 text-center text-sm font-medium text-foreground">{agenda.saldo ?? '—'}</td>
                    <td className="px-4 py-3 text-center text-sm font-medium text-foreground">{agenda.aguardando ?? '—'}</td>
                    <td className="px-4 py-3 text-center text-sm font-medium text-foreground">{agenda.aguardando7d ?? '—'}</td>
                    <td className="px-4 py-3 text-center text-sm font-medium text-foreground">{agenda.aguardando28d ?? '—'}</td>
                    <td className="px-4 py-3 text-center text-sm font-medium text-foreground">{agenda.aguardando90d ?? '—'}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded text-sm ${getBadgeColor(agenda.indexRegula)}`}>
                        {agenda.indexRegula != null ? agenda.indexRegula.toFixed(2) : '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {agenda.reguladores.map((reg) => (
                          <span
                            key={reg.email}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary"
                          >
                            <UserCheck size={10} />
                            {reg.nome}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center text-xs text-muted-foreground">
                      {/* Mostrar o check-in mais recente */}
                      {new Date(
                        Math.max(...agenda.reguladores.map(r => new Date(r.desde).getTime()))
                      ).toLocaleString('pt-BR', {
                        hour: '2-digit',
                        minute: '2-digit',
                        day: '2-digit',
                        month: '2-digit',
                      })}
                    </td>
                  </tr>
                );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
