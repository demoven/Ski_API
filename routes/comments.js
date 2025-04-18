const express = require('express');
const { getDatabase } = require('../services/database');
const { ObjectId } = require('mongodb'); 

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const db = getDatabase('sample_mflix'); // Remplacez 'sample_mflix' par le nom de votre base de données
    const collection = db.collection('comments'); // Remplacez 'comments' par le nom de votre collection

    const comments = await collection.find({}).toArray();
    res.status(200).json(comments);
  } catch (error) {
    console.error("Error fetching comments:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});
router.post('/', async (req, res) => {
    try {
        const db = getDatabase('test'); // Remplacez 'sample_mflix' par le nom de votre base de données
        const collection = db.collection('test'); // Remplacez 'comments' par le nom de votre collection

        if(!req.body.name) {
            return res.status(400).json({ error: "Name is required" });
        }

        // Ajout de l'_id en tant qu'ObjectId
        const newComment = {
            _id: new ObjectId(), // Génère un nouvel ObjectId
            name: req.body.name
        };

        await collection.insertOne(newComment);

        res.status(201).json(newComment); // Retourne le commentaire inséré
    } catch (error) {
        console.error("Error adding comment:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});
module.exports = router;