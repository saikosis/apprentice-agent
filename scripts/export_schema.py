"""Print the JSON Schema of every contract model (stdout → shared/schema.json)."""

import inspect
import json

from pydantic import BaseModel
from pydantic.json_schema import models_json_schema

from backend.app import contract

models = [
    m
    for _, m in inspect.getmembers(contract, inspect.isclass)
    if issubclass(m, BaseModel) and m.__module__ == contract.__name__ and m is not contract.M
]
_, defs = models_json_schema([(m, "validation") for m in models], ref_template="#/$defs/{model}")

# Root object referencing every model so json2ts emits all of them.
schema = {
    "title": "Contract",
    "type": "object",
    "properties": {m.__name__: {"$ref": f"#/$defs/{m.__name__}"} for m in models},
    **defs,
}
print(json.dumps(schema, indent=2, ensure_ascii=False))
