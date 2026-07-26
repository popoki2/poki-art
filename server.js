const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'usersDB.json');
const WORDS_PATH = path.join(__dirname, 'wordsDB.json');

// --- [ 데이터베이스 연동 ] ---
function loadUsersDB() {
    try {
        if (!fs.existsSync(DB_PATH)) {
            fs.writeFileSync(DB_PATH, JSON.stringify({}), 'utf8');
        }
        return JSON.parse(fs.readFileSync(DB_PATH, 'utf8') || '{}');
    } catch (e) {
        return {};
    }
}

function saveUsersDB(db) {
    try {
        fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
    } catch (e) {}
}

function loadWordsDB() {
    try {
        if (!fs.existsSync(WORDS_PATH)) {
            return { food: ["마카롱", "케이크"], anime: ["피카츄", "초사이어인"], meme: ["무야호"], lol: ["티모"], all: ["마카롱", "케이크", "피카츄", "초사이어인", "무야호", "티모"] };
        }
        const parsed = JSON.parse(fs.readFileSync(WORDS_PATH, 'utf8'));
        parsed.all = Array.from(new Set([
            ...(parsed.food || []),
            ...(parsed.anime || []),
            ...(parsed.meme || []),
            ...(parsed.lol || [])
        ]));
        return parsed;
    } catch (e) {
        return { food: [], anime: [], meme: [], lol: [] };
    }
}

let usersDB = loadUsersDB();
let wordsDB = loadWordsDB();

const SHOP_ITEMS = [
    { id: 'title_artist', type: 'title', name: '🎨 피카소의 재래', price: 300, value: '피카소의 재래' },
    { id: 'title_master', type: 'title', name: '👑 그림의 신', price: 800, value: '그림의 신' },
    { id: 'color_pink', type: 'color', name: '💗 네온 핑크 닉네임', price: 400, value: '#ff69b4' },
    { id: 'color_gold', type: 'color', name: '✨ 황금빛 닉네임', price: 600, value: '#ffd700' },
    { id: 'badge_angel', type: 'badge', name: '👼 천사 아이콘', price: 350, value: '👼' },
    { id: 'badge_devil', type: 'badge', name: '😈 악마 아이콘', price: 350, value: '😈' }
];

function getRandomWord(category, usedWords = []) {
    wordsDB = loadWordsDB();
    let list = wordsDB[category] || wordsDB.all;
    if (!list || list.length === 0) list = wordsDB.all;

    let available = list.filter(w => !usedWords.includes(w));
    if (available.length === 0) {
        available = list;
        usedWords.length = 0;
    }
    const selected = available[Math.floor(Math.random() * available.length)];
    usedWords.push(selected);
    return selected;
}

const rooms = {};
const lobbyUsers = {};
let roomCounter = 1;

function getPublicRoomList() {
    return Object.values(rooms).map(r => ({
        id: r.id,
        roomNum: r.roomNum,
        title: r.title,
        category: r.category,
        currentPlayers: r.players.length,
        maxPlayers: r.maxPlayers,
        totalRounds: r.totalRounds,
        isLocked: !!r.password,
        isPlaying: r.isPlaying
    }));
}

io.on('connection', (socket) => {
    let currentUser = { username: null, nickname: null, roomId: null };

    socket.on('register', ({ username, password, nickname }) => {
        usersDB = loadUsersDB();
        if (usersDB[username]) return socket.emit('authError', '이미 존재하는 아이디입니다.');
        if (Object.values(usersDB).some(u => u.nickname === nickname)) return socket.emit('authError', '이미 사용 중인 닉네임입니다.');

        usersDB[username] = {
            username, password, nickname: nickname || username,
            points: 1000, exp: 0, inventory: [],
            equipped: { title: '인터넷 오타쿠', badge: '🎀', color: '#ff1493', border: 'none' }
        };
        saveUsersDB(usersDB);
        socket.emit('authSuccess', { message: '가입 완료! 로그인해 주세요.' });
    });

    socket.on('login', ({ username, password }) => {
        usersDB = loadUsersDB();
        const user = usersDB[username];
        if (!user || user.password !== password) return socket.emit('authError', '아이디 또는 비밀번호가 틀립니다.');
        if (Object.values(lobbyUsers).some(u => u.username === username)) return socket.emit('authError', '이미 로그인되어 있습니다.');

        currentUser.username = username;
        currentUser.nickname = user.nickname;
        lobbyUsers[socket.id] = { id: socket.id, username, nickname: user.nickname, equipped: user.equipped, points: user.points };

        socket.emit('loginSuccess', { username, ...user });
        io.emit('updateLobbyUsers', Object.values(lobbyUsers));
        socket.emit('updateRoomList', getPublicRoomList());
    });

    socket.on('buyItem', (itemId) => {
        if (!currentUser.username) return;
        usersDB = loadUsersDB();
        const user = usersDB[currentUser.username];
        const item = SHOP_ITEMS.find(i => i.id === itemId);

        if (!user || !item) return;
        if (user.points < item.price) return socket.emit('shopError', '포인트가 부족합니다!');
        if (user.inventory.includes(itemId)) return socket.emit('shopError', '이미 보유한 아이템입니다.');

        user.points -= item.price;
        user.inventory.push(itemId);
        user.equipped[item.type] = item.value;

        saveUsersDB(usersDB);
        socket.emit('shopSuccess', { user, message: `[${item.name}] 구매 완료!` });
        if (lobbyUsers[socket.id]) lobbyUsers[socket.id].equipped = user.equipped;
        io.emit('updateLobbyUsers', Object.values(lobbyUsers));
    });

    socket.on('sendLobbyChat', (msg) => {
        if (!currentUser.nickname) return;
        io.emit('lobbyChat', { sender: currentUser.nickname, text: msg, equipped: usersDB[currentUser.username]?.equipped });
    });

    socket.on('createRoom', (config) => {
        if (!currentUser.username) return;
        const roomId = 'room_' + Date.now();
        rooms[roomId] = {
            id: roomId,
            roomNum: roomCounter++,
            title: config.title || '포키파티 즐겁게 하자!',
            password: config.password || '',
            maxPlayers: parseInt(config.maxPlayers) || 6,
            totalRounds: parseInt(config.totalRounds) || 3,
            roundTime: parseInt(config.roundTime) || 60,
            category: config.category || 'all',
            hostId: socket.id,
            players: [],
            currentRound: 1,
            drawerIndex: -1,
            currentWord: '',
            usedWords: [],
            timeLeft: 0,
            timer: null,
            isPlaying: false,
            solvedPlayers: [],
            canvasData: []
        };
        joinRoomAction(socket, roomId, config.password, currentUser);
    });

    socket.on('joinRoom', ({ roomId, password }) => joinRoomAction(socket, roomId, password, currentUser));

    function joinRoomAction(socket, roomId, password, currentUser) {
        const room = rooms[roomId];
        if (!room) return socket.emit('joinError', '존재하지 않는 방입니다.');
        if (room.password && room.password !== password) return socket.emit('joinError', '비밀번호가 틀립니다.');
        if (room.players.length >= room.maxPlayers) return socket.emit('joinError', '방 정원이 꽉 찼습니다.');
        if (room.isPlaying) return socket.emit('joinError', '이미 게임이 진행 중입니다.');

        delete lobbyUsers[socket.id];
        io.emit('updateLobbyUsers', Object.values(lobbyUsers));

        currentUser.roomId = roomId;
        socket.join(roomId);

        usersDB = loadUsersDB();
        const user = usersDB[currentUser.username] || {};
        const player = {
            id: socket.id,
            username: currentUser.username,
            name: currentUser.nickname,
            score: 0,
            equipped: user.equipped || {}
        };
        room.players.push(player);

        socket.emit('roomJoined', { ...room, isHost: room.hostId === socket.id });
        io.to(roomId).emit('updatePlayers', { players: room.players, hostId: room.hostId, solvedPlayers: room.solvedPlayers, drawerId: room.players[room.drawerIndex]?.id });
        io.to(roomId).emit('chatMessage', { sender: 'SYSTEM', text: `${currentUser.nickname} 님이 입장하셨습니다!` });
        io.emit('updateRoomList', getPublicRoomList());
    }

    socket.on('requestStartGame', () => {
        const room = rooms[currentUser.roomId];
        if (!room || room.hostId !== socket.id || room.players.length < 2 || room.isPlaying) return;
        startGame(currentUser.roomId);
    });

    socket.on('draw', (drawData) => {
        const room = rooms[currentUser.roomId];
        if (room && room.players[room.drawerIndex]?.id === socket.id) {
            room.canvasData.push(drawData);
            socket.to(currentUser.roomId).emit('draw', drawData);
        }
    });

    socket.on('clearCanvas', () => {
        const room = rooms[currentUser.roomId];
        if (room && room.players[room.drawerIndex]?.id === socket.id) {
            room.canvasData = [];
            io.to(currentUser.roomId).emit('clearCanvas');
        }
    });

    // --- [ 👍 개추(따봉) 기능 ] ---
    socket.on('sendGaechu', () => {
        const room = rooms[currentUser.roomId];
        if (!room || !room.isPlaying) return;

        const drawer = room.players[room.drawerIndex];
        if (!drawer || drawer.id === socket.id) return; // 그리는 당사자는 자기 그림에 개추 불가

        // 그림 그린 플레이어에게 +10pt 보상
        drawer.score += 10;
        usersDB = loadUsersDB();
        if (usersDB[drawer.username]) {
            usersDB[drawer.username].points += 10;
            saveUsersDB(usersDB);
        }

        io.to(room.id).emit('geachuEffect', { sender: currentUser.nickname, drawerName: drawer.name });
        io.to(room.id).emit('updatePlayers', { players: room.players, hostId: room.hostId, solvedPlayers: room.solvedPlayers, drawerId: drawer.id });
    });

    // --- [ 정답 및 등수 + 시간 연동 차등 점수 계산 ] ---
    socket.on('chatMessage', (msg) => {
        const roomId = currentUser.roomId;
        if (!roomId || !rooms[roomId]) return;

        const room = rooms[roomId];
        const isDrawer = room.players[room.drawerIndex]?.id === socket.id;
        const isAlreadySolved = room.solvedPlayers.includes(socket.id);

        if (room.isPlaying && !isDrawer && !isAlreadySolved && msg.trim() === room.currentWord) {
            room.solvedPlayers.push(socket.id);
            const rank = room.solvedPlayers.length; // 1등, 2등, 3등...

            // [점수 계산 공식]
            // 기본 점수: 1등=100, 2등=70, 3등=50, 4등이하=30
            // 시간 가산점: (남은시간 / 총시간) * (1등=100, 2등=70, 3등=50, 4등이하=30)
            let baseScore = 30;
            if (rank === 1) baseScore = 100;
            else if (rank === 2) baseScore = 70;
            else if (rank === 3) baseScore = 50;

            const timeBonusRatio = room.timeLeft / room.roundTime;
            const earnedScore = Math.round(baseScore + (baseScore * timeBonusRatio));

            const player = room.players.find(p => p.id === socket.id);
            if (player) player.score += earnedScore;

            usersDB = loadUsersDB();
            if (usersDB[currentUser.username]) {
                usersDB[currentUser.username].points += earnedScore;
                saveUsersDB(usersDB);
            }

            io.to(roomId).emit('updatePlayers', { players: room.players, hostId: room.hostId, solvedPlayers: room.solvedPlayers, drawerId: room.players[room.drawerIndex]?.id });
            io.to(roomId).emit('correctAnswerOverlay', { winner: currentUser.nickname });
            io.to(roomId).emit('chatMessage', { sender: 'SYSTEM 🎉', text: `[${rank}등] ${currentUser.nickname} 정답! (남은시간 ${room.timeLeft}초 ⚡ +${earnedScore}pt)` });

            if (room.solvedPlayers.length >= room.players.length - 1) {
                clearInterval(room.timer);
                setTimeout(() => nextTurn(roomId), 1500);
            }
            return;
        }

        io.to(roomId).emit('chatMessage', { sender: currentUser.nickname, text: msg });
    });

    socket.on('leaveRoom', () => leaveCurrentRoom(socket));
    socket.on('disconnect', () => {
        leaveCurrentRoom(socket);
        delete lobbyUsers[socket.id];
        io.emit('updateLobbyUsers', Object.values(lobbyUsers));
    });

    function leaveCurrentRoom(socket) {
        const roomId = currentUser.roomId;
        if (!roomId || !rooms[roomId]) return;

        const room = rooms[roomId];
        const idx = room.players.findIndex(p => p.id === socket.id);

        if (idx !== -1) {
            room.players.splice(idx, 1);
            socket.leave(roomId);

            if (room.hostId === socket.id && room.players.length > 0) room.hostId = room.players[0].id;

            if (room.players.length === 0) {
                clearInterval(room.timer);
                delete rooms[roomId];
            } else {
                io.to(roomId).emit('updatePlayers', { players: room.players, hostId: room.hostId, solvedPlayers: room.solvedPlayers, drawerId: room.players[room.drawerIndex]?.id });
            }
        }

        currentUser.roomId = null;
        if (currentUser.username && usersDB[currentUser.username]) {
            lobbyUsers[socket.id] = { id: socket.id, username: currentUser.username, nickname: currentUser.nickname, equipped: usersDB[currentUser.username].equipped };
        }
        
        socket.emit('leftRoom');
        io.emit('updateLobbyUsers', Object.values(lobbyUsers));
        io.emit('updateRoomList', getPublicRoomList());
    }
});

function startGame(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    room.isPlaying = true;
    room.currentRound = 1;
    room.drawerIndex = -1;
    room.usedWords = [];
    room.players.forEach(p => p.score = 0);

    io.emit('updateRoomList', getPublicRoomList());
    nextTurn(roomId);
}

function nextTurn(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    room.canvasData = [];
    io.to(roomId).emit('clearCanvas');
    room.solvedPlayers = [];

    room.drawerIndex++;
    if (room.drawerIndex >= room.players.length) {
        room.drawerIndex = 0;
        room.currentRound++;
    }

    if (room.currentRound > room.totalRounds) {
        room.isPlaying = false;
        const sorted = [...room.players].sort((a, b) => b.score - a.score);
        io.to(roomId).emit('gameOver', sorted);
        io.to(roomId).emit('chatMessage', { sender: 'SYSTEM 🏆', text: `게임 완료! 1등: ${sorted[0]?.name || '없음'} 님!` });
        io.emit('updateRoomList', getPublicRoomList());
        return;
    }

    const drawer = room.players[room.drawerIndex];
    room.currentWord = getRandomWord(room.category, room.usedWords);
    room.timeLeft = room.roundTime;

    io.to(roomId).emit('updatePlayers', { players: room.players, hostId: room.hostId, solvedPlayers: room.solvedPlayers, drawerId: drawer.id });
    io.to(drawer.id).emit('turnStart', { isDrawer: true, word: room.currentWord, time: room.roundTime, round: room.currentRound, totalRounds: room.totalRounds });

    room.players.forEach(p => {
        if (p.id !== drawer.id) {
            io.to(p.id).emit('turnStart', { isDrawer: false, word: '???', time: room.roundTime, round: room.currentRound, totalRounds: room.totalRounds });
        }
    });

    clearInterval(room.timer);
    room.timer = setInterval(() => {
        room.timeLeft--;
        io.to(roomId).emit('timerUpdate', room.timeLeft);

        if (room.timeLeft <= 0) {
            clearInterval(room.timer);
            io.to(roomId).emit('chatMessage', { sender: 'SYSTEM ⏰', text: `시간 종료! 정답은 [ ${room.currentWord} ] 였습니다.` });
            setTimeout(() => nextTurn(roomId), 2500);
        }
    }, 1000);
}

app.get('/', (req, res) => res.send(getHTMLContent()));

function getHTMLContent() {
    return `
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <title>ポキパティ！！ (Poki Party v1.3.0)</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=DungGeunMo&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'DungGeunMo', monospace; }
        body { background: #ffdeec; display: flex; justify-content: center; align-items: center; height: 100vh; overflow: hidden; }

        .screen { display: none; width: 1100px; height: 740px; background: #fff0f5; border: 4px solid #ff1493; box-shadow: 6px 6px 0px #000; padding: 16px; position: relative; }
        #auth-screen.active { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; }
        #lobby-screen.active { display: grid; grid-template-columns: 280px 1fr; gap: 16px; height: 100%; }
        #game-room.active { display: grid; grid-template-columns: 220px 1fr 280px; gap: 12px; height: 100%; }

        .pixel-title { font-size: 36px; color: #ff1493; text-shadow: 2px 2px 0px #000; }
        .input-box { width: 280px; padding: 10px; border: 3px solid #ff1493; background: #fff; font-size: 14px; outline: none; box-shadow: 2px 2px 0px #000; }
        .btn { padding: 8px 16px; background: #ff69b4; color: #fff; border: 2px solid #000; cursor: pointer; font-weight: bold; font-size: 14px; box-shadow: 3px 3px 0px #000; }
        .btn:hover { background: #ff1493; }

        .lobby-left { display: flex; flex-direction: column; gap: 12px; height: 100%; }
        .lobby-card { background: #fff; border: 3px solid #ff1493; padding: 12px; box-shadow: 3px 3px 0px #000; }
        .user-list-box { flex: 1; background: #fff; border: 3px solid #ff1493; padding: 8px; overflow-y: auto; box-shadow: 3px 3px 0px #000; display: flex; flex-direction: column; gap: 6px; }

        .lobby-main { display: flex; flex-direction: column; gap: 12px; height: 100%; }
        .room-grid { flex: 1; display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; overflow-y: auto; max-height: 420px; }
        .room-card { background: #fff; border: 3px solid #ff69b4; padding: 12px; cursor: pointer; box-shadow: 3px 3px 0px #000; }

        .lobby-chat-area { height: 180px; background: #fff; border: 3px solid #ff1493; padding: 8px; display: flex; flex-direction: column; box-shadow: 3px 3px 0px #000; }
        .lobby-chat-msgs { flex: 1; overflow-y: auto; font-size: 13px; display: flex; flex-direction: column; gap: 4px; }

        .player-list { background: #fff; border: 3px solid #ff1493; padding: 10px; display: flex; flex-direction: column; gap: 8px; box-shadow: 3px 3px 0px #000; height: 100%; }
        .player-card { background: #fff5f8; border: 2px solid #ff69b4; padding: 6px 8px; font-size: 12px; display: flex; justify-content: space-between; align-items: center; }
        .player-card.is-drawer { background: #fff9c4; border-color: #fbc02d; font-weight: bold; }
        .player-card.is-solved { background: #c8e6c9; border-color: #4caf50; }

        .poki-logo-badge { margin-top: auto; text-align: center; background: #ff1493; color: white; padding: 6px; border: 2px solid #000; font-size: 14px; font-weight: bold; box-shadow: 2px 2px 0px #000; }

        .canvas-area { display: flex; flex-direction: column; align-items: center; gap: 6px; height: 100%; }
        #canvas-wrapper { position: relative; border: 4px solid #ff1493; background: #fff; box-shadow: 4px 4px 0px #000; }
        canvas { display: block; cursor: crosshair; }

        /* 개추(👍) 버튼 위치 조정 */
        #geachu-btn { position: absolute; right: 12px; bottom: 12px; background: #ff4081; color: white; padding: 8px 14px; border: 2.5px solid #000; border-radius: 20px; font-weight: bold; font-size: 14px; cursor: pointer; box-shadow: 3px 3px 0px #000; z-index: 5; }
        #geachu-btn:active { transform: scale(0.95); }

        /* 개추 애니메이션 Floating 텍스트 */
        .geachu-pop { position: absolute; color: #ff1493; font-weight: bold; font-size: 20px; text-shadow: 2px 2px 0px #fff, -1px -1px 0px #000; pointer-events: none; animation: floatUp 1.2s forwards ease-out; }
        @keyframes floatUp {
            0% { opacity: 1; transform: translateY(0) scale(1); }
            100% { opacity: 0; transform: translateY(-80px) scale(1.4); }
        }

        .palette-grid { display: grid; grid-template-columns: repeat(13, 1fr); gap: 3px; width: 640px; background: #fff; padding: 6px; border: 3px solid #ff1493; box-shadow: 3px 3px 0px #000; }
        .color-dot { width: 22px; height: 22px; border: 2px solid #000; cursor: pointer; }
        .color-dot.active { transform: scale(1.2); border-color: #ff0000; outline: 2px solid #fff; }

        .tools-row { display: flex; gap: 6px; align-items: center; justify-content: center; width: 640px; }
        .tool-btn { padding: 4px 8px; font-size: 12px; border: 2px solid #000; background: #fff; cursor: pointer; box-shadow: 2px 2px 0px #000; }
        .tool-btn.active { background: #ff1493; color: white; font-weight: bold; }

        .chat-area { display: flex; flex-direction: column; background: #fff; border: 3px solid #ff1493; padding: 10px; box-shadow: 3px 3px 0px #000; height: 100%; overflow: hidden; }
        .chat-messages { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
        .chat-msg { background: #fff0f5; padding: 6px 8px; border: 1.5px solid #ff69b4; }
        .chat-msg.system { background: #e0f7fa; border-color: #00bcd4; color: #00838f; font-weight: bold; }

        #correct-overlay { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); background: #4caf50; color: white; padding: 8px 20px; border: 3px solid #000; font-weight: bold; display: none; z-index: 10; font-size: 15px; box-shadow: 3px 3px 0px #000; }

        .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); justify-content: center; align-items: center; z-index: 100; }
        .modal-content { background: #fff0f5; padding: 20px; border: 4px solid #ff1493; box-shadow: 6px 6px 0px #000; width: 420px; display: flex; flex-direction: column; gap: 12px; }
    </style>
</head>
<body>

    <!-- Auth -->
    <div id="auth-screen" class="screen active">
        <h1 class="pixel-title">ポキパティ！！ (Poki Party)</h1>
        <p style="color: #666; font-size: 14px;">♡ 레트로 인터넷 그림 퀴즈 파티 ♡</p>
        <input type="text" id="auth-username" class="input-box" placeholder="아이디">
        <input type="password" id="auth-password" class="input-box" placeholder="비밀번호">
        <input type="text" id="auth-nickname" class="input-box" placeholder="닉네임 (가입 시 필수)">
        <div style="display: flex; gap: 10px; margin-top: 5px;">
            <button class="btn" onclick="handleLogin()">로그인</button>
            <button class="btn" style="background:#ba68c8;" onclick="handleRegister()">회원가입</button>
        </div>
    </div>

    <!-- Lobby -->
    <div id="lobby-screen" class="screen">
        <div class="lobby-left">
            <div class="lobby-card">
                <h3 style="color: #ff1493; font-size: 18px; margin-bottom: 6px;">👤 내 프로필</h3>
                <div id="user-profile-info" style="font-size: 13px; line-height: 1.6;"></div>
                <div style="display: flex; gap: 6px; margin-top: 8px;">
                    <button class="btn" style="flex:1; padding: 6px;" onclick="openCreateModal()">➕ 방 만들기</button>
                    <button class="btn" style="background: #ffd700; color: #000; padding: 6px;" onclick="openShopModal()">🛍️ 상점</button>
                </div>
            </div>
            <div class="user-list-box">
                <h4 style="color: #ff1493; font-size: 14px;">🌐 접속자 목록</h4>
                <div id="lobby-user-list" style="display: flex; flex-direction: column; gap: 4px;"></div>
            </div>
        </div>

        <div class="lobby-main">
            <h2 class="pixel-title" style="font-size: 28px;">ポキパティ！！ 파티 로비</h2>
            <div id="room-grid" class="room-grid"></div>
            <div class="lobby-chat-area">
                <h4 style="color: #ff1493; margin-bottom: 4px;">💬 로비 전체 채팅</h4>
                <div id="lobby-chat-msgs" class="lobby-chat-msgs"></div>
                <div style="display: flex; gap: 6px; margin-top: 6px;">
                    <input type="text" id="lobby-chat-input" class="input-box" style="flex:1; width:auto; height: 32px;" placeholder="로비 메시지..." onkeypress="if(event.key==='Enter') sendLobbyChat()">
                    <button class="btn" style="padding: 4px 12px;" onclick="sendLobbyChat()">전송</button>
                </div>
            </div>
        </div>
    </div>

    <!-- Game Room -->
    <div id="game-room" class="screen">
        <div class="player-list">
            <h4 style="text-align: center; color: #ff1493;">PLAYERS</h4>
            <div id="game-player-list" style="flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:6px;"></div>
            <button id="start-game-btn" class="btn" style="background: #4caf50; display:none;" onclick="requestStartGame()">▶️ 게임 시작</button>
            <div class="poki-logo-badge">ポキパティ！！</div>
        </div>

        <div class="canvas-area">
            <div style="display: flex; gap: 20px; align-items: center;">
                <div id="round-display" style="font-size: 15px; font-weight: bold; color: #ba68c8;">ROUND 1 / 3</div>
                <div id="timer-display" style="font-size: 18px; font-weight: bold; color: #ff1493;">⏳ 대기 중...</div>
            </div>
            <div id="word-display" style="font-size: 22px; font-weight: bold; color: #2e7d32;">제시어: ???</div>

            <div id="canvas-wrapper">
                <div id="correct-overlay">🎉 <span id="winner-name"></span> 님 정답!</div>
                <canvas id="game-canvas" width="640" height="460"></canvas>
                <!-- 개추 버튼 -->
                <button id="geachu-btn" onclick="sendGaechu()">👍 개추</button>
            </div>

            <div class="palette-grid" id="palette-grid"></div>

            <div class="tools-row">
                <button class="tool-btn active" onclick="setLineWidth(1, this)">1단계 (극세)</button>
                <button class="tool-btn" onclick="setLineWidth(3, this)">2단계 (얇게)</button>
                <button class="tool-btn" onclick="setLineWidth(6, this)">3단계 (보통)</button>
                <button class="tool-btn" onclick="setLineWidth(10, this)">4단계 (두껍게)</button>
                <button class="tool-btn" onclick="setLineWidth(16, this)">5단계 (극두)</button>
                <button class="tool-btn" onclick="setEraser(this)">🧹 지우개</button>
                <button class="tool-btn" onclick="clearCanvasAction()">🗑️ 전체지우기</button>
                <button class="tool-btn" style="background: #ff5252; color: white;" onclick="leaveRoom()">🚪 나가기</button>
            </div>
        </div>

        <div class="chat-area">
            <h4 style="color: #ff1493; margin-bottom: 6px;">CHAT & ANSWER</h4>
            <div id="chat-messages" class="chat-messages"></div>
            <div style="display: flex; gap: 4px; margin-top: 8px;">
                <input type="text" id="chat-input" class="input-box" style="flex:1; width:auto; height:34px;" placeholder="정답/채팅 입력..." onkeypress="if(event.key==='Enter') sendChat()">
                <button class="btn" style="padding: 4px 10px;" onclick="sendChat()">전송</button>
            </div>
        </div>
    </div>

    <!-- Modals -->
    <div id="create-modal" class="modal">
        <div class="modal-content">
            <h3 style="color: #ff1493;">⚙️ 방 설정하기</h3>
            <label style="font-size:12px; font-weight:bold;">방 제목</label>
            <input type="text" id="room-title" class="input-box" style="width:100%;" value="즐거운 포키파티 같이해요!">
            <label style="font-size:12px; font-weight:bold;">비밀번호 (선택)</label>
            <input type="password" id="room-pass" class="input-box" style="width:100%;" placeholder="비밀번호 없음">
            <label style="font-size:12px; font-weight:bold;">최대 인원</label>
            <select id="room-max" class="input-box" style="width:100%;"><option value="4">4명</option><option value="6" selected>6명</option><option value="8">8명</option></select>
            <label style="font-size:12px; font-weight:bold;">총 라운드</label>
            <select id="room-rounds" class="input-box" style="width:100%;"><option value="2">2 라운드</option><option value="3" selected>3 라운드</option><option value="5">5 라운드</option></select>
            <label style="font-size:12px; font-weight:bold;">제한시간</label>
            <select id="room-time" class="input-box" style="width:100%;"><option value="45">45초</option><option value="60" selected>60초</option><option value="90">90초</option></select>
            <label style="font-size:12px; font-weight:bold;">주제</label>
            <select id="room-category" class="input-box" style="width:100%;"><option value="all" selected>전체</option><option value="food">음식/디저트</option><option value="anime">애니/캐릭터</option><option value="meme">밈/유행어</option><option value="lol">롤(LoL)</option></select>
            <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 10px;">
                <button class="btn" style="background:#ccc;" onclick="closeCreateModal()">취소</button>
                <button class="btn" onclick="submitCreateRoom()">만들기</button>
            </div>
        </div>
    </div>

    <div id="shop-modal" class="modal">
        <div class="modal-content">
            <h3 style="color: #ff1493;">🛍️ 포키파티 상점</h3>
            <div id="shop-items-list" style="display: flex; flex-direction: column; gap: 8px;"></div>
            <button class="btn" style="background:#ccc; margin-top:10px;" onclick="closeShopModal()">닫기</button>
        </div>
    </div>

    <script src="/socket.io/socket.io.js"></script>
    <script>
        const socket = io();
        let currentColor = '#000000';
        let currentLineWidth = 1;
        let isDrawing = false;
        let canDraw = false;

        const canvas = document.getElementById('game-canvas');
        const ctx = canvas.getContext('2d');

        const COLORS = [
            '#000000', '#555555', '#aaaaaa', '#ffffff', '#ff0055', '#ff4081', '#e91e63', '#9c27b0', '#673ab7', '#3f51b5', '#2196f3', '#03a9f4', '#00bcd4',
            '#009688', '#4caf50', '#8bc34a', '#cddc39', '#ffeb3b', '#ffc107', '#ff9800', '#ff5722', '#795548', '#8d6e63', '#ff80ab', '#b388ff', '#ffd700'
        ];

        const paletteContainer = document.getElementById('palette-grid');
        COLORS.forEach((color, index) => {
            const dot = document.createElement('div');
            dot.className = 'color-dot' + (index === 0 ? ' active' : '');
            dot.style.backgroundColor = color;
            dot.onclick = () => setColor(color, dot);
            paletteContainer.appendChild(dot);
        });

        function showScreen(id) {
            document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
            document.getElementById(id).classList.add('active');
        }

        function handleLogin() {
            const username = document.getElementById('auth-username').value;
            const password = document.getElementById('auth-password').value;
            if (!username || !password) return alert("아이디/비밀번호를 입력하세요.");
            socket.emit('login', { username, password });
        }

        function handleRegister() {
            const username = document.getElementById('auth-username').value;
            const password = document.getElementById('auth-password').value;
            const nickname = document.getElementById('auth-nickname').value;
            if (!username || !password || !nickname) return alert("아이디, 비밀번호, 닉네임을 모두 입력하세요.");
            socket.emit('register', { username, password, nickname });
        }

        socket.on('authError', msg => alert(msg));
        socket.on('authSuccess', data => alert(data.message));

        socket.on('loginSuccess', user => {
            updateUserProfile(user);
            showScreen('lobby-screen');
        });

        function updateUserProfile(user) {
            document.getElementById('user-profile-info').innerHTML = `
                <b>${user.equipped?.badge || ''} <span style="color:${user.equipped?.color || '#000'}">${user.nickname}</span></b> (${user.username})<br>
                칭호: [${user.equipped?.title || '신입'}]<br>
                포인트: 🪙 <b>${user.points}pt</b>
            `;
        }

        socket.on('updateLobbyUsers', users => {
            const list = document.getElementById('lobby-user-list');
            list.innerHTML = '';
            users.forEach(u => {
                const item = document.createElement('div');
                item.style.fontSize = '12px';
                item.innerHTML = `🟢 ${u.equipped?.badge || ''} <span style="color:${u.equipped?.color || '#000'}; font-weight:bold;">${u.nickname}</span>`;
                list.appendChild(item);
            });
        });

        socket.on('updateRoomList', rooms => {
            const grid = document.getElementById('room-grid');
            grid.innerHTML = '';
            rooms.forEach(r => {
                const card = document.createElement('div');
                card.className = 'room-card';
                card.onclick = () => {
                    let pass = '';
                    if (r.isLocked) pass = prompt("비밀번호를 입력하세요:");
                    socket.emit('joinRoom', { roomId: r.id, password: pass });
                };
                card.innerHTML = `
                    <b>#${r.roomNum} ${r.title}</b> ${r.isLocked ? '🔒' : ''} ${r.isPlaying ? '[진행 중]' : ''}<br>
                    <small>주제: <b>${r.category.toUpperCase()}</b> | 인원: ${r.currentPlayers}/${r.maxPlayers} | ${r.totalRounds}R</small>
                `;
                grid.appendChild(card);
            });
        });

        function sendLobbyChat() {
            const input = document.getElementById('lobby-chat-input');
            if (!input.value.trim()) return;
            socket.emit('sendLobbyChat', input.value);
            input.value = '';
        }

        socket.on('lobbyChat', ({ sender, text, equipped }) => {
            const box = document.getElementById('lobby-chat-msgs');
            const msg = document.createElement('div');
            msg.innerHTML = `<b style="color:${equipped?.color || '#000'}">[${sender}]</b> ${text}`;
            box.appendChild(msg);
            box.scrollTop = box.scrollHeight;
        });

        // 상점
        const SHOP_ITEMS_CLIENT = [
            { id: 'title_artist', name: '🎨 피카소의 재래 (칭호)', price: 300 },
            { id: 'title_master', name: '👑 그림의 신 (칭호)', price: 800 },
            { id: 'color_pink', name: '💗 네온 핑크 닉네임', price: 400 },
            { id: 'color_gold', name: '✨ 황금빛 닉네임', price: 600 },
            { id: 'badge_angel', name: '👼 천사 아이콘', price: 350 },
            { id: 'badge_devil', name: '😈 악마 아이콘', price: 350 }
        ];

        function openShopModal() {
            const list = document.getElementById('shop-items-list');
            list.innerHTML = '';
            SHOP_ITEMS_CLIENT.forEach(i => {
                const card = document.createElement('div');
                card.className = 'shop-item-card';
                card.style.display = 'flex';
                card.style.justifyContent = 'space-between';
                card.style.padding = '6px';
                card.style.border = '2px solid #000';
                card.style.background = '#fff';
                card.innerHTML = `
                    <span><b>${i.name}</b> (${i.price}pt)</span>
                    <button class="btn" style="padding:4px 8px;" onclick="buyItem('${i.id}')">구매</button>
                `;
                list.appendChild(card);
            });
            document.getElementById('shop-modal').style.display = 'flex';
        }

        function closeShopModal() { document.getElementById('shop-modal').style.display = 'none'; }
        function buyItem(id) { socket.emit('buyItem', id); }

        socket.on('shopError', msg => alert(msg));
        socket.on('shopSuccess', ({ user, message }) => {
            alert(message);
            updateUserProfile(user);
        });

        function openCreateModal() { document.getElementById('create-modal').style.display = 'flex'; }
        function closeCreateModal() { document.getElementById('create-modal').style.display = 'none'; }

        function submitCreateRoom() {
            const title = document.getElementById('room-title').value;
            const password = document.getElementById('room-pass').value;
            const maxPlayers = document.getElementById('room-max').value;
            const totalRounds = document.getElementById('room-rounds').value;
            const roundTime = document.getElementById('room-time').value;
            const category = document.getElementById('room-category').value;

            socket.emit('createRoom', { title, password, maxPlayers, totalRounds, roundTime, category });
            closeCreateModal();
        }

        socket.on('joinError', msg => alert(msg));
        socket.on('roomJoined', () => showScreen('game-room'));
        socket.on('leftRoom', () => showScreen('lobby-screen'));

        function leaveRoom() { socket.emit('leaveRoom'); }
        function requestStartGame() { socket.emit('requestStartGame'); }

        socket.on('updatePlayers', ({ players, hostId, solvedPlayers = [], drawerId }) => {
            const list = document.getElementById('game-player-list');
            list.innerHTML = '';
            players.forEach(p => {
                const card = document.createElement('div');
                let className = 'player-card';
                if (p.id === drawerId) className += ' is-drawer';
                else if (solvedPlayers.includes(p.id)) className += ' is-solved';

                card.className = className;
                const isHost = p.id === hostId ? ' 👑' : '';
                const status = p.id === drawerId ? ' 🎨' : (solvedPlayers.includes(p.id) ? ' ✅' : '');
                card.innerHTML = `
                    <span>${p.equipped?.badge || ''} <b style="color:${p.equipped?.color || '#000'}">${p.name}</b>${isHost}${status}</span>
                    <b>${p.score}pt</b>
                `;
                list.appendChild(card);
            });

            document.getElementById('start-game-btn').style.display = (socket.id === hostId) ? 'block' : 'none';
        });

        socket.on('turnStart', ({ isDrawer, word, time, round, totalRounds }) => {
            canDraw = isDrawer;
            document.getElementById('word-display').innerText = `제시어: ${word}`;
            document.getElementById('timer-display').innerText = `⏳ 남은 시간: ${time}초`;
            document.getElementById('round-display').innerText = `ROUND ${round} / ${totalRounds}`;
            document.getElementById('geachu-btn').style.display = isDrawer ? 'none' : 'block';
        });

        socket.on('timerUpdate', time => {
            document.getElementById('timer-display').innerText = `⏳ 남은 시간: ${time}초`;
        });

        // 개추 전송
        function sendGaechu() {
            socket.emit('sendGaechu');
        }

        // 개추 시각 연출 효과
        socket.on('geachuEffect', ({ sender, drawerName }) => {
            const wrapper = document.getElementById('canvas-wrapper');
            const pop = document.createElement('div');
            pop.className = 'geachu-pop';
            pop.innerText = `👍 ${sender} 님의 개추! (+10pt)`;
            
            // 랜덤 위치 생성
            pop.style.left = (Math.random() * 300 + 100) + 'px';
            pop.style.top = (Math.random() * 200 + 150) + 'px';
            
            wrapper.appendChild(pop);
            setTimeout(() => pop.remove(), 1200);
        });

        socket.on('correctAnswerOverlay', ({ winner }) => {
            const overlay = document.getElementById('correct-overlay');
            document.getElementById('winner-name').innerText = winner;
            overlay.style.display = 'block';
            setTimeout(() => { overlay.style.display = 'none'; }, 2000);
        });

        // 캔버스 드로잉
        canvas.addEventListener('mousedown', (e) => {
            if (!canDraw) return;
            isDrawing = true;
            draw(e.offsetX, e.offsetY, false);
        });

        canvas.addEventListener('mousemove', (e) => {
            if (!isDrawing || !canDraw) return;
            draw(e.offsetX, e.offsetY, true);
        });

        canvas.addEventListener('mouseup', () => isDrawing = false);
        canvas.addEventListener('mouseleave', () => isDrawing = false);

        function draw(x, y, isDragging) {
            const drawData = { x, y, isDragging, color: currentColor, width: currentLineWidth };
            renderDraw(drawData);
            socket.emit('draw', drawData);
        }

        function renderDraw({ x, y, isDragging, color, width }) {
            ctx.strokeStyle = color;
            ctx.lineWidth = width;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            if (!isDragging) {
                ctx.beginPath();
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
                ctx.stroke();
            }
        }

        socket.on('draw', renderDraw);
        socket.on('clearCanvas', () => ctx.clearRect(0, 0, canvas.width, canvas.height));

        function clearCanvasAction() {
            if (!canDraw) return;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            socket.emit('clearCanvas');
        }

        function setColor(color, el) {
            currentColor = color;
            document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
            if (el) el.classList.add('active');
        }

        function setLineWidth(width, el) {
            currentLineWidth = width;
            document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
            if (el) el.classList.add('active');
        }

        function setEraser(el) {
            currentColor = '#ffffff';
            document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
            if (el) el.classList.add('active');
        }

        function sendChat() {
            const input = document.getElementById('chat-input');
            if (!input.value.trim()) return;
            socket.emit('chatMessage', input.value);
            input.value = '';
        }

        socket.on('chatMessage', ({ sender, text }) => {
            const box = document.getElementById('chat-messages');
            const msg = document.createElement('div');
            msg.className = 'chat-msg' + (sender.includes('SYSTEM') ? ' system' : '');
            msg.innerText = `[${sender}] ${text}`;
            box.appendChild(msg);
            box.scrollTop = box.scrollHeight;
        });
    </script>
</body>
</html>
    `;
}

server.listen(PORT, () => {
    console.log(`=================================================`);
    console.log(` Poki Party v1.3.0 Major Update! Port: ${PORT}`);
    console.log(`=================================================`);
});
