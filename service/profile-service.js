const express = require('express');
const admin = require('firebase-admin');
const serviceAccount = require('./firebase-service-account.json');
const dotenv = require('dotenv');
dotenv.config();

const app = express();
app.use(express.json()); // Middleware pour parser le JSON dans les requêtes
const PORT = 8081;

console.log(process.env.FIREBASE_URL);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_URL
});

const db = admin.database();

app.get('/', async (req, res) => {
  const userUid = req.headers['x-uid']; // Récupération de l'UID envoyé par la gateway
  if (!userUid) {
    return res.status(400).json({ error: "UID manquant dans l'en-tête" });
  }
  
  try {
    // Créer des promesses pour les deux appels Firebase
    const getUserData = new Promise((resolve, reject) => {
      const refUser = db.ref('users').child(userUid);
      refUser.once('value', (snapshot) => {
        const userData = snapshot.val();
        if (userData) {
          console.log('Utilisateur trouvé:', userData);
          resolve(userData);
        } else {
          console.log('Utilisateur non trouvé');
          resolve(null);
        }
      }, (error) => {
        console.error('Erreur Realtime DB:', error);
        reject(error);
      });
    });
    
    const getQuestions = new Promise((resolve, reject) => {
      const ref = db.ref('questions');
      ref.once('value', (snapshot) => {
        const questions = snapshot.val();
        if (questions) {
          // Convertir l'objet en tableau
          const questionList = Object.keys(questions).map((key) => ({
            element: key,
            ...questions[key]
          }));
          console.log('Liste des questions:', questionList);
          resolve(questionList);
        } else {
          resolve([]);
        }
      }, (error) => {
        console.error('Erreur Realtime DB:', error);
        reject(error);
      });
    });
    
    // Attendre que les deux promesses soient résolues
    const [userData, questionList] = await Promise.all([getUserData, getQuestions]);

    let response = compare(userData, questionList, userUid);
    if (response.length > 0) {
      console.log('Questions manquantes ou incorrectes:', response);
      return res.status(400).json({ error: 'Questions manquantes ou incorrectes', questions: response });
    }
    
    // Maintenant que tu as les deux données, tu peux faire ton traitement
    // et renvoyer une réponse complète
    res.json({
      user: userData
      // Ajoute ici d'autres traitements si nécessaire
    });
    
  } catch (error) {
    console.error('Erreur serveur:', error);
    res.status(500).json({ error: 'Erreur serveur', details: error.message });
  }
});

// Add a new question
app.post('questions/create', async (req, res) => {
  try {
    const keyElement = req.body.element;
    const question = {
      question: req.body.question,
      reponses: req.body.reponses,
      type: req.body.type
    }
    if (!keyElement || !question.question || !question.reponses || !question.type) {
      return res.status(400).json({ error: 'Données manquantes' });
    }

    // Vérifier si la question existe déjà
    const ref = db.ref('questions').child(keyElement);
    ref.once('value', (snapshot) => {
      if (snapshot.exists()) {
        return res.status(400).json({ error: 'La question existe déjà' });
      }
      
      // Ajouter la question
      ref.set(question, (error) => {
        if (error) {
          console.error('Erreur Realtime DB:', error);
          res.status(500).json({ error: 'Erreur lors de l\'ajout de la question', details: error.message });
        } else {
          res.json({ message: 'Question ajoutée avec succès' });
        }
      });
    }, (error) => {
      console.error('Erreur Realtime DB:', error);
      res.status(500).json({ error: 'Erreur lors de la vérification de la question', details: error.message });
    });
  }
  catch (error) {
    console.error('Erreur serveur:', error);
    res.status(500).json({ error: 'Erreur serveur', details: error.message });
  }
});
app.post('/preferences', async (req, res) => {
  //Add a preference answer
  try {
    const userUid = req.headers['x-uid']; // Récupération de l'UID envoyé par la gateway
    if (!userUid) {
      return res.status(400).json({ error: "UID manquant dans l'en-tête" });
    }
    const elements = req.body;
    
    // Tableau pour suivre les opérations asynchrones
    const updatePromises = [];
    
    elements.forEach((element) => {
      // Pour chaque objet, traiter chaque clé comme un élément à enregistrer
      // avec sa valeur correspondante
      Object.entries(element).forEach(([key, value]) => {
        // Vérification que la clé n'est pas undefined ou vide
        if (key && key !== 'undefined') {
          const promise = new Promise((resolve, reject) => {
            const ref = db.ref('users').child(userUid).child(key);
            ref.set(value, (error) => {
              if (error) {
                console.error('Erreur Realtime DB:', error);
                reject(error);
              } else {
                resolve();
              }
            });
          });
          updatePromises.push(promise);
        }
      });
    });
    
    // Attendre que toutes les opérations soient terminées
    Promise.all(updatePromises)
      .then(() => {
        res.json({ message: 'Préférences ajoutées avec succès' });
      })
      .catch((error) => {
        res.status(500).json({ error: 'Erreur lors de l\'ajout des préférences', details: error.message });
      });

  } catch (error) {
    console.error('Erreur serveur:', error);
    res.status(500).json({ error: 'Erreur serveur', details: error.message });
  }
});
// Supprimer une question par element
app.delete('questions/delete/:element', async (req, res) => {
  try {
    const element = req.params.element;
    if (!element) {
      return res.status(400).json({ error: 'Element non spécifié' });
    }

    const ref = db.ref('questions').child(element);
    
    // Vérifier si la question existe
    ref.once('value', (snapshot) => {
      if (!snapshot.exists()) {
        return res.status(404).json({ error: 'Question non trouvée' });
      }
      
      // Supprimer la question
      ref.remove((error) => {
        if (error) {
          console.error('Erreur Realtime DB:', error);
          res.status(500).json({ error: 'Erreur lors de la suppression de la question', details: error.message });
        } else {
          res.json({ message: 'Question supprimée avec succès' });
        }
      });
    }, (error) => {
      console.error('Erreur Realtime DB:', error);
      res.status(500).json({ error: 'Erreur lors de la vérification de la question', details: error.message });
    });
  } catch (error) {
    console.error('Erreur serveur:', error);
    res.status(500).json({ error: 'Erreur serveur', details: error.message });
  }
});

// Modifier une question par element
app.put('questions/update/:element', async (req, res) => {
  try {
    const element = req.params.element;
    if (!element) {
      return res.status(400).json({ error: 'Element non spécifié' });
    }
    
    // Vérifier que le corps de la requête contient des données
    if (!req.body) {
      return res.status(400).json({ error: 'Aucune donnée fournie pour la mise à jour' });
    }
    
    const ref = db.ref('questions').child(element);
    
    // Vérifier si la question existe
    ref.once('value', (snapshot) => {
      if (!snapshot.exists()) {
        return res.status(404).json({ error: 'Question non trouvée' });
      }
      
      // Construire l'objet de mise à jour avec uniquement les champs fournis
      const updateData = {};
      if (req.body.question) updateData.question = req.body.question;
      if (req.body.reponses) updateData.reponses = req.body.reponses;
      if (req.body.type) updateData.type = req.body.type;
      
      // Mettre à jour la question
      ref.update(updateData, (error) => {
        if (error) {
          console.error('Erreur Realtime DB:', error);
          res.status(500).json({ error: 'Erreur lors de la mise à jour de la question', details: error.message });
        } else {
          res.json({ message: 'Question mise à jour avec succès' });
        }
      });
    }, (error) => {
      console.error('Erreur Realtime DB:', error);
      res.status(500).json({ error: 'Erreur lors de la vérification de la question', details: error.message });
    });
  } catch (error) {
    console.error('Erreur serveur:', error);
    res.status(500).json({ error: 'Erreur serveur', details: error.message });
  }
});

function compare(user, questionList, userUid) {
  // Liste des questions manquantes ou avec réponses incorrectes
  const missingOrIncorrectQuestions = [];
  const ref = db.ref('users').child(userUid);
  // Parcourir toutes les questions
  questionList.forEach(question => {
    const questionKey = question.element;
    const questionType = question.type;
    
    // Vérifier si la question existe dans le profil utilisateur
    if (!user || !(questionKey in user)) {
      // Question manquante dans le profil utilisateur
      missingOrIncorrectQuestions.push(question);
      return; // Passer à la question suivante
    }
    
    // La question existe, vérifier le type de la réponse
    const userResponse = user[questionKey];
    
    // Vérifier que la réponse correspond au type attendu
    let isValid = true;
    
    switch (questionType) {
      case 'text':
        isValid = typeof userResponse === 'string';
        break;
        
      case 'number':
        isValid = !isNaN(Number(userResponse));
        break;
        
      case 'date':
        isValid = !isNaN(Date.parse(userResponse));
        break;

      case 'bool':
        isValid = typeof userResponse === 'boolean';
        break;
        
      case 'radio':
      case 'checkbox':
        // Vérifier que la réponse est dans la liste des réponses possibles
        if (!Array.isArray(question.reponses)) {
          isValid = false;
        } else if (questionType === 'radio') {
          // Pour un bouton radio, la réponse doit être unique et dans la liste
          isValid = question.reponses.includes(userResponse);
        } else {
          // Pour une checkbox, la réponse peut être multiple mais toutes doivent être dans la liste
          if (!Array.isArray(userResponse)) {
            isValid = false;
          } else {
            isValid = userResponse.every(item => question.reponses.includes(item));
          }
        }
        break;
        
      default:
        isValid = true; // Type inconnu, on considère que c'est valide
    }
    
    // Si la réponse n'est pas valide, ajouter à la liste des questions à résoudre
    if (!isValid) {
      missingOrIncorrectQuestions.push(question);

      // Optionnel : supprimer la réponse incorrecte du profil utilisateur
      ref.child(questionKey).remove((error) => {
        if (error) {
          console.error('Erreur lors de la suppression de la réponse incorrecte:', error);
        } else {
          console.log(`Réponse incorrecte supprimée pour la question ${questionKey}`);
        }
      });
    }
  });
  
  return missingOrIncorrectQuestions;
}

// ...existing code...

app.listen(PORT, '127.0.0.1', () => {
  console.log(`User service démarré sur http://127.0.0.1:${PORT}`);
});
