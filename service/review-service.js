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

// Fonction utilitaire pour récupérer les préférences utilisateur
async function getUserProfile(userUid) {
  try {
    // URL du service de profil (en local)
    const profileServiceUrl = process.env.PROFILE_SERVICE_URL || 'http://localhost:8081';
    
    // Faire la requête avec l'en-tête UID
    const response = await axios.get(profileServiceUrl, {
      headers: {
        'x-uid': userUid
      }
    });
    
    return response.data;
  } catch (error) {
    console.error("Erreur lors de la récupération du profil utilisateur:", error.message);
    // Retourner null ou un objet vide en cas d'erreur
    return null;
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
// Modifiez votre route POST pour inclure les préférences utilisateur et calculer les moyennes
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

        // Vérifier si l'utilisateur a déjà laissé un avis
        const existingReviewRef = db.ref(`reviews/${slopeId}/${userUid}`);
        const existingReviewSnapshot = await existingReviewRef.once('value');
        if (existingReviewSnapshot.exists()) {
            return res.status(400).json({ error: "Vous avez déjà laissé un avis pour cette pente" });
        }
        
        // Récupérer les préférences utilisateur
        const userProfile = await getUserProfile(userUid);
        if (!userProfile) {
            return res.status(404).json({ error: "Profil utilisateur non trouvé" });
        }
        console.log("Profil utilisateur récupéré:", userProfile);
        
        // Créer la review avec les préférences utilisateur
        const reviewRef = db.ref(`reviews/${slopeId}/${userUid}`);
        await reviewRef.set({
            userUid,
            rating,
            createdAt: admin.database.ServerValue.TIMESTAMP,
            userProfile: userProfile // Stocker les préférences avec l'avis
        });
        
        // Référence pour les statistiques de la pente
        // Nous utilisons reviews/{slopeId}/stats pour stocker toutes les statistiques
        const statsRef = db.ref(`reviews/${slopeId}/stats`);
        
        // Obtenir les statistiques actuelles
        const statsSnapshot = await statsRef.once('value');
        const currentStats = statsSnapshot.val() || {};
        
        // Mettre à jour le nombre total d'évaluations et la note moyenne globale
        const totalNumber = (currentStats.totalNumber || 0) + 1;
        const currentAvg = currentStats.ratingAvg || 0;
        const newRatingAvg = ((currentAvg * (totalNumber - 1)) + rating) / totalNumber;
        
        // Préparer les mises à jour pour les statistiques
        const updates = {
            ratingAvg: newRatingAvg,
            totalNumber: totalNumber
        };
        
        // Pour chaque préférence utilisateur, calculer la moyenne et incrémenter le compteur
        Object.keys(userProfile).forEach(prefKey => {
            // Ignorer les valeurs qui ne sont pas des nombres ou des chaînes
            const prefValue = userProfile[prefKey];
            if (typeof prefValue !== 'string' && typeof prefValue !== 'number') return;
            
            // Créer ou mettre à jour les statistiques pour cette préférence
            const prefStats = currentStats[prefKey] || {};
            
            if (!prefStats[prefValue]) {
                prefStats[prefValue] = {
                    avg: rating,
                    count: 1
                };
            } else {
                const currentCount = prefStats[prefValue].count;
                const currentAvg = prefStats[prefValue].avg;
                prefStats[prefValue] = {
                    avg: ((currentAvg * currentCount) + rating) / (currentCount + 1),
                    count: currentCount + 1
                };
            }
            
            // Stocker directement dans l'objet stats sans ajouter "Stats" au nom de la clé
            updates[prefKey] = prefStats;
        });
        
        // Appliquer toutes les mises à jour en une seule opération
        await statsRef.update(updates);
        
        res.status(201).json({ 
            message: "Review créée avec succès",
            stats: { ratingAvg: newRatingAvg, totalNumber: totalNumber }
        });
    } catch (error) {
        handleError(res, "Erreur lors de la création de la review", error);
    }
});

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

        // 1. Récupérer la review à supprimer et ses données
        const reviewRef = db.ref(`reviews/${slopeId}/${userUid}`);
        const reviewSnapshot = await reviewRef.once('value');
        if (!reviewSnapshot.exists()) {
            return res.status(404).json({ error: "Aucun avis trouvé pour cet utilisateur sur cette pente" });
        }
        
        // Extraire les données nécessaires de la review
        const reviewData = reviewSnapshot.val();
        const { rating, userProfile } = reviewData;
        
        // 2. Récupérer les statistiques actuelles de la pente
        const statsRef = db.ref(`reviews/${slopeId}/stats`);
        const statsSnapshot = await statsRef.once('value');
        
        if (statsSnapshot.exists()) {
            const currentStats = statsSnapshot.val();
            
            // 3. Mettre à jour le nombre total d'avis et la moyenne globale
            const totalNumber = currentStats.totalNumber - 1;
            let newRatingAvg = 0;
            
            if (totalNumber > 0) {
                newRatingAvg = ((currentStats.ratingAvg * currentStats.totalNumber) - rating) / totalNumber;
            }
            
            // 4. Préparer les mises à jour pour les statistiques
            const updates = {
                ratingAvg: totalNumber > 0 ? newRatingAvg : 0,
                totalNumber: totalNumber
            };
            
            // 5. Créer deux listes: un pour les mises à jour et un pour les suppressions individuelles
            const specificDeletions = [];
            
            // Mettre à jour les statistiques pour chaque préférence utilisateur
            if (userProfile) {
                Object.keys(userProfile).forEach(prefKey => {
                    const prefValue = userProfile[prefKey];
                    
                    // Ignorer les valeurs qui ne sont pas des chaînes ou des nombres
                    if (typeof prefValue !== 'string' && typeof prefValue !== 'number') return;
                    
                    // Vérifier si cette préférence existe dans les stats
                    if (currentStats[prefKey] && currentStats[prefKey][prefValue]) {
                        const prefStats = currentStats[prefKey][prefValue];
                        const prefCount = prefStats.count - 1;
                        
                        if (prefCount <= 0) {
                            // Au lieu de définir à null, ajouter à la liste des suppressions spécifiques
                            specificDeletions.push(`${prefKey}/${prefValue}`);
                        } else {
                            // Recalculer la moyenne pour cette préférence
                            const newPrefAvg = ((prefStats.avg * prefStats.count) - rating) / prefCount;
                            if (!updates[prefKey]) updates[prefKey] = {};
                            updates[prefKey][prefValue] = {
                                avg: newPrefAvg,
                                count: prefCount
                            };
                        }
                    }
                });
            }
            
            // 6. D'abord appliquer les mises à jour
            if (totalNumber > 0) {
                await statsRef.update(updates);
                
                // Puis effectuer les suppressions individuelles une par une
                for (const path of specificDeletions) {
                    await statsRef.child(path).remove();
                }
            } else {
                // Si c'était le dernier avis, supprimer les statistiques complètes
                await statsRef.remove();
            }
        }
        
        // 7. Supprimer l'avis
        await reviewRef.remove();
        
        res.status(200).json({ 
            message: "Review supprimée avec succès",
            statsUpdated: true
        });
    } catch (error) {
        handleError(res, "Erreur lors de la suppression de la review", error);
    }
});

app.listen(PORT, '127.0.0.1', () => {
    console.log(`User service démarré sur http://127.0.0.1:${PORT}`);
});