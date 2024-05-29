// backend/api.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: 'http://localhost:5173',
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

const port = 3000;

const api = () => {
  // Middleware
  app.use(express.json());
  app.use(cors());

  // POST endpoint to receive note data
  app.post('/add-note', (req, res) => {
    const note = req.body;
    console.log('Note received:', note);
    io.emit('newNote', note); // Broadcast the note to all connected clients
    res.send('Creating Note');
  });

  app.post('/delete-note', (req, res) => {
    const { id } = req.body;
    console.log('Note deleted:', id);
    io.emit('deleteNote', id); // Broadcast the note ID to all connected clients
    res.send('Deleting Note');
  });

  app.post('/add-label', (req, res) => {
    const { id, labelId } = req.body;
    console.log('Label added to note:', labelId, 'Note ID:', id);
    io.emit('addLabel', { id, labelId }); // Broadcast the label addition to all connected clients
    res.send('Adding Label');
  });

  // Start the server
  server.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
};

export default api;
