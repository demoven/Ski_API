const express = require('express');
const { getDatabase } = require('../services/database');
const { ObjectId } = require('mongodb');
const dotenv = require('dotenv');
dotenv.config();

const router = express.Router();

// Fonction pour calculer la distance entre deux points (formule de Haversine)
const calculateDistance = (lat1, lng1, lat2, lng2) => {
  const R = 6371; // Rayon de la Terre en km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c * 1000; // Distance en mètres
};

// Fonction pour trouver le point le plus proche d'une position donnée
const findNearestPoint = (currentLat, currentLng, coordinates) => {
  let nearest = null;
  let minDistance = Infinity;
  let nearestIndex = -1;

  coordinates.forEach((coord, index) => {
    const distance = calculateDistance(currentLat, currentLng, coord.lat, coord.lng);
    if (distance < minDistance) {
      minDistance = distance;
      nearest = coord;
      nearestIndex = index;
    }
  });

  return { point: nearest, distance: minDistance, index: nearestIndex };
};

// Fonction pour construire le graphe des connexions
const buildConnectionGraph = (resort) => {
  const graph = new Map();
  
  // Ajouter toutes les pistes au graphe
  resort.slopes.forEach(slope => {
    const slopeId = slope._id.toString();
    if (!graph.has(slopeId)) {
      graph.set(slopeId, {
        type: 'slope',
        name: slope.name,
        coordinates: slope.listCoordinates || [],
        connections: []
      });
    }

    // Ajouter les connexions de cette piste
    if (slope.intersections) {
      slope.intersections.forEach(intersection => {
        // Chercher la piste de destination par nom
        const targetSlope = resort.slopes.find(s => s.name === intersection.name);
        if (targetSlope) {
          graph.get(slopeId).connections.push({
            targetId: targetSlope._id.toString(),
            type: 'slope_to_slope',
            connectionPoint: intersection.coordinates[0] || null
          });
        }
      });
    }
  });

  // Ajouter toutes les remontées au graphe
  resort.lifts.forEach(lift => {
    const liftId = lift._id.toString();
    if (!graph.has(liftId)) {
      graph.set(liftId, {
        type: 'lift',
        name: lift.name,
        coordinates: lift.coordinates || [],
        connections: []
      });
    }

    // Ajouter les connexions de cette remontée
    if (lift.connections) {
      lift.connections.forEach(connection => {
        // Chercher la piste de destination par nom
        const targetSlope = resort.slopes.find(s => s.name === connection.name);
        if (targetSlope) {
          graph.get(liftId).connections.push({
            targetId: targetSlope._id.toString(),
            type: 'lift_to_slope',
            connectionPoint: connection.coordinates[0] || null
          });
        }
      });
    }
  });

  // Ajouter les connexions inverses (pistes vers remontées)
  resort.lifts.forEach(lift => {
    const liftId = lift._id.toString();
    if (lift.connections) {
      lift.connections.forEach(connection => {
        const sourceSlope = resort.slopes.find(s => s.name === connection.name);
        if (sourceSlope && graph.has(sourceSlope._id.toString())) {
          graph.get(sourceSlope._id.toString()).connections.push({
            targetId: liftId,
            type: 'slope_to_lift',
            connectionPoint: connection.coordinates[0] || null
          });
        }
      });
    }
  });

  return graph;
};

// Algorithme de Dijkstra pour trouver le chemin le plus court
const findShortestPath = (graph, startElementId, targetSlopeId, currentLat, currentLng) => {
  const distances = new Map();
  const previous = new Map();
  const visited = new Set();
  const queue = [];

  // Initialiser les distances
  for (const [nodeId] of graph) {
    distances.set(nodeId, Infinity);
  }

  // Distance jusqu'à l'élément de départ
  const startElement = graph.get(startElementId);
  if (startElement && startElement.coordinates.length > 0) {
    const startPoint = findNearestPoint(currentLat, currentLng, startElement.coordinates);
    distances.set(startElementId, startPoint.distance);
    queue.push({ id: startElementId, distance: startPoint.distance });
  }

  while (queue.length > 0) {
    // Trier pour obtenir le nœud avec la distance minimale
    queue.sort((a, b) => a.distance - b.distance);
    const current = queue.shift();
    
    if (visited.has(current.id)) continue;
    visited.add(current.id);

    if (current.id === targetSlopeId) {
      break; // Destination atteinte
    }

    const currentNode = graph.get(current.id);
    if (!currentNode) continue;

    // Explorer les connexions
    currentNode.connections.forEach(connection => {
      if (visited.has(connection.targetId)) return;

      const targetNode = graph.get(connection.targetId);
      if (!targetNode) return;

      // Calculer la distance vers ce nœud
      let connectionDistance = 0;
      
      if (currentNode.coordinates.length > 0 && targetNode.coordinates.length > 0) {
        let currentExitPoint, targetEntryPoint;
        
        // Déterminer le point de sortie de l'élément actuel
        if (currentNode.type === 'lift') {
          // Pour une remontée, on sort par le dernier point (sommet)
          currentExitPoint = currentNode.coordinates[currentNode.coordinates.length - 1];
        } else {
          // Pour une piste, on sort par le dernier point (bas de la piste)
          currentExitPoint = currentNode.coordinates[currentNode.coordinates.length - 1];
        }
        
        // Déterminer le point d'entrée de l'élément cible
        if (targetNode.type === 'lift') {
          // Pour une remontée, on entre par le premier point (bas)
          targetEntryPoint = targetNode.coordinates[0];
        } else {
          // Pour une piste, on entre par le premier point (sommet)
          targetEntryPoint = targetNode.coordinates[0];
        }
        
        if (connection.connectionPoint) {
          // Utiliser le point de connexion spécifique
          connectionDistance = calculateDistance(
            currentExitPoint.lat, currentExitPoint.lng,
            connection.connectionPoint.lat, connection.connectionPoint.lng
          ) + calculateDistance(
            connection.connectionPoint.lat, connection.connectionPoint.lng,
            targetEntryPoint.lat, targetEntryPoint.lng
          );
        } else {
          // Distance directe entre point de sortie et point d'entrée
          connectionDistance = calculateDistance(
            currentExitPoint.lat, currentExitPoint.lng,
            targetEntryPoint.lat, targetEntryPoint.lng
          );
        }
      }

      // Ajouter la longueur de l'élément cible
      if (targetNode.type === 'lift') {
        // Pour un télésiège, pas de distance supplémentaire car il transporte automatiquement
        // du premier au dernier point (pas besoin de marcher/skier)
        connectionDistance += 0;
      } else {
        // Pour une piste, ajouter la distance totale de la piste à parcourir
        for (let i = 0; i < targetNode.coordinates.length - 1; i++) {
          const coord1 = targetNode.coordinates[i];
          const coord2 = targetNode.coordinates[i + 1];
          connectionDistance += calculateDistance(coord1.lat, coord1.lng, coord2.lat, coord2.lng);
        }
      }

      const newDistance = distances.get(current.id) + connectionDistance;

      if (newDistance < distances.get(connection.targetId)) {
        distances.set(connection.targetId, newDistance);
        previous.set(connection.targetId, current.id);
        
        // Ajouter à la queue si pas déjà présent
        if (!queue.find(item => item.id === connection.targetId)) {
          queue.push({ id: connection.targetId, distance: newDistance });
        }
      }
    });
  }

  // Reconstruire le chemin
  const path = [];
  let currentId = targetSlopeId;
  
  while (currentId && previous.has(currentId)) {
    path.unshift(currentId);
    currentId = previous.get(currentId);
  }
  
  if (currentId) {
    path.unshift(currentId);
  }

  return path;
};

// Fonction pour générer les coordonnées du chemin complet
const generatePathCoordinates = (graph, path, currentLat, currentLng, nearestElementId) => {
  const coordinates = [];
  
  // 1. Ajouter la position actuelle
  coordinates.push({ lat: parseFloat(currentLat), lng: parseFloat(currentLng) });

  // 2. Aller au point d'entrée le plus proche du premier élément
  const firstElement = graph.get(nearestElementId);
  if (firstElement && firstElement.coordinates && firstElement.coordinates.length > 0) {
    // Déterminer le point d'entrée (début de piste/remontée)
    let entryPoint;
    
    if (firstElement.type === 'slope') {
      // Pour une piste, l'entrée est le premier point (sommet)
      entryPoint = firstElement.coordinates[0];
    } else if (firstElement.type === 'lift') {
      // Pour une remontée, l'entrée est le premier point (bas de la remontée)
      entryPoint = firstElement.coordinates[0];
    }
    
    if (entryPoint) {
      coordinates.push({
        lat: entryPoint.lat,
        lng: entryPoint.lng
      });
    }
  }

  // 3. Suivre le chemin planifié élément par élément
  for (let i = 0; i < path.length; i++) {
    const element = graph.get(path[i]);
    if (!element || !element.coordinates || element.coordinates.length === 0) continue;

    if (element.type === 'lift') {
      // Pour un télésiège : traitement spécial
      if (i === 0) {
        // Si c'est le premier élément du chemin, ajouter toutes les coordonnées pour visualiser le trajet
        element.coordinates.forEach(coord => {
          coordinates.push({
            lat: coord.lat,
            lng: coord.lng
          });
        });
      } else {
        // Si on arrive depuis un autre élément, ajouter seulement le point d'arrivée (sommet)
        // car le télésiège nous transporte automatiquement du bas vers le haut
        const exitPoint = element.coordinates[element.coordinates.length - 1];
        coordinates.push({
          lat: exitPoint.lat,
          lng: exitPoint.lng
        });
      }
    } else if (element.type === 'slope') {
      // Pour une piste : ajouter toutes les coordonnées car il faut la descendre
      if (i === 0) {
        // Premier élément : ajouter toutes ses coordonnées depuis le début
        element.coordinates.forEach(coord => {
          coordinates.push({
            lat: coord.lat,
            lng: coord.lng
          });
        });
      } else {
        // Éléments suivants : ajouter toutes les coordonnées depuis le début
        element.coordinates.forEach(coord => {
          coordinates.push({
            lat: coord.lat,
            lng: coord.lng
          });
        });
      }
    }
  }

  return coordinates;
};

router.get('/coordinates/:currentLat/:currentLng/:resortId/:slopeId', async (req, res) => {
  try {
    const { currentLat, currentLng, resortId, slopeId } = req.params;
    console.log("resortId:", resortId);
    console.log("slopeId:", slopeId);
    console.log("Position actuelle:", currentLat, currentLng);

    const db = getDatabase('France');
    const collection = db.collection('ski_resorts');
    const resort = await collection.findOne({ _id: new ObjectId(resortId) });
    
    if (!resort) {
      return res.status(404).json({ error: "Resort not found" });
    }

    const targetSlope = resort.slopes.find(s => s._id.toString() === slopeId);
    if (!targetSlope) {
      return res.status(404).json({ error: "Slope not found" });
    }

    // Construire le graphe des connexions
    const graph = buildConnectionGraph(resort);
    console.log(`Graphe construit avec ${graph.size} éléments`);

    // Trouver l'élément le plus proche de la position actuelle
    let nearestElement = null;
    let minDistance = Infinity;
    let nearestElementId = null;

    for (const [elementId, element] of graph) {
      if (element.coordinates && element.coordinates.length > 0) {
        // Pour chaque élément, vérifier la distance au point d'entrée
        let entryPoint;
        
        if (element.type === 'slope') {
          // Pour une piste, l'entrée est le premier point (sommet de la piste)
          entryPoint = element.coordinates[0];
        } else if (element.type === 'lift') {
          // Pour une remontée, l'entrée est le premier point (départ de la remontée)
          entryPoint = element.coordinates[0];
        }
        
        if (entryPoint) {
          const distance = calculateDistance(
            parseFloat(currentLat), 
            parseFloat(currentLng), 
            entryPoint.lat, 
            entryPoint.lng
          );
          
          if (distance < minDistance) {
            minDistance = distance;
            nearestElement = element;
            nearestElementId = elementId;
          }
        }
      }
    }

    if (!nearestElement) {
      return res.status(404).json({ error: "No accessible slopes or lifts found" });
    }

    console.log(`Point d'entrée le plus proche: ${nearestElement.name} (${nearestElement.type}) à ${minDistance.toFixed(2)}m`);

    // Si l'élément le plus proche est déjà la piste de destination
    if (nearestElementId === slopeId) {
      console.log("L'entrée la plus proche est déjà la piste de destination");
      
      // Chemin simple : position actuelle -> entrée de la piste -> piste complète  
      const coordinates = [
        { lat: parseFloat(currentLat), lng: parseFloat(currentLng) },
        { lat: targetSlope.listCoordinates[0].lat, lng: targetSlope.listCoordinates[0].lng }
      ];
      
      // Ajouter toutes les coordonnées de la piste de destination
      targetSlope.listCoordinates.forEach(coord => {
        coordinates.push({
          lat: coord.lat,
          lng: coord.lng
        });
      });
      
      return res.status(200).json({
        coordinates,
        path: [nearestElement.name],
        totalDistance: minDistance
      });
    }

    // Trouver le chemin le plus court
    const path = findShortestPath(graph, nearestElementId, slopeId, parseFloat(currentLat), parseFloat(currentLng));
    
    if (path.length === 0) {
      return res.status(404).json({ 
        error: "No path found to destination slope",
        message: "La piste de destination n'est pas accessible depuis votre position"
      });
    }

    // Générer les coordonnées du chemin complet
    const coordinates = generatePathCoordinates(graph, path, parseFloat(currentLat), parseFloat(currentLng), nearestElementId);
    
    // Créer la liste des noms pour le chemin
    const pathNames = path.map(elementId => {
      const element = graph.get(elementId);
      return element ? `${element.name} (${element.type})` : 'Unknown';
    });

    console.log(`Chemin trouvé: Position actuelle -> ${pathNames.join(' -> ')}`);
    console.log(`Distance jusqu'au point d'entrée: ${minDistance.toFixed(2)}m`);
    console.log(`Nombre total de coordonnées: ${coordinates.length}`);

    res.status(200).json({
      coordinates,
      path: pathNames,
      entryPoint: nearestElement.name,
      distanceToEntry: Math.round(minDistance),
      totalCoordinates: coordinates.length
    });

  } catch (error) {
    console.error("Error in GET /coordinates:", error);
    res.status(500).json({ 
      error: "Internal Server Error", 
      message: error.message 
    });
  }
});

module.exports = router;