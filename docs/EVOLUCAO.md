# Próximas funcionalidades propostas

Recomendações para a rotina de um engenheiro com várias obras. Os módulos abaixo
não estão implementados nesta entrega; a ordem busca valor operacional e rastreabilidade.

| Ordem | Módulo | Entrega inicial sugerida |
| --- | --- | --- |
| 1 | Diário de obra | Registro por data de serviços, equipe presente, ocorrências e fotos, com publicação de resumo para o cliente e relatório PDF. |
| 2 | Movimentação de materiais | Entradas, consumo, perdas e transferências, unidade, fornecedor e histórico; saldo calculado a partir dos movimentos. |
| 3 | Financeiro por obra | Vencimentos, fornecedor, pagamentos parciais, comprovantes, categorias e comparação entre orçamento e realizado. |
| 4 | Cronograma e medição | Planejado versus realizado, datas efetivas, responsáveis, alertas de atraso e pesos por etapa. |
| 5 | Solicitações e aprovações | Dúvidas, pedidos de mudança, orçamento adicional e aceite do cliente com autor, data e histórico. |
| 6 | Documentos versionados | Categorias, revisões, validade, versão vigente e histórico, sem substituir silenciosamente o documento anterior. |

Começar pelo diário permite consolidar uma linha do tempo da execução e a
comunicação com o cliente. Depois, estoque e financeiro podem vincular movimentos
e despesas aos registros da obra. O progresso atual continua calculado pela
quantidade de etapas concluídas, sem medição física ponderada.

## Preparação para uso real

Antes de depender da instalação no dia a dia: testar backup e restauração de
banco/arquivos, configurar HTTPS e supervisão do processo, implementar recuperação
de conta e definir a política de exclusão/auditoria. A versão atual é uma base
local de validação, sem implantação em VPS nesta entrega.
