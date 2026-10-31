const amqp = require("amqplib")

async function connectRabbit() {
  const {
    RABBITMQ_HOST,
    RABBITMQ_PORT,
    RABBITMQ_USER,
    RABBITMQ_PASS,
    RABBITMQ_VHOST
  } = process.env

  const vhost = RABBITMQ_VHOST === "/" ? "%2F" : RABBITMQ_VHOST

  const url = `amqp://${RABBITMQ_USER}:${RABBITMQ_PASS}@${RABBITMQ_HOST}:${RABBITMQ_PORT}/${vhost}`

  const connection = await amqp.connect(url)
  const channel = await connection.createChannel()

  console.log("✅ Producer conectado ao RabbitMQ")

  return channel
}

module.exports = connectRabbit
