const express = require('express');
const { getDatabase } = require('../services/database');
const { ObjectId } = require('mongodb');
const Resort = require('../models/Resort'); 

const router = express.Router();

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

//POST: Add a new ski resort
router.post('/', async (req, res) => {
  try {
    //Connect to the database
    const db = getDatabase('France');

    //Access the collection
    const collection = db.collection('ski_resorts'); 

    //Create a new resort instance using the Resort model
    const newResort = new Resort(req.body);

    //Validate the new resort instance using Mongoose to ensure it meets the schema requirements
    await newResort.validate();

    //Insert the new resort into the collection
    const result = await collection.insertOne(newResort.toObject()); 

    //Send the inserted resort as a JSON response with a 201 status code
    res.status(201).json({
      //Include the inserted ID in the response
      _id: result.insertedId, 
      //Include the resort data in the response
      ...newResort.toObject(), 
    });
  } catch (error) {
    //Send a 400 status code if the error is a validation error
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    //Send a 500 status code for any other errors
    res.status(500).json({ error: "Internal Server Error" });
  }
});

//DELETE: Delete a ski resort by name
router.delete('/:name', async (req, res) => {
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
    
    //Send a 500 status code for any errors that occur
    res.status(500).json({ error: "Internal Server Error" });
  }
});

//DELETE: Delete a ski resort by ID
router.delete('/id/:id', async (req, res) => {
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