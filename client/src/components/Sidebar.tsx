import { useState, useRef, useEffect, useCallback } from 'react';
import { Menu, X, BarChart3, Table2, FolderOpen, Home, LogOut, UserCircle2, Sun, Moon, ClipboardList, Activity, RefreshCw, Users, Link2, TrendingDown, Sparkles, LogIn, Database, MessageSquare, BookOpen } from 'lucide-react';
import { Link } from 'wouter';
import { useRegulador } from '@/contexts/ReguladorContext';
import { useTheme } from '@/contexts/ThemeContext';
import { trpc } from '@/lib/trpc';

interface SidebarProps {
  currentPage: string;
  onToggle?: (isOpen: boolean) => void;
}

// Mapa de label amigável para cada perfil
const PERFIL_LABELS: Record<string, string> = {
  regulador: 'Regulador',
  monitoramento: 'Monitoramento',
  administrador: 'Administrador',
};

function perfilLabel(perfil: string | null): string {
  if (!perfil) return '';
  return PERFIL_LABELS[perfil.toLowerCase()] ?? (perfil.charAt(0).toUpperCase() + perfil.slice(1).toLowerCase());
}

export default function Sidebar({ currentPage, onToggle }: SidebarProps) {
  const [isOpen, setIsOpen] = useState(true);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const { regulador, perfilAtivo, perfisDisponiveis, temMultiplosPerfis, trocarPerfil } = useRegulador();
  const { theme, toggleTheme } = useTheme();
  const clearCheckInsMutation = trpc.checkIns.clearMeus.useMutation();

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      window.location.href = '/';
    },
  });

  const handleLogout = async () => {
    try {
      await clearCheckInsMutation.mutateAsync();
    } catch {
      // Ignorar erros ao limpar check-ins
    }
    logoutMutation.mutate();
  };

  const setOpen = useCallback((value: boolean) => {
    setIsOpen(value);
    onToggle?.(value);
  }, [onToggle]);

  // Inicia o timer de 3s para recolher quando o cursor sai do sidebar
  const handleMouseLeave = useCallback(() => {
    if (!isOpen) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setOpen(false), 3000);
  }, [isOpen, setOpen]);

  // Cancela o timer enquanto o cursor estiver sobre o sidebar
  const handleMouseEnter = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  // Limpar timer ao desmontar
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const toggleSidebar = () => setOpen(!isOpen);

  // Visibilidade do Monitor de Check-ins: regulador, consultor, monitoramento ou administrador
  const isAdminOrMonitor =
    perfilAtivo === 'monitoramento' ||
    perfilAtivo === 'administrador' ||
    perfilAtivo === 'regulador' ||
    perfilAtivo === 'consultor' ||
    (!perfilAtivo && (
      regulador?.perfil?.toLowerCase() === 'administrador' ||
      regulador?.perfil?.toLowerCase() === 'monitoramento' ||
      regulador?.perfil?.toLowerCase() === 'regulador' ||
      regulador?.perfil?.toLowerCase() === 'consultor'
    ));

  const isAdminOrMonitorOnly =
    perfilAtivo === 'monitoramento' ||
    perfilAtivo === 'administrador' ||
    (!perfilAtivo && (
      regulador?.perfil?.toLowerCase() === 'administrador' ||
      regulador?.perfil?.toLowerCase() === 'monitoramento'
    ));

  const navItems = [
    // Início visível para todos os perfis. Usa /inicio (e não /) porque o regulador puro
    // continua sendo redirecionado de / para Minhas Agendas ao entrar no portal.
    { href: '/inicio', page: 'inicio', icon: Home, label: 'Início', visible: true },
    { href: '/regulacao', page: 'regulacao', icon: Table2, label: 'Lista de agendas', visible: true },
    { href: '/minhas-agendas', page: 'minhas-agendas', icon: ClipboardList, label: 'Minhas Agendas', visible: true },
    { href: '/monitor-checkins', page: 'monitor-checkins', icon: Activity, label: 'Monitor de Check-ins', visible: isAdminOrMonitor },
    { href: '/reguladores', page: 'reguladores', icon: Users, label: 'Reguladores', visible: true },
    { href: '/condutas-gercon', page: 'condutas-gercon', icon: BookOpen, label: 'Condutas para Consultorias', visible: perfilAtivo === 'administrador' || perfilAtivo === 'consultor' || (!perfilAtivo && (regulador?.perfil ?? '').toLowerCase().includes('administrador')) || (!perfilAtivo && (regulador?.perfil ?? '').toLowerCase().includes('consultor')) },
    { href: '/agendas-relacionadas', page: 'agendas-relacionadas', icon: Link2, label: 'Agendas Relacionadas', visible: isAdminOrMonitorOnly },
    { href: '/novas-agendas', page: 'novas-agendas', icon: Sparkles, label: 'Novas Agendas', visible: isAdminOrMonitorOnly },
    { href: '/monitor-logins', page: 'monitor-logins', icon: LogIn, label: 'Monitor de Logins', visible: isAdminOrMonitorOnly },
    { href: '/uso-portal', page: 'uso-portal', icon: Activity, label: 'Uso do Portal', visible: isAdminOrMonitorOnly },
    { href: '/previa-pg', page: 'previa-pg', icon: Database, label: 'Prévia PG', visible: perfilAtivo === 'administrador' || (!perfilAtivo && (regulador?.perfil ?? '').toLowerCase().includes('administrador')) },
    { href: '/teste-plataforma-backend', page: 'teste-plataforma-backend', icon: Database, label: 'Teste Plataforma Backend', visible: perfilAtivo === 'administrador' || (!perfilAtivo && (regulador?.perfil ?? '').toLowerCase().includes('administrador')) },
    { href: '/recados', page: 'recados', icon: MessageSquare, label: 'Recados e Legenda', visible: perfilAtivo === 'administrador' || (!perfilAtivo && (regulador?.perfil ?? '').toLowerCase().includes('administrador')) },
    { href: '/sem-cotas', page: 'sem-cotas', icon: TrendingDown, label: 'Sem Cotas', visible: isAdminOrMonitorOnly },
    { href: '/documentos', page: 'documentos', icon: FolderOpen, label: 'Documentos', visible: true },
  ].filter(item => item.visible);

  // Dropdown de perfis (suporta 2 ou mais perfis)
  const [perfilDropdownAberto, setPerfilDropdownAberto] = useState(false);
  const perfisAlternativos = temMultiplosPerfis
    ? perfisDisponiveis.filter(p => p !== perfilAtivo)
    : [];

  return (
    <div
      className={`relative h-screen bg-gradient-to-b from-slate-900 to-slate-800 text-white transition-all duration-300 ease-in-out z-40 flex flex-col shrink-0 ${
        isOpen ? 'w-64' : 'w-16'
      }`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Header */}
      <div className={`flex items-center h-16 border-b border-slate-700 shrink-0 ${isOpen ? 'justify-between px-4' : 'justify-center px-2'}`}>
        {isOpen && (
          <h1 className="text-base font-bold truncate">Portal Monitoramento</h1>
        )}
        <button
          onClick={toggleSidebar}
          className="p-2 hover:bg-slate-700 rounded-lg transition-colors"
          title={isOpen ? 'Recolher menu' : 'Expandir menu'}
        >
          {isOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto">
        {navItems.map(({ href, page, icon: Icon, label }) => (
          <Link
            key={page}
            href={href}
            className={`flex items-center rounded-lg transition-colors ${
              isOpen ? 'gap-3 px-4 py-3' : 'justify-center px-2 py-3'
            } ${
              currentPage === page
                ? 'bg-blue-600 text-white'
                : 'text-slate-300 hover:bg-slate-700'
            }`}
            title={!isOpen ? label : undefined}
          >
            <Icon size={20} className="flex-shrink-0" />
            {isOpen && (
              <span className="text-sm font-medium leading-tight truncate">{label}</span>
            )}
          </Link>
        ))}
      </nav>

      {/* Footer — perfil do usuário + tema */}
      <div className="border-t border-slate-700 shrink-0">
        {isOpen ? (
          <div className="px-4 py-4 space-y-3">
            {/* Informações do regulador */}
            {regulador ? (
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center shrink-0">
                  <UserCircle2 size={20} className="text-white" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-white truncate leading-tight">
                    {regulador.nome}
                  </p>
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    {perfilAtivo && (
                      <span className="inline-block text-xs font-medium px-2 py-0.5 rounded-full bg-blue-600/30 text-blue-300 border border-blue-500/30">
                        {perfilLabel(perfilAtivo)}
                      </span>
                    )}
                    {/* Seletor de perfil — visível para usuários com múltiplos perfis */}
                    {temMultiplosPerfis && perfisAlternativos.length > 0 && (
                      <div className="relative">
                        {perfisAlternativos.length === 1 ? (
                          // Apenas 2 perfis: botão simples de alternância
                          <button
                            onClick={() => trocarPerfil(perfisAlternativos[0])}
                            className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-slate-700 text-slate-300 border border-slate-600 hover:bg-slate-600 hover:text-white transition-colors"
                            title={`Trocar para ${perfilLabel(perfisAlternativos[0])}`}
                          >
                            <RefreshCw size={10} className="shrink-0" />
                            {perfilLabel(perfisAlternativos[0])}
                          </button>
                        ) : (
                          // 3+ perfis: dropdown
                          <>
                            <button
                              onClick={() => setPerfilDropdownAberto(v => !v)}
                              className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-slate-700 text-slate-300 border border-slate-600 hover:bg-slate-600 hover:text-white transition-colors"
                              title="Trocar perfil"
                            >
                              <RefreshCw size={10} className="shrink-0" />
                              Trocar perfil
                            </button>
                            {perfilDropdownAberto && (
                              <div className="absolute bottom-7 left-0 z-50 bg-slate-800 border border-slate-600 rounded-lg shadow-lg py-1 min-w-[140px]">
                                {perfisAlternativos.map(p => (
                                  <button
                                    key={p}
                                    onClick={() => { trocarPerfil(p); setPerfilDropdownAberto(false); }}
                                    className="w-full text-left px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
                                  >
                                    {perfilLabel(p)}
                                  </button>
                                ))}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-slate-700 flex items-center justify-center shrink-0">
                  <UserCircle2 size={20} className="text-slate-400" />
                </div>
                <p className="text-xs text-slate-400">Carregando perfil...</p>
              </div>
            )}

            {/* Linha de ações: tema + sair */}
            <div className="flex items-center gap-2">
              {/* Botão de alternância de tema */}
              {toggleTheme && (
                <button
                  onClick={toggleTheme}
                  className="flex items-center gap-2 flex-1 px-3 py-2 text-xs text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
                  title={theme === 'dark' ? 'Mudar para modo claro' : 'Mudar para modo escuro'}
                >
                  {theme === 'dark' ? (
                    <>
                      <Sun size={14} className="shrink-0 text-yellow-400" />
                      <span>Modo claro</span>
                    </>
                  ) : (
                    <>
                      <Moon size={14} className="shrink-0 text-blue-300" />
                      <span>Modo escuro</span>
                    </>
                  )}
                </button>
              )}

              {/* Botão de sair */}
              <button
                onClick={handleLogout}
                disabled={logoutMutation.isPending || clearCheckInsMutation.isPending}
                className="flex items-center gap-2 px-3 py-2 text-xs text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
                title="Sair"
              >
                <LogOut size={14} className="shrink-0" />
                <span className="sr-only">{logoutMutation.isPending ? 'Saindo...' : 'Sair'}</span>
              </button>
            </div>
          </div>
        ) : (
          /* Sidebar recolhido — exibe apenas avatar, botão de troca (se houver), tema e sair */
          <div className="px-2 py-3 space-y-2 flex flex-col items-center">
            <div
              className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center cursor-default"
              title={regulador ? `${regulador.nome} — ${perfilLabel(perfilAtivo)}` : 'Usuário'}
            >
              <UserCircle2 size={20} className="text-white" />
            </div>

            {/* Botão compacto de troca de perfil (sidebar colapsado) */}
            {temMultiplosPerfis && perfisAlternativos.length > 0 && (
              <div className="relative">
                <button
                  onClick={() => {
                    if (perfisAlternativos.length === 1) {
                      trocarPerfil(perfisAlternativos[0]);
                    } else {
                      setPerfilDropdownAberto(v => !v);
                    }
                  }}
                  className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
                  title={perfisAlternativos.length === 1 ? `Trocar para ${perfilLabel(perfisAlternativos[0])}` : 'Trocar perfil'}
                >
                  <RefreshCw size={16} />
                </button>
                {perfilDropdownAberto && perfisAlternativos.length > 1 && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setPerfilDropdownAberto(false)} />
                    <div className="absolute left-full top-0 ml-2 z-50 bg-slate-800 border border-slate-600 rounded-lg shadow-lg py-1 min-w-[140px]">
                      {perfisAlternativos.map(p => (
                        <button
                          key={p}
                          onClick={() => { trocarPerfil(p); setPerfilDropdownAberto(false); }}
                          className="w-full text-left px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
                        >
                          {perfilLabel(p)}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Botão de tema compacto */}
            {toggleTheme && (
              <button
                onClick={toggleTheme}
                className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
                title={theme === 'dark' ? 'Mudar para modo claro' : 'Mudar para modo escuro'}
              >
                {theme === 'dark' ? (
                  <Sun size={16} className="text-yellow-400" />
                ) : (
                  <Moon size={16} className="text-blue-300" />
                )}
              </button>
            )}

            <button
              onClick={handleLogout}
              disabled={logoutMutation.isPending || clearCheckInsMutation.isPending}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
              title="Sair"
            >
              <LogOut size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
