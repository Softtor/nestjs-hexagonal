# Dispatcher fluente e agnóstico — nestjs-hexagonal v1.4.0

## Objetivo e API

Migrar o padrão de eventos do plugin para uma abstração própria, configurada pelo container do NestJS. O desenvolvedor emitirá eventos pela mesma interface, independentemente de usar EventBus, Kafka, RabbitMQ ou um publisher customizado.

A entrada fluente será **`.event()`**, conforme sua correção:

```ts
// Evento por nome, com payload tipado
await dispatch(publisher)
  .event('order.created')
  .with({ orderId, total })
  .keyedBy(orderId)
  .publish();

// Evento por instância
await dispatch(publisher)
  .event(new OrderCreatedEvent(orderId, total))
  .publish();

// Mesmo contrato, com dispatcher injetado pelo container
await this.events
  .event('order.created')
  .with({ orderId, total })
  .publish();

// Eventos registrados pela entidade, após persistência
await repository.save(order);
await this.events.from(order).publish();

// Composição com RxJS
this.events
  .event(new OrderCreatedEvent(orderId, total))
  .publish$()
  .pipe(/* operadores */);
```

O objetivo é reduzir dependências e cerimônia nos handlers e entidades. Ganhos de desempenho serão tratados como hipótese, sem promessa na release.

## Contratos e comportamento

- Distribuir **templates testados em `shared/`**, seguindo o formato atual do plugin; não criar um novo pacote de runtime.
- Criar `EventPublisherPort` e seu token de DI. O contrato receberá uma requisição de publicação independente de SDK e aceitará retorno síncrono, `Promise` ou `Observable`.
- Oferecer `dispatch(publisher)` para uso explícito e `EventDispatcher` para injeção. Ambos compartilharão a mesma implementação e API.
- Eventos por string terão um mapa TypeScript de nomes e payloads. `.with()` será obrigatório antes da publicação e aceitará somente o payload correspondente ao nome.
- Eventos por instância preservarão o objeto e seu protótipo. Não haverá `.with()` nessa variante: os dados já estarão na instância.
- Builders serão imutáveis. `.keyedBy()`, `.withEventId()` e `.occurredAt()` configurarão a publicação sem alterar o evento recebido.
- A requisição normalizada distinguirá evento nomeado com payload de evento instanciado. Incluirá nome, identificador, data e chave opcional; formato de envelope, tópico e serialização pertencerão ao adapter.
- `.publish()` retornará `Promise<void>`; `.publish$()` retornará `Observable<void>` frio. Construir o builder não publicará nada; cada execução ou assinatura iniciará uma publicação.
- Publishers Observable deverão completar. Conclusão sem emissão contará como sucesso; erros serão propagados. Não haverá retry automático.

A chave será opcional no contrato geral. Adapters que precisem dela deverão exigir uma chave explícita ou derivá-la por configuração, sem inventar um valor.

## Domínio, container e adapters

**Domínio e handlers**

- Transformar a base `Entity` em TypeScript puro, removendo a herança de `AggregateRoot` do NestJS.
- Preservar `apply(event)` como registro local de eventos, sem publicação automática. Remover `mergeObjectContext()` e `commit()` do fluxo padrão.
- Remover a dependência `IEvent` da base `DomainEvent`; manter identidade e metadados estáveis para publicação e tentativas posteriores.
- `from(entity)` publicará os eventos pendentes em sequência e removerá cada um somente após sucesso. Na primeira falha, interromperá e manterá o evento que falhou e os seguintes.
- Persistência continuará sendo responsabilidade exclusiva do repositório. Publicação ocorrerá no handler depois do commit real da transação, não apenas depois de uma escrita ainda não confirmada.

**Configuração no NestJS**

- O container fornecerá o publisher pelo token `EVENT_PUBLISHER_TOKEN` e construirá o dispatcher usando esse provider.
- Documentar configuração com `useClass`, `useFactory` e `useExisting`, sem publisher global ou resolução oculta de dependências.
- O exemplo principal usará um adapter de EventBus para preservar os listeners existentes com `@EventsHandler`.

**Adapters e exemplos**

- **EventBus:** encaminhar a instância original. Para nomes em string, receber um catálogo explícito de factories que construa a classe esperada pelo listener; nomes sem factory produzirão erro.
- **EventPublisher do NestJS:** fornecer um adapter de compatibilidade que encapsule o fluxo legado exclusivamente na infraestrutura.
- **Memória:** registrar publicações e permitir simular falhas, para testes sem broker.
- **Kafka/RabbitMQ/custom:** documentar implementações da mesma porta, com mapeamento e confirmação próprios de cada transporte. Nenhum SDK será importado pelo domínio ou dispatcher.

`publish()` confirmará o resultado informado pelo adapter. No EventBus padrão, isso significa entregar ao bus, sem aguardar todos os listeners. Essa limitação decorre do [comportamento do NestJS](https://raw.githubusercontent.com/nestjs/cqrs/master/src/event-bus.ts).

## Migração e validação

- Migrar os exemplos de pedidos, testes de handlers, templates e orientações dos agentes para o novo dispatcher.
- Atualizar as skills de domínio, aplicação, infraestrutura, listeners, revisão e diagnóstico, além de README, instruções do projeto e checklist de PR.
- Ajustar o checker de padrões A/B/C para reconhecer handlers com dispatcher. O fluxo legado continuará reconhecido para projetos existentes.
- Atualizar o rulebook para `1.4.0` e incluir casos do novo fluxo nos conjuntos de referência. Se perguntas semânticas mudarem, invalidar a calibração anterior e recalibrar com o modelo configurado; não reaproveitar resultados como se fossem novos.

Os testes executarão os templates reais copiados para um projeto temporário e verificarão:

- Tipagem de nomes e payloads, sequência obrigatória de `.with()` e preservação de instâncias.
- Equivalência entre helper explícito e dispatcher injetado.
- Publishers síncronos, Promise e Observable; erros síncronos e assíncronos.
- `publish$()` sem efeito antes da assinatura e compatível com operadores RxJS.
- Persistência antes da publicação; nenhuma publicação quando a persistência falhar.
- Fila vazia, ordem, falha parcial e retenção de eventos ainda não entregues.
- Integração real do adapter EventBus com um listener NestJS e resolução pelo container.
- Compatibilidade do adapter EventPublisher e dos exemplos de adapters externos sem broker real.

Rodar os testes completos, typecheck, validação documental e checker dos exemplos antes do merge.

## Publicação e limites

- Atualizar os três manifests e o changelog para `1.4.0`.
- Abrir a PR com exemplos antes/depois, guia de migração e evidências de validação.
- Após o CI passar, integrar, criar a tag e publicar a release `v1.4.0`, já autorizada pelo pedido.
- Explicar nas notas que os projetos que copiaram templates antigos precisarão migrar seus arquivos; atualizar o plugin não reescreve aplicações existentes.
- Outbox, retries persistentes, descoberta automática de listeners e garantias de entrega exatamente uma vez ficam fora desta versão.
- Documentar que falhas ou cancelamentos podem deixar o resultado de uma entrega incerto; consumidores devem tolerar duplicatas quando houver repetição.
