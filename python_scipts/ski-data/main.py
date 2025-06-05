import time
import requests
import unicodedata
from flask import Blueprint, jsonify, request, current_app, Flask

app = Flask(__name__)
fetch_bp = Blueprint('fetch_stations', __name__)


# Liste des stations
station_names = [
    "Abondance",
    "Aillon-Margériaz",
    "Albiez-Montrond",
    "Ancelle",
    "Arâches-la-Frasse",
    "Artouste",
    "Ascou",
    "Auron",
    "Aussois",
    "Autrans",
    "Ax 3 Domaines",
    "Ballon d'Alsace",
    "Barèges",
    "Bernex",
    "Bonneval-sur-Arc",
    "Bourg d'Oueil",
    "Bussang",
    "Camurac",
    "Cauterets",
    "Chabanon",
    "Chamonix-Mont-Blanc",
    "Chapelle-des-Bois",
    "Châtel",
    "Cluses",
    "Col de Plainpalais",
    "Col de Porte",
    "Combloux",
    "Courchevel",
    "Crest-Voland",
    "Crévoux",
    "Domaine skiable Valberg",
    "Dévoluy",
    "Flaine",
    "Flumet",
    "Font-Romeu Pyrénées 2000",
    "Formiguères",
    "Gavarnie-Gèdre",
    "Gérardmer",
    "Giron",
    "Gourette",
    "Grand Tourmalet",
    "Hautacam",
    "Hirmentaz - Les Habères",
    "Isola 2000",
    "La Bresse",
    "La Chapelle d'Abondance",
    "La Clusaz",
    "La Colmiane",
    "La Croix de Bauzon",
    "La Giettaz",
    "La Norma",
    "La Plagne",
    "La Quillane",
    "La Rosière",
    "Le Boréon",
    "Le Champ du Feu",
    "Le Corbier",
    "Le Grand Domaine",
    "Le Grand Puy",
    "Le Grand-Bornand",
    "Le Lioran",
    "Le Mourtis",
    "Le Reposoir",
    "Le Sauze",
    "Le Semnoz",
    "Le Somport",
    "Les Angles",
    "Les Contamines-Montjoie",
    "Les Deux Alpes",
    "Les Estables",
    "Les Fourgs",
    "Les Gets",
    "Les Houches",
    "Les Karellis",
    "Les Monts d'Olmes",
    "Les Orres",
    "Les Portes du Mont-Blanc",
    "Les Rousses",
    "Les Sybelles",
    "Luchon-Superbagnères",
    "Luz Ardiden",
    "Manigod",
    "Massif des Brasses",
    "Megève",
    "Menthières",
    "Mijoux - La Faucille",
    "Métabief",
    "Méaudre",
    "Montgenèvre",
    "Morillon",
    "Morzine",
    "Nistos",
    "Notre-Dame-de-Bellecombe",
    "Peyragudes",
    "Porté-Puymorens",
    "Pralognan-la-Vanoise",
    "Praz de Lys Sommand",
    "Praz-sur-Arly",
    "Puy-Saint-Vincent",
    "Puyvalador",
    "Ratery",
    "Réallon",
    "Risoul",
    "Roc d'Enfer",
    "Rouge Gazon",
    "Saint-Colomban-des-Villards",
    "Saint-François-Longchamp",
    "Saint-Gervais-les-Bains",
    "Saint-Jean-d'Arves",
    "Saint-Laurent-en-Grandvaux",
    "Saint-Nizier-du-Moucherotte",
    "Saint-Pierre-de-Chartreuse",
    "Saint-Sorlin-d'Arves",
    "Sainte-Foy-Tarentaise",
    "Sallanches",
    "Samoëns",
    "Serre Chevalier",
    "Sixt-Fer-à-Cheval",
    "Stade de neige du Col du Feu",
    "Thollon-les-Mémises",
    "Tignes",
    "Val Cenis",
    "Val Thorens",
    "Val d'Ese",
    "Valfréjus",
    "Valmeinier",
    "Valloire",
    "Vaujany",
    "Ventron",
    "Villard-de-Lans"
]

OVERPASS_ENDPOINTS = [
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter"
]

DIFFICULTY_LABELS = {
    "novice": "Vert",
    "easy": "Bleu",
    "intermediate": "Rouge",
    "advanced": "Noir"
}

def get_working_overpass_url():
    test_query = "[out:json][timeout:5];node(1);out;"
    for url in OVERPASS_ENDPOINTS:
        try:
            response = requests.post(url, data=test_query, timeout=10)
            if response.status_code == 200:
                return url
        except:
            continue
    raise Exception("Aucun endpoint Overpass API disponible")

def normalize_name(name):
    name = name.strip().lower()
    name = unicodedata.normalize("NFD", name)
    return "".join(c for c in name if not unicodedata.combining(c))

def get_overpass_data(station, overpass_url):
    query = f"""
    [out:json][timeout:25];
    area["name"="{station}"]->.a;
    (
      way(area.a)["piste:type"];
      relation(area.a)["piste:type"];
      node(area.a)["aerialway"];
      way(area.a)["aerialway"];
      relation(area.a)["aerialway"];
    );
    out body;
    >;
    out skel qt;
    """
    response = requests.post(overpass_url, data={"data": query})
    response.raise_for_status()
    return response.json()

def extract_coords(elem, all_elements):
    coords, seen = [], set()
    if elem["type"] == "node":
        coord = (elem["lat"], elem["lon"])
        if coord not in seen:
            coords.append(coord)
            seen.add(coord)
    else:
        node_ids = []
        if elem["type"] == "way":
            node_ids = elem.get("nodes", [])
        elif elem["type"] == "relation":
            for member in elem.get("members", []):
                if member["type"] == "node":
                    node_ids.append(member["ref"])
        for nid in node_ids:
            for node in all_elements:
                if node["type"] == "node" and node["id"] == nid:
                    coord = (node["lat"], node["lon"])
                    if coord not in seen:
                        coords.append(coord)
                        seen.add(coord)
    return coords

def get_station_info(station, overpass_url):
    data = get_overpass_data(station, overpass_url)
    if not data or "elements" not in data:
        return None

    elements = data["elements"]
    pistes_dict, remontees = {}, []

    for el in elements:
        if el["type"] not in ("way", "relation") or "tags" not in el:
            continue

        tags = el["tags"]
        name = tags.get("name", "").strip()
        if not name or name.lower() in ["", "none", "null", "unknown", "(nom inconnu)"]:
            continue

        coords = extract_coords(el, elements)
        if not coords:
            continue

        if "piste:type" in tags:
            raw_diff = tags.get("piste:difficulty", "easy").lower()
            diff_label = DIFFICULTY_LABELS.get(raw_diff, "Vert")
            norm_name = normalize_name(name)

            if norm_name not in pistes_dict:
                pistes_dict[norm_name] = {
                    "name": name,
                    "difficulty": diff_label,
                    "coords": coords
                }
            else:
                for c in coords:
                    if c not in pistes_dict[norm_name]["coords"]:
                        pistes_dict[norm_name]["coords"].append(c)

        elif "aerialway" in tags and tags["aerialway"] not in ("pylon", "goods"):
            remontees.append({
                "name": name,
                "type": tags.get("aerialway", "unknown"),
                "coords": coords
            })

    pistes = list(pistes_dict.values())
    return {
        "station": station,
        "pistes": pistes,
        "remontees": remontees
    }
@app.route("/")
def index():
    return "L'API fonctionne !"


@fetch_bp.route("/fetch-stations", methods=["POST"])
def fetch_and_forward():
    try:
        overpass_url = get_working_overpass_url()
        results = []

        for station in station_names:
            info = get_station_info(station, overpass_url)
            if info:
                results.append(info)
            time.sleep(1.5)

        # Envoi direct vers l'URL de destination
        destination_url = request.json.get("destination_url")
        if not destination_url:
            return jsonify({"error": "Missing 'destination_url'"}), 400

        headers = request.json.get("headers", {})
        
        # Envoi direct des données vers l'URL de destination
        payload = {
            "data": results
        }
        
        # Force le Content-Type explicitement
        request_headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }
        if headers:
            request_headers.update(headers)

        print(f"Envoi vers {destination_url} avec {len(results)} stations")
        print(f"Taille du payload: {len(str(payload))} caractères")
        print(f"Headers envoyés: {request_headers}")

        destination_response = requests.post(
            destination_url, 
            json=payload, 
            headers=request_headers,
            timeout=60
        )
        
        # Debug amélioré
        response_data = {
            "status": "success",
            "data_sent_to": destination_url,
            "stations_count": len(results),
            "payload_size": len(str(payload)),
            "destination_response": {
                "status_code": destination_response.status_code,
                "headers": dict(destination_response.headers),
                "response_text": destination_response.text[:1000],  # Premiers 1000 caractères
            }
        }
        
        # Essayer de parser en JSON si possible
        try:
            if destination_response.headers.get('content-type', '').startswith('application/json'):
                response_data["destination_response"]["json"] = destination_response.json()
        except:
            pass
            
        return jsonify(response_data)

    except requests.exceptions.Timeout:
        return jsonify({"error": "Timeout lors de l'envoi vers le service de destination"}), 504
    except requests.exceptions.ConnectionError as e:
        return jsonify({"error": f"Erreur de connexion: {str(e)}"}), 503
    except Exception as e:
        current_app.logger.error(f"Erreur fetch_and_forward : {e}")
        return jsonify({"error": str(e)}), 500
@fetch_bp.route("/test-single-station", methods=["POST"])
def test_single_station():
    try:
        overpass_url = get_working_overpass_url()
        
        # Test avec seulement Vars
        info = get_station_info("Vars", overpass_url)
        if not info:
            return jsonify({"error": "Aucune donnée trouvée pour Vars"}), 404
            
        destination_url = request.json.get("destination_url")
        if not destination_url:
            return jsonify({"error": "Missing 'destination_url'"}), 400

        # Payload minimal pour test
        payload = {"data": [info]}
        
        request_headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }
        
        print(f"Test avec Vars seulement")
        print(f"Nombre de pistes: {len(info.get('pistes', []))}")
        print(f"Nombre de remontées: {len(info.get('remontees', []))}")
        print(f"Taille du payload: {len(str(payload))} caractères")
        
        response = requests.post(
            destination_url,
            json=payload,
            headers=request_headers,
            timeout=15
        )
        
        return jsonify({
            "status": "test_single_success",
            "station_tested": "Vars",
            "payload_size": len(str(payload)),
            "destination_response": {
                "status_code": response.status_code,
                "headers": dict(response.headers),
                "response_text": response.text[:500]
            }
        })
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@fetch_bp.route("/fetch-for-process", methods=["POST"])
def fetch_for_process():
    """Endpoint spécialement formaté pour votre service /process"""
    try:
        overpass_url = get_working_overpass_url()
        results = []

        for station in station_names:
            info = get_station_info(station, overpass_url)
            if info:
                results.append(info)
            time.sleep(1.5)

        # URL de votre service /process
        process_url = "https://ski-processor-251891772802.europe-west1.run.app/process"
        
        # URL où votre service /process doit envoyer les données finales
        forward_to_url = request.json.get("forward_to_url", "http://httpbin.org/post")
        
        # Format exact attendu par votre /process
        payload = {
            "data": results,
            "destination_url": forward_to_url
        }
        
        request_headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }
        
        print(f"Envoi vers {process_url}")
        print(f"Données seront transférées vers: {forward_to_url}")
        print(f"Stations collectées: {len(results)}")
        print(f"Taille du payload: {len(str(payload))} caractères")
        
        # Envoi vers votre service /process
        process_response = requests.post(
            process_url,
            json=payload,
            headers=request_headers,
            timeout=60
        )
        
        return jsonify({
            "status": "success",
            "process_url": process_url,
            "forward_to_url": forward_to_url,
            "stations_collected": len(results),
            "payload_size": len(str(payload)),
            "process_response": {
                "status_code": process_response.status_code,
                "headers": dict(process_response.headers),
                "response": process_response.json() if process_response.headers.get('content-type', '').startswith('application/json') else process_response.text[:1000]
            }
        })
        
    except requests.exceptions.Timeout:
        return jsonify({"error": "Timeout lors de l'envoi vers le service /process"}), 504
    except Exception as e:
        current_app.logger.error(f"Erreur fetch_for_process : {e}")
        return jsonify({"error": str(e)}), 500
app.register_blueprint(fetch_bp)