const express = require('express');
const { getDatabase } = require('../services/database');
const { ObjectId } = require('mongodb');
const Resort = require('../models/Resort'); // Importer le modèle Mongoose

const router = express.Router();

// GET: Récupérer tous les resorts
router.get('/', async (req, res) => {
  try {
    const db = getDatabase('France'); // Connexion à la base de données
    const collection = db.collection('ski_resorts'); // Accès à la collection

    const resorts = await collection.find({}).toArray(); // Récupérer tous les documents
    res.status(200).json(resorts);
  } catch (error) {
    console.error("Error fetching resorts:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// POST: Ajouter un nouveau resort
router.post('/', async (req, res) => {
  try {
    const db = getDatabase('France'); // Connexion à la base de données
    const collection = db.collection('ski_resorts'); // Accès à la collection

    // Créer un nouvel objet Resort avec Mongoose pour validation
    const newResort = new Resort(req.body);

    // Valider les données avec Mongoose
    await newResort.validate();

    // Insérer le document validé dans la collection MongoDB
    const result = await collection.insertOne(newResort.toObject()); // Convertir le document Mongoose en objet brut

    res.status(201).json({
      _id: result.insertedId, // Utiliser insertedId pour récupérer l'ID du document inséré
      ...newResort.toObject(), // Inclure les autres champs validés
    });
  } catch (error) {
    console.error("Error adding resort:", error);

    // Vérifier si l'erreur est liée à la validation Mongoose
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }

    res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;