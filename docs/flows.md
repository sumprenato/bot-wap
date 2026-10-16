# Construtor de fluxos de WhatsApp

O módulo usa o React, Express, sessões, RBAC, banco e workers Baileys existentes. Não cria contatos, chips ou departamentos de demonstração na base. O modelo de referência só é criado quando o usuário o solicita e permanece como rascunho até ser configurado e publicado.

## Como usar

1. Execute `npm install` e `npm run build`. Reinicie o backend com `npm start`. As migrações são executadas em `db.ready`, no banco configurado pelo projeto.
2. Abra **Fluxos**, em `/fluxos`, e clique em **Novo Fluxo**. Escolha um fluxo vazio ou o modelo de atendimento por horário.
3. Arraste blocos da biblioteca ou clique neles. Configure o bloco no painel direito. Conecte uma saída à entrada de outro bloco. Cada saída permite um destino; vários caminhos podem chegar à mesma entrada.
4. Use Shift + arrastar para selecionar uma área e Ctrl/Cmd + clique para selecionar vários blocos. Ctrl/Cmd+C/V copia e cola; Ctrl/Cmd+D duplica; Delete exclui; Ctrl/Cmd+Z e Ctrl/Cmd+Shift+Z desfazem e refazem. Ctrl/Cmd+S salva, inclusive dentro dos campos de texto.
5. Em **Gatilhos e configurações**, defina gatilhos, prioridade, fuso IANA e chips autorizados. Novos fluxos e o modelo de atendimento começam com **Mensagem recebida**, para responder à primeira mensagem que inicia uma execução; as seguintes continuam a execução em andamento. Fluxos existentes mantêm seus gatilhos. A lista de chips vazia considera os chips permitidos ao responsável pela versão. Ative o salvamento automático se desejar.
6. Em **Variáveis Globais**, configure valores da conta ou padrões da execução. Use `{{global.chave}}`, `{{fluxo.chave}}`, `{{contato.nome}}`, `{{contato.telefone}}`, `{{empresa.nome}}` e `{{atendimento.protocolo}}`. As variáveis salvas do contato entram no contexto `contato`.
7. **Testar Fluxo** abre uma conversa isolada. É possível escolher data/hora, contexto e resposta HTTP. Transferências, tags, finalização e demais efeitos não alteram cadastros nem enviam mensagens reais nesse modo. Scripts são interpretados pelo mesmo QuickJS usado na execução real. Redirecionamentos entre fluxos usam versões publicadas.
8. **Salvar** grava um rascunho. **Validar** verifica o grafo para publicação. **Publicar** cria uma versão imutável e ativa o fluxo. Conversas existentes continuam com seu grafo e variáveis, mesmo que o rascunho seja alterado.
9. Consulte **Histórico** para execuções, transições, erros, versões publicadas e revisões salvas. Versões anteriores podem ser carregadas como rascunho. Uma execução em espera ou com resultado incerto pode ser encerrada; uma operação em andamento precisa terminar antes disso.

Há recuperação local de alterações por conta, fluxo e revisão. Ao reabrir, o editor oferece recuperar ou descartar a cópia compatível. Conflitos de edição retornam HTTP 409; reabra o fluxo antes de sobrescrever uma revisão mais recente.

O bloco **Interromper** encerra a automação daquela conversa e impede que a próxima mensagem reinicie o fluxo. Em Atendimento, o estado aparece como **Automação interrompida**; use **Mais opções → Reativar automação** para permitir um novo início. Reabrir um atendimento finalizado também remove essa interrupção. Uma conversa atribuída a um atendente permanece em **Atendimento humano** e não recebe mensagens do fluxo; é necessário remover o responsável para devolver a conversa à automação.

Pausar o fluxo ou desligar seus gatilhos encerra as execuções abertas, inclusive perguntas, temporizadores e reconexões. Reativar permite novos inícios, sem retomar a pergunta ou o temporizador cancelado. O sistema verifica o controle novamente antes de cada efeito e quando um envio automático sai da fila do WhatsApp. Uma mensagem cuja transmissão já começou não pode ser recolhida por essa pausa.

O editor mostra os gatilhos da versão publicada e avisa quando o rascunho ainda precisa ser publicado. A seleção de chips também pertence à versão publicada: alterações no rascunho só passam a valer após publicar novamente. Um fluxo publicado sem gatilhos só pode ser chamado por outro fluxo; ele aparece como **Sem gatilho automático**, mesmo com a ativação habilitada. Para receber mensagens do WhatsApp em um fluxo existente, adicione **Mensagem recebida** e publique. Gatilhos de palavra-chave continuam respeitando a correspondência configurada.

Se o WhatsApp estiver conectado mas a agenda ainda estiver sincronizando, a execução aguarda a verificação e tenta novamente a cada cinco segundos. Uma recusa comprovada antes do envio também pode ser retomada; resultados de entrega incertos continuam suspensos para evitar duplicidade. Execuções antigas já marcadas como `attention` devem ser conferidas no **Histórico** e encerradas antes de um novo teste para o mesmo contato.

Os envios de um mesmo chip passam por uma fila, compartilhada pelas automações e respostas manuais. O conteúdo original é persistido pelo hook `patchMessageBeforeSending` antes da transmissão, incluindo os bytes de mídia e de contexto necessários ao protocolo. O callback `getMessage` recupera esse conteúdo por conversa e ID, inclusive após reinício e entre aliases de telefone/LID, sem criar uma segunda mensagem. A tabela local `whatsapp_retry_messages` mantém essa cópia por sete dias, com limpeza durante os envios; o histórico continua como alternativa para mensagens anteriores. Exclusões para todos removem também a cópia de reenvio. A recuperação foi testada com transporte simulado; a leitura nos celulares precisa ser confirmada em uma conversa real.

Fluxos do cadastro antigo são convertidos na leitura, preservando nós, mensagens, posições, conexões e palavras-chave. O JSON exportado mantém uma cópia da estrutura original. Tipos antigos desconhecidos são identificados para revisão e impedem publicação; não recebem uma execução fictícia.

## Modelo solicitado

O modelo liga início → script de horário → saudação de manhã/tarde/noite → menu principal. As saídas vão para e-commerce, departamento, suporte comercial e submenu de catálogos.

Configure os departamentos nos dois blocos de redirecionamento. Crie as variáveis de conta `ecommerce_url`, `catalogo_produtos` e `catalogo_servicos` com os endereços reais, ou substitua as mensagens de catálogo por blocos de documento com upload. A publicação rejeita os departamentos ainda não configurados. A simulação pode percorrer o rascunho e registra as transferências como operações isoladas.

## Arquitetura

| Responsabilidade | Implementação |
| --- | --- |
| Biblioteca, esquema e validação compartilhados | `flows/schema.js` |
| Interpretação dos blocos e transições | `flows/engine.js` |
| CRUD, revisão otimista, importação e duplicação com novos IDs | `flows/store.js` |
| Migrações SQLite/PostgreSQL | `flows/migration.js` |
| Fila persistente, retomada, temporizadores e logs | `flows/service.js` |
| Efeitos reais, permissões e integração com workers/CRM | `flows/adapter.js` |
| HTTPS e JavaScript isolado | `flows/security.js` |
| Rotas autenticadas e uploads | `flows/routes.js` |
| Modelo de referência | `flows/example.js` |
| Tabela, canvas React Flow e edição | `frontend/flows.jsx` |
| Propriedades, variáveis, gatilhos, simulador e histórico | `frontend/flows-panels.jsx` |
| Estilos próprios | `public/assets/css/pages/flows.css` |

O servidor principal coordena as automações. Cada worker mantém seu armazenamento de conversas e uma outbox de eventos no SQLite do chip. A mensagem recebida e seu evento são gravados na mesma transação. O worker repete os eventos pendentes até que o servidor confirme a persistência na inbox central.

A inbox identifica eventos por conta, chip e ID do provedor. Uma sequência persistida preserva a ordem de recebimento, e um índice impede processar duas entradas simultâneas para o mesmo contato/chip. A execução mantém o ID, responsável, conta, contato, chip, versão, grafo, bloco atual, variáveis, respostas, tentativas, prazos e estado. Existem índices e reservas condicionais para execuções ativas e operações em andamento.

O temporizador grava o prazo no banco e é retomado pelo backend, independentemente de navegador aberto. Uma execução que encontra o chip desconectado aguarda a reconexão, com tentativas espaçadas, preservando sua entrada pendente. Os logs registram bloco, saída e conexão. Rascunhos não são usados como versões de produção.

Os efeitos têm registros próprios reservados antes da chamada externa. Efeitos confirmados não são repetidos ao recuperar uma execução. Um envio sem resultado conhecido fica em `attention`: conferir o atendimento e encerrar antes de reiniciar. Esse comportamento evita prometer entrega exatamente uma vez, que o transporte externo não garante transacionalmente com o banco local.

## Blocos

As saídas automáticas **Padrão** e **Erro** e o bloco **Tratamento de erro** foram removidos. Scripts e switches seguem apenas saídas explicitamente configuradas; sem correspondência, a execução termina. Respostas inválidas seguem o limite de tentativas e depois encerram a execução. Fluxos salvos, versões antigas e execuções carregadas passam por adaptação para retirar os caminhos antigos; o histórico original armazenado é preservado. Falhas técnicas continuam registradas no histórico, sem desvio para outro bloco.

Há processadores para texto (incluindo lista de mensagens), imagem, áudio, vídeo, documento, três modalidades de menu, pergunta, espera, regras E/OU, condições de chip/tag, horário comercial com feriados/exceções, variáveis tipadas, switch, distribuição ponderada, tags, temporizadores, transferência, distribuição de atendimentos, movimentação de oportunidade, HTTP, JavaScript, finalização, início, gatilho, interrupção.

Horários que atravessam meia-noite pertencem ao dia em que começam. Por exemplo, segunda das 22h às 2h inclui a madrugada de terça. Um feriado fechado ou uma exceção configurada para terça substitui essa continuação.

Variáveis aceitam texto, número, booleano, data e JSON. Os padrões são copiados por execução, preservando zero, falso e null. Transferir para outro fluxo adiciona seus padrões sem apagar os valores já coletados. JSON inválido impede salvar/publicar; atribuições recusam valores incompatíveis com o tipo, incluindo datas impossíveis e números vazios. Temporizadores aceitam data ISO literal ou interpolada de uma variável.

Distribuição suporta sequência, aleatório e menor carga. A elegibilidade considera conta ativa, permissões, departamento e limite de atendimentos não finalizados. A plataforma atual não tem um estado separado de presença/disponibilidade do atendente; não se presume que uma conta ativa esteja online.

O provedor existente é Baileys. Menus de botões e respostas rápidas usam o fallback numérico, com as mesmas saídas e tentativas. Não há promessa de botões nativos nesse canal. Mídias usam o envio existente e a persistência de mensagens da plataforma. Os atendentes autorizados à conversa podem abrir os arquivos enviados pela automação.

## Segurança e limites

- Todas as rotas usam a sessão e as permissões existentes. Publicação verifica referências da conta e permissões dos efeitos. A execução revalida o responsável da versão. Recursos e variáveis são separados por conta. Histórico de não proprietários fica restrito às execuções do próprio responsável, além do escopo do fluxo.
- JavaScript executa em QuickJS/WebAssembly, sem `process`, `require`, rede, sistema de arquivos ou banco. Limites: 8 MB, pilha de 256 KB, aproximadamente 200 ms de interpretação, código de 20 KB e retorno JSON de 64 KB. O relógio local sem argumentos usa o fuso do fluxo; `Date.now()` mantém o instante real/simulado.
- HTTP aceita HTTPS público na porta 443, faz resolução DNS limitada, bloqueia endereços privados/reservados e fixa o IP validado na conexão TLS. Não segue redirecionamentos. Há timeout de até 15 segundos, corpo de até 256 KB e resposta JSON de até 1 MB.
- Credenciais HTTP são referências a variáveis do servidor, por exemplo `FLOW_SECRET_1_CRM` para conta 1. O nome precisa corresponder à conta e é enviado como Bearer; o valor não é incluído no fluxo. Headers de autenticação, cookies, tokens e credenciais na URL são recusados no salvamento. Cada conta deve ter seu próprio segredo.
- Uploads validam assinatura, tipo e tamanho. Imagem: JPEG, PNG e WebP, até 5 MB. Áudio: MP3, OGG, MP4 e WAV. Vídeo: MP4. Documentos: PDF, TXT, DOCX e XLSX. Demais arquivos: até 16 MB. A compatibilidade final de codec/transcodificação depende do WhatsApp e precisa ser validada com o chip.
- Grafos: até 1.000 blocos, 5.000 conexões e JSON de 2 MB. O editor renderiza elementos visíveis e tem minimapa. Execuções: até 500 transições e 30 dias; lotes de até 30 transições; tentativas de resposta entre 1 e 10. Temporizadores: até 30 dias.
- Gatilhos de palavra-chave aceitam exata, contém e inicia com. Regex não é disponibilizada. Maior prioridade vence; empate usa o menor ID do fluxo. Uma mensagem não inicia dois fluxos concorrentes para a mesma conversa.

O serviço usa um coordenador Express e os workers de chip existentes. Não houve implantação ou certificação de múltiplas instâncias do backend compartilhando os mesmos sockets de WhatsApp. A aplicação deve manter seu armazenamento persistente conforme a configuração existente.

## Eventos autenticados

Mensagem, primeira mensagem e contato novo são emitidos pelo recebimento do WhatsApp. Uma tag adicionada em uma conversa gera um evento pelo worker. Sistemas externos autenticados podem chamar:

```http
POST /api/flows/:id/event
Content-Type: application/json
Cookie: sessão autenticada do proprietário

{
  "eventId": "identificador-unico-no-sistema-de-origem",
  "type": "api",
  "name": "nome-configurado-no-gatilho",
  "chipId": 1,
  "number": "numero-real-do-contato"
}
```

Tipos aceitos: `api`, `system`, `integration`, `tagAdded`. Para tag, informe `tags`. O endpoint é direcionado ao fluxo identificado e exige ID de evento para deduplicação. Não é um webhook público anônimo. Uma integração precisa fornecer uma sessão válida; não foi criada uma autenticação alternativa por token global.

## Validação e dependências externas

Execute `npm run test:flows`, `npm run test:flows:ui`, `npm run test:flows:audit`, `npm run test:flows:postgres`, `npm test` e `npm run test:ui`. O relatório de execução fica em `docs/flows-validation.md`.

Os testes usam bancos temporários SQLite e PostgreSQL 18 local, navegador real e adaptadores de WhatsApp/HTTP controlados. Nenhum cliente real recebe mensagens nos testes. Envio e recebimento com um chip conectado e codecs de mídia precisam de validação no ambiente correspondente. As quatro imagens citadas no pedido não estavam no anexo disponível; o visual foi construído com a identidade atual e a descrição textual.

Referências das bibliotecas: [React Flow](https://reactflow.dev/api-reference/react-flow) e [QuickJS Emscripten](https://github.com/justjake/quickjs-emscripten).
