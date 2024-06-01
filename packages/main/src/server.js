import {verify} from './token/middleware';

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

/**
 * @param {import('electron-better-ipc').ipcMain} ipcMain
 * @param {import('electron').BrowserWindow} win
 */
const api = (ipcMain, win) => {
  // Middleware
  app.use(express.json());
  app.use(cors());

  // POST endpoint to receive note data
  app.post('/add-note', verify(['note:add']), (req, res) => {
    const note = req.body;
    console.log('Note received:', note);
    io.emit('newNote', note); // Broadcast the note to all connected clients
    res.send('Creating Note');
  });

  app.post('/delete-note', verify(['note:delete']), (req, res) => {
    const { id } = req.body;
    console.log('Note deleted:', id);
    io.emit('deleteNote', id); // Broadcast the note ID to all connected clients
    res.send('Deleting Note');
  });

  app.post('/add-label', verify(['label:add']), (req, res) => {
    const { id, labelId } = req.body;
    console.log('Label added to note:', labelId, 'Note ID:', id);
    io.emit('addLabel', { id, labelId }); // Broadcast the label addition to all connected clients
    res.send('Adding Label');
  });

  app.post('/request-auth', (req, res) => {
    const { id, platform } = req.body;
    ipcMain.callRenderer(win, 'auth:request-auth', { id, platform });
    res.send('request sent!');
  });

  app.get('/confirm-auth', verify([]), (req, res) => {
    console.log(req.auth);
    res.send('passed');
  });

  // Start the server
  server.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
};

export default api;
