const { MongoClient, ServerApiVersion } = require('mongodb');
const dotenv = require('dotenv');

//Use the uri from .env file
dotenv.config({ path: './.env' }); // Assurez-vous que le chemin est correct par rapport à votre structure de projet
const uri = process.env.MONGODB_URI; // Assurez-vous que cette variable d'environnement est définie dans votre fichier .env

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function connectToDatabase() {
  await client.connect();
}

function getDatabase(dbName) {
  return client.db(dbName);
}

module.exports = { connectToDatabase, getDatabase };