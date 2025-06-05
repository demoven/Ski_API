import json
import flask
import requests
from flask import Flask, request, jsonify
import os
from google.cloud import storage
import logging

app = flask.Flask(__name__)
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
app = Flask(__name__)

def get_firebase_token():
    try:
        firebase_email = os.getenv('FIREBASE_EMAIL')
        firebase_password = os.getenv('FIREBASE_PASSWORD')
        firebase_api_key = os.getenv('FIREBASE_API_KEY')
        if not all([firebase_email, firebase_password, firebase_api_key]):
            logger.error("Missing Firebase credentials in environment variables")
            return None
        auth_url = f"https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={firebase_api_key}"
        auth_data = {
            "email": firebase_email,
            "password": firebase_password,
            "returnSecureToken": True
        }
        response = requests.post(auth_url, json=auth_data)
        if response.status_code == 200:
            token = response.json().get('idToken')
            logger.info("Firebase authentication successful")
            return token
        else:
            logger.error(f"Firebase authentication failed: {response.status_code} - {response.text}")
            return None
    except Exception as e:
        logger.error(f"Error during Firebase authentication: {str(e)}")
        return None

def trouver_connections(slopes, chair_lifts, tolerance=0.0006):
    logger.info(f"Recherche de connexions - Pistes: {len(slopes)}, Remontées: {len(chair_lifts)}, Tolérance: {tolerance}")
    def points_proches(p1, p2, tol=tolerance):
        distance = abs(p1[0] - p2[0]) + abs(p1[1] - p2[1])
        return distance < tol
    for i, slope in enumerate(slopes):
        if not slope["coordinates"]:
            continue
        debut_slope = slope["coordinates"][0]
        fin_slope = slope["coordinates"][-1]
        for j, autre in enumerate(slopes):
            if i == j or not autre["coordinates"]:
                continue
            for coord_autre in autre["coordinates"]:
                if points_proches(debut_slope, coord_autre) or points_proches(fin_slope, coord_autre):
                    if not any(c["name"] == slope["name"] for c in autre["connection"]):
                        autre["connection"].append({
                            "name": slope["name"],
                            "coordinates": coord_autre,
                            "type": "slope"
                        })
                    break
    for slope in slopes:
        if not slope["coordinates"]:
            continue
        debut_slope = slope["coordinates"][0]
        fin_slope = slope["coordinates"][-1]
        for chair_lift in chair_lifts:
            if not chair_lift["coordinates"]:
                continue
            bas = chair_lift["coordinates"][0]
            haut = chair_lift["coordinates"][-1]
            if points_proches(fin_slope, bas) or points_proches(debut_slope, haut):
                if not any(c["name"] == slope["name"] for c in chair_lift["connection"]):
                    chair_lift["connection"].append({
                        "name": slope["name"],
                        "coordinates": fin_slope if points_proches(fin_slope, bas) else debut_slope,
                        "type": "slope"
                    })
    for i, lift in enumerate(chair_lifts):
        if not lift["coordinates"]:
            continue
        haut = lift["coordinates"][-1]
        for j, autre in enumerate(chair_lifts):
            if i == j or not autre["coordinates"]:
                continue
            bas_autre = autre["coordinates"][0]
            if points_proches(haut, bas_autre):
                if not any(c["name"] == lift["name"] for c in autre["connection"]):
                    autre["connection"].append({
                        "name": lift["name"],
                        "coordinates": haut,
                        "type": "chair_lift"
                    })
    for lift in chair_lifts:
        if not lift["coordinates"]:
            continue
        haut = lift["coordinates"][-1]
        for slope in slopes:
            if not slope["coordinates"]:
                continue
            debut = slope["coordinates"][0]
            if points_proches(haut, debut):
                if not any(c["name"] == lift["name"] for c in slope["connection"]):
                    slope["connection"].append({
                        "name": lift["name"],
                        "coordinates": haut,
                        "type": "chair_lift"
                    })
    return slopes, chair_lifts

def post_to_destination(data, destination_url, headers=None):
    try:
        if headers is None:
            headers = {'Content-Type': 'application/json'}
        response = requests.post(destination_url, json=data, headers=headers, timeout=30)
        response.raise_for_status()
        logger.info(f"Data successfully posted to {destination_url}")
        return {"status": "success", "response": response.json() if response.content else None}
    except requests.exceptions.RequestException as e:
        logger.error(f"Error posting to {destination_url}: {str(e)}")
        return {"status": "error", "message": str(e)}

@app.route('/process', methods=['POST'])
def process_ski_data():
    try:
        if not request.json:
            return jsonify({"error": "No JSON data provided"}), 400
        json_data = request.json.get('data')
        destination_url = request.json.get('destination_url')
        headers = request.json.get('headers', {})
        tolerance = request.json.get('tolerance', 0.0006)
        if not json_data:
            return jsonify({"error": "No 'data' field in JSON"}), 400
        if not destination_url:
            return jsonify({"error": "No 'destination_url' provided"}), 400
        firebase_token = get_firebase_token()
        if not firebase_token:
            return jsonify({"status": "error", "message": "Failed to authenticate with Firebase"}), 401
        headers['Authorization'] = f'Bearer {firebase_token}'
        results, errors = [], []
        for station in json_data:
            try:
                station_name = station.get("station", "Unknown Station")
                slopes = [
                    {
                        "name": p.get("name", "Unnamed"),
                        "difficulty": p.get("difficulty", "unknown"),
                        "coordinates": [[pt[1], pt[0]] for pt in p.get("coords", [])],
                        "connection": []
                    }
                    for p in station.get("pistes", [])
                ]
                chair_lifts = [
                    {
                        "station": l.get("name", "Unnamed"),
                        "type": l.get("type", "unknown"),
                        "coordinates": [[pt[1], pt[0]] for pt in l.get("coords", [])],
                        "connection": []
                    }
                    for l in station.get("remontees", [])
                    if l.get("type") not in ["magic_carpet", ""]
                ]
                slopes, chair_lifts = trouver_connections(slopes, chair_lifts, tolerance)
                processed_data = {
                    "station": station_name,
                    "slopes": slopes,
                    "chair_lifts": chair_lifts
                }
                post_result = post_to_destination(processed_data, destination_url, headers)
                if post_result["status"] == "success":
                    results.append({"station": station_name, "status": "success", "response": post_result.get("response")})
                else:
                    errors.append({"station": station_name, "error": post_result["message"]})
            except Exception as e:
                errors.append({"station": station.get("station", "Unknown"), "error": str(e)})
        return jsonify({
            "status": "completed",
            "successful_stations": len(results),
            "failed_stations": len(errors),
            "results": results,
            "errors": errors if errors else None
        }), 200 if not errors else 207
    except Exception as e:
        logger.error(f"Error in process_ski_data: {str(e)}")
        return jsonify({"status": "error", "message": f"Internal server error: {str(e)}"}), 500



# Point d'entrée pour Google Cloud Functions
def main(request):
    """Entry point for Google Cloud Functions"""
    with app.test_request_context(path=request.path, method=request.method, 
                                  headers=request.headers, data=request.data):
        return app.full_dispatch_request()


if __name__ == '__main__':
    # Pour Cloud Run, utiliser le port fourni par la variable d'environnement
    port = int(os.environ.get('PORT', 8080))
    # Utiliser gunicorn pour la production
    import subprocess
    import sys
    
    # En mode debug local
    if os.environ.get('GAE_ENV', '').startswith('standard') or os.environ.get('PORT'):
        # Production - utiliser gunicorn
        subprocess.run([
            sys.executable, '-m', 'gunicorn', 
            '--bind', f'0.0.0.0:{port}',
            '--workers', '1',
            '--timeout', '0',
            'main:app'
        ])
    else:
        # Développement local
        app.run(debug=True, host='0.0.0.0', port=port)