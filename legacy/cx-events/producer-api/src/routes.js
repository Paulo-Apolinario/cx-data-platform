const express = require("express")
const { v4: uuidv4 } = require("uuid")
const Ajv = require("ajv")
const schema = require("./schema")

const router = express.Router()
const ajv = new Ajv()
const validate = ajv.compile(schema)

router.post("/track", async (req, res) => {
  const event = {
    event_id: uuidv4(),
    ...req.body
  }

  if (!validate(event)) {
    return res.status(400).json({
      error: "Evento inválido",
      details: validate.errors
    })
  }

  req.channel.sendToQueue(
  process.env.QUEUE_NAME || "cx.queue",
  Buffer.from(JSON.stringify(event)),
  { persistent: true }
)


  res.status(202).json({
    status: "accepted",
    event_id: event.event_id
  })
})

module.exports = router
