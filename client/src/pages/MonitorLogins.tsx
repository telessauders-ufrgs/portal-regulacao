/**
 * MonitorLogins.tsx — sessões de uso do portal (administradores e monitoramento)
 *
 * Regra das sessões (ver server/atividade.ts e hooks/useHeartbeat.ts):
 *  - o navegador envia um sinal a cada 2 min, só se houve interação real e a aba está visível;
 *  - sem sinal por 30 min, a sessão é ENCERRADA NO REGISTRO (o "Fim" = última atividade);
 *  - isso NÃO desloga o usuário: o login (cookie) continua válido e, ao voltar a usar,
 *    uma nova sessão é aberta automaticamente.
 *
 * Filtros: período (consultado no servidor), busca por nome/e-mail e status (no navegador).
 * Exportação: CSV ou XLS das linhas filtradas.
 */
import { useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useRegulador } from '@/contexts/ReguladorContext';
import { LogIn, LogOut, RefreshCw, Loader2, Download, Search, X } from 'lucide-react';

type Status = 'ativo' | 'ocioso' | 'encerrado';
const ROTULO_STATUS: Record<Status, string> = { ativo: 'Ativo agora', ocioso: 'Ocioso', encerrado: 'Encerrado' };

const PERIODOS = [
  { id: 'hoje', rotulo: 'Hoje', dias: 0 },
  { id: '7', rotulo: '7 dias', dias: 7 },
  { id: '30', rotulo: '30 dias', dias: 30 },
  { id: '90', rotulo: '90 dias', dias: 90 },
  { id: 'custom', rotulo: 'Personalizado', dias: -1 },
] as const;
type PeriodoId = typeof PERIODOS[number]['id'];

/** yyyy-mm-dd no fuso local (para <input type="date">). */
function isoDia(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export default function MonitorLogins() {
  const { perfilAtivo, regulador } = useRegulador();
  const perfilNorm = (perfilAtivo ?? regulador?.perfil ?? '').toLowerCase();
  const isAdminOuMonitor = perfilNorm.includes('administrador') || perfilNorm.includes('monitoramento');

  // ── Filtros ──
  const [periodo, setPeriodo] = useState<PeriodoId>('7');
  const [dataIni, setDataIni] = useState(() => isoDia(new Date(Date.now() - 7 * 864e5)));
  const [dataFim, setDataFim] = useState(() => isoDia(new Date()));
  const [busca, setBusca] = useState('');
  const [statusSel, setStatusSel] = useState<Set<Status>>(new Set());
  const [exportAberto, setExportAberto] = useState(false);

  // Período → intervalo enviado ao servidor (início do 1º dia até o fim do último)
  const intervalo = useMemo(() => {
    const p = PERIODOS.find(x => x.id === periodo)!;
    if (p.dias === -1) {
      return {
        desde: dataIni ? new Date(`${dataIni}T00:00:00`).toISOString() : undefined,
        ate: dataFim ? new Date(`${dataFim}T23:59:59`).toISOString() : undefined,
      };
    }
    const ini = new Date(); ini.setHours(0, 0, 0, 0); ini.setDate(ini.getDate() - p.dias);
    return { desde: ini.toISOString(), ate: undefined };
  }, [periodo, dataIni, dataFim]);

  const { data = [], isLoading, refetch, isFetching } = trpc.loginLog.listar.useQuery(
    { limite: 10000, ...intervalo },
    { refetchInterval: 60_000, enabled: isAdminOuMonitor }
  );

  const formatDate = (date: Date | string | null | undefined) => {
    if (!date) return '—';
    return new Date(date).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  };

  const minutos = (ini: Date | string, fim: Date | string) =>
    Math.max(0, Math.floor((new Date(fim).getTime() - new Date(ini).getTime()) / 60000));
  const fmtDuracao = (mins: number) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? `${h}h ${m}min` : `${m}min`;
  };

  // Linhas com status e duração calculados
  const linhas = useMemo(() => data.map(row => {
    const ultima = row.ultimaAtividadeAt ?? row.loginAt;
    const minDesdeUltima = (Date.now() - new Date(ultima).getTime()) / 60000;
    const status: Status = row.logoutAt ? 'encerrado' : minDesdeUltima <= 10 ? 'ativo' : 'ocioso';
    return { ...row, status, duracaoMin: minutos(row.loginAt, row.logoutAt ?? ultima) };
  }), [data]);

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return linhas.filter(l =>
      (!termo || (l.reguladorNome ?? '').toLowerCase().includes(termo) || l.reguladorEmail.toLowerCase().includes(termo)) &&
      (statusSel.size === 0 || statusSel.has(l.status))
    );
  }, [linhas, busca, statusSel]);

  const resumo = useMemo(() => ({
    sessoes: filtradas.length,
    pessoas: new Set(filtradas.map(l => l.reguladorEmail.toLowerCase())).size,
    minutos: filtradas.reduce((s, l) => s + l.duracaoMin, 0),
    ativos: filtradas.filter(l => l.status === 'ativo').length,
  }), [filtradas]);

  const toggleStatus = (s: Status) => setStatusSel(prev => {
    const n = new Set(prev); if (n.has(s)) n.delete(s); else n.add(s); return n;
  });
  const temFiltro = !!busca || statusSel.size > 0;

  // ── Exportação (linhas filtradas) ──
  const exportar = (formato: 'csv' | 'xls') => {
    const cab = ['Regulador', 'E-mail', 'Login', 'Fim', 'Última atividade', 'Duração (min)', 'Status'];
    const corpo = filtradas.map(l => [
      l.reguladorNome ?? '', l.reguladorEmail, formatDate(l.loginAt), formatDate(l.logoutAt),
      formatDate(l.ultimaAtividadeAt), String(l.duracaoMin), ROTULO_STATUS[l.status],
    ]);
    const dados = [cab, ...corpo];
    const nome = `monitor-logins-${isoDia(new Date())}`;
    let blob: Blob;
    if (formato === 'csv') {
      const csv = dados.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
      blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    } else {
      const esc = (c: string) => c.replace(/&/g, '&amp;').replace(/</g, '&lt;');
      const html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="UTF-8"/></head><body><table>' +
        dados.map(r => '<tr>' + r.map(c => `<td>${esc(String(c))}</td>`).join('') + '</tr>').join('') + '</table></body></html>';
      blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${nome}.${formato}`; a.click();
    URL.revokeObjectURL(url);
  };

  if (!isAdminOuMonitor) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Acesso restrito a administradores e monitores.
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-background">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border bg-card space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <LogIn size={18} className="text-primary" />
              <h1 className="text-xl font-semibold text-foreground">Monitor de Logins</h1>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Sessões de uso do portal. Uma sessão é encerrada no registro após 30 min sem interação; o fim registrado é o horário da última atividade real.
              O usuário <strong>não é desconectado</strong> — ao voltar a usar, uma nova sessão é aberta.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="relative">
              <button onClick={() => setExportAberto(v => !v)} disabled={filtradas.length === 0}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-border text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50">
                <Download size={12} /> Exportar
              </button>
              {exportAberto && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setExportAberto(false)} />
                  <div className="absolute right-0 top-full mt-1 z-50 flex flex-col bg-card border border-border rounded-lg shadow-lg overflow-hidden min-w-[100px]">
                    <button onClick={() => { exportar('csv'); setExportAberto(false); }} className="px-4 py-2 text-xs text-left hover:bg-muted">.CSV</button>
                    <button onClick={() => { exportar('xls'); setExportAberto(false); }} className="px-4 py-2 text-xs text-left hover:bg-muted">.XLS</button>
                  </div>
                </>
              )}
            </div>
            <button onClick={() => refetch()}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-border text-muted-foreground hover:bg-muted transition-colors">
              <RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} /> Atualizar
            </button>
          </div>
        </div>

        {/* Filtros */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Período:</span>
          {PERIODOS.map(p => (
            <button key={p.id} onClick={() => setPeriodo(p.id)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${periodo === p.id ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:bg-muted'}`}>
              {p.rotulo}
            </button>
          ))}
          {periodo === 'custom' && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <input type="date" value={dataIni} max={dataFim || undefined} onChange={e => setDataIni(e.target.value)}
                className="text-xs px-2 py-1 rounded-md border border-border bg-background text-foreground" />
              até
              <input type="date" value={dataFim} min={dataIni || undefined} onChange={e => setDataFim(e.target.value)}
                className="text-xs px-2 py-1 rounded-md border border-border bg-background text-foreground" />
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar nome ou e-mail..."
              className="text-xs pl-7 pr-2 py-1 rounded-md border border-border bg-background w-56" />
          </div>
          <span className="text-xs text-muted-foreground ml-1">Status:</span>
          {(['ativo', 'ocioso', 'encerrado'] as Status[]).map(s => (
            <button key={s} onClick={() => toggleStatus(s)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${statusSel.has(s) ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:bg-muted'}`}>
              {ROTULO_STATUS[s]}
            </button>
          ))}
          {temFiltro && (
            <button onClick={() => { setBusca(''); setStatusSel(new Set()); }}
              className="flex items-center gap-1 text-xs px-2 py-1 rounded-md text-muted-foreground hover:bg-muted">
              <X size={11} /> Limpar filtros
            </button>
          )}
        </div>
      </div>

      {/* Conteúdo */}
      <div className="flex-1 overflow-auto p-6 space-y-4">
        {/* Resumo do que está filtrado */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Sessões', valor: resumo.sessoes.toLocaleString('pt-BR') },
            { label: 'Pessoas', valor: resumo.pessoas.toLocaleString('pt-BR') },
            { label: 'Tempo total', valor: resumo.minutos > 0 ? fmtDuracao(resumo.minutos) : '—' },
            { label: 'Ativos agora', valor: resumo.ativos.toLocaleString('pt-BR') },
          ].map(c => (
            <div key={c.label} className="bg-card border border-border rounded-lg p-3">
              <div className="text-xs text-muted-foreground">{c.label}</div>
              <div className="text-xl font-semibold text-foreground">{isLoading ? '…' : c.valor}</div>
            </div>
          ))}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-40 gap-2 text-muted-foreground text-sm">
            <Loader2 size={18} className="animate-spin" />
            Carregando...
          </div>
        ) : filtradas.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground border border-dashed border-border rounded-lg">
            <LogIn size={32} className="opacity-30" />
            <p className="text-sm">Nenhuma sessão encontrada com esses filtros.</p>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <table className="w-full border-collapse">
              <thead className="bg-secondary">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground uppercase tracking-wider border-b border-border">Regulador</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground uppercase tracking-wider border-b border-border">E-mail</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-foreground uppercase tracking-wider border-b border-border">
                    <div className="flex items-center justify-center gap-1"><LogIn size={11} /> Login</div>
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-foreground uppercase tracking-wider border-b border-border">
                    <div className="flex items-center justify-center gap-1"><LogOut size={11} /> Fim</div>
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-foreground uppercase tracking-wider border-b border-border">Última atividade</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-foreground uppercase tracking-wider border-b border-border">Duração</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-foreground uppercase tracking-wider border-b border-border">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtradas.map((row) => (
                  <tr key={row.id} className="border-b border-border hover:bg-muted/40 transition-colors">
                    <td className="px-4 py-3 text-sm font-medium text-foreground">{row.reguladorNome ?? '—'}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{row.reguladorEmail}</td>
                    <td className="px-4 py-3 text-center text-xs text-foreground">{formatDate(row.loginAt)}</td>
                    <td className="px-4 py-3 text-center text-xs text-foreground">{formatDate(row.logoutAt)}</td>
                    <td className="px-4 py-3 text-center text-xs text-foreground">{formatDate(row.ultimaAtividadeAt)}</td>
                    <td className="px-4 py-3 text-center text-xs text-muted-foreground">{fmtDuracao(row.duracaoMin)}</td>
                    <td className="px-4 py-3 text-center">
                      {row.status === 'ativo' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                          Ativo agora
                        </span>
                      ) : row.status === 'ocioso' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">
                          Ocioso
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
                          Encerrado
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data.length >= 10000 && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            Mostrando as 10.000 sessões mais recentes do período. Reduza o período para ver tudo.
          </p>
        )}
      </div>
    </div>
  );
}
