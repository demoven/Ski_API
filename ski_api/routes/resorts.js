const express = require('express');
const { getDatabase } = require('../services/database');
const { ObjectId } = require('mongodb');
const admin = require('firebase-admin');
const serviceAccount = require('../firebase-service-account.json');
const axios = require('axios');
const dotenv = require('dotenv');
const { connections } = require('mongoose');
dotenv.config();

const router = express.Router();

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_URL
});

const db_firebase = admin.database();

// Fonction pour récupérer le profil utilisateur
const getUserProfile = async (userUid) => {
  try {
    const url = process.env.PROFILE_SERVICE_URL || 'http://localhost:8081';
    const response = await axios.get(url, { headers: { 'x-uid': userUid } });
    return response.data;
  } catch (error) {
    console.error("Erreur profil:", error.message);
    return null;
  }
};

// Fonction pour récupérer les statistiques d'une piste
const getSlopeStats = async (resortId, slopeId) => {
  try {
    const snapshot = await db_firebase.ref(`reviews/${resortId}/${slopeId}/stats`).once('value');
    return snapshot.exists() ? snapshot.val() : null;
  } catch (error) {
    console.error("Erreur récupération stats:", error.message);
    return null;
  }
};
// Fonction améliorée pour calculer le score de pertinence d'une piste
const calculateSlopeRelevance = (slope, userProfile, slopeStats) => {
  let score = 0;
  let factorCount = 0;

  // Si pas de statistiques, se baser principalement sur le niveau utilisateur
  if (!slopeStats || slopeStats.totalNumber === 0) {
    // Score par défaut basé sur la difficulté
    const difficultyOrder = { 'Vert': 4, 'Bleu': 3, 'Rouge': 2, 'Noir': 1 };
    let defaultScore = difficultyOrder[slope.difficulty] || 2.5;

    // Si le profil utilisateur existe avec un niveau, donner priorité à la correspondance niveau/difficulté
    if (userProfile && userProfile.level) {
      const userLevel = userProfile.level.toLowerCase();
      const slopeDifficulty = slope.difficulty;

      const levelMapping = {
        'vert': {
          'Vert': 5.0,     // Parfait - augmenté pour donner priorité
          'Bleu': 3.0,     // Acceptable pour progresser - augmenté
          'Rouge': 1.0,    // Trop difficile mais possible
          'Noir': 0.5      // Dangereux mais listé
        },
        'bleu': {
          'Vert': 3.0,     // Un peu facile
          'Bleu': 5.0,     // Parfait - augmenté
          'Rouge': 3.5,    // Bon défi - augmenté
          'Noir': 2.0      // Encore difficile mais possible
        },
        'rouge': {
          'Vert': 1.5,     // Trop facile
          'Bleu': 3.0,     // Facile
          'Rouge': 5.0,    // Parfait - augmenté
          'Noir': 4.0      // Bon défi - augmenté
        },
        'noir': {
          'Vert': 1.0,     // Beaucoup trop facile
          'Bleu': 2.0,     // Trop facile
          'Rouge': 4.0,    // Bon niveau
          'Noir': 5.0      // Parfait - augmenté
        }
      };

      if (levelMapping[userLevel] && levelMapping[userLevel][slopeDifficulty] !== undefined) {
        // Remplacer le score par défaut par le score basé sur le niveau
        return levelMapping[userLevel][slopeDifficulty];
      }
    }

    return defaultScore;
  }

  // 1. Score de base basé sur la note moyenne générale (poids: 1.0)
  if (slopeStats.ratingAvg && slopeStats.totalNumber > 0) {
    score += slopeStats.ratingAvg;
    factorCount += 1.0;
  }

  // 2. Bonus basé sur les préférences utilisateur similaires (poids: 0.8)
  if (userProfile && slopeStats) {
    Object.entries(userProfile).forEach(([key, value]) => {
      if (slopeStats[key] && slopeStats[key][value]) {
        const prefStat = slopeStats[key][value];
        if (prefStat.count > 0) {
          // Pondération basée sur le nombre d'avis similaires
          const confidence = Math.min(prefStat.count / 3, 1); // Confiance max à 3 avis
          const weight = confidence * 0.8;
          score += prefStat.avg * weight;
          factorCount += weight;
        }
      }
    });
  }

  // 3. Correspondance niveau utilisateur / difficulté piste (poids: 1.2)
  if (userProfile && userProfile.level) {
    const userLevel = userProfile.level.toLowerCase();
    const slopeDifficulty = slope.difficulty;
    let difficultyScore = 0;

    const levelMapping = {
      'vert': {
        'Vert': 2.0,    // Parfait
        'Bleu': 0.5,    // Acceptable pour progresser
        'Rouge': -1.5,  // Trop difficile
        'Noir': -2.0    // Dangereux
      },
      'bleu': {
        'Vert': 0.3,    // Un peu facile
        'Bleu': 2.0,    // Parfait
        'Rouge': 1.0,   // Bon défi
        'Noir': -0.8    // Encore difficile
      },
      'rouge': {
        'Vert': -0.5,   // Trop facile
        'Bleu': -0.2,   // Facile
        'Rouge': 1.5,   // Bien
        'Noir': 2.0     // Parfait
      },
      'noir': {
        'Vert': -0.5,
        'Bleu': -0.2,
        'Rouge': 1.5,
        'Noir': 2.0
      }
    };

    if (levelMapping[userLevel] && levelMapping[userLevel][slopeDifficulty] !== undefined) {
      difficultyScore = levelMapping[userLevel][slopeDifficulty];
      // Augmenter le poids lorsqu'il y a peu d'avis (inversement proportionnel)
      const levelWeight = 1.2 + (3 / Math.max(slopeStats.totalNumber, 1)) * 0.8;
      score += difficultyScore * levelWeight;
      factorCount += levelWeight;
    }
  }

  // 4. Bonus de popularité avec courbe logarithmique (poids: 0.3)
  if (slopeStats.totalNumber > 0) {
    const popularityScore = Math.log(slopeStats.totalNumber + 1) * 0.15;
    score += popularityScore;
    factorCount += 0.3;
  }

  // 5. Malus pour les pistes avec très peu d'avis (moins de 3)
  if (slopeStats.totalNumber > 0 && slopeStats.totalNumber < 3) {
    score -= 0.5; // Légère pénalité pour manque de données
  }

  // 6. Bonus pour les pistes très bien notées (>= 4.0)
  if (slopeStats.ratingAvg >= 4.0) {
    score += 0.3;
  }

  // Normalisation finale
  const finalScore = factorCount > 0 ? score / Math.max(factorCount, 1) : 2.5;

  // S'assurer que le score reste dans une plage raisonnable
  return Math.max(0, Math.min(5, finalScore));
};

async function isAdmin(req, res, next) {
  try {
    const userUid = req.headers['x-uid'];

    if (!userUid) {
      return res.status(401).json({ error: "Authentification requise. UID manquant dans l'en-tête" });
    }

    // Récupérer les informations de l'utilisateur, y compris les custom claims
    const userRecord = await admin.auth().getUser(userUid);

    // Vérifier si l'utilisateur a le custom claim 'admin'
    if (userRecord.customClaims && userRecord.customClaims.admin === true) {
      // L'utilisateur est admin, continuer vers la route
      next();
    } else {
      // L'utilisateur n'est pas admin
      return res.status(403).json({
        error: "Accès refusé",
        message: "Vous n'avez pas les droits d'administration nécessaires"
      });
    }
  } catch (error) {
    console.error("Erreur lors de la vérification des droits d'administration:", error);
    return res.status(500).json({
      error: "Erreur serveur",
      message: "Impossible de vérifier les droits d'administration"
    });
  }
}

//GET: Retrieve all ski resorts
router.get('/', async (req, res) => {
  try {
    //Connect to the database
    const db = getDatabase('France');

    //Access the collection
    const collection = db.collection('ski_resorts');

    //Find all resorts in the collection
    const resorts = await collection.find({}).toArray();

    //Send the resorts as a JSON response and set the status to 200
    res.status(200).json(resorts);

  } catch (error) {
    //Send a 500 status code for any errors that occur
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// GET: Retrieve only the names of all ski resorts
router.get('/names', async (req, res) => {
  try {
    // Connect to the database
    const db = getDatabase('France');

    // Access the collection
    const collection = db.collection('ski_resorts');

    // Find all resorts in the collection and project only the name field
    const resortsWithId = await collection.find({}, { projection: { name: 1 } }).toArray();

    // Extract only the names from the result objects
    const resortNames = resortsWithId.map(resort => resort.name);

    // Send just the array of names as a JSON response
    res.status(200).json(resortNames);

  } catch (error) {
    // Send a 500 status code for any errors that occur
    res.status(500).json({ error: "Internal Server Error" });
  }
});
router.get('/:name', async (req, res) => {
  try {
    const db = getDatabase('France');
    const collection = db.collection('ski_resorts');
    const resort = await collection.findOne({ name: req.params.name });
    const resortWithoutSlopesAndLifts = {
      _id: resort._id,
      name: resort.name,
      slopes: resort.slopes ? resort.slopes.map(slope => ({
        _id: slope._id,
        name: slope.name,
        difficulty: slope.difficulty,
        resortId: slope.resortId,
      })) : [],
      lifts: resort.lifts ? resort.lifts.map(lift => ({
        _id: lift._id,
        name: lift.name,
      })) : [],
    }

    if (!resort) {
      return res.status(404).json({ error: "Resort not found" });
    }

    // Récupérer l'UID utilisateur et son profil
    const userUid = req.headers['x-uid'];
    let userProfile = null;

    if (userUid) {
      userProfile = await getUserProfile(userUid);
      console.log(`Profil utilisateur récupéré pour ${userUid}:`, userProfile);
    }

    // Traitement des pistes si elles existent
    if (resortWithoutSlopesAndLifts.slopes && resortWithoutSlopesAndLifts.slopes.length > 0) {
      console.log(`Tri de ${resortWithoutSlopesAndLifts.slopes.length} pistes pour la station ${resortWithoutSlopesAndLifts.name}`);

      // Récupérer les statistiques et calculer les scores
      const slopesWithRelevance = await Promise.all(
        resortWithoutSlopesAndLifts.slopes.map(async (slope, index) => {
          try {
            const stats = await getSlopeStats(resortWithoutSlopesAndLifts._id, slope._id);
            const relevanceScore = calculateSlopeRelevance(slope, userProfile, stats);

            console.log(`Piste ${slope.name}: score=${relevanceScore.toFixed(2)}, difficulté=${slope.difficulty}`);

            return {
              ...slope,
              relevanceScore: Number(relevanceScore.toFixed(2)),
              stats: stats ? {
                ratingAvg: Number((stats.ratingAvg || 0).toFixed(2)),
                totalNumber: stats.totalNumber || 0
              } : null,
              originalIndex: index // Pour debug
            };
          } catch (error) {
            console.error(`Erreur traitement piste ${slope.name}:`, error);
            return {
              ...slope,
              relevanceScore: 2.5, // Score neutre en cas d'erreur
              stats: null,
              originalIndex: index
            };
          }
        })
      );

      // Tri par score de pertinence décroissant, puis par note moyenne
      resortWithoutSlopesAndLifts.slopes = slopesWithRelevance.sort((a, b) => {
        if (Math.abs(a.relevanceScore - b.relevanceScore) < 0.1) {
          // Si les scores sont très proches, trier par note moyenne
          const avgA = a.stats?.ratingAvg || 0;
          const avgB = b.stats?.ratingAvg || 0;
          return avgB - avgA;
        }
        return b.relevanceScore - a.relevanceScore;
      });

      console.log('Ordre final des pistes:', resortWithoutSlopesAndLifts.slopes.map(s =>
        `${s.name} (${s.relevanceScore})`
      ).join(', '));
    }

    res.status(200).json(resortWithoutSlopesAndLifts);
  } catch (error) {
    console.error("Erreur dans GET /:name:", error);
    res.status(500).json({
      error: "Internal Server Error",
      message: "Erreur lors de la récupération et du tri des pistes"
    });
  }
});

router.get('/coordinates/:currentLat/:currentLng/:destinationId', async (req, res) => {
  try {
    const { currentLat, currentLng, destinationId } = req.params;

    console.log('currentLat:', currentLat);
    console.log('currentLng:', currentLng);
    console.log('destinationId:', destinationId);

    const testData = [
      {
        "lat": 43.09762198347906,
        "lng": 5.884755593921662
      },
      {
        "lat": 43.10133521973748,
        "lng": 5.883511052014766
      }
    ]
    res.status(200).json(testData);
  } catch (error) {
  }

});
//POST: Add a new ski resort or update existing one (preserving all existing IDs)
router.post('/', isAdmin, async (req, res) => {
  try {
    //Connect to the database
    const db = getDatabase('France');

    //Access the collection
    const collection = db.collection('ski_resorts');

    //Helper functions
    const isString = value => typeof value === 'string';
    const isNumber = value => typeof value === 'number';
    const isArray = Array.isArray;
    const isObject = value => value && typeof value === 'object';

    const stationName = isString(req.body.station) ? req.body.station : "Unnamed resort";
    
    // Vérifier si la station existe déjà
    const existingResort = await collection.findOne({ name: stationName });
    
    let resortId;
    let isUpdate = false;
    
    if (existingResort) {
      resortId = existingResort._id;
      isUpdate = true;
      console.log(`Station "${stationName}" trouvée, mise à jour avec préservation des IDs...`);
    } else {
      resortId = new ObjectId();
      console.log(`Nouvelle station "${stationName}", création...`);
    }

    // Fonction pour trouver un élément existant par nom
    const findExistingByName = (existingArray, name) => {
      return existingArray ? existingArray.find(item => item.name === name) : null;
    };

    // Fonction pour créer/mettre à jour les pistes
    const processSlopes = () => {
      if (!isArray(req.body.slopes)) return [];
      
      return req.body.slopes.map(slope => {
        const slopeName = isString(slope.name) ? slope.name : "Unnamed slope";
        const existingSlope = isUpdate ? findExistingByName(existingResort.slopes, slopeName) : null;
        
        return {
          resortId: resortId,
          _id: existingSlope ? existingSlope._id : new ObjectId(), // Préserver l'ID existant
          name: slopeName,
          difficulty: isString(slope.difficulty) ? slope.difficulty : "Vert",
          listCoordinates: isArray(slope.coordinates)
            ? slope.coordinates.map(coord => ({
                _id: new ObjectId(), // Nouvelles coordonnées = nouveaux IDs
                lat: coord[1],
                lng: coord[0],
              }))
            : [],
          intersections: isArray(slope.connection)
            ? slope.connection.map(connection => {
                const connectionName = isString(connection.name) ? connection.name : "Unnamed intersection";
                const existingIntersection = existingSlope && existingSlope.intersections 
                  ? findExistingByName(existingSlope.intersections, connectionName) 
                  : null;
                
                return {
                  _id: existingIntersection ? existingIntersection._id : new ObjectId(),
                  name: connectionName,
                  coordinates: isArray(connection.coordinates)
                    ? [{
                        _id: new ObjectId(), // Nouvelles coordonnées = nouveaux IDs
                        lat: connection.coordinates[1],
                        lng: connection.coordinates[0],
                      }]
                    : [],
                };
              })
            : [],
        };
      });
    };

    // Fonction pour créer/mettre à jour les remontées
    const processLifts = () => {
      if (!isArray(req.body.chair_lifts)) return [];
      
      return req.body.chair_lifts.map(lift => {
        const liftName = isString(lift.name) ? lift.name : "Unnamed lift";
        const existingLift = isUpdate ? findExistingByName(existingResort.lifts, liftName) : null;
        
        return {
          resortId: resortId,
          _id: existingLift ? existingLift._id : new ObjectId(), // Préserver l'ID existant
          name: liftName,
          coordinates: isArray(lift.coordinates)
            ? lift.coordinates.map(coord => ({
                _id: new ObjectId(), // Nouvelles coordonnées = nouveaux IDs
                lat: coord[1],
                lng: coord[0],
              }))
            : [],
          connections: isArray(lift.connection)
            ? lift.connection.map(connection => {
                const connectionName = isString(connection.name) ? connection.name : "Unnamed connection";
                const existingConnection = existingLift && existingLift.connections 
                  ? findExistingByName(existingLift.connections, connectionName) 
                  : null;
                
                return {
                  _id: existingConnection ? existingConnection._id : new ObjectId(),
                  name: connectionName,
                  coordinates: isArray(connection.coordinates)
                    ? [{
                        _id: new ObjectId(), // Nouvelles coordonnées = nouveaux IDs
                        lat: connection.coordinates[1],
                        lng: connection.coordinates[0],
                      }]
                    : [],
                };
              })
            : [],
        };
      });
    };

    const resort = {
      _id: resortId,
      name: stationName,
      slopes: processSlopes(),
      lifts: processLifts(),
    };

    let result;
    
    if (isUpdate) {
      // Mettre à jour la station existante
      result = await collection.replaceOne(
        { _id: resortId },
        resort
      );
      
      if (result.modifiedCount === 0 && result.matchedCount === 0) {
        return res.status(404).json({ error: "Resort not found for update" });
      }
      
      console.log(`Station "${stationName}" mise à jour avec préservation des IDs`);
      
      res.status(200).json({
        _id: resortId,
        message: "Resort updated successfully with preserved IDs",
        operation: "update",
        slopesCount: resort.slopes.length,
        liftsCount: resort.lifts.length
      });
      
    } else {
      // Insérer une nouvelle station
      result = await collection.insertOne(resort);
      
      console.log(`Nouvelle station "${stationName}" créée`);
      
      res.status(201).json({
        _id: result.insertedId,
        message: "Resort created successfully", 
        operation: "create",
        slopesCount: resort.slopes.length,
        liftsCount: resort.lifts.length
      });
    }

  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    
    console.error("Erreur lors de la création/mise à jour de la station:", error);
    res.status(500).json({ 
      error: "Internal Server Error",
      message: error.message 
    });
  }
});

//DELETE: Delete a ski resort by name
router.delete('/:name', isAdmin, async (req, res) => {
  try {
    //Connect to the database
    const db = getDatabase('France');

    //Access the collection
    const collection = db.collection('ski_resorts');

    //Delete the resort by name
    const result = await collection.deleteOne({ name: req.params.name });

    //Check if the resort was found and deleted
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: "Resort not found" });
    }

    //Send a success message as a JSON response with a 200 status code
    res.status(200).json({ message: "Resort deleted successfully" });
  } catch (error) {
    //Handle any errors that occur during the deletion process
    res.status(500).json({ error: "Internal Server Error" });
  }
});

//DELETE: Delete a ski resort by ID
router.delete('/id/:id', isAdmin, async (req, res) => {
  try {
    //Connect to the database
    const db = getDatabase('France');

    //Access the collection
    const collection = db.collection('ski_resorts');

    //Delete the resort by ID
    const result = await collection.deleteOne({ _id: new ObjectId(req.params.id) });

    //Check if the resort was found and deleted
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: "Resort not found" });
    }

    //Send a success message as a JSON response with a 200 status code
    res.status(200).json({ message: "Resort deleted successfully" });
  } catch (error) {
    //Handle any errors that occur during the deletion process
    res.status(500).json({ error: "Internal Server Error" });
  }
});

//EXPORT: Export the router to be used in other parts of the application
module.exports = router;