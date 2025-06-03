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
  
  // TOUTES les pistes mais marquées comme accessibles ou non
  resort.slopes.forEach(slope => {
    const isAccessible = canUseSlope(maxDifficulty, slope.difficulty);
    
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
          
        }
      }
    });
  });
  
  // Debug: vérifier la connectivité du graphe
  let connectedNodes = 0;
  graph.forEach((node, nodeId) => {
    if (node.neighbors.length > 0) {
      connectedNodes++;
    }
  });
  
  return graph;
}

// Trouver le point le plus proche (uniquement parmi les points accessibles)
function findClosestPoint(lat, lng, points, maxDifficulty = null) {
  let closestPoint = null;
  let minDistance = Infinity;
  
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
  
  return closestPoint;
}

// Algorithme de Dijkstra avec plus de debug
function findShortestPath(graph, startId, endId) {
  const distances = new Map();
  const previous = new Map();
  const visited = new Set();
  const queue = [];
  
  // Vérifier que les points existent
  if (!graph.has(startId)) {
    return null;
  }
  
  if (!graph.has(endId)) {
    return null;
  }

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
  }
  // Reconstruire le chemin
  const path = [];
  let current = endId;
  
  while (current !== null) {
    path.unshift(current);
    current = previous.get(current);
  }
  
  const pathFound = path.length > 1 && path[0] === startId;
  
  if (!pathFound && path.length === 1) {
    const startConnections = graph.get(startId);
    startConnections.neighbors.forEach((neighbor, index) => {
      const neighborNode = graph.get(neighbor.id);
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
    // Calculer le chemin
    let path = findShortestPath(graph, startPoint.id, endPoint.id);
    
    if (!path) {
      // Essayer de trouver un chemin alternatif vers n'importe quel point accessible de la piste cible
      let alternativePath = null;
      for (const [pointId, point] of points) {
        if (point.slopeId && point.slopeId.toString() === slopeId && point.accessible) {
          alternativePath = findShortestPath(graph, startPoint.id, pointId);
          if (alternativePath) {
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
    
    res.json({
      coordinates: coordinates,
      totalDistance: Math.round(totalDistance),
    });
    
  } catch (error) {
    return res.status(500).json({ error: "Internal server error", details: error.message });
  }
});

module.exports = router;