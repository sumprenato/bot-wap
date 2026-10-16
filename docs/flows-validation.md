# Auditoria local dos fluxos — 16/10/2026

A revisão cobriu os **28 tipos de bloco**, editor, gerenciamento, publicação, simulador, gatilhos, variáveis, histórico, permissões e persistência. Os testes usam contas e bancos temporários, Chrome com Playwright e PostgreSQL 18 local isolado. Conforme solicitado, não houve acesso à Railway.

## Correção de Interromper, pausa e atendimento humano

A reprodução posterior encontrou três falhas que os testes iniciais não cobriam: Interromper encerrava a execução, mas uma mensagem com outro ID iniciava outra; pausa/desativação só filtravam novos gatilhos; atribuição a um atendente não bloqueava a automação em andamento.

O bloco Interromper agora grava uma interrupção persistente na conversa do chip. Novas mensagens não iniciam automações até usar **Mais opções → Reativar automação** ou reabrir o atendimento. Conversas atribuídas, bloqueadas ou finalizadas também não iniciam nem retomam respostas automáticas. Pausar/desligar e atribuir/assumir pelo sistema encerram as esperas abertas sem exigir nova mensagem do cliente. Execuções já em andamento revalidam o controle antes dos próximos blocos/efeitos.

O envio automático leva o ID da execução até o worker. Ao sair da fila, o worker confere a conversa e consulta o coordenador novamente. Recusas comprovadas antes do transporte encerram a automação sem marcar entrega incerta nem impedir respostas manuais. Mensagens cuja transmissão já começou não podem ser recolhidas por essa verificação.

Foram adicionados testes para mensagens novas após Interromper, reativação explícita, pausa/desativação durante pergunta ou temporizador, pausa/atribuição entre mensagens sequenciais, cancelamento imediato pelos endpoints e envio automático aguardando na fila. O teste com worker real usa Baileys controlado e verifica o caminho completo de recebimento, outbox/inbox, execução, autorização por IPC e transporte. O navegador verifica os estados da conversa, reativação persistente pela API e resposta manual com responsável atribuído.

Logs desta correção: `.tmp/flow-handoff-all.log`, `.tmp/flow-handoff-controls.log`, `.tmp/flow-handoff-worker.log`, `.tmp/flow-handoff-postgres.log`, `.tmp/flow-handoff-ui.log`, `.tmp/flow-handoff-editor.log` e `.tmp/flow-handoff-editors.log`. `flow-handoff-baseline.log` registra a reprodução dos quatro casos antes das correções.

## Cobertura

| Área | Verificações |
| --- | --- |
| Início e início por gatilho | Validação, execução, edição e proteção contra exclusão da raiz |
| Texto e quatro mídias | Mensagens sequenciais, interpolação, upload, legendas, armazenamento e contrato de envio; edição durante upload |
| Menu numérico, botões e resposta rápida | Opções, seleção por ID/texto, tentativas, repetição, timeout e opções ambíguas |
| Pergunta e espera | Texto, número, data e escolha; respostas inválidas, prazo, reinício e isolamento entre contatos |
| Condição, chip, tag e horário | Operadores, E/OU, estado do chip, tags, virada de dia/semana, feriados e exceções |
| Variável, switch, randomizador e script | Cinco tipos, valores aninhados, probabilidades, saídas explícitas, QuickJS real e limites |
| HTTP | Métodos, JSON com caracteres escapados, tipos, mapeamento, credencial do servidor, política DNS/IP e recusa de redirecionamentos |
| Distribuição | Sequência, aleatório e menor carga com adaptador real; departamento, elegibilidade, permissões e capacidade |
| Transferência, tags, oportunidade e finalização | Departamento/fluxo publicado de destino, padrões do destino, tags, etapa e histórico CRM, encerramento |
| Temporizador e interrupção | Unidades, data literal/dinâmica, limite de 30 dias, relógio após efeitos demorados, persistência e cancelamento |
| Gerenciamento | Criar, pesquisar, importar/exportar, duplicar com novos IDs, excluir com confirmação, ativar/pausar e controlar gatilhos |
| Canvas | Arraste, conexão/reconexão/desconexão, zoom, seleção múltipla, copiar/colar, duplicar/excluir, desfazer/refazer e atalhos; grafo de 501 blocos |
| Aparência | Tela inteira, restauração do site ao fechar, temas claro/escuro, celular, notificações e confirmações |
| Salvamento | Revisões, conflito HTTP 409, publicação imutável, chips da versão publicada, autosave, JSON inválido e recuperação local |
| Variáveis | Criar/editar/excluir pelos formulários globais e da execução; texto, decimal/zero, falso, data, objetos/listas/null |
| Gatilhos | Oito tipos, três correspondências de palavra-chave, prioridade/desempate, ativação, adicionar/excluir, fuso e escopo de chips; eventos autenticados sem duplicação |
| Histórico | Detalhes, logs e variáveis; encerrar; listar/carregar versões e revisões como rascunho; redefinir alterações |
| Autorização | Proprietário/leitor, isolamento de contas/departamentos, recursos externos ao escopo e permissão revogada durante espera |
| Recuperação e WhatsApp | Inbox/outbox, eventos repetidos, reinício completo, reconexão, recusa antes de transmitir, entrega incerta, fila, payload persistido para retries e ausência de assinatura automática |
| Funcionalidade removida | Ausência de Padrão/Erro e do bloco de tratamento; adaptação de grafos antigos e interrupção sem saída correspondente |

Express, autenticação, bancos, intérprete, filas e adaptadores do sistema são exercitados nos testes de integração. O transporte WhatsApp é controlado, permitindo verificar os efeitos sem enviar mensagens a pessoas.

## Correções desta auditoria

1. Horários que atravessam meia-noite consideram o dia de abertura, feriados e exceções.
2. Interpolação HTTP percorre os valores do JSON. Aspas, quebras de linha e barras dos dados não quebram a requisição.
3. Chips autorizados acompanham a versão publicada. Alterar o rascunho não muda o alcance da automação em uso.
4. Retomada após recusa comprovada antes do envio restaura o estado do bloco, preservando mensagens confirmadas, histórico e tentativas de resposta.
5. Distribuição considera o departamento de destino configurado para avaliar os atendentes.
6. Publicação rejeita configurações incompletas, opções ambíguas, escolhas vazias, capacidade fracionária e temporizadores inválidos.
7. A conclusão de uploads conserva edições feitas durante o envio, inclusive a legenda.
8. JSON inválido impede salvar/publicar, em vez de confirmar silenciosamente o último valor válido.
9. Transferência entre fluxos inicializa padrões do destino e conserva valores já coletados.
10. Opções no simulador recebem a mesma interpolação do texto enviado.
11. Texto vazio após interpolação é recusado antes de reservar um envio.
12. Padrões JSON são copiados por execução, preservam null e não compartilham objetos entre clientes.
13. Variáveis respeitam seus tipos. Atribuições recusam número vazio, data impossível e JSON/booleano inválido; temporizadores continuam aceitando datas por variável.
14. O relógio é atualizado antes de cada bloco real: efeitos demorados não encurtam o temporizador seguinte.
15. Retomadas verificam também o acesso ao fluxo de destino.
16. Encerrar limpa retries de reconexão e entradas pendentes, com atualização condicional para recusar encerramento durante operação em andamento. Estados parados, bloqueados ou com falha não permanecem agendados por um retry antigo.
17. Controles de variáveis receberam nomes acessíveis e aceitam números decimais.
18. Grafos recebidos pela API sem o tipo visual do nó passam a usar o componente correto do editor, inclusive ao carregar versões antigas.

## Execuções e evidências

| Comando | Resultado |
| --- | --- |
| `npm test` | **172 aprovados, 0 falhas, 0 ignorados**, em aproximadamente 52 segundos; log `flow-handoff-all.log` |
| `npm run test:flows` | Suíte específica, incluindo contratos de envio/retry; também executada pela bateria completa |
| `npm run test:flows:postgres` | **30 aprovados, 0 falhas**: 14 de API e 16 de execução persistente; PostgreSQL 18 real, cluster e duas bases temporárias; log `flow-handoff-postgres.log` |
| `npm run test:flows:ui` | **Passou** — Chrome: canvas, CRUD, publicação, importação/exportação, simulador, 501 blocos, temas, celular e tela inteira |
| `npm run test:flows:audit` | **Passou** — Chrome: 28 painéis, arquivos, variáveis, gatilhos, histórico, restauração e recuperação |
| `npm run test:flows:handoff` | **Passou** — Chrome: estado interrompido/humano, reativação e envio manual |
| `npm run test:ui` | **Passou** — 12 páginas em desktop/celular, navegação, sessão e integrações existentes |
| `npm run test:access` | **Passou** — editor de permissões, concessão/revogação ao vivo, rotas e temas |
| `npm run test:modals` | **Passou** — confirmações, foco/teclado, sobreposição, formulários e descarte |
| `npm run build` | **Passou** — arquivos servidos pelo site recompilados |
| Prettier e `git diff --check` nos arquivos revisados | **Passaram**; espaços preexistentes em `public/app.js` e `public/dashboard.html` não foram alterados |

Logs em `.tmp/`: `flow-audit-full-test.log`, `flow-audit-focused.log`, `flow-audit-postgres.log`, `flow-audit-editor.log`, `flow-audit-inspectors.log`, `flow-audit-pages.log`, `flow-audit-access.log`, `flow-audit-modals.log` e `flow-audit-build.log`. Dados temporários são removidos pelos runners; logs/capturas permanecem para consulta.

O runner PostgreSQL requer `initdb` e `pg_ctl`. No Windows detecta a instalação padrão da versão 18; outro caminho pode ser informado em `POSTGRES_BIN`. Usa uma porta livre de `127.0.0.1` e não modifica os servidores PostgreSQL existentes.

## Limites

- A entrega e a leitura em celulares reais não foram verificadas. O desaparecimento de “Aguardando mensagem” precisa ser confirmado em conversa real; localmente foram verificados fila, payload original, bytes criptográficos e recuperação de retries.
- Mídias foram verificadas por tipo/assinatura, armazenamento e contrato de envio. As amostras sintéticas de áudio/vídeo não comprovam codec, reprodução ou transcodificação pelo WhatsApp.
- HTTP usa transporte controlado nos testes, com verificações da política de segurança. Integrações externas específicas precisam de homologação com suas credenciais e serviço.
- Botões/respostas rápidas usam fallback numérico no Baileys. O projeto não possui um estado separado de presença online de atendentes.
- Não houve deploy, acesso à Railway, envio a clientes, atualização ampla de dependências, benchmark de conversas ou homologação de múltiplos coordenadores em produção.

As alterações preexistentes na árvore de trabalho foram preservadas. O manual operacional está em [flows.md](flows.md).
