const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();

function generateCode() {
  let code;
  do { code = String(Math.floor(100000 + Math.random() * 900000)); } while (rooms.has(code));
  return code;
}

io.on('connection', (socket) => {
  // ساخت اتاق
  socket.on('createRoom', ({ target, playerId }, cb) => {
    const code = generateCode();
    const room = {
      code,
      target: target === 5 ? 5 : 3,
      players: { white: socket.id, black: null },
      playerIds: { white: playerId, black: null },
      gameState: null,
      disconnectedAt: null
    };
    rooms.set(code, room);
    socket.join(code);
    socket.roomCode = code;
    socket.color = 'white';
    
    if (typeof cb === 'function') cb({ success: true, code, color: 'white', target: room.target });
  });

  // ورود یا بازگشت به اتاق
  socket.on('joinRoom', ({ code, playerId }, cb) => {
    const room = rooms.get(String(code));
    if (!room) return cb({ success: false, error: 'اتاق پیدا نشد' });

    // اگر بازیکن سفید بود (بازگشت)
    if (room.playerIds.white === playerId) {
      room.players.white = socket.id;
      socket.join(room.code);
      socket.roomCode = room.code;
      socket.color = 'white';
      
      if (room.gameState) {
        cb({ success: true, code, color: 'white', target: room.target, resumed: true });
        io.to(socket.id).emit('gameStart', { target: room.target });
        io.to(socket.id).emit('stateSync', room.gameState);
        io.to(room.code).emit('opponentReconnected');
      } else if (room.players.black) {
        cb({ success: true, code, color: 'white', target: room.target, resumed: true });
        io.to(socket.id).emit('gameStart', { target: room.target });
      } else {
        cb({ success: true, code, color: 'white', target: room.target, resumed: true });
        io.to(socket.id).emit('waitingForOpponent', { code: room.code });
      }
      return;
    }

    // اگر بازیکن مشکی بود (بازگشت)
    if (room.playerIds.black === playerId) {
      room.players.black = socket.id;
      socket.join(room.code);
      socket.roomCode = room.code;
      socket.color = 'black';
      
      if (room.gameState) {
            return cb({ success: false, error: 'اتاق پر است! اگر می‌خواهید به بازی قبلی برگردید، صفحه (F5) را رفرش کنید.' });
        io.to(socket.id).emit('gameStart', { target: room.target });
        io.to(socket.id).emit('stateSync', room.gameState);
        io.to(room.code).emit('opponentReconnected');
      } else {
        cb({ success: true, code, color: 'black', target:    return cb({ success: false, error: 'اتاق پر است! اگر می‌خواهید به بازی قبلی برگردید، صفحه (F5) را رفرش کنید.' }); room.target, resumed: true });
        io.to(socket.id).emit('gameStart', { target: room.target });
      }
      return;
    }

    // بازیکن مشکی جدید (ورود اولیه)
    if (!room.playerIds.black) {
      room.players.black = socket.id;
      room.playerIds.black = playerId;
      socket.join(room.code);
      socket.roomCode = room.code;
      socket.color = 'black';
      
      cb({ success: true, code, color: 'black', target: room.target });
      io.to(room.code).emit('gameStart', { target: room.target });
      return;
    }

    return cb({ success: false, error: 'اتاق پر است یا این بازی در حال انجام است' });
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

  socket.on('gameOver', (data) => {
    const room = rooms.get(socket.roomCode);
    if (!room) return;
    socket.to(room.code).emit('gameOver', data);
    room.gameState = null;
  });

  socket.on('disconnect', () => {
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