const express = require('express');
const admin = require('firebase-admin');
const serviceAccount = require('./firebase-service-account.json');
const dotenv = require('dotenv');
dotenv.config();

const app = express();
app.use(express.json());
const PORT = 8083;
const axios = require('axios');

console.log(process.env.FIREBASE_URL);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_URL
});

const db = admin.database();

// Helper functions
const handleError = (res, message, error) => {
    console.error(`${message}:`, error);
    res.status(500).json({ error: message, details: error.message });
};

const getDbData = (path) => {
    return new Promise((resolve, reject) => {
        db.ref(path).once('value',
            snapshot => resolve(snapshot.val() || null),
            error => reject(error)
        );
    });
};

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

async function getUserPreferences(userUid) {
  try {
    // Utilisez l'URL de la gateway pour accéder au profile-service
    const gatewayUrl = process.env.GATEWAY_URL || 'http://localhost:8080';
    const response = await axios.get(`${gatewayUrl}/profile`, {
      headers: {
        'Authorization': `Bearer ${await getServiceToken()}`,
        'x-uid': userUid
      }
    });
    return response.data;
  } catch (error) {
    console.error('Erreur lors de la récupération des préférences utilisateur:', error.message);
    return null;
  }
}

// Fonction pour obtenir un token de service pour l'authentification entre services
async function getServiceToken() {
  // Implémenter la logique pour obtenir un token de service
  // Cette fonction dépendra de votre implémentation de sécurité
  // Par exemple, vous pourriez utiliser Firebase Admin SDK pour créer un token personnalisé
  try {
    const token = await admin.auth().createCustomToken('service-account');
    return token;
  } catch (error) {
    console.error('Erreur lors de la création du token de service:', error);
    throw error;
  }
}

app.get('/:slopeId', async (req, res) => {
    // Récupérer l'avis de l'utilisateur sur la slope
    const uid = req.headers['x-uid'];
    if (!uid) return res.status(401).json({ error: "Authentification requise. UID manquant dans l'en-tête" });
    console.log("UID de l'utilisateur:", uid);

    const slopeId = req.params.slopeId;
    if (!slopeId) return res.status(400).json({ error: "ID de la pente manquant" });
    try {
        const reviewRef = db.ref(`reviews/${slopeId}/${uid}`);
        reviewRef.once('value', (snapshot) => {
            if (snapshot.exists()) {
                const review = snapshot.val();
                res.status(200).json({ message: "Avis récupéré avec succès", review });
            } else {
                res.status(404).json({ error: "Aucun avis trouvé pour cet utilisateur sur cette pente" });
            }
        }, (error) => {
            handleError(res, "Erreur lors de la récupération de l'avis", error);
        });

    } catch (error) {
        handleError(res, "Erreur lors de la récupération de l'avis", error);
    }
});
// Modifiez votre route POST pour inclure les préférences utilisateur
app.post('/', async (req, res) => {
    try {
        const userUid = req.headers['x-uid'];
        if (!userUid) {
            return res.status(401).json({ error: "Authentification requise. UID manquant dans l'en-tête" });
        }

        const { slopeId, rating } = req.body;
        if (!slopeId || !rating) {
            return res.status(400).json({ error: "Champs manquants" });
        }
        
        // Récupérer les préférences utilisateur
        const userPreferences = await getUserPreferences(userUid);
        
        // Créer la review avec les préférences utilisateur
        const reviewRef = db.ref(`reviews/${slopeId}/${userUid}`);
        await reviewRef.set({
            userUid,
            rating,
            preferences: userPreferences || {},
            createdAt: admin.database.ServerValue.TIMESTAMP
        });
         // Le reste de votre code pour calculer et mettre à jour la moyenne des notes
        const avgRatingRef = db.ref(`reviews/${slopeId}/averageRating`);
        const avgRatingSnapshot = await avgRatingRef.once('value');
        const avgRating = avgRatingSnapshot.val() || 0;
        const numberOfReviewsRef = db.ref(`reviews/${slopeId}/numberOfReviews`);
        const numberOfReviewsSnapshot = await numberOfReviewsRef.once('value');
        const numberOfReviews = (numberOfReviewsSnapshot.val() || 0) + 1;
        await numberOfReviewsRef.set(numberOfReviews);
        const newAvgRating = ((avgRating * (numberOfReviews - 1)) + rating) / numberOfReviews;
        await avgRatingRef.set(newAvgRating); 
        res.status(201).json({ message: "Review créée avec succès" });
    } catch (error) {
        handleError(res, "Erreur lors de la création de la review", error);
    }
});


// app.post('/', async (req, res) => {
//     try {
//         const userUid = req.headers['x-uid'];
//         if (!userUid) {
//             return res.status(401).json({ error: "Authentification requise. UID manquant dans l'en-tête" });
//         }

//         const { slopeId, rating } = req.body;
//         if (!slopeId || !rating) {
//             return res.status(400).json({ error: "Champs manquants" });
//         }

//         const reviewRef = db.ref(`reviews/${slopeId}/${userUid}`);
//         await reviewRef.set({
//             userUid,
//             rating,
//             createdAt: admin.database.ServerValue.TIMESTAMP
//         });
//         const avgRatingRef = db.ref(`reviews/${slopeId}/averageRating`);
//         const avgRatingSnapshot = await avgRatingRef.once('value');
//         const avgRating = avgRatingSnapshot.val() || 0;
//         const numberOfReviewsRef = db.ref(`reviews/${slopeId}/numberOfReviews`);
//         const numberOfReviewsSnapshot = await numberOfReviewsRef.once('value');
//         const numberOfReviews = (numberOfReviewsSnapshot.val() || 0) + 1;
//         await numberOfReviewsRef.set(numberOfReviews);
//         const newAvgRating = ((avgRating * (numberOfReviews - 1)) + rating) / numberOfReviews;
//         await avgRatingRef.set(newAvgRating); 
//         res.status(201).json({ message: "Review créée avec succès" });
//     } catch (error) {
//         handleError(res, "Erreur lors de la création de la review", error);
//     }
// });

app.delete('/:slopeId', async (req, res) => {
    try {
        const userUid = req.headers['x-uid'];
        if (!userUid) {
            return res.status(401).json({ error: "Authentification requise. UID manquant dans l'en-tête" });
        }
        const slopeId = req.params.slopeId;
        if (!slopeId) {
            return res.status(400).json({ error: "ID de la pente manquant" });
        }

        const reviewRef = db.ref(`reviews/${slopeId}/${userUid}`);
        const reviewSnapshot = await reviewRef.once('value');
        if (!reviewSnapshot.exists()) {
            return res.status(404).json({ error: "Aucun avis trouvé pour cet utilisateur sur cette pente" });
        }
        await reviewRef.remove();
        const avgRatingRef = db.ref(`reviews/${slopeId}/averageRating`);
        const avgRatingSnapshot = await avgRatingRef.once('value');
        const avgRating = avgRatingSnapshot.val() || 0;
        const numberOfReviewsRef = db.ref(`reviews/${slopeId}/numberOfReviews`);
        const numberOfReviewsSnapshot = await numberOfReviewsRef.once('value');
        const numberOfReviews = (numberOfReviewsSnapshot.val() || 0) - 1;
        await numberOfReviewsRef.set(numberOfReviews);
        if (numberOfReviews > 0) {
            const newAvgRating = ((avgRating * (numberOfReviews + 1)) - rating) / numberOfReviews;
            await avgRatingRef.set(newAvgRating);
        } else {
            await avgRatingRef.set(0);
        }
        res.status(200).json({ message: "Review supprimée avec succès" });
    } catch (error) {
        handleError(res, "Erreur lors de la suppression de la review", error);
    }
});

app.listen(PORT, '127.0.0.1', () => {
    console.log(`User service démarré sur http://127.0.0.1:${PORT}`);
});