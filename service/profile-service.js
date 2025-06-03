const express = require('express');
const admin = require('firebase-admin');
const serviceAccount = require('./firebase-service-account.json');
const dotenv = require('dotenv');
dotenv.config();

const app = express();
app.use(express.json());
const PORT = 8081;

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

// Routes
app.get('/', async (req, res) => {
  const userUid = req.headers['x-uid'];
  if (!userUid) return res.status(400).json({ error: "UID manquant dans l'en-tête" });

  try {
    const [userData, questions] = await Promise.all([
      getDbData(`users/${userUid}`),
      getDbData('questions')
    ]);

    // Convert questions object to array
    const questionList = questions ? Object.keys(questions).map(key => ({
      element: key,
      ...questions[key]
    })) : [];

    const missingQuestions = compare(userData, questionList, userUid);
    if (missingQuestions.length > 0) {
      console.log('Questions manquantes ou incorrectes:', missingQuestions);
      return res.status(400).json({
        error: 'Questions manquantes ou incorrectes',
        questions: missingQuestions
      });
    }

    // Filter user data to include only fields that match question keys
    const relevantUserData = {};
    if (userData && questions) {
      Object.keys(questions).forEach(questionKey => {
        if (questionKey in userData) {
          relevantUserData[questionKey] = userData[questionKey];
        }
      });
    }

    res.json(relevantUserData);
  } catch (error) {
    handleError(res, 'Erreur serveur', error);
  }
});

app.delete('/', async (req, res) => {
  const userUid = req.headers['x-uid'];
  if (!userUid) return res.status(400).json({ error: "UID manquant dans l'en-tête" });
  try {
    const userData = await getDbData(`users/${userUid}`);
    if (!userData) return res.status(404).json({ error: 'Utilisateur non trouvé' });
    await db.ref(`users/${userUid}`).remove();
    res.json({ message: 'Utilisateur supprimé avec succès' });
  } catch (error) {
    handleError(res, 'Erreur lors de la suppression de l’utilisateur', error);
  }
});

// Add a new question
app.post('/questions/create', isAdmin, async (req, res) => {
  try {
    const { element: keyElement, question, answers, type } = req.body;

    if (!keyElement || !question || !answers || !type) {
      return res.status(400).json({ error: 'Données manquantes' });
    }

    const exists = await getDbData(`questions/${keyElement}`);
    if (exists) return res.status(400).json({ error: 'La question existe déjà' });

    await db.ref(`questions/${keyElement}`).set({ question, answers, type });
    res.json({ message: 'Question ajoutée avec succès' });
  } catch (error) {
    handleError(res, "Erreur lors de l'ajout de la question", error);
  }
});

// Add user preferences
app.post('/preferences', async (req, res) => {
  try {
    const userUid = req.headers['x-uid'];
    if (!userUid) return res.status(400).json({ error: "UID manquant dans l'en-tête" });

    // Get all questions to validate against
    const questions = await getDbData('questions');
    if (!questions) {
      return res.status(404).json({ error: "Aucune question trouvée pour validation" });
    }

    // Directly use request body as a JSON object
    const preferencesData = req.body;
    const updatePromises = [];
    const invalidKeys = [];

    // Process each property in the JSON object
    Object.entries(preferencesData).forEach(([key, value]) => {
      if (key && key !== 'undefined') {
        // Validate the key exists in questions
        if (key in questions) {
          // Validate value based on question type
          const questionType = questions[key].type;
          const questionResponses = questions[key].answers;
          let isValid = true;

          switch (questionType) {
            case 'text': isValid = typeof value === 'string'; break;
            case 'number': isValid = !isNaN(Number(value)); break;
            case 'date': isValid = !isNaN(Date.parse(value)); break;
            case 'bool': isValid = typeof value === 'boolean'; break;
            case 'radio': isValid = questionResponses.includes(value); break;
            case 'checkbox':
              isValid = Array.isArray(value) &&
                value.every(item => questionResponses.includes(item));
              break;
          }

          if (isValid) {
            updatePromises.push(db.ref(`users/${userUid}/${key}`).set(value));
          } else {
            invalidKeys.push({ key, reason: "Format de réponse invalide" });
          }
        } else {
          invalidKeys.push({ key, reason: "Question non définie" });
        }
      }
    });

    if (invalidKeys.length > 0) {
      return res.status(400).json({
        error: 'Certaines préférences ne sont pas valides',
        invalidElements: invalidKeys
      });
    }

    await Promise.all(updatePromises);
    res.json({ message: 'Préférences ajoutées avec succès' });
  } catch (error) {
    handleError(res, "Erreur lors de l'ajout des préférences", error);
  }
});

// Delete a question
app.delete('/questions/delete/:element', isAdmin, async (req, res) => {
  try {
    const { element } = req.params;
    if (!element) return res.status(400).json({ error: 'Element non spécifié' });

    const question = await getDbData(`questions/${element}`);
    if (!question) return res.status(404).json({ error: 'Question non trouvée' });

    await db.ref(`questions/${element}`).remove();
    res.json({ message: 'Question supprimée avec succès' });
  } catch (error) {
    handleError(res, 'Erreur lors de la suppression de la question', error);
  }
});

app.get('/questions', async (req, res) => {
  try {
    const questions = await getDbData('questions');
    if (!questions) return res.status(404).json({ error: 'Aucune question trouvée' });

    // Convert questions object to array
    const questionList = Object.keys(questions).map(key => ({
      element: key,
      ...questions[key]
    }));

    res.json(questionList);
  } catch (error) {
    handleError(res, 'Erreur lors de la récupération des questions', error);
  }
}
);

// Update a question
app.put('/questions/update/:element', isAdmin, async (req, res) => {
  try {
    const { element } = req.params;
    if (!element) return res.status(400).json({ error: 'Element non spécifié' });
    if (!req.body) return res.status(400).json({ error: 'Aucune donnée fournie pour la mise à jour' });

    const question = await getDbData(`questions/${element}`);
    if (!question) return res.status(404).json({ error: 'Question non trouvée' });

    const { question: q, answers, type } = req.body;
    const updateData = {};
    if (q) updateData.question = q;
    if (answers) updateData.answers = answers;
    if (type) updateData.type = type;

    await db.ref(`questions/${element}`).update(updateData);
    res.json({ message: 'Question mise à jour avec succès' });
  } catch (error) {
    handleError(res, 'Erreur lors de la mise à jour de la question', error);
  }
});

function compare(user, questionList, userUid) {
  const missingOrIncorrectQuestions = [];
  const ref = db.ref('users').child(userUid);

  questionList.forEach(question => {
    const { element: questionKey, type: questionType, answers } = question;

    // Check if question exists in user profile
    if (!user || !(questionKey in user)) {
      missingOrIncorrectQuestions.push(question);
      return;
    }

    const userResponse = user[questionKey];
    let isValid = true;

    // Validate response based on type
    switch (questionType) {
      case 'text': isValid = typeof userResponse === 'string'; break;
      case 'number': isValid = !isNaN(Number(userResponse)); break;
      case 'date': isValid = !isNaN(Date.parse(userResponse)); break;
      case 'bool': isValid = typeof userResponse === 'boolean'; break;
      case 'radio':
        isValid = Array.isArray(answers) && answers.includes(userResponse);
        break;
      case 'checkbox':
        isValid = Array.isArray(userResponse) && Array.isArray(answers) &&
          userResponse.every(item => answers.includes(item));
        break;
    }

    if (!isValid) {
      missingOrIncorrectQuestions.push(question);
      ref.child(questionKey).remove()
        .catch(error => console.error('Erreur lors de la suppression:', error));
    }
  });

  return missingOrIncorrectQuestions;
}

app.listen(PORT, '127.0.0.1', () => {
  console.log(`User service démarré sur http://127.0.0.1:${PORT}`);
});