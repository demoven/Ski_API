FROM python:3.10-slim

WORKDIR /app
COPY . /app

RUN pip install --no-cache-dir -r requirements.txt

CMD exec gunicorn main:app --bind :8080 --workers 1 --timeout 0
