const express = require('express');
const { getDatabase } = require('../services/database');
const { ObjectId } = require('mongodb');

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

    //Check if the resort already exists in the collection
    const resort = {
      _id: new ObjectId(),
      name: req.body.name,
      slopes: Array.isArray(req.body.slopes)
        ? req.body.slopes.map(slope => ({
          _id: new ObjectId(),
          name: slope.name,
          elevation: slope.elevation,
          difficulty: slope.difficulty,
          listCoordinates: Array.isArray(slope.listCoordinates)
            ? slope.listCoordinates.map(coord => ({
              _id: new ObjectId(),
              lat: coord.lat,
              lng: coord.lng,
            }))
            : [],

          intersections: Array.isArray(slope.intersections)
            ? slope.intersections.map(intersection => ({
              _id: new ObjectId(),
              name: intersection.name,
              listCoordinates: Array.isArray(intersection.listCoordinates)
                ? intersection.listCoordinates.map(coord => ({
                  _id: new ObjectId(),
                  lat: coord.lat,
                  lng: coord.lng,
                }))
                : [],
            }))
            : [],
            reviews: Array.isArray(slope.reviews)
            ? slope.reviews.map(review => ({
              _id: new ObjectId(),
              name: review.name,
              rating: review.rating,
              comment: review.comment,
            }))
            : [],
        })) : [],

      lifts: Array.isArray(req.body.lifts)
        ? req.body.lifts.map(lift => ({
          _id: new ObjectId(),
          name: lift.name,
          start: {
            _id: new ObjectId(),
            lat: lift.start.lat,
            lng: lift.start.lng,
          },
          end: {
            _id: new ObjectId(),
            lat: lift.end.lat,
            lng: lift.end.lng,
          }
        })) : [],
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