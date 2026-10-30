# Evolução da plataforma

## Implementado nesta entrega

| Módulo | Entrega |
| --- | --- |
| Diário de obra | Data, serviços, ocorrências, equipe presente por snapshot, fotos, notas internas, publicação, revisões, arquivamento e relatório para imprimir/salvar PDF. |
| Materiais | Cartões por material, busca/filtros, saldo livre em destaque, compra/retirada, catálogo de unidades, alertas, reservas e histórico recolhido. |
| Compras | Compra efetuada em um registro: material novo/existente, quantidade, preço/frete, fornecedor/nota, estoque, despesa/pagamento e saldo do orçamento. |
| Acabamentos | Opções com fotos e adicionais por ambiente, envio ao cliente e decisão imutável. |
| Vistoria e pós-obra | Pendências, fotos enviadas pelo cliente, atendimento, responsável/prazo, conferência, reabertura e histórico. |
| Financeiro | Fornecedor, vencimento, pagamento parcial, comprovante, estorno justificado, indicadores e orçamento versus realizado. |
| Cronograma | Percentual concluído por etapa e participação relativa opcional, responsável, datas previstas/reais e alertas de prazo vencido. |
| Perguntas | Conversas por obra, histórico de mensagens, autor/data, indicação de resposta e isolamento por cliente. |
| Aprovações | Rascunho, envio ao portal, bloqueio do conteúdo enviado, aceite/recusa do cliente, autor/data e histórico preservado. |

## Revisão funcional

Correção integral de compra com estorno coordenado, atenção por perfil na visão geral,
isolamento de filtros, bloqueio de material duplicado, avanço coerente, preservação
de equipe histórica e validação de ações da API. Casos detalhados em
[REVISAO_CASOS_DE_USO.md](REVISAO_CASOS_DE_USO.md).

## Evoluções ainda propostas

- Revisões e categorias de documentos, versão vigente e validade.
- Dependências entre etapas, Gantt e comparativos de produtividade.
- Catálogo compartilhado de materiais, devoluções e eventual retomada de pedidos/cotações.
- Convites e recuperação de conta, notificações e consulta da auditoria geral.
- Backup automatizado, restauração validada e implantação com HTTPS na VPS.

A aplicação continua atendendo uma conta de engenheiro e várias obras/clientes.
Não há emissão fiscal, assinatura digital, aplicativo offline ou integração bancária.
