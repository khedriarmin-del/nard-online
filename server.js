const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('index.html') || filePath.endsWith('sw.js')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

const rooms = new Map();
let matchmakingQueue = [];

function generateCode() {
  let code;
  do { code = String(Math.floor(100000 + Math.random() * 900000)); } while (rooms.has(code));
  return code;
}

io.on('connection', (socket) => {
    socket.on('findMatch', ({ playerId, playerName, entryFee, bonus }) => {
    matchmakingQueue.push({ socketId: socket.id, playerId, playerName, entryFee, bonus });
    
    const opponentIndex = matchmakingQueue.findIndex(p => p.socketId !== socket.id && p.entryFee === entryFee);
    
    if (opponentIndex !== -1) {
      const p2 = matchmakingQueue[opponentIndex];
      const p1 = matchmakingQueue.find(p => p.socketId === socket.id);
      
      matchmakingQueue = matchmakingQueue.filter(p => p.socketId !== socket.id && p.socketId !== p2.socketId);
      
      const code = generateCode();
      const room = {
        code, target: 3, roomType: 'random', entryFee: p1.entryFee, bonus: p1.bonus,
        players: { white: p1.socketId, black: p2.socketId },
        playerIds: { white: p1.playerId, black: p2.playerId },
        playerNames: { white: p1.playerName, black: p2.playerName },
        gameState: null, matchScore: { white: 0, black: 0 }, gamesWon: { white: 0, black: 0 }, disconnectedAt: null
      };
      rooms.set(code, room);
      
      const s1 = io.sockets.sockets.get(p1.socketId);
      const s2 = io.sockets.sockets.get(p2.socketId);
      if (s1) { s1.join(code); s1.roomCode = code; s1.color = 'white'; }
      if (s2) { s2.join(code); s2.roomCode = code; s2.color = 'black'; }
      
      // 👇 این دو خط اضافه شد تا رنگ‌ها به گوشی‌ها ارسال شود
      if (s1) s1.emit('assignedColor', 'white');
      if (s2) s2.emit('assignedColor', 'black');
      
      const gameData = { code, target: 3, matchScore: room.matchScore, whiteName: p1.playerName, blackName: p2.playerName, entryFee: room.entryFee, bonus: room.bonus, roomType: 'random' };
      io.to(code).emit('gameStart', gameData);
    } else {
      socket.emit('waitingForMatch');
    }
  });

  socket.on('cancelMatch', () => {
    matchmakingQueue = matchmakingQueue.filter(p => p.socketId !== socket.id);
  });

  socket.on('chatMessage', (msg) => {
    const room = rooms.get(socket.roomCode);
    if (!room) return;
    io.to(room.code).emit('chatMessage', { sender: socket.color, text: msg });
  });

  socket.on('createRoom', ({ target, entryFee, playerId, playerName }, cb) => {
    const code = generateCode();
    const room = {
      code,
      target: target === 5 ? 5 : 3,
      roomType: 'private',
      entryFee: entryFee,
      bonus: 0,
      players: { white: socket.id, black: null },
      playerIds: { white: playerId, black: null },
      playerNames: { white: playerName, black: null },
      gameState: null,
      matchScore: { white: 0, black: 0 },
      gamesWon: { white: 0, black: 0 },
      disconnectedAt: null
    };
    rooms.set(code, room);
    socket.join(code); socket.roomCode = code; socket.color = 'white';
    if (typeof cb === 'function') cb({ success: true, code, color: 'white', target: room.target, entryFee: room.entryFee });
  });

  socket.on('joinRoom', ({ code, playerId, playerName }, cb) => {
    const room = rooms.get(String(code));
    if (!room) return cb({ success: false, error: 'اتاق پیدا نشد' });

    if (room.playerIds.white === playerId) {
      room.players.white = socket.id;
      socket.join(room.code); socket.roomCode = room.code; socket.color = 'white';
      
      if (room.gameState) {
        cb({ success: true, code, color: 'white', target: room.target, resumed: true, roomType: room.roomType, entryFee: room.entryFee });
        io.to(socket.id).emit('gameStart', { target: room.target, matchScore: room.matchScore, whiteName: room.playerNames.white, blackName: room.playerNames.black, roomType: room.roomType, entryFee: room.entryFee });
        io.to(socket.id).emit('stateSync', room.gameState);
        io.to(room.code).emit('opponentReconnected');
      } else if (room.players.black) {
        cb({ success: true, code, color: 'white', target: room.target, resumed: true, roomType: room.roomType, entryFee: room.entryFee });
        io.to(socket.id).emit('gameStart', { target: room.target, matchScore: room.matchScore, whiteName: room.playerNames.white, blackName: room.playerNames.black, roomType: room.roomType, entryFee: room.entryFee });
      } else {
        cb({ success: true, code, color: 'white', target: room.target, resumed: true, roomType: room.roomType, entryFee: room.entryFee });
        io.to(socket.id).emit('waitingForOpponent', { code: room.code });
      }
      return;
    }

    if (room.playerIds.black === playerId) {
      room.players.black = socket.id;
      socket.join(room.code); socket.roomCode = room.code; socket.color = 'black';
      
      if (room.gameState) {
        cb({ success: true, code, color: 'black', target: room.target, resumed: true, roomType: room.roomType, entryFee: room.entryFee });
        io.to(socket.id).emit('gameStart', { target: room.target, matchScore: room.matchScore, whiteName: room.playerNames.white, blackName: room.playerNames.black, roomType: room.roomType, entryFee: room.entryFee });
        io.to(socket.id).emit('stateSync', room.gameState);
        io.to(room.code).emit('opponentReconnected');
      } else {
        cb({ success: true, code, color: 'black', target: room.target, resumed: true, roomType: room.roomType, entryFee: room.entryFee });
        io.to(socket.id).emit('gameStart', { target: room.target, matchScore: room.matchScore, whiteName: room.playerNames.white, blackName: room.playerNames.black, roomType: room.roomType, entryFee: room.entryFee });
      }
      return;
    }

    if (!room.playerIds.black) {
      room.players.black = socket.id;
      room.playerIds.black = playerId;
      room.playerNames.black = playerName;
      socket.join(room.code); socket.roomCode = room.code; socket.color = 'black';
      
      cb({ success: true, code, color: 'black', target: room.target, roomType: room.roomType, entryFee: room.entryFee });
      io.to(room.code).emit('gameStart', { target: room.target, matchScore: room.matchScore, whiteName: room.playerNames.white, blackName: room.playerNames.black, roomType: room.roomType, entryFee: room.entryFee });
      return;
    }

    return cb({ success: false, error: 'اتاق پر است!' });
  });

  socket.on('rollDice', () => {
    const room = rooms.get(socket.roomCode);
    if (!room) return;
    const n1 = Math.floor(Math.random() * 6) + 1;
    const n2 = Math.floor(Math.random() * 6) + 1;
    io.to(room.code).emit('diceResult', { n1, n2, roller: socket.color });
  });

  socket.on('stateUpdate', (data) => {
    const room = rooms.get(socket.roomCode);
    if (!room) return;
    room.gameState = data;
    socket.to(room.code).emit('stateSync', data);
  });

  socket.on('gameOver', ({ winner, points }) => {
    const room = rooms.get(socket.roomCode);
    if (!room) return;
    room.gameState = null;
    room.matchScore[winner] += points;
    room.gamesWon[winner] += 1;
    
    if (room.matchScore[winner] >= room.target) {
      io.to(room.code).emit('matchOver', { winner, scores: room.matchScore, gamesWon: room.gamesWon, roomType: room.roomType, entryFee: room.entryFee, bonus: room.bonus });
    } else {
      io.to(room.code).emit('startNextGame', { scores: room.matchScore, nextTurn: winner });
    }
  });

  socket.on('disconnect', () => {
    matchmakingQueue = matchmakingQueue.filter(p => p.socketId !== socket.id);

    const code = socket.roomCode;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;
    
    if (room.players.white === socket.id) room.players.white = null;
    if (room.players.black === socket.id) room.players.black = null;
    
    if (!room.players.white && !room.players.black) {
      rooms.delete(code);
    } else {
      socket.to(code).emit('opponentDisconnected');
      room.disconnectedAt = Date.now();
      
      setTimeout(() => {
        const r = rooms.get(code);
        if (r && r.disconnectedAt && Date.now() - r.disconnectedAt >= 59000) {
          socket.to(code).emit('opponentTimeout');
        }
      }, 60000);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🎲 Server running on http://localhost:${PORT}`);
});
