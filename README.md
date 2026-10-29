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
- Quadro de etapas: planejada, em execução e concluída.
- Mapa fotográfico com data, ambiente, descrição e vínculo a uma etapa.
- Documentos e notas em PDF/imagem; download protegido por autorização.
- Publicação explícita de fotos/documentos para o cliente; internos por padrão.
- Cadastro/edição/exclusão de materiais, despesas e profissionais por obra.
- Visão financeira interna: registrado, pago, pendente e saldo do orçamento.
- Portal do cliente, sem acesso a outras obras ou aos cadastros internos.
- Registro de auditoria das alterações no banco, ainda sem tela de consulta.

O mapa fotográfico é um histórico de fotos por local/etapa, sem planta interativa
ou georreferenciamento nesta versão. Materiais têm controle simples de quantidade,
sem movimentação de estoque. Não há emissão fiscal, folha de pagamento ou envio de e-mails.

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
visibilidade de anexos, cadastros, validação de valores/datas e persistência.
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
