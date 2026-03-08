#!/bin/bash

python3 -m debugpy --listen 5678 -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
