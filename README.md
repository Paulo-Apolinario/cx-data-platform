# Gestão de Obras

Primeira versão de uma aplicação para um engenheiro gerenciar várias obras e
compartilhar o andamento com cada cliente. A implementação anterior de eventos
de CX está arquivada em `legacy/cx-events/` e não faz parte do sistema atual.

## Funcionalidades implementadas

- Login do engenheiro e de clientes, com sessões e troca de senha.
- Cadastro/edição de obras, endereço, datas, orçamento e cliente titular.
- Vínculo do cliente em destaque na obra, com nome/e-mail e ação de vincular ou trocar.
- Cadastro do cliente dentro do formulário da obra ou da alteração de vínculo.
- Visual arquitetônico com volumes 3D ilustrativos e controles de rotação.
- Cartão inteiro da obra clicável, com link acessível por teclado e endereço próprio.
- Busca e filtros por etapa/visibilidade em fotos e documentos; ampliação de imagens.
- Lista de documentos com formato, tamanho, data, etapa e ações, adaptada ao celular.
- Quadro de etapas: planejada, em execução e concluída.
- Mapa fotográfico com data, ambiente, descrição e vínculo a uma etapa.
- Documentos e notas em PDF/imagem; download protegido por autorização.
- Publicação explícita de fotos/documentos para o cliente; internos por padrão.
- Diário de obra com equipe presente, fotos, ocorrências, notas internas e revisões.
- Relatório do diário por período, pronto para imprimir ou salvar em PDF pelo navegador.
- Materiais com saldo inicial, entradas, consumo, perdas e transferência entre obras.
- Financeiro com fornecedor, vencimento, pagamentos parciais, comprovantes e estornos.
- Serviços contratados com quantidades, participações, execução real e revisões de escopo.
- Quadro e cronograma de tarefas vinculadas aos serviços, sem alterar o avanço físico.
- Unidades de material por lista, prévia de saldo, estorno de movimentos, mínimo e reservas.
- Compras efetuadas com cadastro de material na própria compra, entrada automática, despesa/pagamento e saldo do orçamento atualizados juntos.
- Acabamentos com opções, fotos, adicionais e decisão do cliente.
- Vistoria/pós-obra com fotos enviadas pelo cliente, atendimento, conferência e reabertura.
- Solicitações de alteração e custos adicionais, com aprovação ou recusa pelo cliente.
- Cadastro de profissionais por obra e indicadores de orçamento, pago e valores em atraso.
- Portal do cliente, sem acesso a outras obras ou aos cadastros internos.
- Registro de auditoria das alterações no banco, ainda sem tela de consulta.

O mapa fotográfico é um histórico de fotos por local/etapa, sem planta interativa
ou georreferenciamento nesta versão. Não há emissão fiscal, folha de pagamento,
assinatura digital ou envio de e-mails. Os aceites são registros de decisão no portal.

## Executar localmente, sem Docker

Requisito: **Node.js 24 ou superior** (inclui `node:sqlite`). Não é necessário
instalar Python, RabbitMQ ou banco separadamente. Não há pacotes externos de execução.

1. Abra a pasta do projeto no VS Code.
2. Copie `.env.example` para `.env` (no Windows: `copy .env.example .env`; Linux/macOS: `cp .env.example .env`).
3. Execute `npm run setup` e informe nome, e-mail e uma senha de 12 a 128 caracteres.
   A senha aparece no terminal durante essa configuração; use um local privado.
4. Execute `npm start`.
5. Acesse **http://localhost:3000**, usando o mesmo endereço de `APP_ORIGIN`.

Não há senha padrão nem dados fictícios carregados automaticamente. `npm run dev`
reinicia o servidor ao editar código. O repositório não exige `npm install`.

### Primeiro fluxo de uso

1. Entre com a conta do engenheiro.
2. Cadastre o cliente na seção **Clientes**, definindo sua senha inicial.
3. Cadastre a obra e selecione esse cliente.
4. Abra a obra e adicione etapas, materiais, despesas e equipe.
5. Anexe fotos/documentos e escolha quais publicar.
6. Saia e entre como cliente para conferir a experiência. Ele pode alterar sua senha.

Clique em qualquer área do cartão da obra para abri-la. O controle de vínculo de
cliente continua independente. O endereço com `#obra=...` pode ser copiado ou
aberto em outra aba; recarregar a página mantém a obra aberta. A autorização segue
obrigatória, e os botões voltar/avançar do navegador acompanham a navegação.

Em **Documentos** e **Mapa fotográfico**, busque por título, descrição, nome do
arquivo ou ambiente e filtre por etapa. O engenheiro também pode filtrar por
publicação. Imagens podem ser ampliadas no sistema; PDFs são baixados. A busca
ocorre nos metadados e não no conteúdo interno dos PDFs. Os resumos representam
os arquivos autorizados carregados, e o contador indica quantos passaram no filtro.

Também é possível criar o cliente diretamente em **Nova obra → Cliente da obra →
Cadastrar cliente aqui**. Para uma obra já criada, abra-a e clique em **Vincular
cliente** (ou **Alterar cliente**). Selecione nome/e-mail ou cadastre a nova conta
ali mesmo e clique em **Salvar vínculo**. A troca preserva os dados da obra e muda
qual cliente pode acessá-la. Selecionar **Sem cliente vinculado** retira o acesso.

As ilustrações 3D aparecem na visão geral, nos cartões e no cabeçalho da obra.
Os botões de giro exploram oito ângulos. São volumes conceituais de apresentação,
**não representam a planta ou o modelo BIM real da obra**. Não exigem arquivos de
modelo, GPU dedicada, WebGL, CDN ou dependências adicionais. A preferência do
dispositivo por movimento reduzido é respeitada.

Cada cliente pode acompanhar várias obras. A instalação admite uma conta de
engenheiro. A aplicação web se adapta ao celular; não há aplicativo nativo/offline.

## Como usar os novos módulos

- **Diário de obra:** adicione data, serviços, ocorrências, equipe e fotos já cadastradas.
  Marque a publicação para compartilhar. Anotações internas e nomes da equipe não
  são enviados ao cliente; fotos internas continuam privadas. Edite mantendo o
  histórico de revisões ou arquive para retirar o registro da visualização.
  Use o período e **Imprimir / Salvar PDF**; no diálogo do navegador, escolha
  **Salvar como PDF**. O relatório não inclui anotações internas.
- **Materiais:** informe a unidade e o saldo inicial no cadastro. Depois use
  **Movimentar** para entradas, consumo, perdas ou transferência. Para transferir,
  cadastre o material na outra obra com a mesma unidade e selecione-o como destino.
  Saída e entrada são registradas juntas. Saldos não ficam negativos e históricos
  não são apagados. Lançamentos manuais incorretos podem ser estornados com justificativa e registrados novamente. Compras recebidas e uso de reservas mantêm seus vínculos e não permitem estorno isolado.
- **Despesas:** registre fornecedor, categoria, valor e vencimento. Use **Pagar**
  para registrar pagamentos parciais, escolhendo comprovantes da aba Documentos.
  **Pagamentos** mostra o histórico e permite estornar com justificativa. Registros
  com histórico de pagamentos não podem ser excluídos. O realizado soma despesas
  registradas; o pago soma pagamentos não estornados, sem duplicar os valores.
- **Cronograma:** informe o percentual concluído (0 a 100%), responsável e datas da
  tarefa e vincule-a ao serviço contratado. O avanço físico considera a execução
  dos serviços em Serviços contratados. Concluir tarefas não altera o avanço da obra.
  Planejada exige 0%; concluída exige 100%. Datas reais são opcionais; a conclusão
  real exige início real e situação concluída. Prazos vencidos são destacados.
- **Aprovações:** crie e revise o rascunho, depois envie ao portal do cliente
  vinculado. Após o envio, título, descrição e valor ficam bloqueados. O cliente
  aprova ou recusa com observação; conta e data ficam registradas. Uma decisão
  não pode ser reescrita. O aceite não cria despesas nem altera o orçamento
  automaticamente. Ao trocar o cliente da obra, propostas enviadas ao titular
  anterior devem ser canceladas e recriadas para o novo destinatário.

### Atualizar uma instalação existente

1. Pare o servidor com **Ctrl+C** e copie toda a pasta `data` para um backup.
2. Atualize a branch `feat/gestao-obras`, preservando `.env` e `data`.
3. Execute `npm test` e depois `npm start`.
4. A migração 2 é aplicada automaticamente uma única vez. Os saldos anteriores
   viram movimentos de abertura; despesas já pagas recebem pagamentos históricos.
   Etapas existentes recebem peso 1; concluídas ficam em 100%, demais em 0% até
   medição informada. A medição ponderada pode mudar o percentual exibido.

O cálculo de atraso usa a data em `America/Sao_Paulo`. Não há notificações por e-mail.

## Dados e backup

O banco (`obras.sqlite`) e os arquivos (`uploads/`) ficam em `DATA_DIR`, por padrão
`./data`. Esse diretório é privado e ignorado pelo Git. **Não apague essa pasta ao
atualizar o código.** Um backup deve incluir banco e uploads juntos.

Para um backup consistente nesta primeira versão, interrompa o servidor, copie
**todo o diretório de dados** para um local seguro e depois reinicie o sistema.
Para restaurar, interrompa o servidor e restaure esse diretório completo; teste
a recuperação em outra pasta/porta antes de depender do backup em produção.

## Testes

```sh
npm test
```

Testes usam diretórios temporários e cobrem autenticação, isolamento entre clientes,
visibilidade de anexos, cadastros, validação de valores/datas, migração com dados
anteriores, transferências, pagamentos concorrentes, revisões e decisões do cliente.
Não utilizam seu banco de trabalho.

## Produção e próximas etapas

Esta é uma primeira versão para validação. SQLite atende aos testes locais e ao
escopo inicial de uma instalação pequena. Migração para PostgreSQL, instalação
na VPS e automação de backup ainda não estão implementadas.

Para uma futura instalação com HTTPS, definir `NODE_ENV=production` e
`APP_ORIGIN=https://seu-dominio`, manter dados fora da pasta pública e executar
uma única instância sob supervisão. Não expor o servidor local diretamente.

Os antigos arquivos com credenciais foram retirados do código atual, mas permanecem
no histórico Git. Substitua qualquer senha publicada que tenha sido utilizada.

Veja [arquitetura, API, limites e próximos passos](docs/ARQUITETURA.md).

### Perguntas do cliente e clareza dos materiais

Na obra, a aba **Perguntas** permite ao cliente abrir um assunto e continuar a
conversa com o engenheiro. Autor, data e mensagens permanecem no histórico. O
indicador mostra quem deve responder. Atualize a obra para buscar novas mensagens;
não há envio de e-mail, WhatsApp ou atualização em tempo real nesta versão.
As conversas pertencem ao cliente que as iniciou: após trocar o titular, ficam
somente para consulta do engenheiro e não são transferidas ao novo cliente.

**Nova etapa** fica apenas no **Cronograma**. O quadro apresenta as mesmas etapas
por situação e oferece um atalho para gerenciá-las no cronograma.

Em Materiais, escolha a unidade na lista (por exemplo, `saco`, `un`, `kg`,
`m²`, `m³`) e informe separadamente a quantidade que já existe na obra. Valores
antigos fora da lista, inclusive `1000 un`, aparecem
como **Unidade a corrigir**. Use **Editar cadastro** para corrigir a medida; isso
preserva as quantidades e o histórico, sem conversão ou suposição sobre os valores.
Unidades válidas continuam protegidas contra troca para impedir conversões falsas.
A migração 3 cria as tabelas de conversas automaticamente no próximo início.

### Estoque, compras, acabamentos e pós-obra

- **Entradas e retiradas:** use Registrar entrada para material que chegou. Para
  material utilizado, use Registrar retirada. A prévia mostra o saldo que ficará.
  Exemplo: 1.000 un − 400 un − 100 un = 500 un. Não transforme lançamentos antigos
  automaticamente: se foram entradas por engano, estorne cada uma com motivo e
  registre as retiradas corretas. O estorno é um movimento contrário auditado.
- **Reservas:** Na obra é o saldo físico; Reservado é o que foi separado para
  serviços; Livre para usar = Na obra − Reservado. Registrar uso dá baixa uma vez.
  Liberar reserva apenas devolve a quantidade ao saldo livre. Estoque mínimo gera
  alerta quando o saldo livre fica abaixo do mínimo configurado.
- **Compras:** use Registrar compra para o que já foi comprado e está entrando na
  obra. Escolha um material existente ou cadastre o novo ali mesmo. Informe
  quantidade, preço unitário, frete, fornecedor, data e número da nota (opcional).
  A prévia mostra total, saldo do orçamento e entrada no estoque. Informe se já
  foi paga (registra o pagamento) ou ficou a pagar (registra a despesa pendente).
  A confirmação faz tudo em uma transação, sem repetir na aba Materiais/Despesas.
  O saldo do orçamento é orçamento menos todas as despesas registradas; não é
  um extrato bancário e diminui também para compras a prazo. A lista mostra o
  estado atual do pagamento. Cotações e pedidos intermediários foram desativados.
  Registros anteriores ainda pendentes ficam em área recolhida: podem ser
  concluídos com os dados da compra efetiva ou cancelados, sem lançamento automático.
- **Acabamentos:** crie um rascunho por ambiente, adicione opções e fotos de
  referência do mapa fotográfico, depois envie ao cliente. Fotos precisam estar
  publicadas. O cliente escolhe uma opção ou recusa as propostas. A decisão fica
  imutável; adicionais não alteram o orçamento nem criam despesa automaticamente.
- **Vistoria e pós-obra:** cliente ou engenheiro registra a pendência; podem anexar
  até dez fotos JPG/PNG/WebP de até 8 MB cada. O engenheiro informa responsável,
  prazo e andamento; após Correção realizada, o cliente ou engenheiro confere e
  encerra. Se necessário, reabra com justificativa. O histórico não é apagado.
  Registros pertencem ao cliente vinculado na criação e não passam a outro titular.

A migração 4 adiciona essas estruturas automaticamente e preserva os dados
anteriores. Faça backup de DATA_DIR com o servidor parado antes de atualizar.

### Organização atual (migração 5)

Perguntas, Acabamentos e Vistoria e pós-obra ficam no final das abas para os dois
perfis. Materiais usa cartões por item, saldo disponível, alertas, busca e filtros.
Registrar retirada dá baixa; Comprar mais abre a compra já com o material escolhido.
Estoque inicial é para material que já existia, sem nova compra. Entrada sem compra
(doação, devolução de uso ou ajuste justificado), reservas e edição ficam em Outras
ações. Histórico e reservas são recolhidos por padrão e podem ser consultados.

A migração 5 preserva compras e saldos anteriores, sem repetir despesas, pagamentos
ou movimentos. Nenhum registro antigo pendente vira compra automaticamente.

### Revisão funcional (migração 6)

A Visão geral reúne pendências existentes por obra e dá acesso direto à tela de
resolução. Engenheiro e cliente têm indicadores diferentes, preservando dados
internos. Filtros de materiais reiniciam ao abrir outra obra; cadastros repetidos
na mesma unidade são bloqueados; 100% de avanço físico exige execução completa dos serviços contratados.
Profissionais citados no histórico do diário devem ser inativados em vez de excluídos.

Em Compras, **Corrigir compra** abre um estorno integral justificado. Exige saldo
livre para toda a quantidade; desfaz estoque, custo e pagamentos no sistema,
preservando os originais e devolvendo o custo ao saldo do orçamento. Depois registre
a compra correta. Não movimenta dinheiro no banco nem substitui devolução física
parcial ao fornecedor. Despesas canceladas não aceitam novos pagamentos/edições.

Veja [casos de uso, ajustes verificados e próximas funções propostas](docs/REVISAO_CASOS_DE_USO.md).

### Serviços contratados e celular (migração 7)

1. Abra a obra em **Serviços contratados**. Cadastre o que foi contratado, a
   quantidade/unidade ou acompanhamento por percentual e a participação no total.
   Exemplo: fundação 30%, alvenaria 40% e pintura 30%.
2. Confira se as participações somam 100% e use **Confirmar contratação**.
3. Use **Registrar execução** para informar o realizado em cada ocasião. Se foram
   feitos 20 m² hoje, registre 20, mesmo que já houvesse execução anterior. Em modo
   percentual, informe o avanço adicional daquele registro. Fotos são opcionais;
   apenas fotos publicadas aparecem para o cliente.
4. Organize tarefas no Quadro/Cronograma e vincule-as aos serviços. Essas tarefas
   não compõem o percentual físico. Compras/pagamentos também não o alteram.
5. Quantidade errada pode ser corrigida com justificativa no histórico de execução.
   **Revisar escopo** altera o contratado, incluindo novos serviços e participações,
   e registra motivo, versões e impacto no avanço. Não altera o orçamento nem
   equivale a aceite ou assinatura digital do cliente.

Cálculo: soma da participação de cada serviço × fração executada. Fundação completa
com participação 30%, metade da alvenaria com 40% e pintura não iniciada com 30%
resultam em 50% de avanço. Não se somam quantidades de unidades distintas. O sistema
bloqueia execução acima do contratado, redução de contrato abaixo do já executado
ou troca da unidade/modo de serviço com histórico.

Obras existentes mantêm seus dados e tarefas. O avanço físico aparece como
**A definir** até a contratação ser configurada. Percentuais antigos de tarefas
não são convertidos automaticamente em serviços ou em execução física.

Em celulares, a interface possui navegação inferior Início/Obras/Clientes/Conta,
seletor de área da obra, botões de toque, formulários em painel inferior, campos
legíveis e espaços para as áreas seguras da tela. O cliente não vê Clientes ou
áreas internas de gestão. Desktop mantém navegação lateral e abas. Manifesto e
ícone permitem apresentação independente em navegadores compatíveis; não há
aplicativo nativo ou funcionamento offline. Não se armazenam dados privados em
cache offline.

Para testar no celular na mesma rede Wi-Fi do computador:

1. No PowerShell, execute `ipconfig` e localize o IPv4 da conexão ativa.
2. No `.env`, use `HOST=0.0.0.0` e ajuste `APP_ORIGIN` para esse endereço, por
   exemplo `APP_ORIGIN=http://192.168.1.10:3000` (substitua pelo IPv4 real).
3. Reinicie com `npm start` e abra esse mesmo endereço no computador e celular.
   `localhost` no celular aponta para o próprio celular. Se o Windows pedir
   autorização de rede para o Node, libere a rede privada usada no teste.

Esse é um teste na rede local. Para acesso externo, a aplicação precisa estar
hospedada com endereço próprio e HTTPS. O servidor continua disponível no desktop.
