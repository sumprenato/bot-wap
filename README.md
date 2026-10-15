# Bot WhatsApp + Dashboard

Bot que encaminha mensagens de clientes do WhatsApp para o seu número, permite
assumir a conversa manualmente (`!assumir`) e conta com uma dashboard web para
acompanhar e responder tudo em tempo real.

## Estrutura

- `bot.js` — lógica do bot (Baileys) + eventos para a dashboard.
- `server.js` — servidor web (Express + Socket.io) que serve a dashboard e liga tudo.
- `db.js` — camada de banco de dados: usa **PostgreSQL** automaticamente se
  `DATABASE_URL`/`DATABASE_PRIVATE_URL` estiver definida (ex.: Railway), ou
  **SQLite** localmente caso contrário.
- `store.js` — histórico de conversas e mensagens, persistido no banco de dados
  (antes ficava num arquivo `conversations.json`, que se perdia a cada deploy).
- `frontend/` — site em React: login, atendimento, dashboard e todas as páginas de gestão. Formulários, listas, filtros e mensagens usam estado React.
- `frontend/template.jsx` — converte a estrutura HTML inicial em elementos React, preservando o desenho e a primeira renderização da rota correta.
- `frontend/motion.jsx` — efeitos de interação compartilhados pelo site.
- `public/` — HTML inicial, estilos e bundle React compilado.
- `index.js` — modo antigo sem dashboard (`npm run bot-only`), mantido por
  compatibilidade.

## O que foi corrigido nesta versão

- **Persistência real em banco de dados**: conversas e mensagens agora ficam
  em tabelas (`conversations`, `messages`) no Postgres/SQLite, não mais num
  JSON solto que se perdia a cada redeploy.
- **`store.js` assíncrono** de ponta a ponta, com `server.js` e `bot.js`
  atualizados para usar `await` corretamente (antes havia leituras
  desatualizadas e possíveis condições de corrida).
- **Cookies de sessão** corrigidos (`secure: 'auto'`) para funcionar em HTTPS
  atrás do proxy do Railway sem precisar configurar `FRONTEND_URL`.
- **`public/config.js`** não aponta mais para uma URL fixa de um deploy
  específico — usa same-origin por padrão, funcionando em qualquer domínio.
- **Armazenamento configurável** via `STORAGE_DIR`: banco SQLite, sessão do
  WhatsApp (`auth_info/`) e mídias (`media/`) ficam todos dentro dela, prontos
  para apontar para um Volume persistente no Railway.
- **Contatos persistidos**: contatos enviados pela agenda do WhatsApp e nomes
  identificados nas mensagens são salvos na tabela `contacts` e aparecem na
  página Contatos do painel.
- Pequenos ajustes de robustez (reconexão do Baileys, limpeza de arquivo
  temporário quando o envio de mídia falha, recriação da pasta `auth_info`
  após desconectar, etc.).
- Removidos do pacote: `node_modules/`, `.git/`, sessão do WhatsApp
  (`auth_info/`), mídias e bancos de dados de exemplo que estavam
  **misturados no zip original** — continham dados reais de clientes e não
  deveriam ser versionados nem reaproveitados num novo ambiente.

## Correções da versão 1.0.1

- **Não respondia quando o contato chamava primeiro**: contatos novos chegam
  com um ID interno do WhatsApp (`@lid`) em vez do telefone. O bot só lembrava
  esse ID em memória; após qualquer restart ele tentava enviar para
  `<id>@s.whatsapp.net` (inexistente) e a mensagem sumia sem erro. Agora o JID
  real fica salvo no banco (`contacts.jid`) e é usado no envio. Também:
  conversas iniciadas por você e respondidas via LID são mescladas, números BR
  com/sem o 9 são tentados, número inexistente gera erro claro e mensagens
  como localização/contato/figurinha aparecem no chat.
- **Precisava de F5 / disconnect**:
  - worker que caía só voltava quando alguém recarregava a página → agora o
    servidor reinicia sozinho (espera crescente) e requisições pendentes não
    ficam mais penduradas (timeout + rejeição quando o worker morre);
  - sessão deslogada pelo celular exigia "disconnect" manual → agora limpa as
    credenciais e gera um novo QR automaticamente;
  - reconexão do WhatsApp tentava uma única vez → agora insiste com backoff;
  - worker atendia pedidos antes do banco estar pronto (tela vazia no F5) →
    agora espera o banco;
  - painel resincroniza sozinho (volta de aba, internet, queda do socket e a
    cada 10s/60s), e chat aberto por telefone acompanha a conversa quando o
    servidor a guarda sob outro número (LID).

## Rodando localmente

### Estabilidade dos chips e diagnóstico de quedas

Após confirmar a identidade do WhatsApp conectado pelo QR Code, o bot importa
automaticamente as mensagens dos últimos sete dias entregues pelo WhatsApp no
evento de histórico. Mensagens recebidas e enviadas ficam no armazenamento
isolado do chip com suas datas originais, sem duplicar IDs já salvos. Lotes de
histórico não executam comandos antigos, enviam mensagens ou marcam conversas
como lidas. O diálogo de conexão mostra a quantidade importada.

As mensagens permanecem salvas após os sete dias e após reiniciar o serviço;
o limite antigo de 200 mensagens por conversa foi removido. Exclusões manuais
continuam disponíveis. Na Railway, isso depende de manter o volume persistente.
O WhatsApp decide quais mensagens e anexos disponibiliza; mídia indisponível
mantém seu registro e metadados, sem impedir a importação das demais mensagens.
Não é necessário desconectar uma sessão existente para instalar a mudança.
Teste isolado: `npm run test:history`.

O atendimento renderiza inicialmente as 100 mensagens mais recentes, com o botão
"Carregar mensagens anteriores" para consultar o restante. Isso limita o trabalho
do navegador, sem remover mensagens do banco. Envio e confirmações de entrega usam
atualizações parciais mescladas pelo ID da mensagem; consultas da interface não
carregam os dados criptográficos armazenados para reenvios. As consultas de escopo
continuam aplicando as mesmas permissões e usam apenas metadados.

`npm test` inclui os testes de consultas e atualizações parciais. `npm run test:inbox`
também verifica uma conversa com 5.000 mensagens, envio, digitação, confirmações e
acesso ao histórico anterior.

Quedas de rede e erros genéricos de stream (inclusive código 500) preservam as
credenciais e reconectam com espera crescente, limitada a 30 segundos. A espera
só volta ao início depois de uma conexão estável por pelo menos um minuto.
Uma confirmação de identidade indisponível por erro temporário do servidor
também preserva o dispositivo vinculado; uma conta comprovadamente diferente
continua sendo recusada.

O worker encerra ao perder o processo principal e nos reinícios solicitados pelo
gerenciador. Antes de sair, fecha o transporte sem executar logout e aguarda a
gravação das credenciais e chaves. O novo worker aguarda a saída do anterior,
evitando duas conexões locais para a mesma sessão. Consultar a dashboard não
antecipa as tentativas de reinício de um worker que esteja falhando.

Cada chip grava eventos em `STORAGE_DIR/chips/<id>/connection-events.log`, com
horário, código da queda, motivo, ação e tempo da próxima tentativa. O arquivo
é limitado a 128 KB, com uma cópia anterior em `.log.1`; não registra QR Codes,
conteúdo de mensagens ou chaves de autenticação. O código 440 identifica uma
conexão substituída: a reconexão automática é pausada para evitar disputa com
outra instância. Encerre a instância duplicada antes de reiniciar o serviço.
Um logout real do WhatsApp (401) ainda exige novo QR Code.

`npm run test:connection` reproduz quedas consecutivas, erros temporários de
identidade, persistência pendente, eventos atrasados, processos órfãos, reinício
sem sobreposição e isolamento entre workers, sem conectar contas reais.

### Dashboard e telas responsivas

As páginas de gestão ocupam a largura disponível da janela. A dashboard tem
cabeçalho compacto, filtros de 7/14/30 dias e por chip, gráficos de área/linhas/barras,
distribuição dos atendimentos, mapa de mensagens por hora e comparativo dos chips.
Os totais de mensagens usam o período selecionado, em horário de Brasília; os
atendimentos e resultados comerciais representam a situação atual. Os resultados
dos funis são independentes do filtro de chip. Os dados atualizam a cada 30 segundos
com a aba visível, e o relatório CSV inclui o resumo e os valores diários filtrados.

`npm run test:dashboard` verifica filtros, gráficos, exportação e adaptação a
monitores de 1366 a 3440 pixels e celular, usando dados locais de teste.

### WhatsApp Business e entrega de mensagens

A conexão por QR usa dispositivos vinculados do WhatsApp, inclusive do aplicativo
WhatsApp Business. No celular, abra **Dispositivos conectados → Conectar um
dispositivo** e escaneie o QR do chip no painel.

O bot fornece os conteúdos originais ao mecanismo `getMessage` do Baileys quando
o WhatsApp solicita um reenvio. Um cache limitado atende mensagens recém-enviadas;
o histórico persistido permite recuperá-las após reiniciar o worker, incluindo
as chaves de mídia e os aliases entre telefone e LID. Isso corrige a ausência
de recuperação que podia deixar a mensagem visível no painel enquanto o celular
mostrava “aguardando mensagem”.

Após atualizar e reiniciar o servidor, teste mensagens novas nos dois sentidos,
incluindo texto e mídia. O aviso sozinho não identifica a causa: se continuar,
verifique conexão, confirmações de entrega e logs do worker. Conteúdos antigos
sem o payload original salvo não podem ser recuperados por esse mecanismo.

Essa conexão não implementa a API oficial WhatsApp Business Platform/Cloud API.

### Importar contatos

Em **Contatos → Importar contatos**, envie um CSV UTF-8 de até 2 MB e 5.000
linhas. O botão **Baixar modelo CSV** fornece um exemplo. O CSV exportado pelo
próprio painel também pode ser importado. São aceitos os separadores `;` e `,`,
campos entre aspas e as colunas `Telefone` (obrigatória, com DDI), `Nome` e
`Rótulos` (opcionais; separe os rótulos com vírgulas).

Os contatos ficam no banco do **chip selecionado em Atendimento ou Contatos**; o WhatsApp não
precisa estar conectado. Telefones repetidos são agrupados, nomes preenchidos
atualizam contatos existentes e novos rótulos se somam aos anteriores. A
importação não cria conversas nem envia mensagens. O resultado informa os
novos contatos, atualizações, repetições e linhas rejeitadas. Linhas válidas
são salvas mesmo quando há outras linhas inválidas.

### Instalação e animações

Todo o site usa um único ponto de entrada React em `frontend/site.jsx`, compilado
em `public/assets/js/site.js`, incluindo o cliente Socket.io, sem CDN de scripts.
Os antigos controladores de interface em `public/assets/js/app.js` e `pages/`
não são carregados pelas páginas. As URLs continuam sendo servidas pelo Express,
com links nativos, para preservar navegação, voltar/avançar e F5.

Depois de alterar `frontend/`, execute `npm run build`. O bundle e sua licença
ficam em `public/assets/js/`. As animações cobrem cliques, navegação, cards,
mensagens, editores, menus, filtros, indicadores e gráficos, com estilos em
`public/assets/css/motion.css`. A preferência de movimento reduzido desativa
os efeitos. Use `npm test` e `npm run test:ui` para validar APIs e páginas.

```bash
npm install
cp .env.example .env
# edite o .env: ADMIN_USERNAME, ADMIN_PASSWORD, SESSION_SECRET
npm start
```

No PowerShell, use `Copy-Item .env.example .env` e configure os dados de login.
O painel identifica os números dos chips pelo QR Code; `ADMIN_NUMBER` não é
necessário para iniciar o servidor nem para cadastrar canais.

Abra **http://localhost:3000**. Faça login com `ADMIN_USERNAME`/`ADMIN_PASSWORD`
(criados automaticamente no banco na primeira execução). Em **Meus chips**,
clique em **Novo chip**, escolha nome e departamento e escaneie o QR Code.
Repita para conectar outros canais sem interromper os anteriores.

No cadastro, `username` é o ID exclusivo usado somente para entrar no painel.
O campo `display_name` (Nome no painel) é independente e é o nome mostrado no
painel e usado na assinatura das mensagens enviadas pela dashboard. Usuários
existentes recebem automaticamente o próprio `username` como nome exibido e
podem alterá-lo em **Meu perfil**.

Cada cadastro também informa um número WhatsApp próprio. Ao entrar no painel,
esse número recebe uma sessão Baileys e um QR Code exclusivos, armazenados em
`STORAGE_DIR/users/<id>/`. As conversas, bloqueios, mídias e sessão de cada
usuário ficam isolados das demais contas. O histórico de mensagens e os
contatos também ficam persistidos nessa mesma instalação. O número deve ser informado com DDI,
somente dígitos, entre 10 e 15 caracteres.

Sem Postgres configurado, os dados ficam em `./database.sqlite` (ou dentro de
`STORAGE_DIR`, se você definir essa variável).

## Deploy no Railway (com banco de dados)

1. **Crie um projeto no Railway** e conecte este repositório (ou faça upload
   via `railway up`).
2. **Adicione um plugin PostgreSQL** ao projeto (`+ New` → `Database` →
   `PostgreSQL`). O Railway já injeta `DATABASE_URL` automaticamente no seu
   serviço — o `db.js` detecta isso sozinho e passa a usar Postgres.
3. **Adicione um Volume** ao serviço do bot (`Settings` → `Volumes`), montado
   por exemplo em `/app/storage`. É nele que ficam a sessão do WhatsApp
   (`auth_info/`) e as mídias recebidas/enviadas — sem isso, você precisaria
   escanear o QR Code de novo a cada deploy.
4. **Configure as variáveis de ambiente** do serviço (`Settings` →
   `Variables`), usando `.env.example` como referência:
   - `ADMIN_NUMBER` — seu número de WhatsApp (o que vai controlar o bot).
   - `ADMIN_USERNAME` / `ADMIN_PASSWORD` — login do painel.
   - `SESSION_SECRET` — string aleatória longa.
   - `STORAGE_DIR=/app/storage` — mesmo caminho do Volume criado no passo 3.
     Se ficar vazio, o app usa `RAILWAY_VOLUME_MOUNT_PATH`, fornecido pela Railway.
     Um caminho explícito continua tendo prioridade para preservar os dados existentes.
   - Não é necessário definir `DATABASE_URL` (o Railway já injeta) nem `PORT`
     (o Railway também injeta).
5. **Deploy.** O Railway detecta automaticamente que é um projeto Node
   (via `package.json`, script `start`) e roda `npm install && npm start`.
6. Abra a URL pública gerada pelo Railway, faça login e escaneie o QR Code
   com o WhatsApp que vai ser o bot.

### Observações importantes

- Execute `npm run check:storage` no ambiente do serviço para conferir o caminho.
  O comando não abre conexão com o WhatsApp nem lê credenciais. Na Railway, retorna
  erro se não houver volume ou se `STORAGE_DIR` estiver fora dele; o servidor também
  registra um aviso ao iniciar. PostgreSQL guarda os dados do painel, mas as chaves
  do WhatsApp, o histórico local dos workers e as mídias dependem do volume.
- Ao corrigir um caminho fora do volume, preserve primeiro os arquivos do diretório
  antigo com os workers parados e copie-os para uma pasta exclusiva dentro do volume.
  Só então altere `STORAGE_DIR` e reinicie. Trocar apenas a variável ou o ponto de
  montagem pode esconder as sessões e mídias atuais. Uma sessão já apagada ou
  revogada pelo WhatsApp exige um novo pareamento.
- As sessões de login do painel ficam em memória (`express-session` sem
  store externo). Isso é suficiente para um único serviço/instância — se você
  reiniciar o deploy, só será necessário logar de novo no painel (a conexão
  do WhatsApp, essa sim, fica salva no Volume).
- O usuário admin do painel é criado **apenas uma vez**, na primeira
  inicialização do banco. Trocar `ADMIN_PASSWORD` depois não atualiza um
  usuário já existente — se precisar trocar a senha, atualize direto na
  tabela `users` do Postgres (ou apague o banco para recriar do zero, caso
  ainda não tenha dados importantes).
- Nunca comite o arquivo `.env` (ele já está no `.gitignore`).

## Comandos pelo WhatsApp (do número admin)

- `!assumir 5511999999999` — assume a conversa com esse número; tudo que você
  digitar depois é repassado a ele.
- `!enviar 5511999999999 sua mensagem` (ou `!mandar`) — envia uma mensagem
  pontual sem precisar "assumir" antes.
- `!sair` ou `!encerrar` — larga a conversa assumida.

## Rodando sem dashboard (modo antigo)

```bash
npm run bot-only
```

Roda só `index.js`: QR Code no terminal, comandos `!assumir` / `!sair` /
`!status` pelo WhatsApp, sem painel web nem banco de dados.


## Verificar as páginas

É possível conectar vários chips simultaneamente em **Meus chips**. Cada canal
tem seu QR Code, sessão, contatos e histórico próprios. No **Atendimento**, use
**Canal de atendimento** para escolher o chip; respostas, arquivos e ações da
conversa são enviados ao canal selecionado. Definir um chip como **Padrão**
não desconecta os outros. Reconectar com outra conta continua sendo recusado.

- `npm test`: verifica APIs, autenticação, chips e isolamento das rotas.
- `npm run test:chips`: verifica o cadastro somente por QR Code, o telefone identificado, a edição dos canais e as janelas em desktop/celular e nos dois temas, com WhatsApp simulado.
- `npm run test:multi-chip`: verifica dois canais simultâneos com o mesmo cliente, roteamento de texto/arquivo, isolamento dos eventos, queda de um canal e troca rápida entre chips. Usa conexões simuladas.
- `npm run test:ui`: usa Playwright com Chrome instalado para verificar as 11 páginas em desktop e celular, formulários, filtros, erros de API e preservação de dados. Para usar Edge, defina `UI_BROWSER=msedge`.
- O teste de interface cria um banco temporário em `.tmp/`, simula o WhatsApp sem iniciar conexões e remove o banco ao terminar. As capturas de Funis ficam em `.tmp/funis-desktop.png` e `.tmp/funis-mobile.png`.

A página **Funis** usa `/funis`; links antigos para `/kanban` redirecionam automaticamente. As APIs e os dados existentes continuam compatíveis.

## Cargos, permissões e contas

Em **Minha equipe**, o proprietário pode criar gerentes e atendentes, filtrar os membros e editar seus acessos. Gerentes começam sem permissões. O cargo não concede acesso automaticamente: cada ação depende de uma concessão explícita, validada no servidor. Gerentes autorizados administram somente atendentes dentro dos próprios departamentos, funis, tags e escopo; não alteram o proprietário, outros gerentes ou seus próprios privilégios.

Os quatro escopos são próprios, departamentos autorizados, equipe supervisionada e conta. Para ver atendimentos de outros usuários, os escopos de departamento e conta também exigem `atendimento.visualizar_todos`. Atendimentos próprios usam o responsável atribuído; conversas novas sem responsável ficam disponíveis ao proprietário para distribuição. Cada conversa conserva seu departamento, inclusive quando transferida em um canal de outro departamento. Funis e tags exigem suas listas de recursos autorizados.

O proprietário pode bloquear a delegação de uma permissão. A concessão direta do proprietário é separada das concessões dos gerentes: editar dados do atendente não converte uma delegação em concessão direta. Revogar ou limitar o gerente retira imediatamente os acessos dependentes, preservando as concessões diretas. Revogações atualizam menus, dados e ações com a sessão aberta; bloqueio, remoção ou troca administrativa da senha revogam sessões. Remover um membro preserva seu cadastro e histórico. A transferência de propriedade mantém um proprietário ativo e transforma o antigo proprietário em gerente sem concessões administrativas automáticas.

As APIs, páginas, eventos de Socket.IO, arquivos, importações, exportações e recursos referenciados são filtrados por conta e escopo. A auditoria em Minha equipe registra autor, usuário afetado, operação, valores anteriores e novos e horário. Gerentes precisam de `auditoria.visualizar` e recebem apenas registros dos membros autorizados. O perfil pessoal e a troca da própria senha continuam acessíveis; o nome compartilhado da conta exige permissões de configurações.

A migração automática cria `accounts`, `permission_grants`, `audit_log` e `rbac_migrations`, acrescenta conta/status/escopo aos usuários, responsável às conversas e conta/criador/departamento aos recursos administrativos. Mantém IDs, históricos e sequências reservadas. A propriedade atual é preservada. Membros antigos não recebem novos privilégios administrativos: o proprietário precisa revisar suas permissões. Cadastros independentes antigos continuam contas próprias; recursos administrativos globais sem vínculo anterior ficam na primeira conta proprietária. Em instalações antigas com várias contas independentes, sua distribuição exige revisão do proprietário, pois não havia informação de origem para inferi-la com segurança.

O catálogo corresponde às funcionalidades implementadas. Campanhas e fluxos têm controles de cadastro, edição e exclusão; o projeto ainda não possui um motor de envio de campanhas ou execução de chatbot. Não há permissão ou botão que simule esses serviços. Contatos removidos da agenda do painel preservam o histórico e podem retornar quando ainda estiverem salvos no WhatsApp.

Validação adicional: `npm run test:access` verifica o editor real de permissões, concessões e revogações com sessão aberta, bloqueio de rotas, menus, desktop/celular e ambos os temas. `npm test` inclui hierarquia, quatro escopos, delegação, isolamento, auditoria e migração com reinicialização. Os testes de WhatsApp usam conexões simuladas. O caminho PostgreSQL foi adaptado, mas requer validação em uma instância PostgreSQL disponível.
