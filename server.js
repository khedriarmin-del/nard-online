const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();
let matchmakingQueue = [];

function generateCode() {
  let code;
  do { code = String(Math.floor(100000 + Math.random() * 900000)); } while (rooms.has(code));
  return code;
}

io.on('connection', (socket) => {
  // === بازی با حریف تصادفی ===
  socket.on('findMatch', ({ playerId, playerName }) => {
    matchmakingQueue.push({ socketId: socket.id, playerId, playerName });
    
    if (matchmakingQueue.length >= 2) {
      const p1 = matchmakingQueue.shift();
      const p2 = matchmakingQueue.shift();
      
      const code = generateCode();
      const room = {
        code,
        target: 3, // بازی تصادفی پیش‌فرض ۳ امتیازی است
        players: { white: p1.socketId, black: p2.socketId },
        playerIds: { white: p1.playerId, black: p2.playerId },
        playerNames: { white: p1.playerName, black: p2.playerName },
        gameState: null,
        matchScore: { white: 0, black: 0 },
        disconnectedAt: null
      };
      rooms.set(code, room);
      
      const s1 = io.sockets.sockets.get(p1.socketId);
      const s2 = io.sockets.sockets.get(p2.socketId);
      
      if (s1) { s1.join(code); s1.roomCode = code; s1.color = 'white'; }
      if (s2) { s2.join(code); s2.roomCode = code; s2.color = 'black'; }
      
      io.to(code).emit('matchFound', { 
        code, 
        target: 3,
        whiteName: p1.playerName,
        blackName: p2.playerName
      });
      io.to(code).emit('gameStart', { target: 3, matchScore: room.matchScore });
    } else {
      socket.emit('waitingForMatch');
    }
  });

  // === چت ===
  socket.on('chatMessage', (msg) => {
    const room = rooms.get(socket.roomCode);
    if (!room) return;
    // ارسال پیام به هر دو بازیکن
    io.to(room.code).emit('chatMessage', {
      sender: socket.color,
      text: msg
    });
  });

  // === ساخت اتاق اختصاصی ===
  socket.on('createRoom', ({ target, playerId, playerName }, cb) => {
    const code = generateCode();
    const room = {
      code,
      target: target === 5 ? 5 : 3,
      players: { white: socket.id, black: null },
      playerIds: { white: playerId, black: null },
      playerNames: { white: playerName, black: null },
      gameState: null,
      matchScore: { white: 0, black: 0 },
      disconnectedAt: null
    };
    rooms.set(code, room);
    socket.join(code);
    socket.roomCode = code;
    socket.color = 'white';
    
    if (typeof cb === 'function') cb({ success: true, code, color: 'white', target: room.target });
  });

  // === ورود به اتاق اختصاصی ===
  socket.on('joinRoom', ({ code, playerId, playerName }, cb) => {
    const room = rooms.get(String(code));
    if (!room) return cb({ success: false, error: 'اتاق پیدا نشد' });

    // اگر بازیکن قبلی بود (Reconnect)
    if (room.playerIds.white === playerId) {
      room.players.white = socket.id;
      socket.join(room.code); socket.roomCode = room.code; socket.color = 'white';
      
      if (room.gameState) {
        cb({ success: true, code, color: 'white', target: room.target, resumed: true });
        io.to(socket.id).emit('gameStart', { target: room.target, matchScore: room.matchScore, whiteName: room.playerNames.white, blackName: room.playerNames.black });
        io.to(socket.id).emit('stateSync', room.gameState);
        io.to(room.code).emit('opponentReconnected');
      } else if (room.players.black) {
        cb({ success: true, code, color: 'white', target: room.target, resumed: true });
        io.to(socket.id).emit('gameStart', { target: room.target, matchScore: room.matchScore, whiteName: room.playerNames.white, blackName: room.playerNames.black });
      } else {
        cb({ success: true, code, color: 'white', target: room.target, resumed: true });
        io.to(socket.id).emit('waitingForOpponent', { code: room.code });
      }
      return;
    }

    if (room.playerIds.black === playerId) {
      room.players.black = socket.id;
      socket.join(room.code); socket.roomCode = room.code; socket.color = 'black';
      
      if (room.gameState) {
        cb({ success: true, code, color: 'black', target: room.target, resumed: true });
        io.to(socket.id).emit('gameStart', { target: room.target, matchScore: room.matchScore, whiteName: room.playerNames.white, blackName: room.playerNames.black });
        io.to(socket.id).emit('stateSync', room.gameState);
        io.to(room.code).emit('opponentReconnected');
      } else {
        cb({ success: true, code, color: 'black', target: room.target, resumed: true });
        io.to(socket.id).emit('gameStart', { target: room.target, matchScore: room.matchScore, whiteName: room.playerNames.white, blackName: room.playerNames.black });
      }
      return;
    }

    // ورود بازیکن جدید (مشکی)
    if (!room.playerIds.black) {
      room.players.black = socket.id;
      room.playerIds.black = playerId;
      room.playerNames.black = playerName;
      socket.join(room.code); socket.roomCode = room.code; socket.color = 'black';
      
      cb({ success: true, code, color: 'black', target: room.target });
      io.to(room.code).emit('gameStart', { target: room.target, matchScore: room.matchScore, whiteName: room.playerNames.white, blackName: room.playerNames.black });
      return;
    }

    return cb({ success: false, error: 'اتاق پر است!' });
  });

  // === مکانیزم‌های بازی ===
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
    
    if (room.matchScore[winner] >= room.target) {
      io.to(room.code).emit('matchOver', { winner, scores: room.matchScore });
    } else {
      io.to(room.code).emit('startNextGame', { scores: room.matchScore, nextTurn: winner });
    }
  });

  // === قطع اتصال ===
  socket.on('disconnect', () => {
    // حذف از صف بازی تصادفی (اگر آنجا بود)
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
