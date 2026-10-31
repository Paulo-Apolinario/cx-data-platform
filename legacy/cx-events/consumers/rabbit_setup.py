import pika


def setup_rabbit(channel):
    # ===============================
    # Exchange principal
    # ===============================
    channel.exchange_declare(
        exchange="cx.events",
        exchange_type="direct",
        durable=True
    )

    # ===============================
    # Dead Letter Exchange (DLX)
    # ===============================
    channel.exchange_declare(
        exchange="cx.events.dlx",
        exchange_type="direct",
        durable=True
    )

    # ===============================
    # Dead Letter Queue (DLQ)
    # ===============================
    channel.queue_declare(
        queue="cx.queue.dlq",
        durable=True
    )

    channel.queue_bind(
        exchange="cx.events.dlx",
        queue="cx.queue.dlq",
        routing_key="cx.queue.dlq"
    )

    # ===============================
    # Retry Queue (com TTL)
    # ===============================
    channel.queue_declare(
        queue="cx.queue.retry",
        durable=True,
        arguments={
            "x-message-ttl": 5000,  # 5 segundos
            "x-dead-letter-exchange": "cx.events",
            "x-dead-letter-routing-key": "cx.queue"
        }
    )

    channel.queue_bind(
        exchange="cx.events.dlx",
        queue="cx.queue.retry",
        routing_key="cx.queue.retry"
    )

    # ===============================
    # Queue principal
    # ===============================
    channel.queue_declare(
        queue="cx.queue",
        durable=True,
        arguments={
            # Em caso de erro → vai para retry
            "x-dead-letter-exchange": "cx.events.dlx",
            "x-dead-letter-routing-key": "cx.queue.retry"
        }
    )

    channel.queue_bind(
        exchange="cx.events",
        queue="cx.queue",
        routing_key="cx.queue"
    )
