# Gestão de Obras — primeira versão

## Escopo e limites

Uma instalação atende **um engenheiro**, com várias obras e clientes. Existe
restrição no banco para uma única conta ENGINEER. Um cliente pode estar vinculado
a várias obras; cada obra tem um cliente titular nesta versão. A gestão de
funcionários é um cadastro por obra, sem acesso de funcionário ao sistema.

O frontend responsivo usa HTML/CSS/JavaScript e a API usa Node.js 24 e SQLite
(`node:sqlite`). Não há dependências de execução externas ao Node, contêiner,
mensageria ou consumidor Python. Essa é uma escolha para experimentação local e
uso inicial com baixa concorrência. A migração para PostgreSQL ainda não está
implementada: será necessária se houver expansão de usuários/instâncias.

## Relações

- `users`: engenheiro e contas de clientes, com hash scrypt individual e salt.
- `projects`: obra, cliente titular, endereço, datas, orçamento em centavos e situação.
- `stages`: etapa, peso, medição percentual, responsável, situação e datas previstas/reais.
- `attachments`: fotos/documentos vinculados à obra e opcionalmente a uma etapa.
- `materials`: cadastro/unidade e cache do saldo por obra.
- `material_movements`: razão imutável de abertura, entrada, consumo, perda e transferências.
- `expenses`: despesa, fornecedor, categoria, vencimento e valor em centavos.
- `expense_payments`: pagamentos parciais, comprovante e estorno com justificativa.
- `diary_entries`: diário, equipe por snapshot, fotos, versão, visibilidade e arquivamento.
- `diary_revisions`: snapshots das revisões anteriores, autor e data.
- `approvals`: conteúdo da proposta, destinatário no envio, decisão e autor/data do aceite.
- `workers`: profissional, função, telefone e situação por obra.
- `sessions`: apenas o hash dos tokens, com validade de oito horas.
- `audit_log`: autor, ação, identificador e data das alterações.
- `migrations`: versão do schema aplicado automaticamente na inicialização.

O progresso é a média ponderada das medições por etapa, sem vínculo automático
com os volumes 3D ilustrativos. Em uma etapa de peso 1 com 100% e outra de peso 3
com 50%, o avanço exibido é 63% (62,5% arredondado). A contagem de etapas concluídas
continua disponível em separado.

Materiais usam soma dos deltas arredondada a três casas; a coluna `quantity` é
atualizada como cache. Transferências debitam e creditam em uma transação, com
`transfer_id` compartilhado. Não somar materiais de unidades diferentes. A unidade
não pode ser alterada após o cadastro; correções de saldo usam novos movimentos.

Pagamentos efetivos são somados sem os estornados. Parcial é derivado do total pago,
não um estado de quitação editável. O orçamento não é somado ao realizado. Adicionais
aprovados são um indicador separado e não geram lançamentos automaticamente.

## Autorização

O servidor verifica o perfil e o vínculo em cada acesso. Clientes têm leitura das
próprias obras e etapas, além dos anexos com `visible_to_client=1`. Não recebem
orçamento, despesas, materiais ou equipe nas respostas da API. Não podem cadastrar
ou alterar os cadastros operacionais; podem decidir somente propostas pendentes
endereçadas à sua conta. Diários publicados omitem notas internas e nomes da
equipe, e filtram as fotos conforme publicação. Arquivos não são públicos: a rota de download exige a mesma
autorização da obra e da publicação. Não se utiliza o nome original como caminho.

O engenheiro cadastra os clientes com senha inicial de pelo menos 12 caracteres,
compartilhada por canal privado. Ambos os perfis podem mudar a própria senha,
informando a atual. A mudança invalida todas as sessões da conta. Convite por
e-mail, recuperação de senha e revogação de conta pela interface são evoluções pendentes.

## Endpoints

| Método e caminho | Permissão |
| --- | --- |
| `GET /api/health` | Público; resposta mínima de disponibilidade |
| `POST /api/auth/login` | Público; e-mail e senha |
| `GET /api/auth/me` | Sessão ativa |
| `POST /api/auth/logout` | Sessão ativa |
| `POST /api/auth/password` | Sessão ativa; senha atual e nova |
| `GET, POST /api/clients` | Engenheiro |
| `GET /api/projects` | Engenheiro ou obras do cliente |
| `POST /api/projects` | Engenheiro |
| `GET /api/projects/:id` | Engenheiro ou cliente titular |
| `PATCH /api/projects/:id` | Engenheiro; formulário completo |
| `PATCH /api/projects/:id/client` | Engenheiro; vínculo explícito (`client_id` ou `null`), preservando os demais campos |
| `POST /api/projects/:id/stages` | Engenheiro |
| `PATCH, DELETE /api/projects/:id/stages/:recordId` | Engenheiro |
| `POST /api/projects/:id/{materials,expenses,workers}` | Engenheiro |
| `PATCH, DELETE /api/projects/:id/{materials,expenses,workers}/:recordId` | Engenheiro |
| `POST /api/projects/:id/attachments` | Engenheiro; arquivo base64 e metadados |
| `PATCH /api/attachments/:id` | Engenheiro; publicação (`visible_to_client`) |
| `DELETE /api/attachments/:id` | Engenheiro |
| `GET /api/attachments/:id/file` | Sessão e autorização no arquivo; `?download=1` para baixar |

POST/PATCH requerem JSON; mutações exigem `Origin` igual a `APP_ORIGIN`. PATCH dos
cadastros recebe os campos completos, não um documento JSON Patch. Exclusão de
etapa mantém os anexos e remove o vínculo, com registro da exclusão na auditoria.

O endpoint de vínculo exige a propriedade `client_id`; um campo omitido não remove
o acesso por acidente. A conta precisa ser de cliente ativo. Nome/e-mail do titular
são expostos somente ao engenheiro. A troca de vínculo aplica-se imediatamente em
todos os acessos seguintes, inclusive nos downloads de arquivos já publicados.

O cadastro de cliente dentro da obra usa primeiro `POST /api/clients`, depois o
salvamento da obra ou do vínculo. São duas operações: se a segunda falhar, a conta
criada permanece disponível para seleção e nova tentativa, sem recriá-la. Cancelar
o formulário após esse erro não apaga a conta criada.

## Apresentação arquitetônica

`public/visuals.js` contém ícones vetoriais e geometria HTML para ilustrações CSS 3D.
Cada volume tem quatro fachadas e uma cobertura. Os controles alternam oito vistas;
não há carregamento de modelo real, BIM, WebGL ou arquivos externos. As ilustrações
são identificadas na interface como ilustrativas e não usam medidas da obra.

A camada visual não determina o progresso da obra. Animações/transições são
desativadas com `prefers-reduced-motion`. Ilustrações decorativas ficam fora da
árvore de acessibilidade; controles possuem rótulos e suporte de teclado. As abas
suportam setas, Home e End. Na versão móvel, as abas rolam horizontalmente.

## Arquivos e segurança operacional

Uploads aceitam JPG, PNG, WebP e PDF de até 8 MB, verificando assinatura de arquivo.
Isso não substitui antivírus nem validação integral do formato. PDF é entregue
como download; SVG/HTML não são aceitos. Arquivos ficam fora de `public/`.

Cookies são HttpOnly/SameSite=Strict e Secure em produção. Há limite de tentativas
de login por IP, em memória (reinício o zera), CSP e consultas parametrizadas.
Não há CORS aberto. Em produção, usar uma única instância e proxy HTTPS; não confiar
em `X-Forwarded-For` fornecido pelo cliente. Atrás de proxy, o limite por IP será
compartilhado pelo endereço do proxy nesta implementação.

O SQLite síncrono e a leitura dos arquivos em memória são adequados à versão
inicial, com limites de tamanho. Antes de abrir a instalação à internet, revisar
backup/restauração, supervisão do processo, HTTPS, limites no proxy, antivírus,
recuperação de conta e capacidade para o volume de fotos esperado. Esta versão
não foi validada em uma VPS nem com dados reais.

## Módulos operacionais e consistência

`server/operations.mjs` concentra as regras dos novos módulos; `public/operations-ui.js`
fornece formulários, listas e relatório de impressão. A migração 2 preserva saldos,
pagamentos antigos e etapas. `tests/fixtures/schema-v1.sql` representa o schema anterior
para o teste de migração, não deve ser executado manualmente em banco atualizado.

| Método/caminho relativo a `/api/projects/:id` | Regra |
| --- | --- |
| `GET, POST /diary` | Leitura autorizada; criação pelo engenheiro |
| `GET, PATCH, DELETE /diary/:entry` | Leitura autorizada; edição com `version`; DELETE arquiva |
| `GET /diary/:entry/revisions` | Somente engenheiro; revisões anteriores |
| `GET /materials`, `/expenses`, `/stages`, `/approvals` | Conforme perfil e vínculo |
| `POST /materials/:material/movements` | Entrada/consumo/perda/transferência; engenheiro |
| `POST /expenses/:expense/payments` | Pagamento parcial; engenheiro |
| `POST /expenses/:expense/payments/:payment/void` | Estorno com motivo; engenheiro |
| `POST, PATCH /approvals[/:approval]` | Rascunhos do engenheiro |
| `POST /approvals/:approval/send` | Publica para o cliente atual e fixa destinatário |
| `POST /approvals/:approval/cancel` | Somente antes de uma decisão |
| `POST /approvals/:approval/decision` | Cliente destinatário e titular atual; aprovação ou recusa |

Os pagamentos e movimentos recebem `request_id` opcional, estável por submissão
no frontend, para que uma repetição idêntica não duplique o lançamento. Reutilizar
o identificador com conteúdo diferente retorna 409. Transferências e pagamentos
validam o saldo dentro da transação. Estornos e decisões usam atualização condicional
para impedir repetição. Edição de diário compara a versão atual dentro da transação.

A proposta enviada torna-se imutável. A decisão registra autor e timestamp UTC,
sem equivalência a uma assinatura digital. Trocar o titular não transfere propostas
antigas ao novo cliente. Documentos de pagamentos e fotos referidas por diário ou
revisão são protegidos contra exclusão, inclusive após estorno/arquivamento.

O relatório do diário utiliza HTML de impressão e `window.print()`, com Save as PDF
no navegador, sem serviço externo. Aguarda carregamento das imagens e omite notas
internas. O cliente imprime somente dados autorizados. Não há exportação financeira,
relatório de medição assinado ou emissão de documentos fiscais nesta entrega.

## Próximas entregas propostas

1. Validar as rotinas com o engenheiro usando dados fictícios.
2. Categorias e revisões de documentos; dependências entre etapas e visualização Gantt.
3. Convites, recuperação e desativação de contas, notificações e auditoria geral na interface.
4. Plano de produção, backup automatizado e restauração testada; avaliar PostgreSQL.

## Conversas por obra (migração 3)

`questions` guarda assunto, obra e cliente original. `question_messages` mantém
mensagens imutáveis, autor e timestamp. `GET /api/projects/:id/questions` lista
conversas autorizadas; `POST` cria um assunto (cliente apenas), e
`POST /api/projects/:id/questions/:question/messages` acrescenta uma resposta.
O campo derivado `awaiting` indica o papel que deve responder. Identificadores
`request_id` tornam reenvios idênticos seguros. Permissão e vínculo são checados
novamente dentro da transação após a leitura do corpo da requisição.

O engenheiro consulta todas as conversas da obra, enquanto o cliente só consulta
as próprias e precisa continuar titular da obra. Após uma troca de titular,
conversas anteriores não recebem respostas e não aparecem para o novo cliente.
Não há exclusão/edição de mensagens, envio externo ou polling automático.

Materiais com unidade numérica legada podem ter somente o rótulo corrigido,
com auditoria específica, sem mudar saldo ou movimentos. A validação exige pelo
menos uma letra; unidades válidas continuam imutáveis. Não há conversão automática.

## Fluxos operacionais (migração 4)

O catálogo de unidades é compartilhado em `public/units.js` e validado no servidor.
Campos textuais antigos não pertencentes à lista exigem seleção explícita, sem
converter quantidades. Unidades válidas continuam imutáveis no cadastro.

`server/workflows.mjs` implementa operações transacionais e `public/workflows-ui.js`
fornece as telas. `operation_requests` guarda o fingerprint por usuário/caminho e
corpo, além do resultado, para reenvio idempotente com `request_id` estável. As
permissões são verificadas antes de devolver resultados anteriores e novamente
na transação. O cliente nunca recebe compras, estoque ou reservas.

Rotas abaixo recebem POST e são relativas a `/api/projects/:project`:

| Rota | Regra |
| --- | --- |
| `/movements/:id/reverse` | Estorna entrada/consumo/perda manual com justificativa; não reverte transferências, recebimentos ou uso de reservas isoladamente. |
| `/reservations` | Reserva saldo livre, opcionalmente para uma etapa da mesma obra. |
| `/reservations/:id/consume` | Cria saída e finaliza a reserva na mesma transação. |
| `/reservations/:id/release` | Libera a reserva sem movimentação física. |
| `/purchases` | Solicita compra de material da própria obra. |
| `/purchases/:id/quotes` | Cotação manual com preço unitário, frete e total calculado no servidor. |
| `/purchases/:id/order` | Fixa a cotação e bloqueia novas propostas. |
| `/purchases/:id/receive` | Recebe todo o pedido uma única vez e cria entrada mais despesa pendente atomicamente. |
| `/purchases/:id/cancel` | Cancela somente antes do recebimento; exige motivo. |
| `/selections` e `/selections/:id/options` | Rascunho do engenheiro e opções de acabamento com foto/adicional. |
| `/selections/:id/send` | Fixa destinatário atual, exige opções e fotos publicadas. |
| `/selections/:id/choose` ou `/reject` | Decisão única pelo destinatário que continua titular. |
| `/selections/:id/cancel` | Somente engenheiro, rascunho ou pendente. |
| `/inspections` | Abre pendência vinculada ao titular atual; sem cliente, fica interna. |
| `/inspections/:id/update` | Engenheiro registra andamento, responsável, prazo e nota. |
| `/inspections/:id/close` ou `/reopen` | Conferência após correção ou reabertura com nota; titular ou engenheiro. |
| `/inspections/:id/photo` | Upload autorizado e idempotente de foto, até dez por pendência; mesma proteção de formatos/tamanho dos anexos. |

GET nas coleções (exceto movements) retorna somente dados autorizados. Todas as
coleções também integram o detalhe da obra. Fotos de pendências são publicadas
na obra e protegidas contra exclusão. Fotos posteriormente tornadas internas
somem das respostas do cliente. A escolha de acabamento não modifica o orçamento
nem cria despesa. Troca de titular não transfere escolhas/pendências anteriores.

Saldo físico = soma dos deltas; saldo livre = físico − reservas ativas. Toda
retirada ou transferência considera o livre dentro da transação. Estornos usam
`reverses_id` único e movimento compensatório; histórico original permanece.
Materiais ou despesas usados por compras não podem ser apagados; valores de
recebimentos são protegidos contra edição isolada. Etapas referidas por reservas
não podem ser excluídas. A apresentação do histórico segue a ordem de registro.

Limites: cotação manual, recebimento completo (sem parcial/devolução), sem contato
externo automático, assinatura digital ou cobrança a partir de escolhas. Não há
conversão de unidades nem ajuste automático de lançamentos antigos ambíguos.

## Compras diretas e organização atual (migração 5)

Esta seção substitui o fluxo de cotação/pedido/recebimento descrito na migração 4.
POST `/api/projects/:project/purchases` registra a compra efetuada. Recebe
`material_id` ou `new_material: {name,unit}`, quantity, unit_price, freight,
purchase_date, supplier, invoice_number, payment_status (PAID/PENDING), method,
due_date, notes e request_id. O servidor calcula o total em centavos, reutiliza
material com mesmo nome/unidade ou cadastra o novo e, na mesma transação, cria:
entrada de estoque, despesa, pagamento integral quando informado como pago e
registro da compra. Saldo de orçamento continua derivado de orçamento − despesas;
compras a prazo também comprometem esse saldo, enquanto pago/a pagar são separados.
O cadastro novo não ignora material homônimo com unidade legada inválida: exige
corrigir primeiro o cadastro existente para evitar duplicação ambígua.

POST `/purchases/:id/complete` permite concluir registros anteriores pendentes,
exigindo o mesmo material e os dados da compra real. POST `/cancel` preserva o
cancelamento dos pendentes. Rotas de quotes/order/receive retornam conflito,
orientando a usar Registrar compra. Reenvios idênticos continuam idempotentes.
Dados de cotações antigas são preservados no banco; compras recebidas têm seus
metadados preenchidos pela migração sem criar lançamentos adicionais. Rascunhos
pendentes permanecem sem efeito no estoque ou financeiro até confirmação explícita.

Perguntas/Acabamentos/Vistoria ficam nas últimas posições das abas. Materiais
prioriza saldo livre por cartão e compra/retirada; reservas, entradas sem custo e
histórico são acessíveis sob demanda. A retirada não oferece o tipo Entrada.
