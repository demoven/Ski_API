const express = require('express');
const { connectToDatabase } = require('./services/database');
const commentsRoutes = require('./routes/comments');

const app = express();
app.use(express.json());

const PORT = process.env.PORT;

// Connect to the database and start the server
connectToDatabase()
  .then(() => {
    console.log("Connected to MongoDB Atlas");

    // Use the comments routes
    app.use('/comments', commentsRoutes);

    // Start the server
    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Error connecting to MongoDB Atlas:", error);
    process.exit(1); // Exit the application if the connection fails
  });