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

// 외부 wordsDB.json 파일 로드
function loadWordsDB() {
    try {
        if (!fs.existsSync(WORDS_PATH)) {
            return { food: ["떡볶이", "초밥"], anime: ["피카츄", "나루토"], meme: ["무야호"], lol: ["티모"], all: ["떡볶이", "초밥", "피카츄", "나루토", "무야호", "티모"] };
        }
        const raw = fs.readFileSync(WORDS_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        parsed.all = Array.from(new Set([
            ...(parsed.food || []),
            ...(parsed.anime || []),
            ...(parsed.meme || []),
            ...(parsed.lol || [])
        ]));
        return parsed;
    } catch (e) {
        return { food: [], anime: [], meme: [], lol: [], all: [] };
    }
}

let usersDB = loadUsersDB();
let wordsDB = loadWordsDB();

function getRandomWord(category, usedWords = []) {
    wordsDB = loadWordsDB();
    let list = wordsDB[category] || wordsDB.all;
    if (!list || list.length === 0) list = wordsDB.all;

    let available = list.filter(w => !usedWords.includes(w));
    if (available.length === 0) {
        available = list;
        usedWords.length = 0;
    }
    const randomIndex = Math.floor(Math.random() * available.length);
    const selected = available[randomIndex];
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

    // 회원가입
    socket.on('register', ({ username, password, nickname }) => {
        usersDB = loadUsersDB();
        if (usersDB[username]) {
            return socket.emit('authError', '이미 존재하는 아이디입니다.');
        }
        
        // 닉네임 중복 검사
        const isNicknameTaken = Object.values(usersDB).some(u => u.nickname === nickname);
        if (isNicknameTaken) {
            return socket.emit('authError', '이미 사용 중인 닉네임입니다.');
        }

        usersDB[username] = {
            username,
            password,
            nickname: nickname || username,
            points: 500,
            exp: 0,
            level: 1,
            inventory: [],
            equipped: { title: '신입', badge: '🔰' }
        };
        saveUsersDB(usersDB);
        socket.emit('authSuccess', { message: '회원가입 완료! 로그인 해주세요.' });
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
            return socket.emit('authError', '이미 다른 곳에서 접속 중인 계정입니다.');
        }

        currentUser.username = username;
        currentUser.nickname = user.nickname;
        lobbyUsers[socket.id] = { id: socket.id, username, ...user };

        socket.emit('loginSuccess', { username, ...user });
        io.emit('updateLobbyUsers', Object.values(lobbyUsers));
        socket.emit('updateRoomList', getPublicRoomList());
    });

    // 방 생성 (상세 옵션 수신)
    socket.on('createRoom', (config) => {
        if (!currentUser.username) return;

        const roomId = 'room_' + Date.now();
        rooms[roomId] = {
            id: roomId,
            roomNum: roomCounter++,
            title: config.title || '즐거운 포키파티!',
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

    socket.on('joinRoom', ({ roomId, password }) => {
        if (!currentUser.username) return;
        joinRoomAction(socket, roomId, password, currentUser);
    });

    function joinRoomAction(socket, roomId, password, currentUser) {
        const room = rooms[roomId];
        if (!room) return socket.emit('joinError', '존재하지 않는 방입니다.');
        if (room.password && room.password !== password) return socket.emit('joinError', '비밀번호가 올바르지 않습니다.');
        if (room.players.length >= room.maxPlayers) return socket.emit('joinError', '정원이 가득 찬 방입니다.');
        if (room.isPlaying) return socket.emit('joinError', '게임이 이미 진행 중입니다.');

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
            title: user.equipped?.title || '신입'
        };
        room.players.push(player);

        socket.emit('roomJoined', { ...room, isHost: room.hostId === socket.id });
        io.to(roomId).emit('updatePlayers', { players: room.players, hostId: room.hostId, solvedPlayers: room.solvedPlayers, drawerId: room.players[room.drawerIndex]?.id });
        io.to(roomId).emit('chatMessage', { sender: 'SYSTEM', text: `${currentUser.nickname} 님이 입장하셨습니다!` });
        io.emit('updateRoomList', getPublicRoomList());
    }

    socket.on('requestStartGame', () => {
        const roomId = currentUser.roomId;
        if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];

        if (room.hostId !== socket.id) return socket.emit('chatMessage', { sender: 'SYSTEM', text: '❌ 방장만 게임을 시작할 수 있습니다.' });
        if (room.players.length < 2) return socket.emit('chatMessage', { sender: 'SYSTEM', text: '❌ 최소 2명 이상이어야 시작 가능합니다.' });
        if (room.isPlaying) return;

        startGame(roomId);
    });

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
            const earnedScore = Math.max(150 - (solveOrder - 1) * 20, 50);

            const player = room.players.find(p => p.id === socket.id);
            if (player) player.score += earnedScore;

            io.to(roomId).emit('updatePlayers', { players: room.players, hostId: room.hostId, solvedPlayers: room.solvedPlayers, drawerId: room.players[room.drawerIndex]?.id });
            io.to(roomId).emit('correctAnswerOverlay', { winner: currentUser.nickname });
            io.to(roomId).emit('chatMessage', { sender: 'SYSTEM 🎉', text: `[${solveOrder}등] ${currentUser.nickname} 님 정답! (+${earnedScore}pt)` });

            if (room.solvedPlayers.length >= room.players.length - 1) {
                clearInterval(room.timer);
                setTimeout(() => nextTurn(roomId), 1500);
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
        const idx = room.players.findIndex(p => p.id === socket.id);

        if (idx !== -1) {
            room.players.splice(idx, 1);
            socket.leave(roomId);

            if (room.hostId === socket.id && room.players.length > 0) {
                room.hostId = room.players[0].id;
            }

            if (room.players.length === 0) {
                clearInterval(room.timer);
                delete rooms[roomId];
            } else {
                io.to(roomId).emit('updatePlayers', { players: room.players, hostId: room.hostId, solvedPlayers: room.solvedPlayers, drawerId: room.players[room.drawerIndex]?.id });
            }
        }

        currentUser.roomId = null;
        if (currentUser.username && usersDB[currentUser.username]) {
            lobbyUsers[socket.id] = { id: socket.id, username: currentUser.username, ...usersDB[currentUser.username] };
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
        io.to(roomId).emit('chatMessage', { sender: 'SYSTEM 🏆', text: `게임 종료! 1등: ${sorted[0]?.name || '없음'}님!` });
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

app.get('/', (req, res) => {
    res.send(getHTMLContent());
});

function getHTMLContent() {
    return `
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <title>Poki Party! - 포키파티</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'MapleStory', sans-serif, sans-serif; }
        body { background: #fce4ec; display: flex; justify-content: center; align-items: center; height: 100vh; overflow: hidden; }

        .screen { display: none; width: 980px; height: 680px; background: #fff; border-radius: 16px; box-shadow: 0 8px 24px rgba(0,0,0,0.12); border: 4px solid #f48fb1; padding: 16px; position: relative; }
        
        #auth-screen.active { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; }
        #loading-screen.active { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 20px; background: #fff0f5; }
        #lobby-screen.active { display: flex; gap: 16px; }
        
        /* 인게임 레이아웃: CSS Grid 정밀 계산으로 채팅창 뚫림 방지 */
        #game-room.active { 
            display: grid; 
            grid-template-columns: 200px 1fr 240px; 
            gap: 12px; 
            height: 100%; 
            width: 100%;
        }

        .input-box { width: 280px; padding: 10px; border: 2px solid #f48fb1; border-radius: 8px; outline: none; font-size: 14px; }
        .btn { padding: 8px 16px; background: #f06292; color: #fff; border: none; border-radius: 8px; cursor: pointer; font-weight: bold; font-size: 13px; }
        .btn:hover { background: #ec407a; }

        .spinner { width: 50px; height: 50px; border: 5px solid #f8bbd0; border-top: 5px solid #ec407a; border-radius: 50%; animation: spin 1s linear infinite; }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }

        .lobby-side { width: 240px; background: #fff5f8; border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 12px; border: 2px solid #f8bbd0; }
        .lobby-main { flex: 1; display: flex; flex-direction: column; gap: 12px; }
        .room-grid { flex: 1; display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; overflow-y: auto; max-height: 520px; }
        .room-card { background: #fff; border: 2px solid #f8bbd0; border-radius: 8px; padding: 12px; cursor: pointer; }
        .room-card:hover { border-color: #f06292; }

        .player-list { background: #fff5f8; border-radius: 10px; padding: 10px; display: flex; flex-direction: column; gap: 8px; border: 2px solid #f8bbd0; height: 100%; }
        .player-card { background: #fff; border: 2px solid #f8bbd0; padding: 8px; border-radius: 6px; font-size: 12px; display: flex; justify-content: space-between; }
        .player-card.is-drawer { background: #fff9c4; border-color: #fbc02d; font-weight: bold; }
        .player-card.is-solved { background: #c8e6c9; border-color: #4caf50; }

        .canvas-area { display: flex; flex-direction: column; align-items: center; gap: 6px; position: relative; height: 100%; }
        #canvas-wrapper { position: relative; border: 3px solid #f48fb1; border-radius: 8px; background: #fff; overflow: hidden; }
        canvas { display: block; cursor: crosshair; }

        /* 20개 이상의 풍성한 팔레트 스타일 */
        .palette-grid { display: flex; flex-wrap: wrap; gap: 4px; width: 480px; justify-content: center; background: #fff5f8; padding: 6px; border-radius: 8px; border: 2px solid #f8bbd0; }
        .color-dot { width: 20px; height: 20px; border-radius: 50%; cursor: pointer; border: 1.5px solid #ccc; transition: 0.1s; }
        .color-dot.active { border: 2px solid #000; transform: scale(1.25); }

        .tools-row { display: flex; gap: 6px; align-items: center; justify-content: center; width: 480px; margin-top: 2px; }
        .tool-btn { padding: 4px 8px; font-size: 11px; border: 1px solid #ccc; background: #fff; border-radius: 4px; cursor: pointer; }
        .tool-btn.active { background: #f06292; color: white; font-weight: bold; }

        /* 채팅창 레이아웃 - 뚫림 고침 */
        .chat-area { display: flex; flex-direction: column; background: #fff5f8; border-radius: 10px; padding: 10px; border: 2px solid #f8bbd0; height: 100%; overflow: hidden; }
        .chat-messages { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; font-size: 12px; padding-right: 4px; word-break: break-all; }
        .chat-msg { background: #fff; padding: 6px 8px; border-radius: 6px; border: 1px solid #ffe0b2; }
        .chat-msg.system { background: #e1f5fe; border-color: #81d4fa; color: #0277bd; font-weight: bold; }
        .chat-input-box { display: flex; gap: 4px; margin-top: 8px; height: 32px; }
        .chat-input-box input { flex: 1; padding: 4px 8px; border: 1px solid #f48fb1; border-radius: 4px; outline: none; font-size: 12px; }

        #correct-overlay { position: absolute; top: 10px; left: 50%; transform: translateX(-50%); background: rgba(76, 175, 80, 0.95); color: white; padding: 6px 16px; border-radius: 20px; font-weight: bold; display: none; z-index: 10; font-size: 13px; }

        /* 방 생성 모달 레이아웃 */
        .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.4); justify-content: center; align-items: center; z-index: 100; }
        .modal-content { background: #fff; padding: 20px; border-radius: 12px; border: 4px solid #f48fb1; width: 340px; display: flex; flex-direction: column; gap: 10px; }
        .modal-content label { font-size: 12px; font-weight: bold; color: #ad1457; }
        .modal-content input, .modal-content select { padding: 6px; border: 1px solid #f8bbd0; border-radius: 4px; outline: none; }
    </style>
</head>
<body>

    <!-- 1. Auth Screen -->
    <div id="auth-screen" class="screen active">
        <h1 style="color: #d81b60; font-size: 38px;">🎉 Poki Party!</h1>
        <p style="color: #888; font-size: 13px;">나만의 그림 퀴즈 파티에 오신 걸 환영합니다!</p>
        <input type="text" id="auth-username" class="input-box" placeholder="아이디">
        <input type="password" id="auth-password" class="input-box" placeholder="비밀번호">
        <input type="text" id="auth-nickname" class="input-box" placeholder="닉네임 (회원가입시 사용)">
        <div style="display: flex; gap: 10px; margin-top: 5px;">
            <button class="btn" onclick="handleLogin()">로그인</button>
            <button class="btn" style="background:#8e24aa;" onclick="handleRegister()">회원가입</button>
        </div>
    </div>

    <!-- 2. Loading Screen -->
    <div id="loading-screen" class="screen">
        <div class="spinner"></div>
        <h2 style="color: #d81b60; font-size: 26px;">🎉 포키파티에 오신 걸 환영합니다! 🎉</h2>
        <p style="color: #888; font-size: 14px;">로비 화면을 불러오고 있습니다...</p>
    </div>

    <!-- 3. Lobby Screen -->
    <div id="lobby-screen" class="screen">
        <div class="lobby-side">
            <h3 style="color: #ad1457;">👤 내 프로필</h3>
            <div id="user-profile-info" style="font-size: 13px; line-height: 1.6;"></div>
            <button class="btn" onclick="openCreateModal()">➕ 방 만들기</button>
        </div>
        <div class="lobby-main">
            <h3 style="color: #ad1457;">🏠 파티 방 목록</h3>
            <div id="room-grid" class="room-grid"></div>
        </div>
    </div>

    <!-- 4. Game Room Screen -->
    <div id="game-room" class="screen">
        <div class="player-list">
            <h4 style="text-align: center; color: #ad1457;">PLAYERS</h4>
            <div id="game-player-list" style="flex:1; overflow-y:auto;"></div>
            <button id="start-game-btn" class="btn" style="background: #4caf50; display:none;" onclick="requestStartGame()">▶️ 게임 시작</button>
        </div>

        <div class="canvas-area">
            <div style="display: flex; gap: 20px; align-items: center;">
                <div id="round-display" style="font-size: 14px; font-weight: bold; color: #8e24aa;">ROUND 1 / 3</div>
                <div id="timer-display" style="font-size: 16px; font-weight: bold; color: #d81b60;">⏳ 대기 중...</div>
            </div>
            <div id="word-display" style="font-size: 20px; font-weight: bold; color: #2e7d32;">제시어: ???</div>

            <div id="canvas-wrapper">
                <div id="correct-overlay">🎉 <span id="winner-name"></span> 님 정답!</div>
                <canvas id="game-canvas" width="480" height="380"></canvas>
            </div>

            <!-- 21개 알록달록 팔레트 -->
            <div class="palette-grid" id="palette-grid"></div>

            <div class="tools-row">
                <button class="tool-btn active" onclick="setLineWidth(2, this)">✏️ 얇게</button>
                <button class="tool-btn" onclick="setLineWidth(6, this)">✏️ 보통</button>
                <button class="tool-btn" onclick="setLineWidth(12, this)">✏️ 두껍게</button>
                <button class="tool-btn" onclick="setEraser(this)">🧹 지우개</button>
                <button class="tool-btn" onclick="clearCanvasAction()">🗑️ 전체지우기</button>
                <button class="tool-btn" style="background: #ff80ab; color: white;" onclick="leaveRoom()">🚪 나가기</button>
            </div>
        </div>

        <div class="chat-area">
            <div id="chat-messages" class="chat-messages"></div>
            <div class="chat-input-box">
                <input type="text" id="chat-input" placeholder="정답/채팅 입력..." onkeypress="if(event.key==='Enter') sendChat()">
                <button class="btn" style="padding: 4px 10px;" onclick="sendChat()">전송</button>
            </div>
        </div>
    </div>

    <!-- 방 만들기 설정 모달 -->
    <div id="create-modal" class="modal">
        <div class="modal-content">
            <h3 style="color: #d81b60;">⚙️ 방 설정하기</h3>
            <label>방 제목</label>
            <input type="text" id="room-title" value="신나는 포키파티 같이해요!">
            <label>비밀번호 (선택)</label>
            <input type="password" id="room-pass" placeholder="비밀번호 없음">
            <label>최대 인원</label>
            <select id="room-max">
                <option value="4">4명</option>
                <option value="6" selected>6명</option>
                <option value="8">8명</option>
            </select>
            <label>총 라운드</label>
            <select id="room-rounds">
                <option value="2">2 라운드</option>
                <option value="3" selected>3 라운드</option>
                <option value="5">5 라운드</option>
            </select>
            <label>제한시간</label>
            <select id="room-time">
                <option value="45">45초</option>
                <option value="60" selected>60초</option>
                <option value="90">90초</option>
            </select>
            <label>제시어 주제</label>
            <select id="room-category">
                <option value="all" selected>전체 (종합)</option>
                <option value="food">음식/디저트</option>
                <option value="anime">애니/캐릭터</option>
                <option value="meme">밈/유행어</option>
                <option value="lol">롤(LoL)</option>
            </select>
            <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 10px;">
                <button class="btn" style="background:#ccc;" onclick="closeCreateModal()">취소</button>
                <button class="btn" onclick="submitCreateRoom()">만들기</button>
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

        // 21개 풍성한 물감 색상 정의
        const COLORS = [
            '#000000', '#795548', '#888888', '#ffffff', 
            '#ff0000', '#ff5722', '#ff9800', '#ffc107', 
            '#ffeb3b', '#8bc34a', '#4caf50', '#009688', 
            '#00bcd4', '#03a9f4', '#2196f3', '#3f51b5', 
            '#673ab7', '#9c27b0', '#e91e63', '#f48fb1', '#ffd700'
        ];

        // 팔레트 동적 생성
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
            if (!username || !password) return alert("아이디/비밀번호를 입력해 주세요.");
            socket.emit('login', { username, password });
        }

        function handleRegister() {
            const username = document.getElementById('auth-username').value;
            const password = document.getElementById('auth-password').value;
            const nickname = document.getElementById('auth-nickname').value;
            if (!username || !password || !nickname) return alert("아이디, 비밀번호, 닉네임을 모두 입력해 주세요.");
            socket.emit('register', { username, password, nickname });
        }

        socket.on('authError', msg => alert(msg));
        socket.on('authSuccess', data => alert(data.message));

        socket.on('loginSuccess', user => {
            document.getElementById('user-profile-info').innerHTML = \`
                <b>\${user.nickname}</b> (\${user.username})<br>
                칭호: [\${user.equipped?.title || '신입'}]<br>
                포인트: 🪙 \${user.points}pt
            \`;
            showScreen('loading-screen');
            setTimeout(() => showScreen('lobby-screen'), 1200);
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
                card.innerHTML = \`
                    <b>#\${r.roomNum} \${r.title}</b> \${r.isLocked ? '🔒' : ''} \${r.isPlaying ? '[진행 중]' : ''}<br>
                    <small>주제: <b>\${r.category.toUpperCase()}</b> | 인원: \${r.currentPlayers}/\${r.maxPlayers} | \${r.totalRounds}라운드</small>
                \`;
                grid.appendChild(card);
            });
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
                card.innerHTML = \`<span>\${p.badge || ''}\${p.name}\${isHost}\${status}</span><b>\${p.score}pt</b>\`;
                list.appendChild(card);
            });

            document.getElementById('start-game-btn').style.display = (socket.id === hostId) ? 'block' : 'none';
        });

        socket.on('turnStart', ({ isDrawer, word, time, round, totalRounds }) => {
            canDraw = isDrawer;
            document.getElementById('word-display').innerText = \`제시어: \${word}\`;
            document.getElementById('timer-display').innerText = \`⏳ 남은 시간: \${time}초\`;
            document.getElementById('round-display').innerText = \`ROUND \${round} / \${totalRounds}\`;
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

        // 그림판 로직
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
    console.log(` Poki Party v1.1.0 Update Completed! Port: ${PORT}`);
    console.log(`=================================================`);
});
