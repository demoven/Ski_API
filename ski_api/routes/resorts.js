const express = require('express');
const { getDatabase } = require('../services/database');
const { ObjectId } = require('mongodb');
const admin = require('firebase-admin');
const serviceAccount = require('../firebase-service-account.json');
const dotenv = require('dotenv');
dotenv.config();

const router = express.Router();

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_URL
});


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

//GET: Retrieve a ski resort by name
router.get('/:name', async (req, res) => {
  try {
    //Connect to the database
    const db = getDatabase('France');

    //Access the collection
    const collection = db.collection('ski_resorts');

    //Find the resort by name
    const resort = await collection.findOne({ name: req.params.name });

    //Check if the resort was found
    if (!resort) {
      return res.status(404).json({ error: "Resort not found" });
    }

    //Send the resort as a JSON response with a 200 status code
    res.status(200).json(resort);
  } catch (error) {
    //Send a 500 status code for any errors that occur
    res.status(500).json({ error: "Internal Server Error" });
  }
});

//POST: Add a new ski resort
router.post('/',isAdmin, async (req, res) => {
  try {
    //Connect to the database
    const db = getDatabase('France');

    //Access the collection
    const collection = db.collection('ski_resorts');

    //Check if the resort already exists in the collection
    const isString = value => typeof value === 'string';
    const isNumber = value => typeof value === 'number';
    const isArray = Array.isArray;
    const isObject = value => value && typeof value === 'object';
    
    const resort = {
      _id: new ObjectId(),
      name: isString(req.body.name) ? req.body.name : "Unnamed resort",
      slopes: isArray(req.body.slopes)
        ? req.body.slopes.map(slope => ({
            _id: new ObjectId(),
            name: isString(slope.name) ? slope.name : "Unnamed slope",
            elevation: isNumber(slope.elevation) ? slope.elevation : 0,
            difficulty: isString(slope.difficulty) ? slope.difficulty : "unknown",
            listCoordinates: isArray(slope.listCoordinates)
              ? slope.listCoordinates
                  .filter(coord => isObject(coord) && isNumber(coord.lat) && isNumber(coord.lng))
                  .map(coord => ({
                    _id: new ObjectId(),
                    lat: coord.lat,
                    lng: coord.lng,
                  }))
              : [],
              intersections: isArray(slope.intersections)
              ? slope.intersections.map(intersection => ({
                  _id: new ObjectId(),
                  name: isString(intersection.name) ? intersection.name : "Unnamed intersection",
                  coordinates: isObject(intersection.coordinates) && isNumber(intersection.coordinates.lat) && isNumber(intersection.coordinates.lng)
                    ? {
                        _id: new ObjectId(),
                        lat: intersection.coordinates.lat,
                        lng: intersection.coordinates.lng,
                      }
                    : null,
                }))
              : [],
          }))
        : [],
      lifts: isArray(req.body.lifts)
        ? req.body.lifts.map(lift => ({
            _id: new ObjectId(),
            name: isString(lift.name) ? lift.name : "Unnamed lift",
            start: isObject(lift.start) && isNumber(lift.start.lat) && isNumber(lift.start.lng)
              ? {
                  _id: new ObjectId(),
                  lat: lift.start.lat,
                  lng: lift.start.lng,
                }
              : null,
            end: isObject(lift.end) && isNumber(lift.end.lat) && isNumber(lift.end.lng)
              ? {
                  _id: new ObjectId(),
                  lat: lift.end.lat,
                  lng: lift.end.lng,
                }
              : null,
          }))
        : [],
    };

    //Insert the new resort into the collection
    const result = await collection.insertOne(resort);

    //Send the inserted resort as a JSON response with a 201 status code
    res.status(201).json({
      //Include the inserted ID in the response
      _id: result.insertedId,

    });
  } catch (error) {
    //Send a 400 status code if the error is a validation error
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    //Send a 500 status code for any other errors
    res.status(500).json({ error: "Internal Server Error" });
    console.log(error);
  }
});

//DELETE: Delete a ski resort by name
router.delete('/:name',isAdmin, async (req, res) => {
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
router.delete('/id/:id',isAdmin, async (req, res) => {
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