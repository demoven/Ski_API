const express = require('express');
const { connectToDatabase } = require('./services/database');
const resortsRoutes = require('./routes/resorts');

const app = express();
app.use(express.json());

const PORT = process.env.PORT;

const startServer = async () => {
  try {
    await connectToDatabase();
    console.log("Connected to MongoDB Atlas");

    // Use the comments routes
    app.use('/resorts', resortsRoutes);

    // Start the server
    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Error connecting to MongoDB Atlas:", error);
    process.exit(1); // Exit the application if the connection fails
  }
};

startServer();