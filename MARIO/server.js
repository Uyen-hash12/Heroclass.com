const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const multer = require('multer');
const path = require('path');
const { OpenAI } = require('openai');

// Initialize Express app
const app = express();
app.use(cors());
app.use(express.json());

// Serve static files
app.use(express.static(path.join(__dirname, './')));

// Initialize Firebase Admin
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: "YOUR_STORAGE_BUCKET"
});

const db = admin.firestore();
const bucket = admin.storage().bucket();

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Middleware for authentication
const authenticate = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Unauthorized' });
  }
};

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// User Routes
app.post('/api/users', async (req, res) => {
  try {
    const { email, password, name, role } = req.body;
    const userRecord = await admin.auth().createUser({
      email,
      password,
      displayName: name
    });

    await db.collection('users').doc(userRecord.uid).set({
      name,
      email,
      role,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.status(201).json({ uid: userRecord.uid });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Course Routes
app.post('/api/courses', authenticate, async (req, res) => {
  try {
    const { name, subject, grade, description } = req.body;
    const courseRef = await db.collection('courses').add({
      name,
      subject,
      grade,
      description,
      teacherId: req.user.uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    res.status(201).json({ id: courseRef.id });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Lesson Routes
app.post('/api/courses/:courseId/lessons', authenticate, upload.array('files'), async (req, res) => {
  try {
    const { title, content, type } = req.body;
    const files = req.files || [];
    const fileUrls = [];

    // Upload files to Firebase Storage
    for (const file of files) {
      const fileRef = bucket.file(`courses/${req.params.courseId}/${file.originalname}`);
      await fileRef.save(file.buffer);
      const url = await fileRef.getSignedUrl({
        action: 'read',
        expires: '03-01-2500'
      });
      fileUrls.push(url[0]);
    }

    const lessonRef = await db.collection('courses').doc(req.params.courseId)
      .collection('lessons').add({
        title,
        content,
        type,
        files: fileUrls,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

    res.status(201).json({ id: lessonRef.id });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Progress Tracking
app.post('/api/progress', authenticate, async (req, res) => {
  try {
    const { courseId, lessonId, score, completed } = req.body;
    await db.collection('progress').add({
      userId: req.user.uid,
      courseId,
      lessonId,
      score,
      completed,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
    res.status(201).json({ message: 'Progress recorded' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Chat Routes
app.get('/api/chats', authenticate, async (req, res) => {
  try {
    const chats = await db.collection('chats')
      .where('participants', 'array-contains', req.user.uid)
      .get();
    
    const chatList = [];
    chats.forEach(doc => {
      chatList.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    res.json(chatList);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/chats', authenticate, async (req, res) => {
  try {
    const { participants, type, name } = req.body;
    const chatRef = await db.collection('chats').add({
      participants,
      type,
      name,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    res.status(201).json({ id: chatRef.id });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// AI Chat Response
app.post('/api/ai/chat', authenticate, async (req, res) => {
  try {
    const { message } = req.body;
    
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: "Bạn là trợ lý AI cho nền tảng giáo dục tiểu học Hero Class. Hãy trả lời các câu hỏi liên quan đến kiến thức tiểu học một cách đơn giản và dễ hiểu."
        },
        {
          role: "user",
          content: message
        }
      ],
      max_tokens: 500,
      temperature: 0.7
    });

    res.json({ response: response.choices[0].message.content });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 