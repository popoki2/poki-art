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

// 유저 DB 로드 / 저장
function loadUsersDB() {
    try {
        if (!fs.existsSync(DB_PATH)) {
            fs.writeFileSync(DB_PATH, JSON.stringify({}), 'utf8');
        }
        const data = fs.readFileSync(DB_PATH, 'utf8');
        return JSON.parse(data || '{}');
    } catch (e) {
        console.error("DB Load Error:", e);
        return {};
    }
}

function saveUsersDB(db) {
    try {
        fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
    } catch (e) {
        console.error("DB Save Error:", e);
    }
}

// 외부 wordsDB.json 파일 실시간 로드
function loadWordsDB() {
    try {
        if (!fs.existsSync(WORDS_PATH)) {
            console.error("❌ wordsDB.json 파일이 존재하지 않습니다!");
            return { food: [], anime: [], meme: [], lol: [], all: [] };
        }
        const raw = fs.readFileSync(WORDS_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        
        // 전체 단어 통합 (중복 제거)
        const allWords = Array.from(new Set([
            ...(parsed.food || []),
            ...(parsed.anime || []),
            ...(parsed.meme || []),
            ...(parsed.lol || [])
        ]));

        parsed.all = allWords;
        return parsed;
    } catch (e) {
        console.error("❌ wordsDB.json 파일 로드 오류:", e);
        return { food: [], anime: [], meme: [], lol: [], all: [] };
    }
}

let usersDB = loadUsersDB();
let wordsDB = loadWordsDB();

// 무작위 단어 추출 함수 (Fisher-Yates 기반)
function getRandomWord(category, usedWords = []) {
    // 제시어 JSON 다시 로드 (실시간 수정 가능)
    wordsDB = loadWordsDB();
    
    let list = wordsDB[category] || wordsDB.all;
    if (!list || list.length === 0) list = wordsDB.all;

    let available = list.filter(w => !usedWords.includes(w));
    if (available.length === 0) {
        available = list; // 모두 소비했으면 리셋
        usedWords.length = 0;
    }

    const randomIndex = Math.floor(Math.random() * available.length);
    const selected = available[randomIndex];
    usedWords.push(selected);
    return selected;
}

const rooms = {};
const lobbyUsers = {};

const SHOP_ITEMS = [
    { id: 'title_1', type: 'title', name: '🎨 화가', price: 100 },
    { id: 'badge_1', type: 'badge', name: '👑 왕관', price: 200 },
    { id: 'border_1', type: 'border', name: '✨ 황금 테두리', price: 500, style: 'border: 2px solid gold;' }
];

function getPublicRoomList() {
    return Object.values(rooms).map(r => ({
        id: r.id,
        roomNum: r.roomNum,
        title: r.title,
        category: r.category,
        currentPlayers: r.players.length,
        maxPlayers: r.maxPlayers,
        isLocked: !!r.password,
        isPlaying: r.isPlaying
    }));
}

let roomCounter = 1;

io.on('connection', (socket) => {
    let currentUser = { username: null, nickname: null, roomId: null };

    // 회원가입
    socket.on('register', ({ username, password, nickname }) => {
        usersDB = loadUsersDB();
        if (usersDB[username]) {
            return socket.emit('authError', '이미 존재하는 아이디입니다.');
        }
        usersDB[username] = {
            username,
            password,
            nickname: nickname || username,
            points: 500,
            exp: 0,
            level: 1,
            inventory: [],
            equipped: { title: '신입', badge: '🔰', borderStyle: '' }
        };
        saveUsersDB(usersDB);
        socket.emit('authSuccess', { message: '회원가입이 완료되었습니다! 로그인 해주세요.' });
    });

    // 로그인
    socket.on('login', ({ username, password }) => {
        usersDB = loadUsersDB();
        const user = usersDB[username];

        if (!user || user.password !== password) {
            return socket.emit('authError', '아이디 또는 비밀번호가 일치하지 않습니다.');
        }

        const isAlreadyLoggedIn = Object.values(lobbyUsers).some(u => u.username === username);
        if (isAlreadyLoggedIn) {
            return socket.emit('authError', '이미 접속 중인 계정입니다.');
        }

        currentUser.username = username;
        currentUser.nickname = user.nickname;

        lobbyUsers[socket.id] = { id: socket.id, username, ...user };

        socket.emit('loginSuccess', { username, ...user, shopCatalog: SHOP_ITEMS });
        io.emit('updateLobbyUsers', Object.values(lobbyUsers));
        socket.emit('updateRoomList', getPublicRoomList());
    });

    // 방 생성
    socket.on('createRoom', (roomConfig) => {
        if (!currentUser.username) return;
        
        const roomId = 'room_' + Date.now();
        rooms[roomId] = {
            id: roomId,
            roomNum: roomCounter++,
            title: roomConfig.title || '함께 그림 그려요!',
            password: roomConfig.password || '',
            maxPlayers: parseInt(roomConfig.maxPlayers) || 6,
            roundTime: parseInt(roomConfig.roundTime) || 60,
            category: roomConfig.category || 'all', // 테마: food, anime, meme, lol, all
            hostId: socket.id,
            players: [],
            drawerIndex: -1,
            currentWord: '',
            usedWords: [],
            timeLeft: 0,
            timer: null,
            isPlaying: false,
            solvedPlayers: [],
            canvasData: []
        };

        joinRoomAction(socket, roomId, roomConfig.password, currentUser);
    });

    // 방 입장
    socket.on('joinRoom', ({ roomId, password }) => {
        if (!currentUser.username) return;
        joinRoomAction(socket, roomId, password, currentUser);
    });

    function joinRoomAction(socket, roomId, password, currentUser) {
        const room = rooms[roomId];
        if (!room) return socket.emit('joinError', '존재하지 않는 방입니다.');
        if (room.password && room.password !== password) return socket.emit('joinError', '비밀번호가 일치하지 않습니다!');
        if (room.players.length >= room.maxPlayers) return socket.emit('joinError', '방 인원이 가득 찼습니다.');
        if (room.isPlaying) return socket.emit('joinError', '이미 게임이 진행 중인 방입니다.');

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
            badge: user.equipped?.badge || '🔰',
            title: user.equipped?.title || '신입',
            borderStyle: user.equipped?.borderStyle || ''
        };
        room.players.push(player);

        socket.emit('roomJoined', { ...room, isHost: room.hostId === socket.id });
        io.to(roomId).emit('updatePlayers', { players: room.players, hostId: room.hostId, solvedPlayers: room.solvedPlayers, drawerId: room.players[room.drawerIndex]?.id });
        io.to(roomId).emit('chatMessage', { sender: 'SYSTEM', text: `${currentUser.nickname} 님이 입장하셨습니다!` });
        io.emit('updateRoomList', getPublicRoomList());

        socket.emit('loadCanvas', room.canvasData || []);
    }

    // 게임 시작
    socket.on('requestStartGame', () => {
        const roomId = currentUser.roomId;
        if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];

        if (room.hostId !== socket.id) {
            return socket.emit('chatMessage', { sender: 'SYSTEM', text: '❌ 방장만 게임을 시작할 수 있습니다.' });
        }
        if (room.players.length < 2) {
            return socket.emit('chatMessage', { sender: 'SYSTEM', text: '❌ 최소 2명 이상의 플레이어가 필요합니다.' });
        }
        if (room.isPlaying) return;

        startGame(roomId);
    });

    // 그림 그리기 동기화
    socket.on('draw', (drawData) => {
        const roomId = currentUser.roomId;
        if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];

        if (room.players[room.drawerIndex]?.id === socket.id) {
            room.canvasData.push(drawData);
            socket.to(roomId).emit('draw', drawData);
        }
    });

    socket.on('clearCanvas', () => {
        const roomId = currentUser.roomId;
        if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];
        if (room.players[room.drawerIndex]?.id === socket.id) {
            room.canvasData = [];
            io.to(roomId).emit('clearCanvas');
        }
    });

    // 채팅 및 정답 채점
    socket.on('chatMessage', (msg) => {
        const roomId = currentUser.roomId;
        if (!roomId || !rooms[roomId]) {
            return io.emit('lobbyChat', { sender: currentUser.nickname, text: msg });
        }

        const room = rooms[roomId];
        const isDrawer = room.players[room.drawerIndex]?.id === socket.id;
        const isAlreadySolved = room.solvedPlayers.includes(socket.id);

        if (room.isPlaying && !isDrawer && !isAlreadySolved && msg.trim() === room.currentWord) {
            room.solvedPlayers.push(socket.id);

            const solveOrder = room.solvedPlayers.length;
            const baseScore = Math.max(150 - (solveOrder - 1) * 20, 50);
            const timeRatio = room.timeLeft / room.roundTime;
            const earnedScore = Math.max(Math.floor(baseScore * (0.5 + timeRatio * 0.5)), 30);

            const player = room.players.find(p => p.id === socket.id);
            if (player) player.score += earnedScore;

            const drawer = room.players[room.drawerIndex];
            if (drawer) drawer.score += 20;

            usersDB = loadUsersDB();
            if (usersDB[currentUser.username]) {
                const u = usersDB[currentUser.username];
                u.points += earnedScore;
                u.exp += Math.floor(earnedScore * 0.8);
                
                const neededExp = u.level * 100;
                if (u.exp >= neededExp) {
                    u.exp -= neededExp;
                    u.level += 1;
                    socket.emit('chatMessage', { sender: 'SYSTEM 🎊', text: `축하합니다! 레벨이 상승하여 [LV.${u.level}] 이 되었습니다!` });
                }
                saveUsersDB(usersDB);
                socket.emit('profileUpdated', u);
            }

            io.to(roomId).emit('updatePlayers', { 
                players: room.players, 
                hostId: room.hostId, 
                solvedPlayers: room.solvedPlayers, 
                drawerId: drawer?.id 
            });
            io.to(roomId).emit('correctAnswerOverlay', { winner: currentUser.nickname });
            io.to(roomId).emit('chatMessage', { 
                sender: 'SYSTEM 🎉', 
                text: `[${solveOrder}등 정답!] ${currentUser.nickname} 님이 정답을 맞혔습니다! (+${earnedScore}pt)` 
            });

            if (room.solvedPlayers.length >= room.players.length - 1) {
                clearTimeout(room.timer);
                nextTurn(roomId);
            }
            return;
        }

        io.to(roomId).emit('chatMessage', { sender: currentUser.nickname, text: msg });
    });

    socket.on('leaveRoom', () => { leaveCurrentRoom(socket); });
    socket.on('disconnect', () => {
        leaveCurrentRoom(socket);
        delete lobbyUsers[socket.id];
        io.emit('updateLobbyUsers', Object.values(lobbyUsers));
    });

    function leaveCurrentRoom(socket) {
        const roomId = currentUser.roomId;
        if (!roomId || !rooms[roomId]) return;

        const room = rooms[roomId];
        const playerIndex = room.players.findIndex(p => p.id === socket.id);

        if (playerIndex !== -1) {
            room.players.splice(playerIndex, 1);
            socket.leave(roomId);

            if (room.hostId === socket.id && room.players.length > 0) {
                room.hostId = room.players[0].id;
            }

            if (room.players.length === 0) {
                clearInterval(room.timer);
                delete rooms[roomId];
            } else {
                io.to(roomId).emit('updatePlayers', { 
                    players: room.players, 
                    hostId: room.hostId, 
                    solvedPlayers: room.solvedPlayers, 
                    drawerId: room.players[room.drawerIndex]?.id 
                });
            }
        }

        currentUser.roomId = null;
        lobbyUsers[socket.id] = { id: socket.id, username: currentUser.username, ...usersDB[currentUser.username] };
        
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
        room.isPlaying = false;
        const sorted = [...room.players].sort((a, b) => b.score - a.score);

        if (sorted[0] && usersDB[sorted[0].username]) {
            usersDB[sorted[0].username].points += 300;
            usersDB[sorted[0].username].exp += 100;
            saveUsersDB(usersDB);
        }

        io.to(roomId).emit('gameOver', sorted);
        io.emit('updateRoomList', getPublicRoomList());
        return;
    }

    const drawer = room.players[room.drawerIndex];
    // wordsDB.json에서 해당 카테고리(room.category)의 제시어를 무작위 선택
    room.currentWord = getRandomWord(room.category, room.usedWords);
    room.timeLeft = room.roundTime;

    io.to(roomId).emit('updatePlayers', { 
        players: room.players, 
        hostId: room.hostId, 
        solvedPlayers: room.solvedPlayers, 
        drawerId: drawer.id 
    });

    io.to(drawer.id).emit('turnStart', { isDrawer: true, word: room.currentWord, time: room.roundTime });
    
    room.players.forEach(p => {
        if (p.id !== drawer.id) {
            io.to(p.id).emit('turnStart', { isDrawer: false, word: '???', time: room.roundTime });
        }
    });

    clearInterval(room.timer);
    room.timer = setInterval(() => {
        room.timeLeft--;
        io.to(roomId).emit('timerUpdate', room.timeLeft);

        if (room.timeLeft <= 0) {
            clearInterval(room.timer);
            io.to(roomId).emit('chatMessage', { sender: 'SYSTEM ⏰', text: `시간 종료! 정답은 [ ${room.currentWord} ] 이었습니다.` });
            setTimeout(() => nextTurn(roomId), 3000);
        }
    }, 1000);
}

// 웹 페이지 제공
app.get('/', (req, res) => {
    res.send(getHTMLContent());
});

function getHTMLContent() {
    return `
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <title>Poki Party - Catch Mind</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'MapleStory', sans-serif, cursive; }
        body { background: #fce4ec; display: flex; justify-content: center; align-items: center; height: 100vh; overflow: hidden; }
        
        #auth-screen, #lobby-screen, #game-room { display: none; width: 950px; height: 680px; background: #fff; border-radius: 16px; box-shadow: 0 8px 24px rgba(0,0,0,0.15); border: 4px solid #f48fb1; padding: 20px; position: relative; }
        #auth-screen { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 15px; }

        .input-box { width: 280px; padding: 10px; border: 2px solid #f48fb1; border-radius: 8px; outline: none; font-size: 14px; }
        .btn { padding: 10px 20px; background: #f06292; color: #fff; border: none; border-radius: 8px; cursor: pointer; font-weight: bold; font-size: 14px; }
        .btn:hover { background: #ec407a; }

        #lobby-screen { display: flex; gap: 20px; }
        .lobby-side { width: 250px; background: #fff5f8; border-radius: 12px; padding: 15px; display: flex; flex-direction: column; gap: 15px; }
        .lobby-main { flex: 1; display: flex; flex-direction: column; gap: 15px; }
        .room-grid { flex: 1; display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; overflow-y: auto; max-height: 480px; }
        .room-card { background: #fff; border: 2px solid #f8bbd0; border-radius: 8px; padding: 12px; cursor: pointer; transition: 0.2s; }
        .room-card:hover { border-color: #f06292; transform: translateY(-2px); }

        #game-room { grid-template-columns: 200px 1fr 240px; gap: 12px; height: 680px; }
        
        .player-list { background: #fff5f8; border-radius: 10px; padding: 10px; display: flex; flex-direction: column; gap: 8px; overflow-y: auto; }
        .player-card { background: #fff; border: 2px solid #f8bbd0; padding: 8px; border-radius: 6px; font-size: 12px; display: flex; justify-content: space-between; align-items: center; }
        .player-card.is-drawer { background: #fff9c4; border-color: #fbc02d; font-weight: bold; }
        .player-card.is-solved { background: #c8e6c9; border-color: #4caf50; }

        .canvas-area { display: flex; flex-direction: column; align-items: center; gap: 8px; position: relative; }
        #canvas-wrapper { position: relative; border: 3px solid #f48fb1; border-radius: 8px; background: #fff; overflow: hidden; }
        canvas { display: block; cursor: crosshair; }
        
        .toolbar { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; width: 480px; justify-content: center; }
        .color-dot { width: 22px; height: 22px; border-radius: 50%; cursor: pointer; border: 2px solid #ddd; }
        .color-dot.active { border: 2px solid #000; transform: scale(1.15); }
        .tool-btn { padding: 4px 8px; font-size: 12px; border: 1px solid #ccc; background: #fff; border-radius: 4px; cursor: pointer; }
        .tool-btn.active { background: #f06292; color: white; font-weight: bold; }

        .chat-area { display: flex; flex-direction: column; background: #fff5f8; border-radius: 10px; padding: 10px; height: 100%; }
        .chat-messages { flex: 1; overflow-y: auto; max-height: 560px; display: flex; flex-direction: column; gap: 6px; font-size: 13px; padding-right: 4px; }
        .chat-msg { background: #fff; padding: 6px 10px; border-radius: 6px; word-break: break-all; border: 1px solid #ffe0b2; }
        .chat-msg.system { background: #e1f5fe; border-color: #81d4fa; color: #0277bd; font-weight: bold; }
        .chat-input-box { display: flex; gap: 4px; margin-top: 8px; }
        .chat-input-box input { flex: 1; padding: 6px; border: 1px solid #f48fb1; border-radius: 4px; outline: none; }

        #correct-overlay { position: absolute; top: 10px; left: 50%; transform: translateX(-50%); background: rgba(76, 175, 80, 0.9); color: white; padding: 6px 16px; border-radius: 20px; font-weight: bold; display: none; z-index: 10; font-size: 14px; }
    </style>
</head>
<body>

    <div id="auth-screen">
        <h1 style="color: #d81b60;">🎨 Poki Party!</h1>
        <input type="text" id="auth-username" class="input-box" placeholder="아이디">
        <input type="password" id="auth-password" class="input-box" placeholder="비밀번호">
        <input type="text" id="auth-nickname" class="input-box" placeholder="닉네임 (회원가입 시)">
        <div style="display: flex; gap: 10px;">
            <button class="btn" onclick="handleLogin()">로그인</button>
            <button class="btn" style="background:#8e24aa;" onclick="handleRegister()">회원가입</button>
        </div>
    </div>

    <div id="lobby-screen">
        <div class="lobby-side">
            <h3>👤 프로필</h3>
            <div id="user-profile-info" style="font-size: 13px; line-height: 1.6;"></div>
            <button class="btn" onclick="showCreateRoomModal()">➕ 방 만들기</button>
            <button class="btn" style="background: #7cb342;" onclick="quickJoin()">⚡ 빠른 입장</button>
        </div>
        <div class="lobby-main">
            <h3>🏠 게임 방 목록</h3>
            <div id="room-grid" class="room-grid"></div>
        </div>
    </div>

    <div id="game-room">
        <div class="player-list">
            <h4 style="text-align: center; color: #ad1457;">PLAYERS</h4>
            <div id="game-player-list"></div>
            <button id="start-game-btn" class="btn" style="background: #4caf50; display:none;" onclick="requestStartGame()">▶️ 게임 시작</button>
        </div>

        <div class="canvas-area">
            <div id="timer-display" style="font-size: 18px; font-weight: bold; color: #d81b60;">⏳ 대기 중...</div>
            <div id="word-display" style="font-size: 20px; font-weight: bold; color: #2e7d32;">제시어: ???</div>

            <div id="canvas-wrapper">
                <div id="correct-overlay">🎉 <span id="winner-name"></span> 님 정답!</div>
                <canvas id="game-canvas" width="480" height="400"></canvas>
            </div>

            <div class="toolbar">
                <div class="color-dot active" style="background: #000000;" onclick="setColor('#000000', this)"></div>
                <div class="color-dot" style="background: #ff0000;" onclick="setColor('#ff0000', this)"></div>
                <div class="color-dot" style="background: #ff7f00;" onclick="setColor('#ff7f00', this)"></div>
                <div class="color-dot" style="background: #ffff00;" onclick="setColor('#ffff00', this)"></div>
                <div class="color-dot" style="background: #00ff00;" onclick="setColor('#00ff00', this)"></div>
                <div class="color-dot" style="background: #0000ff;" onclick="setColor('#0000ff', this)"></div>
                <div class="color-dot" style="background: #4b0082;" onclick="setColor('#4b0082', this)"></div>
                <div class="color-dot" style="background: #8b00ff;" onclick="setColor('#8b00ff', this)"></div>
                <div class="color-dot" style="background: #ffffff;" onclick="setColor('#ffffff', this)"></div>

                <button class="tool-btn active" id="size-2" onclick="setLineWidth(2, this)">✏️ 얇게</button>
                <button class="tool-btn" id="size-6" onclick="setLineWidth(6, this)">✏️ 보통</button>
                <button class="tool-btn" id="size-12" onclick="setLineWidth(12, this)">✏️ 두껍게</button>
                <button class="tool-btn" onclick="setEraser(this)">🧹 지우개</button>
                <button class="tool-btn" onclick="clearCanvasAction()">🗑️ 전체지우기</button>
                <button class="tool-btn" style="background: #ff80ab; color: white;" onclick="leaveRoom()">🚪 나가기</button>
            </div>
        </div>

        <div class="chat-area">
            <div id="chat-messages" class="chat-messages"></div>
            <div class="chat-input-box">
                <input type="text" id="chat-input" placeholder="정답 또는 채팅 입력..." onkeypress="if(event.key==='Enter') sendChat()">
                <button class="btn" style="padding: 6px 12px;" onclick="sendChat()">전송</button>
            </div>
        </div>
    </div>

    <script src="/socket.io/socket.io.js"></script>
    <script>
        const socket = io();
        let currentColor = '#000000';
        let currentLineWidth = 2;
        let isDrawing = false;
        let canDraw = false;

        const canvas = document.getElementById('game-canvas');
        const ctx = canvas.getContext('2d');

        function handleLogin() {
            const username = document.getElementById('auth-username').value;
            const password = document.getElementById('auth-password').value;
            socket.emit('login', { username, password });
        }

        function handleRegister() {
            const username = document.getElementById('auth-username').value;
            const password = document.getElementById('auth-password').value;
            const nickname = document.getElementById('auth-nickname').value;
            socket.emit('register', { username, password, nickname });
        }

        socket.on('authError', msg => alert(msg));
        socket.on('authSuccess', data => alert(data.message));

        socket.on('loginSuccess', user => {
            document.getElementById('auth-screen').style.display = 'none';
            document.getElementById('lobby-screen').style.display = 'flex';
            updateProfileUI(user);
        });

        function updateProfileUI(u) {
            document.getElementById('user-profile-info').innerHTML = \`
                <b>\${u.nickname}</b> (\${u.username})<br>
                칭호: [\${u.equipped?.title || '신입'}]<br>
                레벨: LV.\${u.level} | EXP: \${u.exp}<br>
                포인트: 🪙 \${u.points}pt
            \`;
        }

        socket.on('updateRoomList', rooms => {
            const grid = document.getElementById('room-grid');
            grid.innerHTML = '';
            rooms.forEach(r => {
                const card = document.createElement('div');
                card.className = 'room-card';
                card.onclick = () => socket.emit('joinRoom', { roomId: r.id, password: '' });
                card.innerHTML = \`
                    <b>#\${r.roomNum} \${r.title}</b> \${r.isLocked ? '🔒' : ''} \${r.isPlaying ? '[게임 중]' : ''}<br>
                    <small>주제: <b>\${r.category.toUpperCase()}</b> | 인원: \${r.currentPlayers}/\${r.maxPlayers}</small>
                \`;
                grid.appendChild(card);
            });
        });

        function showCreateRoomModal() {
            const title = prompt("방 제목을 입력하세요:", "재미있는 그림 퀴즈!");
            if (!title) return;
            const category = prompt("카테고리를 선택하세요 (all, food, anime, meme, lol):", "all");
            socket.emit('createRoom', { title, category: category ? category.toLowerCase() : 'all', maxPlayers: 6, roundTime: 60 });
        }

        function quickJoin() {
            socket.emit('joinRoom', { roomId: 'quick', password: '' });
        }

        socket.on('joinError', msg => alert(msg));

        socket.on('roomJoined', room => {
            document.getElementById('lobby-screen').style.display = 'none';
            document.getElementById('game-room').style.display = 'grid';
        });

        socket.on('leftRoom', () => {
            document.getElementById('game-room').style.display = 'none';
            document.getElementById('lobby-screen').style.display = 'flex';
        });

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
                const statusTag = p.id === drawerId ? ' 🎨' : (solvedPlayers.includes(p.id) ? ' ✅' : '');

                card.innerHTML = \`<span>\${p.badge || ''}\${p.name}\${isHost}\${statusTag}</span><b>\${p.score}pt</b>\`;
                list.appendChild(card);
            });

            document.getElementById('start-game-btn').style.display = (socket.id === hostId) ? 'block' : 'none';
        });

        socket.on('turnStart', ({ isDrawer, word, time }) => {
            canDraw = isDrawer;
            document.getElementById('word-display').innerText = \`제시어: \${word}\`;
            document.getElementById('timer-display').innerText = \`⏳ 남은 시간: \${time}초\`;
        });

        socket.on('timerUpdate', time => {
            document.getElementById('timer-display').innerText = \`⏳ 남은 시간: \${time}초\`;
        });

        socket.on('correctAnswerOverlay', ({ winner }) => {
            const overlay = document.getElementById('correct-overlay');
            document.getElementById('winner-name').innerText = winner;
            overlay.style.display = 'block';
            setTimeout(() => { overlay.style.display = 'none'; }, 2000);
        });

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
        socket.on('loadCanvas', (canvasData) => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            canvasData.forEach(renderDraw);
        });

        socket.on('clearCanvas', () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        });

        function clearCanvasAction() {
            if (!canDraw) return;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            socket.emit('clearCanvas');
        }

        function setColor(color, el) {
            currentColor = color;
            document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
            if(el) el.classList.add('active');
        }

        function setLineWidth(width, el) {
            currentLineWidth = width;
            document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
            if(el) el.classList.add('active');
        }

        function setEraser(el) {
            currentColor = '#ffffff';
            document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
            if(el) el.classList.add('active');
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
            msg.innerText = \`[\${sender}] \${text}\`;
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
    console.log(` Poki Party (wordsDB.json 연동 완료!) 실행 중 (Port: ${PORT})`);
    console.log(`=================================================`);
});
