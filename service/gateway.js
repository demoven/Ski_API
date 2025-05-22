const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const admin = require('firebase-admin');
const serviceAccount = require('./firebase-service-account.json');
const dotenv = require('dotenv');
dotenv.config();

const app = express();
const PORT = 8080;

// Initialisation Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_URL
});

// Middleware de vérification du token Firebase et récupération de l'UID
async function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token manquant' });
  }

  const idToken = authHeader.split(' ')[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.userUid = decodedToken.uid;  // Récupération de l'UID
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Token invalide' });
  }
}

// Appliquer le middleware de vérification à toutes les routes commençant par /users ou /products
app.use(['/profile', '/resorts', '/reviews'], verifyToken);

// Proxy vers user-service
app.use('/profile', createProxyMiddleware({
  target: process.env.PROFILE_SERVICE || 'http://localhost:8081',
  changeOrigin: true,
  pathRewrite: { '^/profile': '' },
  onProxyReq: (proxyReq, req, res) => {
    // Ajouter l'UID à l'en-tête de la requête proxy
    if (req.userUid) {
      proxyReq.setHeader('x-uid', req.userUid);
    }
  }
}));

// Proxy vers user-service
app.use('/resorts', createProxyMiddleware({
  target: process.env.RESORT_SERVICE || 'http://localhost:8082',
  changeOrigin: true,
  pathRewrite: { '^/resorts': '' },
  onProxyReq: (proxyReq, req, res) => {
    // Ajouter l'UID à l'en-tête de la requête proxy
    if (req.userUid) {
      proxyReq.setHeader('x-uid', req.userUid);
    }
  }
}));

// Proxy vers user-service
app.use('/reviews', createProxyMiddleware({
  target: process.env.REVIEWS_SERVICE || 'http://localhost:8083',
  changeOrigin: true,
  pathRewrite: { '^/reviews': '' },
  onProxyReq: (proxyReq, req, res) => {
    // Ajouter l'UID à l'en-tête de la requête proxy
    if (req.userUid) {
      proxyReq.setHeader('x-uid', req.userUid);
    }
  }
}));

// Catch-all pour les routes non définies
app.use('*', (req, res) => {
  res.status(404).json({ message: 'Route non trouvée sur la gateway' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`API Gateway démarrée sur http://127.0.0.1:${PORT}`);
});
