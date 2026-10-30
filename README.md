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
- Cronograma com pesos, medição por etapa, responsáveis e datas previstas/reais.
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
  não são apagados. Correções de quantidade exigem um novo movimento com justificativa.
- **Despesas:** registre fornecedor, categoria, valor e vencimento. Use **Pagar**
  para registrar pagamentos parciais, escolhendo comprovantes da aba Documentos.
  **Pagamentos** mostra o histórico e permite estornar com justificativa. Registros
  com histórico de pagamentos não podem ser excluídos. O realizado soma despesas
  registradas; o pago soma pagamentos não estornados, sem duplicar os valores.
- **Cronograma:** configure peso, medição de 0 a 100%, responsável e datas de cada
  etapa. O avanço é `soma(peso × medição) / soma(pesos)`, arredondado ao inteiro.
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
