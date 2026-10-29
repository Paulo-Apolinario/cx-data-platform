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
- `stages`: etapas vinculadas à obra, datas e situação.
- `attachments`: fotos/documentos vinculados à obra e opcionalmente a uma etapa.
- `materials`: quantidade registrada, unidade e observações por obra.
- `expenses`: despesas, categoria, data, valor em centavos e pagamento.
- `workers`: profissional, função, telefone e situação por obra.
- `sessions`: apenas o hash dos tokens, com validade de oito horas.
- `audit_log`: autor, ação, identificador e data das alterações.
- `migrations`: versão do schema aplicado automaticamente na inicialização.

O percentual é **etapas concluídas / etapas cadastradas**. Não representa medição
física ponderada; a interface informa essa regra. O total de despesas inclui
pagas e pendentes, sem somar o orçamento. Materiais ainda não têm movimentações
de entrada/consumo: a quantidade é editada diretamente. Não somar unidades diferentes.

## Autorização

O servidor verifica o perfil e o vínculo em cada acesso. Clientes têm leitura das
próprias obras e etapas, além dos anexos com `visible_to_client=1`. Não recebem
orçamento, despesas, materiais ou equipe nas respostas da API. Não podem cadastrar
ou alterar registros. Arquivos não são públicos: a rota de download exige a mesma
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

## Próximas entregas propostas

1. Validar formulários e fluxo com o engenheiro, usando dados fictícios.
2. Filtros do mapa fotográfico, relatório PDF e diário de obra.
3. Histórico de entradas/consumo de materiais e anexos de comprovantes nas despesas.
4. Medição física com pesos, responsáveis e dependências entre etapas.
5. Convites, recuperação e desativação de contas, histórico de acesso e alterações.
6. Plano de produção, backup automatizado e restauração testada; avaliar PostgreSQL.
