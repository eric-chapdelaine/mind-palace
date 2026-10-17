"""Worker entry point: one JSON problem on stdin, one JSON solution on stdout."""

import json
import sys

from .solve import solve


def main():
    try:
        print(json.dumps(solve(json.load(sys.stdin))))
    except Exception as error:  # noqa: BLE001 - the worker protocol returns {"error": ...}
        print(json.dumps({"error": str(error)}))
        sys.exit(1)
