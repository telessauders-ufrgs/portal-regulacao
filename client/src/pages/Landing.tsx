import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { trpc } from '@/lib/trpc';
import { useLegenda } from '@/hooks/useLegenda';
import { formatarLimite, type LegendaConfig } from '@shared/legenda';
import {
  Table2,
  ArrowRight,
  Activity,
  Users,
  TrendingUp,
  AlertCircle,
  Clock,
  RefreshCw,
  BookOpen,
} from 'lucide-react';


// ─── Legenda (dicionário das colunas) ─────────────────────────────────────────
// Textos e limites vêm da configuração editável na aba "Recados e Legenda"
// (hook useLegenda; padrão em shared/legenda.ts). As faixas de Fila/Cotas e
// Index são montadas a partir dos limites configurados.
const CLASSES_REGRA = {
  baixa: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-100 border border-emerald-200 dark:border-emerald-800',
  alta: 'bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-100 border border-amber-200 dark:border-amber-800',
  critico: 'bg-red-50 dark:bg-red-950/40 text-red-900 dark:text-red-100 border border-red-200 dark:border-red-800',
  alto: 'bg-orange-50 dark:bg-orange-950/40 text-orange-900 dark:text-orange-100 border border-orange-200 dark:border-orange-800',
  atencao: 'bg-yellow-50 dark:bg-yellow-950/40 text-yellow-900 dark:text-yellow-100 border border-yellow-200 dark:border-yellow-800',
  normal: 'bg-muted text-foreground border border-border',
};

function montarLegenda(cfg: LegendaConfig): {
  termo: string;
  descricao: string;
  regras?: { rotulo: string; texto: string; classe: string }[];
}[] {
  const L = formatarLimite;
  return cfg.termos.map(t => {
    if (t.id === 'filaCotas') {
      return { termo: t.termo, descricao: t.descricao, regras: [
        { rotulo: `⏩ ≤ ${L(cfg.filaCotas.limite)}`, texto: cfg.filaCotas.fraseBaixa, classe: CLASSES_REGRA.baixa },
        { rotulo: `⚠️ > ${L(cfg.filaCotas.limite)}`, texto: cfg.filaCotas.fraseAlta, classe: CLASSES_REGRA.alta },
      ] };
    }
    if (t.id === 'index') {
      return { termo: t.termo, descricao: t.descricao, regras: [
        { rotulo: `Index > ${L(cfg.index.critico)}`, texto: cfg.index.fraseCritico, classe: CLASSES_REGRA.critico },
        { rotulo: `Index > ${L(cfg.index.alto)}`, texto: cfg.index.fraseAlto, classe: CLASSES_REGRA.alto },
        { rotulo: `Index > ${L(cfg.index.atencao)}`, texto: cfg.index.fraseAtencao, classe: CLASSES_REGRA.atencao },
        { rotulo: `Index ≤ ${L(cfg.index.atencao)}`, texto: cfg.index.fraseNormal, classe: CLASSES_REGRA.normal },
      ] };
    }
    return { termo: t.termo, descricao: t.descricao };
  });
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
  color: string;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 flex flex-col items-start gap-2 shadow-sm min-w-0">
      <div className={`p-2.5 rounded-lg ${color} shrink-0`}>
        <Icon size={18} className="text-white" />
      </div>
      <div className="w-full min-w-0">
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide leading-tight truncate">{label}</p>
        <p className="text-xl font-bold text-card-foreground mt-0.5 truncate">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

export default function Landing() {
  const { data: sheetsData, refetch: refetchData } = trpc.sheets.getData.useQuery();
  const { data: prioridades } = trpc.prioridades.getAll.useQuery();
  const { data: syncHistory, refetch: refetchHistory } = trpc.sheets.getSyncHistory.useQuery();

  // Controle de acesso ao botão de sincronização
  // O campo perfil pode conter valores compostos como "ADMINISTRADOR, REGULADOR"
  const { data: accessData } = trpc.auth.checkAccess.useQuery();
  const perfil = accessData?.regulador?.perfil?.toLowerCase() ?? '';
  const podeSync = perfil.includes('administrador') || perfil.includes('monitoramento');

  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle');
  const syncMutation = trpc.sheets.syncAll.useMutation({
    onMutate: () => setSyncStatus('syncing'),
    onSuccess: () => {
      setSyncStatus('success');
      refetchData();
      refetchHistory();
      setTimeout(() => setSyncStatus('idle'), 3000);
    },
    onError: () => {
      setSyncStatus('error');
      setTimeout(() => setSyncStatus('idle'), 3000);
    },
  });

  const rows = sheetsData?.rows ?? [];
  const legendaCfg = useLegenda();
  const legenda = useMemo(() => montarLegenda(legendaCfg), [legendaCfg]);

  const stats = useMemo(() => {
    if (!rows.length) return null;

    const totalCotas = rows.reduce((sum, r) => sum + (Number(r[2]) || 0), 0);
    const totalSaldo = rows.reduce((sum, r) => sum + (Number(r[3]) || 0), 0);
    const totalAguardando = rows.reduce((sum, r) => sum + (Number(r[4]) || 0), 0);
    const totalAlta = rows.filter(r => Number(r[7]) > legendaCfg.index.critico).length;

    const especialidades = new Set(rows.map(r => r[12]).filter(Boolean));

    return {
      totalAgendas: rows.length,
      totalCotas,
      totalSaldo,
      totalAguardando,
      totalAlta,
      totalEspecialidades: especialidades.size,
    };
  }, [rows, legendaCfg]);

  const lastSync = syncHistory?.[0];
  const lastSyncDate = lastSync?.syncedAt
    ? new Date(lastSync.syncedAt).toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-blue-900 text-white px-8 py-14">
        <div className="max-w-4xl">
          <div className="flex items-center gap-2 mb-4">
            <Activity size={16} className="text-blue-400" />
            <span className="text-blue-300 text-sm font-medium uppercase tracking-widest">
              Sistema de Regulação
            </span>
          </div>
          <h1 className="text-4xl font-bold leading-tight mb-3">
            Portal de Monitoramento<br />da Regulação TSRS
          </h1>
          <p className="text-slate-300 text-lg max-w-2xl">
            Plataforma centralizada para consulta, análise e gestão de encaminhamentos para
            consultas especializadas no sistema de saúde.
          </p>
          <div className="flex items-center gap-4 mt-5 flex-wrap">
            {lastSyncDate && (
              <div className="flex items-center gap-2 text-slate-400 text-sm">
                <Clock size={14} />
                <span>Última atualização: {lastSyncDate}</span>
              </div>
            )}
            {podeSync && (
              <button
                onClick={() => syncMutation.mutate()}
                disabled={syncStatus === 'syncing'}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all border ${
                  syncStatus === 'syncing'
                    ? 'border-slate-500 text-slate-400 cursor-not-allowed'
                    : syncStatus === 'success'
                    ? 'border-green-500/50 text-green-400 hover:bg-green-500/10'
                    : syncStatus === 'error'
                    ? 'border-red-500/50 text-red-400 hover:bg-red-500/10'
                    : 'border-slate-500/50 text-slate-300 hover:bg-white/10 hover:border-slate-400'
                }`}
              >
                <RefreshCw size={12} className={syncStatus === 'syncing' ? 'animate-spin' : ''} />
                {syncStatus === 'idle' && 'Sincronizar agora'}
                {syncStatus === 'syncing' && 'Sincronizando...'}
                {syncStatus === 'success' && 'Sincronizado!'}
                {syncStatus === 'error' && 'Erro — tentar novamente'}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="px-8 py-10 max-w-6xl">
        {/* Métricas */}
        {stats && (
          <section className="mb-12">
            <h2 className="text-lg font-semibold text-foreground mb-4">Resumo Geral</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
              <StatCard
                icon={Table2}
                label="Agendas"
                value={stats.totalAgendas.toLocaleString('pt-BR')}
                color="bg-blue-500"
              />
              <StatCard
                icon={Users}
                label="Especialidades"
                value={stats.totalEspecialidades}
                color="bg-indigo-500"
              />
              <StatCard
                icon={TrendingUp}
                label="Total de Cotas"
                value={stats.totalCotas.toLocaleString('pt-BR')}
                color="bg-green-500"
              />
              <StatCard
                icon={Activity}
                label="Saldo Disponível"
                value={stats.totalSaldo.toLocaleString('pt-BR')}
                color="bg-teal-500"
              />
              <StatCard
                icon={Users}
                label="Aguardando"
                value={stats.totalAguardando.toLocaleString('pt-BR')}
                color="bg-amber-500"
              />
              <StatCard
                icon={AlertCircle}
                label={`Índice Alto (>${legendaCfg.index.critico.toLocaleString('pt-BR')})`}
                value={stats.totalAlta}
                sub="agendas críticas"
                color="bg-red-500"
              />
            </div>
          </section>
        )}

        {/* Legenda do portal — substitui o antigo "Acesso Rápido" */}
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-1 flex items-center gap-2">
            <BookOpen size={18} className="text-primary" />
            {legendaCfg.titulo}
          </h2>
          {legendaCfg.subtitulo && (
            <p className="text-sm text-muted-foreground mb-4 whitespace-pre-wrap">{legendaCfg.subtitulo}</p>
          )}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            {legenda.map((item, i) => (
              <div key={item.termo} className={`grid grid-cols-1 md:grid-cols-[150px_1fr] gap-x-5 gap-y-1 px-5 py-3 ${i > 0 ? 'border-t border-border' : ''}`}>
                <div className="text-sm font-bold text-foreground tracking-wide">{item.termo}</div>
                <div className="min-w-0">
                  <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">{item.descricao}</p>
                  {item.regras && (
                    <ul className="mt-2 space-y-1.5">
                      {item.regras.map(r => (
                        <li key={r.rotulo} className={`flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-3 rounded-md px-3 py-2 text-sm ${r.classe}`}>
                          <span className="font-semibold whitespace-nowrap shrink-0">{r.rotulo}</span>
                          <span className="leading-relaxed">{r.texto}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Listas de prioridades resumo */}
        {prioridades && prioridades.length > 0 && (
          <section className="mt-10">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-foreground">Listas de Prioridades Disponíveis</h2>
              <Link href="/prioridades">
                <span className="text-sm text-primary hover:underline flex items-center gap-1 cursor-pointer">
                  Ver todas <ArrowRight size={13} />
                </span>
              </Link>
            </div>
            <div className="bg-card border border-border rounded-xl p-5">
              <p className="text-sm text-muted-foreground mb-3">
                {prioridades.length} documentos disponíveis em {new Set(prioridades.map(p => p.grandeGrupo).filter(Boolean)).size} grupos clínicos
              </p>
              <div className="flex flex-wrap gap-2">
                {Array.from(new Set(prioridades.map(p => p.grandeGrupo?.trim()).filter(Boolean)))
                  .sort((a, b) => (a ?? '').localeCompare(b ?? '', 'pt-BR'))
                  .map(grupo => (
                    <span
                      key={grupo}
                      className="px-3 py-1 bg-violet-50 dark:bg-violet-950/40 border border-violet-200 dark:border-violet-800 text-violet-700 dark:text-violet-300 text-xs font-medium rounded-full"
                    >
                      {grupo}
                    </span>
                  ))}
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
