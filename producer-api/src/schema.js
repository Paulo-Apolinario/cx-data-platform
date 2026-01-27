module.exports = {
  type: "object",
  properties: {
    event_id: { type: "string" },
    event_type: { type: "string" },
    user_id: { type: "integer" },
    metadata: {
      type: "object",
      additionalProperties: true
    }
  },
  required: ["event_id", "event_type", "user_id"],
  additionalProperties: false
}
