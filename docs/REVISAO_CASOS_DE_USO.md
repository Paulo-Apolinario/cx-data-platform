# Revisão funcional e casos de uso — 30/10/2026

Escopo: gestão para um engenheiro, várias obras e clientes titulares, sem Docker.
Revisão em banco temporário com dados demonstrativos, testes HTTP contra servidor
real e navegação Chromium em desktop/celular. Os dados locais do engenheiro não
foram acessados ou modificados durante a validação.

## Casos de uso

| Caso | Ação do usuário | Tratamento validado |
| --- | --- | --- |
| UC01 — Obra e cliente | Criar obra A para cliente A e obra B para cliente B | Login, vínculos, datas e orçamento validados; cada cliente vê suas obras e os dados publicados. |
| UC02 — Compra paga | Comprar 10 sacos a R$ 30 em uma obra com orçamento de R$ 5.000 | Material recebe 10; despesa registra R$ 300; saldo do orçamento R$ 4.700; pagamento integral quando informado como pago. |
| UC03 — Compra a prazo e pagamento parcial | Registrar a mesma compra a pagar e pagar R$ 100 | Custo permanece R$ 300; pago R$ 100 e saldo da despesa R$ 200; o pagamento não desconta o orçamento novamente. |
| UC04 — Reenvio de compra/pagamento | Repetir submissão com o mesmo identificador e dados | Compra, estoque, despesa e pagamento não são duplicados. Alterar dados usando o mesmo identificador gera conflito. |
| UC05 — Uso e reserva | Retirar 2 dos 10 sacos e reservar 3 para um serviço | Na obra 8, reservado 3, livre 5. Usar a reserva dá baixa uma vez; liberar apenas devolve ao saldo livre. |
| UC06 — Transferência | Enviar material para outra obra | Saída e entrada atômicas, mesma unidade, respeitando saldo livre. Não mistura financeiro ou contas de clientes. |
| UC07 — Compra incorreta | Corrigir compra com quantidade/valor errado | Corrigir compra exige motivo e saldo livre para a quantidade integral. Estorna compra, custo e pagamentos no sistema, preserva registros e permite lançar a compra correta. |
| UC08 — Compra parcialmente usada | Tentar estornar compra já consumida/reservada | Bloqueio com explicação. Corrija a retirada ou libere a reserva e recomponha o saldo antes de estornar a compra integral. Não cria estoque negativo. |
| UC09 — Duas ações simultâneas | Pagar uma despesa enquanto a compra é estornada | Verificação dentro da transação; despesa cancelada não termina com pagamento ativo. |
| UC10 — Cadastro repetido | Criar novamente material de mesmo nome/unidade ou renomear outro para esse cadastro | Bloqueio no estoque inicial/edição; compras reutilizam o cadastro existente. Unidade legada ambígua exige correção explícita. |
| UC11 — Cronograma | Informar 99,9% em etapa ainda em execução | Tarefa não altera avanço físico. Serviços contratados e registros de execução definem o progresso; a contratação precisa estar confirmada. |
| UC12 — Diário e equipe | Inativar ou tentar excluir profissional que apareceu no diário | Inativação permitida, exclusão bloqueada se houver registro atual ou revisão. Equipe e notas internas não são expostas ao cliente. |
| UC13 — Fotos e documentos | Publicar, tornar interno, baixar ou excluir arquivo referenciado | Autorização em cada acesso; cliente só vê publicação. Arquivos usados em pagamentos, diário/revisões, acabamentos e vistorias têm exclusão protegida. |
| UC14 — Perguntas e decisões | Cliente pergunta, recebe resposta, aprova adicional ou escolhe acabamento | Conta/data e histórico preservados; apenas destinatário titular decide; decisão não altera orçamento nem gera cobrança automaticamente. |
| UC15 — Vistoria/pós-obra | Cliente abre pendência, envia foto, engenheiro resolve e cliente confere | Fotos restritas à própria pendência, atendimento com responsável/prazo, encerramento e reabertura justificada. |
| UC16 — Troca de titular | Desvincular cliente A e vincular cliente B | Cliente A perde acesso; conversas, escolhas, aprovações e chamados anteriores não passam a B. Arquivos publicados pertencem à obra e continuam conforme a política de publicação da obra. |
| UC17 — Alternar entre obras | Filtrar materiais na obra A e abrir obra B | Busca/filtro e seleção de histórico reiniciados, evitando falsa aparência de estoque vazio na outra obra. |
| UC18 — Rotina diária | Abrir Visão geral e consultar pendências | Engenheiro vê etapas vencidas, contas vencidas, estoque baixo, perguntas sem resposta e vistorias atrasadas, com atalhos. Cliente vê apenas decisões/seleções pendentes. |
| UC19 — Caminho inválido na API | Tentar uma ação de pagamentos em uma etapa | Resposta de operação não encontrada, sem editar/excluir registros de outra função. |
| UC20 — Atualização do sistema | Atualizar banco antigo e reiniciar | Migrações preservam saldos, pagamentos e compras anteriores; não transformam registros pendentes em despesas automaticamente. |

## Problemas encontrados e ajustes

- Faltava correção integral de compra: incluído estorno coordenado com histórico.
- Rechecagem de despesa cancelada precisava estar dentro da transação de pagamento,
  inclusive para requisições concorrentes: corrigida.
- Valores arredondados podiam exibir 100% com etapa incompleta: limite ajustado.
- Filtros de estoque persistiam ao abrir outra obra: reiniciados por obra.
- Estoque inicial/renomeação permitiam duplicar nome e unidade: bloqueados.
- Exclusão de profissional citado no diário podia prejudicar uma edição futura:
  bloqueada, com orientação para inativar.
- Caminhos da API com ação incompatível podiam alcançar uma operação genérica:
  restringidos por tipo de recurso.
- Pendências já registradas estavam dispersas: visão geral ganhou indicadores e
  atalhos por perfil, sem exigir novos preenchimentos.
- Linguagem no cartão da obra ainda usava Avanço ponderado: alterada para Avanço
  da obra, mantendo a participação avançada disponível ao engenheiro.

## Validação e limites

`npm test`: 70 testes aprovados, incluindo os novos cenários em
`tests/review.test.mjs` e as regressões de autenticação, estoque, compras, financeiro,
portal, diário, aprovações, acabamentos e pós-obra. Verificação de sintaxe e
`git diff --check` aprovadas.

Chromium/Playwright: painel de atenção/atalhos do engenheiro e cliente, troca de
obra com filtros, correção de compra, bloqueio de ações em despesa cancelada e
apresentação no celular sem overflow horizontal da página.

Estorno é um registro interno: não faz reembolso ou transação bancária. Não
implementa devolução física parcial ao fornecedor. Uma compra estornada conserva
valor original, motivo, despesa, pagamentos e movimentos para consulta, sem compor
novamente os totais atuais. Novas compras corrigidas devem ser registradas com os
dados efetivos.

Esta revisão valida os casos descritos. Implantação em produção, recuperação de
conta, backup/restauração automatizados, carga elevada, uso offline e integrações
externas continuam como trabalhos separados.

## Próximas funções propostas (ainda não implementadas)

| Prioridade | Função | Uso prático | Escopo inicial simples |
| --- | --- | --- | --- |
| 1 | Agenda da semana | Lembrar visita, entrega ou reunião | Data/hora, obra, observação e concluir compromisso. |
| 2 | Checklist por etapa | Conferir um serviço antes de encerrá-lo | Modelo editável pelo engenheiro, itens conferidos, observação/foto e pendência vinculada. |
| 3 | Serviços de empreiteiros | Saber o contratado, executado e a pagar | Prestador, serviço, quantidade/unidade, valor combinado e execução aprovada; lançamento financeiro explícito. |
| 4 | Ferramentas e equipamentos | Saber com quem estão e quando devolver | Item, obra, responsável, retirada e devolução; alerta de prazo. |
| 5 | Contatos de fornecedores | Encontrar rapidamente quem fornece ou presta serviço | Nome, telefone, especialidade e notas; reaproveitar nas compras. |
| 6 | Resumo semanal do cliente | Compartilhar avanço e próximos passos | Aproveitar diário, etapas e fotos publicadas para relatório revisado pelo engenheiro, sem envio automático. |

As propostas aproveitam os dados já existentes e evitam novas telas com informações
repetidas. A ordem pode ser ajustada conforme a rotina do engenheiro.

## Casos adicionais — serviços e uso no celular

- UC21: confirmar fundação (30%), alvenaria (40%) e pintura (30%); fundação em 100%
  e alvenaria em 100/200 m² resultam em 50%, independentemente de tarefas concluídas.
- UC22: acrescentar mais 100 m² contratados de alvenaria por revisão; avanço muda
  de 50% para 43%, com motivo e snapshots preservados e sem efeito financeiro.
- UC23: impedir execução excedente, alterações por cliente, fotografias de outra
  obra e alterações de unidade com histórico; correção de execução preserva original.
- UC24: executar duas medições concorrentes respeitando saldo contratado; repetição
  do mesmo request_id não duplica execução ou revisão.
- UC25: usar celular para contratação/revisão, trocar áreas, registrar compra e
  entrar/sair pela navegação inferior; cliente só consulta seus serviços publicados.

Validação adicional em tests/scope.test.mjs e Chromium em desktop e celular. As
obras anteriores continuam sem contratação inferida automaticamente. A configuração
do escopo deve ser realizada pelo engenheiro para exibir avanço físico.
