import json
import pika
import psycopg2
from psycopg2.errors import UniqueViolation
from jsonschema import ValidationError

from schemas.event_schema import validate_event
from consumers.rabbit_setup import setup_rabbit
from core.config import (
    RABBITMQ_HOST,
    RABBITMQ_PORT,
    RABBITMQ_USER,
    RABBITMQ_PASS,
    RABBITMQ_QUEUE,
    PG_HOST,
    PG_PORT,
    PG_DB,
    PG_USER,
    PG_PASS
)


def save_event(event: dict) -> bool:
    conn = psycopg2.connect(
        host=PG_HOST,
        port=PG_PORT,
        database=PG_DB,
        user=PG_USER,
        password=PG_PASS
    )

    cur = conn.cursor()

    try:
        cur.execute(
            """
            INSERT INTO events (event_id, event_type, user_id, payload)
            VALUES (%s, %s, %s, %s)
            """,
            (
                event["event_id"],
                event["event_type"],
                event["user_id"],
                json.dumps(event)
            )
        )

        conn.commit()
        return True  # inserido com sucesso

    except UniqueViolation:
        conn.rollback()
        return False  # evento duplicado (idempotência)

    finally:
        cur.close()
        conn.close()


def callback(ch, method, properties, body):
    try:
        event = json.loads(body)
        validate_event(event)

        inserted = save_event(event)

        if inserted:
            print("✅ Evento salvo no PostgreSQL")
        else:
            print("⚠️ Evento duplicado ignorado (idempotência)")

        ch.basic_ack(delivery_tag=method.delivery_tag)

    except ValidationError as e:
        print(f"❌ Evento inválido: {e}")
        ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)

    except Exception as e:
        print(f"❌ Erro inesperado ao processar evento: {e}")
        ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)


def main():
    credentials = pika.PlainCredentials(
        RABBITMQ_USER,
        RABBITMQ_PASS
    )

    connection = pika.BlockingConnection(
        pika.ConnectionParameters(
            host=RABBITMQ_HOST,
            port=RABBITMQ_PORT,
            credentials=credentials
        )
    )

    channel = connection.channel()

    setup_rabbit(channel)

    channel.basic_qos(prefetch_count=1)

    channel.basic_consume(
        queue=RABBITMQ_QUEUE,
        on_message_callback=callback,
        auto_ack=False
    )

    print("[*] Consumer ativo. Aguardando mensagens... (Ctrl+C para sair)")

    try:
        channel.start_consuming()
    except KeyboardInterrupt:
        print("\n🛑 Consumer interrompido pelo usuário")
    finally:
        if channel.is_open:
            channel.close()
        if connection.is_open:
            connection.close()
        print("🔌 Conexão com RabbitMQ encerrada com sucesso")


if __name__ == "__main__":
    main()
