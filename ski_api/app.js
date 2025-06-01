const express = require('express');
const { connectToDatabase } = require('./services/database');
const resortsRoutes = require('./routes/resorts');
const coordinatesRoutes = require('./routes/coordinates');


const app = express();
app.use(express.json({limit: '50mb'})); 
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const PORT = process.env.PORT;

const startServer = async () => {
  try {
    await connectToDatabase();
    console.log("Connected to MongoDB Atlas");

    // Use the comments routes
    app.use('/', resortsRoutes);
    app.use('/', coordinatesRoutes);

    // Start the server

    // Remove the 0.0.0.0 after development
    app.listen(PORT, '127.0.0.1', () => {
      console.log(`Server is running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Error connecting to MongoDB Atlas:", error);
    process.exit(1); // Exit the application if the connection fails
  }
};

startServer();