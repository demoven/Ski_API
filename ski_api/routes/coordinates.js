const express = require('express');
const { getDatabase } = require('../services/database');
const { ObjectId } = require('mongodb');
const dotenv = require('dotenv');
dotenv.config();

const router = express.Router();

// Fonction pour calculer la distance entre deux points (formule de Haversine)
function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000; // Rayon de la Terre en mètres
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// Fonction pour obtenir le niveau de difficulté numérique
function getDifficultyLevel(difficulty) {
  const levels = { 'Vert': 1, 'Bleu': 2, 'Rouge': 3, 'Noir': 4 };
  return levels[difficulty] || 0;
}

// Fonction pour vérifier si l'utilisateur peut emprunter une piste
function canUseSlope(userMaxDifficulty, slopeDifficulty) {
  return getDifficultyLevel(slopeDifficulty) <= getDifficultyLevel(userMaxDifficulty);
}

// Créer un identifiant unique pour un point
function createPointId(type, mainId, index = 0) {
  return `${type}_${mainId}_${index}`;
}

// Construire tous les points du réseau avec filtrage par difficulté
function buildNetworkPoints(resort, maxDifficulty) {
  const points = new Map();
  
  console.log(`Construction des points du réseau avec difficulté max: ${maxDifficulty}...`);
  
  // TOUTES les pistes mais marquées comme accessibles ou non
  resort.slopes.forEach(slope => {
    const isAccessible = canUseSlope(maxDifficulty, slope.difficulty);
    console.log(`Ajout piste ${slope.name} (${slope.difficulty}) - ${isAccessible ? 'ACCESSIBLE' : 'NON ACCESSIBLE'} - ${slope.listCoordinates.length} points`);
    
    // Points de la piste
    slope.listCoordinates.forEach((coord, index) => {
      const pointId = createPointId('slope', slope._id, index);
      points.set(pointId, {
        id: pointId,
        lat: coord.lat,
        lng: coord.lng,
        type: 'slope',
        slopeId: slope._id,
        slopeName: slope.name,
        index: index,
        difficulty: slope.difficulty,
        isStart: index === 0,
        isEnd: index === slope.listCoordinates.length - 1,
        accessible: isAccessible
      });
    });
    
    // Points d'intersection
    if (slope.intersections && slope.intersections.length > 0) {
      slope.intersections.forEach(intersection => {
        intersection.coordinates.forEach((coord, index) => {
          const pointId = createPointId('intersection', intersection._id, index);
          points.set(pointId, {
            id: pointId,
            lat: coord.lat,
            lng: coord.lng,
            type: 'intersection',
            intersectionId: intersection._id,
            intersectionName: intersection.name,
            slopeId: slope._id,
            accessible: true // Les intersections sont toujours accessibles
          });
        });
      });
    }
  });
  
  // TOUS les télésièges (toujours accessibles)
  resort.lifts.forEach(lift => {
    const liftId = lift._id || lift.name;
    console.log(`Ajout télesiège ${lift.name} - ${lift.coordinates.length} points`);
    
    lift.coordinates.forEach((coord, index) => {
      const pointId = createPointId('lift', liftId, index);
      points.set(pointId, {
        id: pointId,
        lat: coord.lat,
        lng: coord.lng,
        type: 'lift',
        liftId: liftId,
        liftName: lift.name,
        index: index,
        isStart: index === 0,
        isEnd: index === lift.coordinates.length - 1,
        accessible: true
      });
    });
    
    // Connexions des télésièges
    if (lift.connections && lift.connections.length > 0) {
      lift.connections.forEach(connection => {
        connection.coordinates.forEach((coord, index) => {
          const pointId = createPointId('connection', connection._id, index);
          points.set(pointId, {
            id: pointId,
            lat: coord.lat,
            lng: coord.lng,
            type: 'connection',
            connectionId: connection._id,
            connectionName: connection.name,
            connectionType: connection.type,
            liftId: liftId,
            accessible: true
          });
        });
      });
    }
  });
  
  console.log(`Total points créés: ${points.size}`);
  return points;
}

// Construire le graphe avec connexions et filtrage par difficulté
function buildGraph(points, maxDifficulty) {
  const graph = new Map();
  
  // Initialiser le graphe
  points.forEach((point, pointId) => {
    graph.set(pointId, {
      point: point,
      neighbors: []
    });
  });
  
  console.log(`Construction des connexions logiques avec difficulté max: ${maxDifficulty}...`);
  let connectionsCount = 0;
  let blockedConnections = 0;
  
  // Créer les connexions
  points.forEach((point1, id1) => {
    points.forEach((point2, id2) => {
      if (id1 !== id2) {
        const distance = calculateDistance(point1.lat, point1.lng, point2.lat, point2.lng);
        let shouldConnect = false;
        let weight = distance;
        let connectionReason = '';
        
        // VÉRIFICATION DE LA DIFFICULTÉ - Empêcher l'utilisation de pistes trop difficiles
        const canUsePoint1 = point1.accessible;
        const canUsePoint2 = point2.accessible;
        
        if (!canUsePoint1 || !canUsePoint2) {
          // Ne pas créer de connexion si l'une des pistes est trop difficile
          if (distance < 100) { // Ne compter que les connexions qui auraient été créées
            blockedConnections++;
            if (blockedConnections <= 10) {
              console.log(`CONNEXION BLOQUÉE: ${point1.type}(${point1.slopeName || point1.liftName || 'unknown'}) -> ${point2.type}(${point2.slopeName || point2.liftName || 'unknown'}) - Difficulté trop élevée`);
            }
          }
          return; // Ignorer cette connexion
        }
        
        // 1. Points consécutifs sur la même piste (DESCENDANT UNIQUEMENT)
        if (point1.type === 'slope' && point2.type === 'slope' && 
            point1.slopeId === point2.slopeId && 
            point2.index === point1.index + 1) {
          shouldConnect = true;
          connectionReason = 'piste_descendante';
        }
        
        // 2. Points consécutifs sur le même télesiège (MONTANT UNIQUEMENT)
        else if (point1.type === 'lift' && point2.type === 'lift' && 
                 point1.liftId === point2.liftId && 
                 point2.index === point1.index + 1) {
          shouldConnect = true;
          weight = distance * 0.3;
          connectionReason = 'teleliege_montant';
        }
        
        // 3. Connexions entre éléments différents (distance plus flexible)
        else if (distance < 100) { // Augmentation à 100m
          
          // Haut de télésiège vers début de piste
          if (point1.type === 'lift' && point1.isEnd && point2.type === 'slope' && point2.isStart) {
            shouldConnect = true;
            connectionReason = 'haut_teleliege_vers_debut_piste';
          }
          
          // Fin de piste vers base de télésiège
          else if (point1.type === 'slope' && point1.isEnd && point2.type === 'lift' && point2.isStart) {
            shouldConnect = true;
            connectionReason = 'fin_piste_vers_base_teleliege';
          }
          
          // Connexions via intersections
          else if (point1.type === 'intersection' || point2.type === 'intersection') {
            shouldConnect = true;
            connectionReason = 'intersection';
          }
          
          // Connexions définies
          else if (point1.type === 'connection' || point2.type === 'connection') {
            shouldConnect = true;
            connectionReason = 'connexion_definie';
          }
          
          // Connexions de proximité entre pistes différentes (pour traverser)
          else if (point1.type === 'slope' && point2.type === 'slope' && 
                   point1.slopeId !== point2.slopeId && distance < 50) {
            shouldConnect = true;
            connectionReason = 'proximite_pistes';
          }
          
          // Connexions de proximité entre télésièges
          else if (point1.type === 'lift' && point2.type === 'lift' && 
                   point1.liftId !== point2.liftId && distance < 50) {
            shouldConnect = true;
            connectionReason = 'proximite_teleliege';
          }
          
          // Connexions mixtes proches
          else if ((point1.type === 'slope' && point2.type === 'lift') ||
                   (point1.type === 'lift' && point2.type === 'slope')) {
            if (distance < 75) {
              shouldConnect = true;
              connectionReason = 'proximite_mixte';
            }
          }
        }
        
        if (shouldConnect) {
          graph.get(id1).neighbors.push({
            id: id2,
            distance: distance,
            weight: weight,
            reason: connectionReason
          });
          connectionsCount++;
          
          if (connectionsCount <= 20) { // Plus de logs pour debug
            console.log(`Connexion ${connectionsCount}: ${point1.type}(${point1.slopeName || point1.liftName || 'unknown'}) -> ${point2.type}(${point2.slopeName || point2.liftName || 'unknown'}) [${connectionReason}] ${Math.round(distance)}m`);
          }
        }
      }
    });
  });
  
  console.log(`Total connexions créées: ${connectionsCount}`);
  console.log(`Connexions bloquées par difficulté: ${blockedConnections}`);
  
  // Debug: vérifier la connectivité du graphe
  let connectedNodes = 0;
  graph.forEach((node, nodeId) => {
    if (node.neighbors.length > 0) {
      connectedNodes++;
    }
  });
  
  console.log(`Noeuds connectés: ${connectedNodes}/${graph.size}`);
  
  return graph;
}

// Trouver le point le plus proche (uniquement parmi les points accessibles)
function findClosestPoint(lat, lng, points, maxDifficulty = null) {
  let closestPoint = null;
  let minDistance = Infinity;
  
  console.log(`Recherche du point le plus proche de (${lat}, ${lng})`);
  
  points.forEach((point) => {
    if (point.lat === undefined || point.lng === undefined || 
        isNaN(point.lat) || isNaN(point.lng)) {
      return;
    }
    
    // Vérifier l'accessibilité du point
    if (!point.accessible) {
      return; // Ignorer les points non accessibles
    }
    
    const distance = calculateDistance(lat, lng, point.lat, point.lng);
    if (distance < minDistance) {
      minDistance = distance;
      closestPoint = { ...point, distanceToTarget: distance };
    }
  });
  
  if (closestPoint) {
    console.log(`Point le plus proche: ${closestPoint.id} (${closestPoint.slopeName || closestPoint.liftName || 'unknown'}) à ${Math.round(minDistance)}m - Accessible: ${closestPoint.accessible}`);
  } else {
    console.error("Aucun point accessible trouvé!");
  }
  
  return closestPoint;
}

// Algorithme de Dijkstra avec plus de debug
function findShortestPath(graph, startId, endId) {
  const distances = new Map();
  const previous = new Map();
  const visited = new Set();
  const queue = [];
  
  console.log(`Recherche de chemin de ${startId} vers ${endId}`);
  
  // Vérifier que les points existent
  if (!graph.has(startId)) {
    console.error(`Point de départ ${startId} non trouvé dans le graphe`);
    return null;
  }
  
  if (!graph.has(endId)) {
    console.error(`Point d'arrivée ${endId} non trouvé dans le graphe`);
    return null;
  }
  
  // Vérifier la connectivité des points
  const startNode = graph.get(startId);
  const endNode = graph.get(endId);
  
  console.log(`Point de départ: ${startNode.point.type} - ${startNode.neighbors.length} connexions - Accessible: ${startNode.point.accessible}`);
  console.log(`Point d'arrivée: ${endNode.point.type} - ${endNode.neighbors.length} connexions - Accessible: ${endNode.point.accessible}`);
  
  // Initialisation
  graph.forEach((_, nodeId) => {
    distances.set(nodeId, nodeId === startId ? 0 : Infinity);
    previous.set(nodeId, null);
  });
  
  queue.push(startId);
  
  let iterations = 0;
  const maxIterations = graph.size * 2;
  
  while (queue.length > 0 && iterations < maxIterations) {
    iterations++;
    
    // Trier la queue par distance
    queue.sort((a, b) => distances.get(a) - distances.get(b));
    const current = queue.shift();
    
    if (visited.has(current)) continue;
    visited.add(current);
    
    if (current === endId) {
      console.log(`Destination atteinte après ${iterations} itérations`);
      break;
    }
    
    const currentNode = graph.get(current);
    if (!currentNode) continue;
    
    currentNode.neighbors.forEach(neighbor => {
      if (!visited.has(neighbor.id)) {
        const newDistance = distances.get(current) + neighbor.weight;
        
        if (newDistance < distances.get(neighbor.id)) {
          distances.set(neighbor.id, newDistance);
          previous.set(neighbor.id, current);
          
          if (!queue.includes(neighbor.id)) {
            queue.push(neighbor.id);
          }
        }
      }
    });
    
    if (iterations % 100 === 0) {
      console.log(`Itération ${iterations}, queue size: ${queue.length}, visited: ${visited.size}`);
    }
  }
  
  console.log(`Algorithme terminé après ${iterations} itérations`);
  console.log(`Noeuds visités: ${visited.size}/${graph.size}`);
  console.log(`Distance finale vers destination: ${distances.get(endId)}`);
  
  // Reconstruire le chemin
  const path = [];
  let current = endId;
  
  while (current !== null) {
    path.unshift(current);
    current = previous.get(current);
  }
  
  const pathFound = path.length > 1 && path[0] === startId;
  console.log(`Chemin ${pathFound ? 'trouvé' : 'non trouvé'}: ${path.length} points`);
  
  if (!pathFound && path.length === 1) {
    console.log("Le chemin ne contient que le point de départ - aucune connexion trouvée");
    console.log("Connexions du point de départ:");
    const startConnections = graph.get(startId);
    startConnections.neighbors.forEach((neighbor, index) => {
      const neighborNode = graph.get(neighbor.id);
      console.log(`  ${index + 1}. ${neighborNode.point.type} - ${neighborNode.point.slopeName || neighborNode.point.liftName || 'unknown'} [${neighbor.reason}] - Accessible: ${neighborNode.point.accessible}`);
    });
  }
  
  return pathFound ? path : null;
}

// Route principale
router.get('/coordinates/:currentLat/:currentLng/:resortId/:slopeId', async (req, res) => {
  try {
    const { currentLat, currentLng, resortId, slopeId } = req.params;
    const userLat = parseFloat(currentLat);
    const userLng = parseFloat(currentLng);
    
    console.log("=== DÉBUT CALCUL CHEMIN ===");
    console.log("Position utilisateur:", userLat, userLng);
    console.log("Resort ID:", resortId);
    console.log("Slope ID:", slopeId);

    const db = getDatabase('France');
    const collection = db.collection('ski_resorts');
    const resort = await collection.findOne({ _id: new ObjectId(resortId) });
    
    if (!resort) {
      return res.status(404).json({ error: "Resort not found" });
    }
    
    // Trouver la piste de destination
    const targetSlope = resort.slopes.find(slope => slope._id.toString() === slopeId);
    if (!targetSlope) {
      return res.status(404).json({ error: "Target slope not found" });
    }
    
    if (!targetSlope.listCoordinates || targetSlope.listCoordinates.length === 0) {
      return res.status(400).json({ error: "Target slope has no coordinates" });
    }
    
    console.log(`Piste destination: ${targetSlope.name} (${targetSlope.difficulty})`);
    console.log(`Limitation de difficulté appliquée: ${targetSlope.difficulty} et moins`);
    
    // Construire le réseau de points avec filtrage par difficulté
    const points = buildNetworkPoints(resort, targetSlope.difficulty);
    
    if (points.size === 0) {
      return res.status(400).json({ error: "No points in network" });
    }
    
    // Construire le graphe avec connexions filtrées par difficulté
    const graph = buildGraph(points, targetSlope.difficulty);
    
    // Trouver le point de départ le plus proche de l'utilisateur (parmi les accessibles)
    const startPoint = findClosestPoint(userLat, userLng, Array.from(points.values()), targetSlope.difficulty);
    
    // Point d'arrivée: début de la piste de destination
    const destinationCoord = targetSlope.listCoordinates[0];
    const endPoint = findClosestPoint(destinationCoord.lat, destinationCoord.lng, Array.from(points.values()), targetSlope.difficulty);
    
    if (!startPoint || !endPoint) {
      return res.status(400).json({ 
        error: "Could not find accessible start or end points",
        details: {
          startPointFound: !!startPoint,
          endPointFound: !!endPoint,
          maxDifficulty: targetSlope.difficulty
        }
      });
    }
    
    console.log(`Point de départ: ${startPoint.id} - distance: ${Math.round(startPoint.distanceToTarget)}m - Accessible: ${startPoint.accessible}`);
    console.log(`Point d'arrivée: ${endPoint.id} - distance: ${Math.round(endPoint.distanceToTarget)}m - Accessible: ${endPoint.accessible}`);
    
    // Calculer le chemin
    let path = findShortestPath(graph, startPoint.id, endPoint.id);
    
    if (!path) {
      // Essayer de trouver un chemin alternatif vers n'importe quel point accessible de la piste cible
      console.log("Tentative de recherche de chemin alternatif...");
      
      let alternativePath = null;
      for (const [pointId, point] of points) {
        if (point.slopeId && point.slopeId.toString() === slopeId && point.accessible) {
          console.log(`Tentative vers ${pointId} (accessible: ${point.accessible})`);
          alternativePath = findShortestPath(graph, startPoint.id, pointId);
          if (alternativePath) {
            console.log(`Chemin alternatif trouvé vers ${pointId}`);
            break;
          }
        }
      }
      
      if (!alternativePath) {
        return res.status(404).json({ 
          error: "No path found between start and end points with current difficulty restrictions",
          debug: {
            startPoint: startPoint.id,
            endPoint: endPoint.id,
            maxDifficulty: targetSlope.difficulty,
            graphSize: graph.size,
            pointsSize: points.size,
            accessiblePoints: Array.from(points.values()).filter(p => p.accessible).length
          }
        });
      }
      
      // Utiliser le chemin alternatif
      path = alternativePath;
    }
    
    console.log(`Chemin trouvé avec ${path.length} points`);
    
    // *** LOGGING DÉTAILLÉ DU CHEMIN ***
    console.log("=== DÉTAIL DU CHEMIN EMPRUNTÉ ===");
    path.forEach((pointId, index) => {
      const point = points.get(pointId);
      if (point) {
        const pointName = point.slopeName || point.liftName || point.intersectionName || point.connectionName || 'Point inconnu';
        const pointType = point.type;
        let direction = '';
        
        if (point.type === 'slope') {
          direction = point.isStart ? '(sommet)' : point.isEnd ? '(bas)' : '(milieu)';
        } else if (point.type === 'lift') {
          direction = point.isStart ? '(base)' : point.isEnd ? '(sommet)' : '(milieu)';
        }
        
        const difficultyInfo = point.difficulty ? ` [${point.difficulty}]` : '';
        const accessibilityInfo = point.accessible ? '✓' : '✗';
        
        console.log(`${index + 1}. [${pointType.toUpperCase()}] ${pointName} ${direction}${difficultyInfo} ${accessibilityInfo}`);
        
        if (index < path.length - 1) {
          const nextPoint = points.get(path[index + 1]);
          if (nextPoint) {
            const segmentDistance = calculateDistance(point.lat, point.lng, nextPoint.lat, nextPoint.lng);
            const currentNode = graph.get(pointId);
            const connection = currentNode.neighbors.find(n => n.id === path[index + 1]);
            const reason = connection ? connection.reason : 'unknown';
            console.log(`   ↓ Distance: ${Math.round(segmentDistance)}m [${reason}]`);
          }
        }
      }
    });
    console.log("=== FIN DÉTAIL DU CHEMIN ===");
    
    // Construire la réponse
    const coordinates = [];
    const pathDetails = [];
    
    // Position utilisateur
    coordinates.push({
      lat: userLat,
      lng: userLng,
      type: 'user_position',
      name: 'Position utilisateur'
    });
    
    // Point de départ dans le réseau
    if (startPoint.distanceToTarget > 10) {
      coordinates.push({
        lat: startPoint.lat,
        lng: startPoint.lng,
        type: 'network_start',
        name: `Entrée réseau: ${startPoint.slopeName || startPoint.liftName || 'Point d\'accès'}`
      });
    }
    
    // Points du chemin
    path.forEach((pointId, index) => {
      const point = points.get(pointId);
      if (point) {
        const pointName = point.slopeName || point.liftName || point.intersectionName || point.connectionName || 'Point inconnu';
        let direction = '';
        
        if (point.type === 'slope') {
          direction = point.isStart ? ' (sommet)' : point.isEnd ? ' (bas)' : '';
        } else if (point.type === 'lift') {
          direction = point.isStart ? ' (base)' : point.isEnd ? ' (sommet)' : '';
        }
        
        coordinates.push({
          lat: point.lat,
          lng: point.lng,
          type: 'path_point',
          pointType: point.type,
          pointName: pointName,
          name: `${point.type === 'slope' ? '🎿' : point.type === 'lift' ? '🚡' : '🔗'} ${pointName}${direction}`,
          difficulty: point.difficulty || null,
          accessible: point.accessible
        });
        
        pathDetails.push({
          step: index + 1,
          type: point.type,
          name: pointName,
          difficulty: point.difficulty || null,
          direction: direction,
          accessible: point.accessible,
          coordinates: { lat: point.lat, lng: point.lng }
        });
      }
    });
    
    // Calculs de distance
    let networkDistance = 0;
    const userToNetworkDistance = startPoint.distanceToTarget;
    
    for (let i = 1; i < coordinates.length - 1; i++) {
      const segmentDistance = calculateDistance(
        coordinates[i].lat, coordinates[i].lng,
        coordinates[i + 1].lat, coordinates[i + 1].lng
      );
      networkDistance += segmentDistance;
    }
    
    const totalDistance = userToNetworkDistance + networkDistance;
    
    console.log("=== RÉSUMÉ DU TRAJET ===");
    console.log(`Limitation de difficulté: ${targetSlope.difficulty} maximum`);
    pathDetails.forEach((step) => {
      const accessibilitySymbol = step.accessible ? '✓' : '✗';
      console.log(`Étape ${step.step}: ${step.type} - ${step.name}${step.direction}${step.difficulty ? ` (${step.difficulty})` : ''} ${accessibilitySymbol}`);
    });
    console.log(`Distance totale: ${Math.round(totalDistance)}m`);
    console.log("=== FIN CALCUL CHEMIN ===");
    
    res.json({
      coordinates: coordinates,
      totalDistance: Math.round(totalDistance),
    });
    
  } catch (error) {
    console.error("Error in pathfinding:", error);
    return res.status(500).json({ error: "Internal server error", details: error.message });
  }
});

module.exports = router;