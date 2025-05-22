const express = require('express');
const admin = require('firebase-admin');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json());

admin.initializeApp({
    credential: admin.credential.cert(require('./firebase-service-account.json')),
    databaseURL: process.env.FIREBASE_URL
});

const db = admin.database();

// Middleware d'authentification admin
const isAdmin = async (req, res, next) => {
    try {
        const userUid = req.headers['x-uid'];
        if (!userUid) return res.status(401).json({ error: "UID manquant" });
        
        const user = await admin.auth().getUser(userUid);
        if (!user.customClaims?.admin) {
            return res.status(403).json({ error: "Accès refusé" });
        }
        next();
    } catch (error) {
        res.status(500).json({ error: "Erreur d'authentification" });
    }
};

// Récupération du profil utilisateur
const getUserProfile = async (userUid) => {
    try {
        const url = process.env.PROFILE_SERVICE_URL || 'http://localhost:8081';
        const response = await axios.get(url, { headers: { 'x-uid': userUid } });
        return response.data;
    } catch (error) {
        console.error("Erreur profil:", error.message);
        return null;
    }
};

// Mise à jour des statistiques
const updateStats = async (slopeId, rating, userProfile, isDelete = false) => {
    const statsRef = db.ref(`reviews/${slopeId}/stats`);
    const snapshot = await statsRef.once('value');
    const stats = snapshot.val() || {};
    
    const multiplier = isDelete ? -1 : 1;
    const totalNumber = (stats.totalNumber || 0) + multiplier;
    
    let updates = { totalNumber };
    
    if (totalNumber > 0) {
        const currentAvg = stats.ratingAvg || 0;
        updates.ratingAvg = isDelete 
            ? ((currentAvg * (totalNumber + 1)) - rating) / totalNumber
            : ((currentAvg * (totalNumber - 1)) + rating) / totalNumber;
    } else {
        updates.ratingAvg = 0;
    }
    
    // Gestion des préférences utilisateur
    if (userProfile) {
        const deletions = [];
        
        Object.entries(userProfile).forEach(([key, value]) => {
            if (typeof value !== 'string' && typeof value !== 'number') return;
            
            const prefStats = stats[key] || {};
            const currentPref = prefStats[value] || { avg: 0, count: 0 };
            const newCount = currentPref.count + multiplier;
            
            if (newCount <= 0) {
                if (isDelete) deletions.push(`${key}/${value}`);
            } else {
                // Préserver les statistiques existantes pour cette préférence
                if (!updates[key]) updates[key] = { ...prefStats };
                updates[key][value] = {
                    avg: isDelete 
                        ? ((currentPref.avg * currentPref.count) - rating) / newCount
                        : ((currentPref.avg * currentPref.count) + rating) / newCount,
                    count: newCount
                };
            }
        });
        
        if (totalNumber > 0) {
            await statsRef.update(updates);
            for (const path of deletions) {
                await statsRef.child(path).remove();
            }
        } else {
            await statsRef.remove();
        }
    } else {
        if (totalNumber > 0) {
            await statsRef.update(updates);
        } else {
            await statsRef.remove();
        }
    }
    
    return updates;
};

// Routes
app.get('/:slopeId', async (req, res) => {
    const uid = req.headers['x-uid'];
    const { slopeId } = req.params;
    
    if (!uid) return res.status(401).json({ error: "UID manquant" });
    if (!slopeId) return res.status(400).json({ error: "ID manquant" });
    
    try {
        const snapshot = await db.ref(`reviews/${slopeId}/${uid}`).once('value');
        
        if (snapshot.exists()) {
            res.json({ message: "Avis trouvé", review: snapshot.val() });
        } else {
            res.status(404).json({ error: "Aucun avis trouvé" });
        }
    } catch (error) {
        res.status(500).json({ error: "Erreur de récupération" });
    }
});

app.post('/', async (req, res) => {
    try {
        const userUid = req.headers['x-uid'];
        const { slopeId, rating } = req.body;
        
        if (!userUid) return res.status(401).json({ error: "UID manquant" });
        if (!slopeId || !rating) return res.status(400).json({ error: "Champs manquants" });
        
        // Vérifier si l'avis existe déjà
        const existingReview = await db.ref(`reviews/${slopeId}/${userUid}`).once('value');
        if (existingReview.exists()) {
            return res.status(400).json({ error: "Avis déjà existant" });
        }
        
        const userProfile = await getUserProfile(userUid);
        if (!userProfile) {
            return res.status(404).json({ error: "Profil non trouvé" });
        }
        
        // Créer l'avis
        await db.ref(`reviews/${slopeId}/${userUid}`).set({
            userUid,
            rating,
            createdAt: admin.database.ServerValue.TIMESTAMP,
            userProfile
        });
        
        // Mettre à jour les statistiques
        const stats = await updateStats(slopeId, rating, userProfile);
        
        res.status(201).json({ 
            message: "Avis créé",
            stats: { ratingAvg: stats.ratingAvg, totalNumber: stats.totalNumber }
        });
    } catch (error) {
        res.status(500).json({ error: "Erreur de création" });
    }
});

app.delete('/:slopeId', async (req, res) => {
    try {
        const userUid = req.headers['x-uid'];
        const { slopeId } = req.params;
        
        if (!userUid) return res.status(401).json({ error: "UID manquant" });
        if (!slopeId) return res.status(400).json({ error: "ID manquant" });
        
        const reviewRef = db.ref(`reviews/${slopeId}/${userUid}`);
        const snapshot = await reviewRef.once('value');
        
        if (!snapshot.exists()) {
            return res.status(404).json({ error: "Avis non trouvé" });
        }
        
        const { rating, userProfile } = snapshot.val();
        
        // Mettre à jour les statistiques
        await updateStats(slopeId, rating, userProfile, true);
        
        // Supprimer l'avis
        await reviewRef.remove();
        
        res.json({ message: "Avis supprimé", statsUpdated: true });
    } catch (error) {
        res.status(500).json({ error: "Erreur de suppression" });
    }
});

app.listen(8083, '127.0.0.1', () => {
    console.log('Service démarré sur http://127.0.0.1:8083');
});