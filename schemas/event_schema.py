from jsonschema import validate

event_schema = {
    "type": "object",
    "properties": {
        "event_id": {"type": "string", "format": "uuid"},
        "event_type": {"type": "string"},
        "user_id": {"type": "integer"},
        "metadata": {
            "type": "object",
            "additionalProperties": True
        }
    },
    "required": ["event_id", "event_type", "user_id"],
    "additionalProperties": False
}

def validate_event(event: dict):
    validate(instance=event, schema=event_schema)
