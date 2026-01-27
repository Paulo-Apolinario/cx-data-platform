import os
from dotenv import load_dotenv

load_dotenv()

# RabbitMQ
RABBITMQ_HOST = os.getenv("RABBITMQ_HOST")
RABBITMQ_PORT = int(os.getenv("RABBITMQ_PORT", 5672))
RABBITMQ_USER = os.getenv("RABBITMQ_USER")
RABBITMQ_PASS = os.getenv("RABBITMQ_PASS")
RABBITMQ_EXCHANGE = os.getenv("RABBITMQ_EXCHANGE")
RABBITMQ_QUEUE = os.getenv("RABBITMQ_QUEUE")
RABBITMQ_DLQ = os.getenv("RABBITMQ_DLQ")

# PostgreSQL
PG_HOST = os.getenv("PG_HOST")
PG_PORT = int(os.getenv("PG_PORT", 5432))
PG_DB = os.getenv("PG_DB")
PG_USER = os.getenv("PG_USER")
PG_PASS = os.getenv("PG_PASS")
