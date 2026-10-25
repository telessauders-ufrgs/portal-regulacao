/**
 * Recados.tsx — "Recados e Legenda" (exclusiva para administradores)
 *
 * Duas seções:
 *  1. Recados: enviar recados para toda a equipe, editar e desativar.
 *  2. Legenda e limites: editar os textos da seção "Aprenda a interpretar..."
 *     da aba Início e os limites das sinalizações (Fila/Cotas e Index).
 *     Os limites salvos repercutem nos destaques de todas as tabelas do portal
 *     e na frase de alerta do check-in (ver shared/legenda.ts e hooks/useLegenda.ts).
 */
import { useEffect, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useRegulador } from '@/contexts/ReguladorContext';
import { Send, Bell, BellOff, Clock, User, Pencil, BookOpen, RotateCcw, Save, Undo2 } from 'lucide-react';
import { LEGENDA_PADRAO, normalizarLegenda, validarLegenda, type LegendaConfig } from '@shared/legenda';

function formatarData(d: Date | string) {
  return new Date(d).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

const inputCls = 'w-full text-sm px-3 py-2 rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50';
const labelCls = 'text-xs font-medium text-muted-foreground uppercase tracking-wide';

export default function Recados() {
  const { regulador, perfilAtivo } = useRegulador();
  const perfilNorm = (perfilAtivo ?? regulador?.perfil ?? '').toLowerCase();
  const isAdmin = perfilNorm.includes('administrador');
  const [secao, setSecao] = useState<'recados' | 'legenda'>('recados');

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        Acesso restrito a administradores.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-2">
        <Bell size={20} className="text-primary" />
        <h1 className="text-lg font-semibold text-foreground">Recados e Legenda</h1>
      </div>

      {/* Seletor de seção */}
      <div className="flex gap-1 p-1 rounded-lg bg-muted w-fit">
        {([['recados', 'Recados para a equipe', Bell], ['legenda', 'Legenda e limites', BookOpen]] as const).map(([id, rotulo, Icone]) => (
          <button key={id} onClick={() => setSecao(id)}
            className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md transition-colors ${secao === id ? 'bg-card text-foreground shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground'}`}>
            <Icone size={14} />
            {rotulo}
          </button>
        ))}
      </div>

      {secao === 'recados' ? <SecaoRecados /> : <SecaoLegenda />}
    </div>
  );
}

// ─── Seção 1: Recados ─────────────────────────────────────────────────────────
function SecaoRecados() {
  const [titulo, setTitulo] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [feedback, setFeedback] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  // Edição de um recado existente
  const [editando, setEditando] = useState<{ id: number; titulo: string; mensagem: string } | null>(null);

  const { data: historico = [], refetch } = trpc.recados.listar.useQuery();
  const utils = trpc.useUtils();

  const criarMutation = trpc.recados.criar.useMutation({
    onSuccess: () => {
      setFeedback({ tipo: 'ok', texto: 'Recado enviado.' });
      setTitulo('');
      setMensagem('');
      refetch();
    },
    onError: (e) => setFeedback({ tipo: 'erro', texto: e.message }),
  });

  const editarMutation = trpc.recados.editar.useMutation({
    onSuccess: () => { setEditando(null); refetch(); utils.recados.getPendente.invalidate(); },
  });

  const desativarMutation = trpc.recados.desativar.useMutation({
    onSuccess: () => refetch(),
  });

  return (
    <>
      {/* Formulário de novo recado */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <h2 className="text-sm font-semibold text-foreground">Novo recado</h2>

        <div className="space-y-1">
          <label className={labelCls}>Título</label>
          <input type="text" value={titulo}
            onChange={e => { setTitulo(e.target.value); setFeedback(null); }}
            placeholder="Ex: Atualização no sistema, Aviso importante..."
            className={inputCls} />
        </div>

        <div className="space-y-1">
          <label className={labelCls}>Mensagem</label>
          <textarea value={mensagem}
            onChange={e => { setMensagem(e.target.value); setFeedback(null); }}
            placeholder="Digite o recado para toda a equipe..."
            rows={4} className={`${inputCls} resize-none`} />
        </div>

        {feedback && (
          <p className={`text-xs ${feedback.tipo === 'ok' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
            {feedback.texto}
          </p>
        )}

        <button
          onClick={() => { if (titulo.trim() && mensagem.trim()) criarMutation.mutate({ titulo: titulo.trim(), mensagem: mensagem.trim() }); }}
          disabled={!titulo.trim() || !mensagem.trim() || criarMutation.isPending}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          <Send size={14} />
          {criarMutation.isPending ? 'Enviando...' : 'Enviar recado'}
        </button>
      </div>

      {/* Histórico */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Histórico de recados</h2>
        {historico.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">Nenhum recado enviado ainda.</p>
        ) : (
          historico.map(r => (
            <div key={r.id}
              className={`rounded-xl border p-4 space-y-2 ${r.ativo ? 'border-primary/30 bg-primary/5' : 'border-border bg-muted/30 opacity-60'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    {r.ativo
                      ? <Bell size={13} className="text-primary shrink-0" />
                      : <BellOff size={13} className="text-muted-foreground shrink-0" />}
                    <p className="text-sm font-semibold text-foreground">{r.titulo}</p>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><User size={10} />{r.autorNome ?? r.autorEmail}</span>
                    <span className="flex items-center gap-1"><Clock size={10} />{formatarData(r.criadoEm)}</span>
                    <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${r.ativo ? 'bg-green-100 dark:bg-green-950/50 text-green-700 dark:text-green-300' : 'bg-muted text-muted-foreground'}`}>
                      {r.ativo ? 'Ativo' : 'Desativado'}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {editando?.id !== r.id && (
                    <button onClick={() => setEditando({ id: r.id, titulo: r.titulo, mensagem: r.mensagem })}
                      className="flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-border text-muted-foreground hover:bg-muted transition-colors">
                      <Pencil size={11} /> Editar
                    </button>
                  )}
                  {r.ativo ? (
                    <button onClick={() => desativarMutation.mutate({ id: r.id })} disabled={desativarMutation.isPending}
                      className="text-xs px-2 py-1 rounded-md border border-border text-muted-foreground hover:bg-muted transition-colors">
                      Desativar
                    </button>
                  ) : null}
                </div>
              </div>

              {editando?.id === r.id ? (
                <div className="space-y-2 pt-1">
                  <input type="text" value={editando.titulo}
                    onChange={e => setEditando({ ...editando, titulo: e.target.value })} className={inputCls} />
                  <textarea value={editando.mensagem} rows={4}
                    onChange={e => setEditando({ ...editando, mensagem: e.target.value })} className={`${inputCls} resize-y`} />
                  <p className="text-xs text-muted-foreground">
                    Quem já clicou em "Ciente" não verá o recado de novo. Para reexibir a todos, envie um recado novo.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => editarMutation.mutate({ id: editando.id, titulo: editando.titulo.trim(), mensagem: editando.mensagem.trim() })}
                      disabled={!editando.titulo.trim() || !editando.mensagem.trim() || editarMutation.isPending}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50">
                      <Save size={12} /> {editarMutation.isPending ? 'Salvando...' : 'Salvar'}
                    </button>
                    <button onClick={() => setEditando(null)}
                      className="px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:bg-muted">
                      Cancelar
                    </button>
                  </div>
                  {editarMutation.error && <p className="text-xs text-red-600 dark:text-red-400">{editarMutation.error.message}</p>}
                </div>
              ) : (
                <p className="text-sm text-foreground whitespace-pre-wrap">{r.mensagem}</p>
              )}
            </div>
          ))
        )}
      </div>
    </>
  );
}

// ─── Seção 2: Legenda e limites ───────────────────────────────────────────────
// Os limites ficam como texto no formulário (aceita "4,5" ou "4.5") e viram
// número só ao salvar.
type Rascunho = Omit<LegendaConfig, 'filaCotas' | 'index'> & {
  filaCotas: Omit<LegendaConfig['filaCotas'], 'limite'> & { limite: string };
  index: Omit<LegendaConfig['index'], 'critico' | 'alto' | 'atencao'> & { critico: string; alto: string; atencao: string };
};

const numTxt = (n: number) => String(n).replace('.', ',');
const paraRascunho = (c: LegendaConfig): Rascunho => ({
  ...c,
  filaCotas: { ...c.filaCotas, limite: numTxt(c.filaCotas.limite) },
  index: { ...c.index, critico: numTxt(c.index.critico), alto: numTxt(c.index.alto), atencao: numTxt(c.index.atencao) },
  termos: c.termos.map(t => ({ ...t })),
});
const txtNum = (s: string) => parseFloat(s.replace(',', '.'));
const doRascunho = (r: Rascunho): LegendaConfig => ({
  ...r,
  filaCotas: { ...r.filaCotas, limite: txtNum(r.filaCotas.limite) },
  index: { ...r.index, critico: txtNum(r.index.critico), alto: txtNum(r.index.alto), atencao: txtNum(r.index.atencao) },
});

function SecaoLegenda() {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.configPortal.getLegenda.useQuery();
  const salva = data?.config ?? LEGENDA_PADRAO;

  const [r, setR] = useState<Rascunho>(() => paraRascunho(salva));
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [confirmarPadrao, setConfirmarPadrao] = useState(false);

  // Quando a configuração salva chega do servidor, carrega no formulário
  useEffect(() => { setR(paraRascunho(salva)); }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const aposSalvar = (texto: string) => {
    setMsg({ tipo: 'ok', texto });
    utils.configPortal.getLegenda.invalidate();
  };
  const salvarMutation = trpc.configPortal.salvarLegenda.useMutation({
    onSuccess: () => aposSalvar('Legenda e limites salvos. As tabelas e a aba Início já usam os novos valores.'),
    onError: e => setMsg({ tipo: 'erro', texto: e.message }),
  });
  const restaurarMutation = trpc.configPortal.restaurarLegenda.useMutation({
    onSuccess: () => { setConfirmarPadrao(false); aposSalvar('Padrão restaurado.'); },
    onError: e => setMsg({ tipo: 'erro', texto: e.message }),
  });

  const salvar = () => {
    const cfg = normalizarLegenda(doRascunho(r));
    // números inválidos voltam ao padrão em normalizarLegenda — avisar antes disso
    const nums = [r.filaCotas.limite, r.index.critico, r.index.alto, r.index.atencao];
    if (nums.some(n => !Number.isFinite(txtNum(n)))) {
      setMsg({ tipo: 'erro', texto: 'Preencha todos os limites com números (ex.: 4 ou 4,5).' });
      return;
    }
    const erro = validarLegenda(cfg);
    if (erro) { setMsg({ tipo: 'erro', texto: erro }); return; }
    salvarMutation.mutate({ config: cfg });
  };

  const setFC = (campo: keyof Rascunho['filaCotas'], v: string) => { setMsg(null); setR(p => ({ ...p, filaCotas: { ...p.filaCotas, [campo]: v } })); };
  const setIX = (campo: keyof Rascunho['index'], v: string) => { setMsg(null); setR(p => ({ ...p, index: { ...p.index, [campo]: v } })); };
  const setTermo = (i: number, campo: 'termo' | 'descricao', v: string) => {
    setMsg(null);
    setR(p => ({ ...p, termos: p.termos.map((t, j) => j === i ? { ...t, [campo]: v } : t) }));
  };

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando...</p>;

  const faixa = (cor: string, rotulo: string, limite: keyof Rascunho['index'] | null, frase: keyof Rascunho['index'], prefixo = '>') => (
    <div className={`rounded-lg border p-3 space-y-2 ${cor}`}>
      <div className="flex items-center gap-2 text-sm font-semibold">
        {rotulo} {prefixo}
        {limite ? (
          <input value={r.index[limite]} onChange={e => setIX(limite, e.target.value)} inputMode="decimal"
            className="w-20 text-sm px-2 py-1 rounded-md border border-border bg-background text-foreground" />
        ) : <span>{r.index.atencao}</span>}
      </div>
      <textarea value={r.index[frase]} onChange={e => setIX(frase, e.target.value)} rows={2} className={`${inputCls} resize-y`} />
    </div>
  );

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Estes textos aparecem na seção "Aprenda a interpretar..." da aba <strong>Início</strong>. Os <strong>limites</strong> definem
        os destaques de Fila/Cotas e Index em todas as tabelas do portal e a frase de alerta do check-in.
        A cor da linha que vem da planilha não muda por aqui.
        {data && <> Última alteração: {formatarData(data.atualizadoEm)}{data.atualizadoPor ? ` por ${data.atualizadoPor}` : ''}.</>}
        {!data && <> Usando os valores padrão.</>}
      </p>

      {/* Título */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Cabeçalho da seção</h2>
        <div className="space-y-1">
          <label className={labelCls}>Título</label>
          <input value={r.titulo} onChange={e => { setMsg(null); setR(p => ({ ...p, titulo: e.target.value })); }} className={inputCls} />
        </div>
        <div className="space-y-1">
          <label className={labelCls}>Subtítulo</label>
          <textarea value={r.subtitulo} rows={2} onChange={e => { setMsg(null); setR(p => ({ ...p, subtitulo: e.target.value })); }} className={`${inputCls} resize-y`} />
        </div>
      </div>

      {/* Fila/Cotas */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Fila/Cotas — limite e frases</h2>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Limite:</span>
          <input value={r.filaCotas.limite} onChange={e => setFC('limite', e.target.value)} inputMode="decimal"
            className="w-20 text-sm px-2 py-1 rounded-md border border-border bg-background text-foreground" />
          <span className="text-xs text-muted-foreground">(padrão {numTxt(LEGENDA_PADRAO.filaCotas.limite)})</span>
        </div>
        <div className="rounded-lg border p-3 space-y-2 bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800">
          <div className="text-sm font-semibold text-emerald-900 dark:text-emerald-100">⏩ Fila/Cotas ≤ {r.filaCotas.limite}</div>
          <textarea value={r.filaCotas.fraseBaixa} onChange={e => setFC('fraseBaixa', e.target.value)} rows={2} className={`${inputCls} resize-y`} />
        </div>
        <div className="rounded-lg border p-3 space-y-2 bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800">
          <div className="text-sm font-semibold text-amber-900 dark:text-amber-100">⚠️ Fila/Cotas &gt; {r.filaCotas.limite}</div>
          <textarea value={r.filaCotas.fraseAlta} onChange={e => setFC('fraseAlta', e.target.value)} rows={3} className={`${inputCls} resize-y`} />
        </div>
      </div>

      {/* Index */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Index — limites e frases</h2>
        <p className="text-xs text-muted-foreground">
          Os limites precisam ser decrescentes (crítico &gt; alto &gt; atenção). Padrão: {numTxt(LEGENDA_PADRAO.index.critico)} / {numTxt(LEGENDA_PADRAO.index.alto)} / {numTxt(LEGENDA_PADRAO.index.atencao)}.
        </p>
        {faixa('bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800 text-red-900 dark:text-red-100', 'Crítico (vermelho): Index', 'critico', 'fraseCritico')}
        {faixa('bg-orange-50 dark:bg-orange-950/30 border-orange-200 dark:border-orange-800 text-orange-900 dark:text-orange-100', 'Alto (laranja): Index', 'alto', 'fraseAlto')}
        {faixa('bg-yellow-50 dark:bg-yellow-950/30 border-yellow-200 dark:border-yellow-800 text-yellow-900 dark:text-yellow-100', 'Atenção (amarelo): Index', 'atencao', 'fraseAtencao')}
        {faixa('bg-muted border-border text-foreground', 'Sem destaque: Index', null, 'fraseNormal', '≤')}
      </div>

      {/* Termos */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Descrição de cada coluna</h2>
        {r.termos.map((t, i) => (
          <div key={t.id} className="grid grid-cols-1 md:grid-cols-[150px_1fr] gap-2 border-t border-border pt-3 first:border-t-0 first:pt-0">
            <input value={t.termo} onChange={e => setTermo(i, 'termo', e.target.value)}
              className="text-sm font-semibold px-2 py-1.5 rounded-md border border-border bg-background text-foreground h-fit" />
            <textarea value={t.descricao} onChange={e => setTermo(i, 'descricao', e.target.value)} rows={3} className={`${inputCls} resize-y`} />
          </div>
        ))}
      </div>

      {/* Ações */}
      <div className="sticky bottom-0 bg-background/95 backdrop-blur border-t border-border py-3 flex flex-wrap items-center gap-2">
        <button onClick={salvar} disabled={salvarMutation.isPending}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
          <Save size={14} /> {salvarMutation.isPending ? 'Salvando...' : 'Salvar alterações'}
        </button>
        <button onClick={() => { setR(paraRascunho(salva)); setMsg(null); }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted">
          <Undo2 size={14} /> Descartar alterações
        </button>
        {confirmarPadrao ? (
          <span className="flex items-center gap-2 text-sm">
            Voltar tudo ao padrão?
            <button onClick={() => restaurarMutation.mutate()} disabled={restaurarMutation.isPending}
              className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-medium hover:bg-red-700 disabled:opacity-50">Sim, restaurar</button>
            <button onClick={() => setConfirmarPadrao(false)} className="px-3 py-1.5 rounded-lg border border-border text-xs">Cancelar</button>
          </span>
        ) : (
          <button onClick={() => setConfirmarPadrao(true)} disabled={!data}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted disabled:opacity-40"
            title={data ? 'Apaga a configuração salva e volta aos textos e limites originais' : 'Já está usando o padrão'}>
            <RotateCcw size={14} /> Restaurar padrão
          </button>
        )}
        {msg && (
          <span className={`text-sm ${msg.tipo === 'ok' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{msg.texto}</span>
        )}
      </div>
    </div>
  );
}
