const express = require('express');
const { getDatabase } = require('../services/database');
const { ObjectId } = require('mongodb');
const admin = require('firebase-admin');
const serviceAccount = require('../firebase-service-account.json');
const axios = require('axios');
const dotenv = require('dotenv');
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
  // ÉTAPE 1: Score de base selon le niveau utilisateur (facteur principal)
  let baseScore = 2.5; // Score par défaut
  
  if (userProfile && userProfile.level) {
    const userLevel = userProfile.level.toLowerCase();
    const slopeDifficulty = slope.difficulty;

    // Mapping avec des scores qui priorisent fortement le niveau correspondant
    const levelMapping = {
      'vert': {
        'Vert': 10.0,    // Parfait - score très élevé
        'Bleu': 7.0,     // Acceptable pour progresser
        'Rouge': 3.0,    // Trop difficile mais possible
        'Noir': 1.0      // Dangereux
      },
      'bleu': {
        'Vert': 6.0,     // Un peu facile mais ok
        'Bleu': 10.0,    // Parfait - score très élevé
        'Rouge': 8.0,    // Bon défi
        'Noir': 4.0      // Difficile mais possible
      },
      'rouge': {
        'Vert': 3.0,     // Trop facile
        'Bleu': 6.0,     // Facile
        'Rouge': 10.0,   // Parfait - score très élevé
        'Noir': 9.0      // Bon défi
      },
      'noir': {
        'Vert': 2.0,     // Beaucoup trop facile
        'Bleu': 4.0,     // Trop facile
        'Rouge': 8.0,    // Bon niveau
        'Noir': 10.0     // Parfait - score très élevé
      },
      'noire': { // Alias pour 'noir'
        'Vert': 2.0,
        'Bleu': 4.0,
        'Rouge': 8.0,
        'Noir': 10.0
      }
    };

    if (levelMapping[userLevel] && levelMapping[userLevel][slopeDifficulty] !== undefined) {
      baseScore = levelMapping[userLevel][slopeDifficulty];
    }
  } else {
    // Si pas de profil utilisateur, ordre par défaut des difficultés
    const difficultyOrder = { 'Vert': 8, 'Bleu': 6, 'Rouge': 4, 'Noir': 2 };
    baseScore = difficultyOrder[slope.difficulty] || 5;
  }

  // ÉTAPE 2: Ajustements fins (facteurs secondaires)
  let adjustmentScore = 0;
  let adjustmentCount = 0;

  // Si pas de statistiques, retourner le score de base
  if (!slopeStats || slopeStats.totalNumber === 0) {
    return Math.max(0, Math.min(15, baseScore)); // Plafond à 15
  }

  // 2.1 Ajustement basé sur la note moyenne (petit impact)
  if (slopeStats.ratingAvg && slopeStats.totalNumber > 0) {
    // Convertir la note sur 5 en ajustement sur 2 points max
    const ratingAdjustment = ((slopeStats.ratingAvg - 2.5) / 2.5) * 2;
    adjustmentScore += ratingAdjustment;
    adjustmentCount += 1;
  }

  // 2.2 Ajustement basé sur les préférences utilisateur similaires
  if (userProfile && slopeStats) {
    let preferenceBonuses = 0;
    let preferenceCount = 0;

    Object.entries(userProfile).forEach(([key, value]) => {
      if (key !== 'level' && slopeStats[key] && slopeStats[key][value]) {
        const prefStat = slopeStats[key][value];
        if (prefStat.count > 0) {
          // Bonus/malus basé sur la note des utilisateurs similaires
          const preferenceAdjustment = ((prefStat.avg - 2.5) / 2.5) * 1.5;
          const confidence = Math.min(prefStat.count / 3, 1);
          preferenceBonuses += preferenceAdjustment * confidence;
          preferenceCount++;
        }
      }
    });

    if (preferenceCount > 0) {
      adjustmentScore += preferenceBonuses / preferenceCount;
      adjustmentCount += 0.5; // Poids réduit
    }
  }

  // 2.3 Bonus de popularité (très faible impact)
  if (slopeStats.totalNumber > 0) {
    const popularityBonus = Math.log(slopeStats.totalNumber + 1) * 0.1;
    adjustmentScore += popularityBonus;
    adjustmentCount += 0.2;
  }

  // 2.4 Bonus pour les pistes très bien notées
  if (slopeStats.ratingAvg >= 4.0) {
    adjustmentScore += 0.5;
  }

  // 2.5 Malus pour les pistes avec très peu d'avis
  if (slopeStats.totalNumber > 0 && slopeStats.totalNumber < 3) {
    adjustmentScore -= 0.3;
  }

  // ÉTAPE 3: Calcul du score final
  const finalAdjustment = adjustmentCount > 0 ? adjustmentScore / adjustmentCount : 0;
  const finalScore = baseScore + Math.max(-2, Math.min(2, finalAdjustment)); // Limiter l'ajustement à ±2

  // S'assurer que le score reste dans une plage raisonnable
  return Math.max(0, Math.min(15, finalScore));
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

      // Tri par score de pertinence décroissant
      resortWithoutSlopesAndLifts.slopes = slopesWithRelevance.sort((a, b) => {
        // Tri principal par score de pertinence
        if (Math.abs(a.relevanceScore - b.relevanceScore) > 0.1) {
          return b.relevanceScore - a.relevanceScore;
        }
        
        // En cas d'égalité, trier par note moyenne
        const avgA = a.stats?.ratingAvg || 0;
        const avgB = b.stats?.ratingAvg || 0;
        if (Math.abs(avgA - avgB) > 0.1) {
          return avgB - avgA;
        }
        
        // En dernier recours, trier par nombre d'avis
        const countA = a.stats?.totalNumber || 0;
        const countB = b.stats?.totalNumber || 0;
        return countB - countA;
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