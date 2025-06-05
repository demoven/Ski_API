FROM python:3.9-slim

WORKDIR /app

# Copier et installer les dépendances
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copier le code
COPY . .

# Variables d'environnement
ENV PORT=8080
ENV PYTHONUNBUFFERED=1

# Commande de démarrage
CMD exec gunicorn main:app --bind :8080 --workers 1 --timeout 0
