require("dotenv").config()
const express = require("express")
const connectRabbit = require("./rabbit")
const routes = require("./routes")

const app = express()
app.use(express.json())

async function start() {
  try {
    const channel = await connectRabbit()

    app.use((req, _, next) => {
      req.channel = channel
      next()
    })

    app.use(routes)

    app.listen(process.env.PORT, () => {
      console.log(`🚀 Producer API rodando na porta ${process.env.PORT}`)
    })
  } catch (err) {
    console.error("❌ Erro ao iniciar Producer API:", err.message)
    process.exit(1)
  }
}

start()
