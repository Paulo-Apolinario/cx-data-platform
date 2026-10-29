import pika
import json
import uuid
from jsonschema import ValidationError

from schemas.event_schema import validate_event
from core.config import (
    RABBITMQ_HOST,
    RABBITMQ_PORT,
    RABBITMQ_USER,
    RABBITMQ_PASS,
    RABBITMQ_EXCHANGE,
    RABBITMQ_QUEUE
)

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

event = {
    "event_id": str(uuid.uuid4()),
    "event_type": "Paulo",
    "user_id": 1,
    "metadata": {
        "status": "ok",
        "source": "producer_manual"
    }
}

try:
    validate_event(event)

    channel.basic_publish(
        exchange=RABBITMQ_EXCHANGE,
        routing_key=RABBITMQ_QUEUE,
        body=json.dumps(event),
        properties=pika.BasicProperties(
            delivery_mode=2
        )
    )

    print("📤 Evento publicado com sucesso")
    print(f"   • event_id: {event['event_id']}")
    print(f"   • event_type: {event['event_type']}")
    print(f"   • user_id: {event['user_id']}")

except ValidationError as e:
    print("❌ Evento inválido — não enviado")
    print(f"Erro: {e}")

finally:
    connection.close()
