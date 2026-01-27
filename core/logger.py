import logging
import json
from datetime import datetime

class JsonFormatter(logging.Formatter):
    def format(self, record):
        log_record = {
            "timestamp": datetime.utcnow().isoformat(),
            "level": record.levelname,
            "service": record.name,
            "message": record.getMessage()
        }

        if hasattr(record, "extra_data"):
            log_record.update(record.extra_data)

        return json.dumps(log_record, ensure_ascii=False)


def get_logger(name: str):
    logger = logging.getLogger(name)
    logger.setLevel(logging.INFO)

    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())

    if not logger.handlers:
        logger.addHandler(handler)

    return logger
