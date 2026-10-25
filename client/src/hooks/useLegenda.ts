/**
 * useLegenda — legenda do portal + limites das sinalizações (Fila/Cotas e Index).
 *
 * Lê a configuração salva pelos administradores na aba "Recados e Legenda".
 * Enquanto carrega, ou se nada foi salvo, devolve LEGENDA_PADRAO — então as
 * tabelas nunca ficam sem destaque. O React Query compartilha uma única
 * requisição entre todos os componentes que usam o hook.
 */
import { useMemo } from 'react';
import { trpc } from '@/lib/trpc';
import { LEGENDA_PADRAO, type LegendaConfig } from '@shared/legenda';

export function useLegenda(): LegendaConfig {
  const { data } = trpc.configPortal.getLegenda.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
  return useMemo(() => data?.config ?? LEGENDA_PADRAO, [data]);
}
