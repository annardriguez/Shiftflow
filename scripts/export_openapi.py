"""Generate the versioned machine-readable HTTP contract from the installed FastAPI app."""

import json
from pathlib import Path
from backend.api.main import create_app

Path("backend/openapi.json").write_text(
    json.dumps(create_app().openapi(), indent=2) + "\n"
)
print("Wrote backend/openapi.json")
