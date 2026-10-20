# Domínio

O portal apoia a **regulação ambulatorial** do SUS no RS: priorizar quais
"agendas" (especialidade × central × município) devem ser reguladas primeiro,
para não perder consultas disponíveis. Os dados vêm da planilha Google e do
GERCON; o portal calcula/ordena indicadores e registra a atividade dos
reguladores (check-in, encaminhamento, conclusão).

## Perfis de acesso

O acesso exige login Google **e** que o e-mail exista na tabela `reguladores`
com `ativo = 'sim'` (procedure `auth.checkAccess`). O **perfil** vem do campo
`reguladores.perfil` (string, possivelmente composta, ex.: `"MONITORAMENTO, REGULADOR"`),
normalizado em [`client/src/contexts/ReguladorContext.tsx`](../client/src/contexts/ReguladorContext.tsx).

| Perfil | Visão |
|---|---|
| `regulador` | Suas agendas (por `grandeGrupo`/especialidades e, opcionalmente, uma whitelist de agendas) |
| `consultor` | Semelhante ao regulador; vê Condutas GERCON |
| `monitoramento` | Acesso irrestrito aos dados + telas de monitoramento |
| `administrador` | Tudo, incluindo configuração, recados e ferramentas de migração |

Usuários com múltiplos perfis têm um seletor de perfil persistido no
`localStorage`. A separação de menus e o escopo de dados por perfil são
aplicados no client ([`Sidebar.tsx`](../client/src/components/Sidebar.tsx),
[`Regulation.tsx`](../client/src/pages/Regulation.tsx)).

> Observação: a tabela `users.role` (`user`/`admin`) e o `adminProcedure`
> existem no servidor, mas a diferenciação de perfil em uso é a string
> `reguladores.perfil`.

## Entidades (schema MySQL)

Fonte: [`drizzle/schema.ts`](../drizzle/schema.ts). Tabelas principais:

### Dados de regulação (sincronizados)
- **`regulacao_data`** — a "lista de agendas": `agenda`, `municipio`, `central`,
  `especialidade`, `cotas`, `saldo`, `aguardando`, `autorizadas`, `aut_cotas`,
  `index_regula`, `aguardando_7d/28d/90d`, e flags/cores de destaque. Fonte: aba
  "Final" da planilha.
- **`regulacao_data_pg`** — espelho com a mesma estrutura, populado do PostgreSQL
  externo; **prévia da migração**, visível só para administradores.
- **`sem_cotas`** — agendas sem cotas, com flag `is_nova` (não existia no dia anterior).
- **`condutas_gercon`** — condutas/respostas-padrão por `especialidade` e `situacao`
  (`ciap_cid`, `conduta`, `referencias`). Fonte: Metabase.
- **`dicionario_especialidades`** — mapeia `agenda → especialidade`.
- **`prioridades`**, **`protocolos`** — listas de apoio (documentos/links).

### Usuários e autorização
- **`users`** — backing do login (`openId`, `email`, `role` `user|admin`).
- **`reguladores`** — usuários autorizados: `nome`, `perfil`, `grandeGrupo`,
  `agendas`, `email` (único), `ativo` (`sim|nao`).
- **`regulador_config`** — especialidades e agendas-filtro por regulador
  (gerenciado no portal).

### Atividade de regulação
- **`check_ins`** — check-in ativo numa agenda (quem está regulando agora).
  Limpo no check-out, no logout e automaticamente após 24h.
- **`agendas_concluidas`** — agendas marcadas como "Concluído" após um check-in.
- **`encaminhamentos`** — agenda encaminhada por admin/monitor a um regulador.
- **`agendas_favoritas`** — reaparecem diariamente em "Encaminhadas para mim".
- **`atividade_log`** — histórico **permanente** (somente inserção) de
  `checkin`/`conclusao` (necessário porque `check_ins` e `agendas_concluidas`
  podem ser apagadas).

### Configuração e comunicação
- **`agendas_relacionadas_config`**, **`agenda_protocolos`**, **`agenda_observacoes`** —
  configurações por agenda.
- **`recados`** / **`recados_lidos`** — comunicados do administrador à equipe.
- **`login_log`** — login/logout + `ultima_atividade_at` (heartbeat).
- **`sync_log`** / **`condutas_gercon_sync_log`** — histórico de sincronizações.

## Glossário (colunas da lista de agendas)

Texto da equipe de regulação (fonte: `LEGENDA` em
[`client/src/pages/Landing.tsx`](../client/src/pages/Landing.tsx)):

| Termo | Significado |
|---|---|
| **AGENDA** | Nome da agenda no GERCON. |
| **CENTRAL** | Central de regulação no GERCON. |
| **MUNICÍPIO** | Município que oferece a agenda, conforme regionalização do GERCON. Campo em branco = solicitações sem município (contabilizadas como município nulo). |
| **FILA/COTAS** | Razão entre casos (autorizados + aguardando) e cotas do mês. Quanto maior, mais o paciente demora para consultar. |
| **INDEX** | Cálculo (saldo do mês, aguardando regulação e autorizados) que sinaliza agendas com risco de perder consultas. |
| **> 7D / > 28D / > 90D** | Casos aguardando a 1ª regulação há mais de 7/28/90 dias. `> 28D` é meta pactuada com a SES/RS. |
| **COTAS** | Total de consultas na especialidade no mês (informado pelos prestadores; não varia no mês). |
| **SALDO** | Consultas ainda disponíveis no mês (diminui ao longo do mês). |
| **AGUARDANDO** | Casos em Aguardando Regulação, Reavaliação ou Reversão. |
| **AUTORIZADAS** | Casos Autorizados e com Autorização Automática. |

### Regionalização (mapa do RS)
`MapaRegioesSaude.tsx` organiza o estado em **30 regiões de saúde**, agrupadas em
**7 macrorregiões**, cada região com seu número de **CRS** (Coordenadoria Regional
de Saúde) e lista de municípios.

## Regras de negócio observadas

Referências diretas ao código:

- **Check-in com teto de 2 reguladores simultâneos** por agenda:
  `LIMITE_CHECKINS = 2` ([`server/routers.ts`](../server/routers.ts)); exceder
  retorna `{ bloqueado: true }`. A identidade da agenda é `agenda + municipio +
  central` (estável apesar de o sync recriar os IDs via DELETE+INSERT).
- **Auto-limpeza de check-ins:** ao fechar a aba
  (`navigator.sendBeacon('/api/checkins/clear')`, [`Home.tsx`](../client/src/pages/Home.tsx)),
  no logout, e por limpeza diária (> 24h) no boot do servidor.
- **Fila/Cotas:** limite 4 — ≤ 4 fluxo flexível; > 4 aplicar protocolo. As frases
  do alerta são reaproveitadas na legenda e no check-in
  ([`client/src/lib/corAgenda.ts`](../client/src/lib/corAgenda.ts)).
- **Limiares do INDEX:** `> 3` crítico (vermelho), `> 2` alta oferta (laranja),
  `> 1` priorizar após vermelho/laranja (amarelo), `≤ 1` seguir pelo tempo de
  espera (cinza) — `Landing.tsx` / `MinhasAgendas.tsx`.
- **Cor → prioridade de ordenação:** nomes de cor são convertidos em hex e numa
  ordem de prioridade para ordenar as linhas (`corAgenda.ts`). Parsing numérico
  pt-BR ("21,2" → 21.2).
- **Ordem das centrais:** CRA primeiro, depois 1CRS…18CRS (`Regulation.tsx`).
- **Conclusão persiste ao sync:** resolvida por JOIN em nome/município/central,
  para a agenda concluída sobreviver à recriação diária dos dados.
- **Heartbeat/sessão:** sinal a cada ~2 min, apenas com interação real e aba
  visível ([`useHeartbeat.ts`](../client/src/hooks/useHeartbeat.ts)); sessões
  ociosas são encerradas no servidor.
