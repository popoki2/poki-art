const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ==========================================
// 📁 파일 기반 데이터베이스 (JSON File DB)
// ==========================================
const USERS_DB_PATH = path.join(__dirname, 'usersDB.json');
const WORDS_DB_PATH = path.join(__dirname, 'wordsDB.json');

// 유저 DB 불러오기 / 저장 함수
function loadUsersDB() {
    try {
        if (!fs.existsSync(USERS_DB_PATH)) fs.writeFileSync(USERS_DB_PATH, '{}', 'utf8');
        return JSON.parse(fs.readFileSync(USERS_DB_PATH, 'utf8'));
    } catch (e) {
        console.error("유저 DB 로드 실패:", e);
        return {};
    }
}

function saveUsersDB(data) {
    try {
        fs.writeFileSync(USERS_DB_PATH, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        console.error("유저 DB 저장 실패:", e);
    }
}

// 제시어 DB 불러오기 함수
function loadWordsDB() {
    try {
        if (!fs.existsSync(WORDS_DB_PATH)) {
            console.error("wordsDB.json 파일이 존재하지 않습니다!");
            return { food: [], anime: [], meme: [], lol: [] };
        }
        const data = JSON.parse(fs.readFileSync(WORDS_DB_PATH, 'utf8'));
        // 전체(all) 카테고리 자동 합성 및 중복 제거
        data.all = Array.from(new Set([
            ...(data.food || []),
            ...(data.anime || []),
            ...(data.meme || []),
            ...(data.lol || [])
        ]));
        return data;
    } catch (e) {
        console.error("제시어 DB 로드 실패:", e);
        return { food: [], anime: [], meme: [], lol: [], all: [] };
    }
}

let usersDB = loadUsersDB();
let wordDatabase = loadWordsDB();

const lobbyUsers = {};
const rooms = {};
let roomCounter = 500;

app.get('*', (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(getHTMLContent());
});

io.on('connection', (socket) => {
    let currentUser = { id: socket.id, username: '', nickname: '', roomId: null, lastMsgTime: 0, lastMsgText: '' };

    socket.on('register', ({ username, password, nickname }) => {
        usersDB = loadUsersDB(); // 실시간 파일 싱크
        const nickRegex = /^[a-zA-Z0-9가-힣]{2,8}$/;
        if (!nickRegex.test(nickname)) {
            socket.emit('authError', '닉네임은 2~8자의 한글, 영문, 숫자만 사용 가능합니다.');
            return;
        }
        if (!username || username.length < 3) {
            socket.emit('authError', '아이디는 3자 이상이어야 합니다.');
            return;
        }
        if (usersDB[username]) {
            socket.emit('authError', '이미 존재하는 아이디입니다.');
            return;
        }

        usersDB[username] = {
            password,
            nickname,
            points: 100,
            exp: 0,
            level: 1,
            title: '신입 포키',
            badge: '🔰'
        };
        saveUsersDB(usersDB);

        socket.emit('authSuccess', { message: '회원가입 성공! 로그인해 주세요.' });
    });

    socket.on('login', ({ username, password }) => {
        usersDB = loadUsersDB(); // 최신 DB 로드
        const user = usersDB[username];
        if (!user || user.password !== password) {
            socket.emit('authError', '아이디 또는 비밀번호가 올바르지 않습니다.');
            return;
        }

        currentUser.username = username;
        currentUser.nickname = user.nickname;
        lobbyUsers[socket.id] = { id: socket.id, ...user };

        socket.emit('loginSuccess', { username, ...user });
        io.emit('updateLobbyUsers', Object.values(lobbyUsers));
        socket.emit('updateRoomList', getPublicRoomList());
    });

    socket.on('lobbyChat', (msg) => {
        if (!currentUser.nickname) return;
        if (checkSpam(socket, currentUser, msg)) return;

        io.emit('lobbyChat', { sender: currentUser.nickname, text: msg });
    });

    socket.on('createRoom', (roomConfig) => {
        roomCounter++;
        const roomId = 'ROOM_' + roomCounter;

        rooms[roomId] = {
            id: roomId,
            roomNum: roomCounter,
            title: roomConfig.title || `${currentUser.nickname}님의 방`,
            password: roomConfig.password || '',
            maxPlayers: parseInt(roomConfig.maxPlayers) || 6,
            roundTime: parseInt(roomConfig.roundTime) || 60,
            category: roomConfig.category || 'all',
            players: [],
            drawerIndex: -1,
            currentWord: '',
            timer: null,
            timeLeft: 60,
            isPlaying: false,
            currentRound: 0,
            maxRounds: 3,
            solvedPlayers: []
        };

        socket.emit('roomCreated', { roomId, password: roomConfig.password });
        io.emit('updateRoomList', getPublicRoomList());
    });

    socket.on('joinRoom', ({ roomId, password }) => {
        const room = rooms[roomId];
        if (!room) return socket.emit('joinError', '존재하지 않는 방입니다.');
        if (room.password && room.password !== password) return socket.emit('joinError', '비밀번호가 일치하지 않습니다!');
        if (room.players.length >= room.maxPlayers) return socket.emit('joinError', '방 인원이 가득 찼습니다.');

        delete lobbyUsers[socket.id];
        io.emit('updateLobbyUsers', Object.values(lobbyUsers));

        currentUser.roomId = roomId;
        socket.join(roomId);

        const player = { id: socket.id, name: currentUser.nickname, score: 0, username: currentUser.username };
        room.players.push(player);

        socket.emit('roomJoined', room);
        io.to(roomId).emit('updatePlayers', room.players);
        io.to(roomId).emit('chatMessage', { sender: 'SYSTEM', text: `${currentUser.nickname} 님이 입장하셨습니다!` });
        io.emit('updateRoomList', getPublicRoomList());

        if (room.players.length >= 2 && !room.isPlaying) {
            startGame(roomId);
        }
    });

    socket.on('leaveRoom', () => {
        leaveCurrentRoom(socket);
    });

    socket.on('draw', (data) => {
        if (currentUser.roomId) socket.to(currentUser.roomId).emit('draw', data);
    });
    socket.on('clearCanvas', () => {
        if (currentUser.roomId) io.to(currentUser.roomId).emit('clearCanvas');
    });
    socket.on('fillCanvas', (color) => {
        if (currentUser.roomId) io.to(currentUser.roomId).emit('fillCanvas', color);
    });

    socket.on('chatMessage', (msg) => {
        const roomId = currentUser.roomId;
        if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];
        const drawer = room.players[room.drawerIndex];

        if (checkSpam(socket, currentUser, msg)) return;

        if (room.isPlaying && drawer && drawer.id === socket.id) {
            socket.emit('chatMessage', { sender: 'SYSTEM', text: '❌ 당신은 출제자입니다! 채팅이 제한됩니다.' });
            return;
        }

        if (room.isPlaying && room.solvedPlayers.includes(socket.id)) {
            socket.emit('chatMessage', { sender: 'SYSTEM', text: '❌ 이미 정답을 맞히셨습니다!' });
            return;
        }

        if (room.isPlaying && msg.trim() === room.currentWord) {
            const player = room.players.find(p => p.id === socket.id);
            if (player) {
                room.solvedPlayers.push(socket.id);

                const points = Math.max(150 - (room.solvedPlayers.length - 1) * 30, 50);
                player.score += points;
                if (drawer) drawer.score += 30;

                // 유저 파일 DB 보상 반영 및 파일 저장
                usersDB = loadUsersDB();
                if (usersDB[currentUser.username]) {
                    usersDB[currentUser.username].points += Math.floor(points / 2);
                    usersDB[currentUser.username].exp += 20;
                    saveUsersDB(usersDB);
                }

                io.to(roomId).emit('updatePlayers', room.players);
                io.to(roomId).emit('correctAnswerOverlay', { winner: currentUser.nickname, word: room.currentWord });
                io.to(roomId).emit('chatMessage', { 
                    sender: 'SYSTEM', 
                    text: `🎉 [정답!] ${currentUser.nickname} 님이 정답(${room.currentWord})을 맞히셨습니다! (+${points}pt)` 
                });

                if (room.solvedPlayers.length >= room.players.length - 1) {
                    nextTurn(roomId);
                }
            }
        } else {
            io.to(roomId).emit('chatMessage', { sender: currentUser.nickname, text: msg });
        }
    });

    socket.on('disconnect', () => {
        delete lobbyUsers[socket.id];
        io.emit('updateLobbyUsers', Object.values(lobbyUsers));
        leaveCurrentRoom(socket);
    });
});

function checkSpam(socket, user, msg) {
    const now = Date.now();
    if (now - user.lastMsgTime < 800) {
        socket.emit('chatMessage', { sender: 'SYSTEM ⚠️', text: '채팅이 너무 빠릅니다! 천천히 입력해 주세요.' });
        return true;
    }
    if (user.lastMsgText === msg && msg.length > 2) {
        socket.emit('chatMessage', { sender: 'SYSTEM ⚠️', text: '동일한 메시지를 연속으로 보낼 수 없습니다.' });
        return true;
    }
    user.lastMsgTime = now;
    user.lastMsgText = msg;
    return false;
}

function leaveCurrentRoom(socket) {
    for (const roomId in rooms) {
        const room = rooms[roomId];
        const playerIndex = room.players.findIndex(p => p.id === socket.id);
        if (playerIndex !== -1) {
            room.players.splice(playerIndex, 1);
            socket.leave(roomId);
            
            io.to(roomId).emit('updatePlayers', room.players);
            io.to(roomId).emit('chatMessage', { sender: 'SYSTEM', text: `누군가가 퇴장하셨습니다.` });

            if (room.players.length === 0) {
                clearInterval(room.timer);
                delete rooms[roomId];
            } else if (room.players.length < 2 && room.isPlaying) {
                clearInterval(room.timer);
                room.isPlaying = false;
                io.to(roomId).emit('chatMessage', { sender: 'SYSTEM', text: '인원이 부족하여 대기 상태로 전환됩니다.' });
            }
            
            io.emit('updateRoomList', getPublicRoomList());
            break;
        }
    }
}

function getPublicRoomList() {
    return Object.values(rooms).map(r => ({
        id: r.id,
        roomNum: r.roomNum,
        title: r.title,
        isLocked: !!r.password,
        currentPlayers: r.players.length,
        maxPlayers: r.maxPlayers,
        category: r.category,
        isPlaying: r.isPlaying
    }));
}

function startGame(roomId) {
    const room = rooms[roomId];
    if (!room) return;
    room.isPlaying = true;
    room.currentRound = 1;
    room.drawerIndex = -1;
    nextTurn(roomId);
}

function nextTurn(roomId) {
    const room = rooms[roomId];
    if (!room || room.players.length === 0) return;

    clearInterval(room.timer);
    room.solvedPlayers = [];
    room.drawerIndex++;

    if (room.drawerIndex >= room.players.length) {
        room.drawerIndex = 0;
        room.currentRound++;
    }

    if (room.currentRound > room.maxRounds) {
        room.isPlaying = false;
        const sorted = [...room.players].sort((a, b) => b.score - a.score);
        
        usersDB = loadUsersDB();
        if (sorted[0] && usersDB[sorted[0].username]) {
            usersDB[sorted[0].username].points += 300;
            usersDB[sorted[0].username].exp += 100;
            saveUsersDB(usersDB);
        }

        io.to(roomId).emit('gameOver', sorted);
        return;
    }

    const drawer = room.players[room.drawerIndex];
    
    // 파일 DB 기반 제시어 추출
    wordDatabase = loadWordsDB();
    const categoryList = wordDatabase[room.category] || wordDatabase.all;

    room.currentWord = categoryList[Math.floor(Math.random() * categoryList.length)];
    room.timeLeft = room.roundTime;

    io.to(roomId).emit('clearCanvas');

    const lengthHint = "_ ".repeat(room.currentWord.length).trim();

    room.players.forEach(p => {
        const isDrawer = (p.id === drawer.id);
        io.to(p.id).emit('turnStart', { 
            isDrawer, 
            word: isDrawer ? room.currentWord : lengthHint, 
            drawerName: drawer.name,
            round: room.currentRound,
            maxRounds: room.maxRounds
        });
    });

    room.timer = setInterval(() => {
        room.timeLeft--;
        io.to(roomId).emit('timerUpdate', room.timeLeft);

        if (room.timeLeft <= 0) {
            clearInterval(room.timer);
            io.to(roomId).emit('chatMessage', { sender: 'SYSTEM', text: `⏰ 시간 초과! 정답은 [ ${room.currentWord} ] 이었습니다.` });
            setTimeout(() => nextTurn(roomId), 2000);
        }
    }, 1000);
}

function getHTMLContent() {
    return `<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ポキパティ！！ (Poki Party)</title>
    <script src="/socket.io/socket.io.js"></script>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=DungGeunMo&family=Noto+Sans+KR:wght@500;700;900&display=swap');
        
        * { box-sizing: border-box; font-family: 'Noto Sans KR', sans-serif; user-select: none; }
        
        body {
            margin: 0; padding: 10px; background: #fce4ec;
            background-image: radial-gradient(#f8bbd0 15%, transparent 16%), radial-gradient(#f8bbd0 15%, transparent 16%);
            background-size: 20px 20px; background-position: 0 0, 10px 10px;
            color: #4a148c; display: flex; flex-direction: column; align-items: center; min-height: 100vh;
        }

        .pixel-box {
            background: #ffffff; border: 3px solid #f06292;
            box-shadow: 4px 4px 0px #ba68c8; border-radius: 8px; overflow: hidden;
        }
        
        .window-header {
            background: linear-gradient(90deg, #ff80ab, #ea80fc);
            padding: 8px 12px; color: #fff; font-weight: 900; font-family: 'DungGeunMo';
            display: flex; justify-content: space-between; align-items: center;
            border-bottom: 2px solid #f06292; text-shadow: 1px 1px 0px #c2185b;
        }

        .modal {
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            background: rgba(74, 20, 140, 0.4); display: flex; justify-content: center; align-items: center; z-index: 999;
        }
        .modal-body { width: 380px; padding: 18px; background: #fff; display: flex; flex-direction: column; gap: 12px; }
        .form-group { display: flex; flex-direction: column; gap: 4px; font-size: 12px; font-weight: bold; }
        input[type="text"], input[type="password"], select {
            border: 2px solid #f06292; border-radius: 4px; padding: 6px; font-weight: bold; outline: none; background: #fff;
        }

        #lobby-screen { width: 100%; max-width: 1000px; display: none; flex-direction: column; gap: 10px; }
        #lobby-main { display: flex; gap: 10px; height: 420px; }
        #lobby-left { width: 220px; display: flex; flex-direction: column; gap: 10px; }
        #user-list-box { flex: 1; overflow-y: auto; padding: 8px; background: #fff0f5; }
        .user-item { padding: 4px 8px; font-size: 13px; font-weight: bold; color: #880e4f; border-bottom: 1px dashed #f8bbd0; }
        
        #my-profile { padding: 10px; background: #f3e5f5; display: flex; flex-direction: column; gap: 4px; }
        .profile-badge { font-size: 11px; color: #7b1fa2; font-weight: bold; background: #e1bee7; padding: 2px 6px; border-radius: 4px; width: fit-content; }

        #lobby-center { flex: 1; display: flex; flex-direction: column; gap: 8px; }
        #category-bar { display: flex; gap: 6px; }
        .tab-btn {
            background: #ff80ab; color: #fff; border: 2px solid #c2185b; padding: 6px 14px;
            font-weight: bold; border-radius: 6px 6px 0 0; cursor: pointer; box-shadow: 2px 2px 0 #880e4f;
        }
        .tab-btn:hover { background: #ff4081; }

        #room-grid {
            flex: 1; background: #fff; border: 2px solid #f06292; padding: 10px;
            display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: repeat(3, 100px); gap: 10px;
            overflow-y: auto;
        }
        
        .room-card {
            background: #fff5f8; border: 2px solid #ea80fc; border-radius: 6px; padding: 10px;
            display: flex; flex-direction: column; justify-content: space-between; cursor: pointer;
            box-shadow: 3px 3px 0 #ce93d8; transition: transform 0.1s;
        }
        .room-card:hover { transform: translateY(-2px); background: #f3e5f5; }

        #lobby-bottom { height: 150px; display: flex; flex-direction: column; }
        #lobby-chat { flex: 1; background: #fafafa; overflow-y: auto; padding: 8px; font-size: 13px; }

        #game-screen { width: 100%; max-width: 1000px; display: none; flex-direction: column; gap: 8px; }
        #game-header { display: flex; justify-content: space-between; align-items: center; padding: 6px 14px; }
        
        .word-hint-box {
            background: #fff; border: 2px solid #ff4081; padding: 4px 24px; border-radius: 20px;
            color: #d81b60; font-size: 22px; font-weight: 900; letter-spacing: 4px; font-family: 'DungGeunMo';
            box-shadow: 2px 2px 0 #f8bbd0;
        }

        #game-main { display: flex; gap: 10px; }
        #game-players { width: 200px; padding: 6px; background: #fff0f5; display: flex; flex-direction: column; justify-content: space-between; }
        .player-card {
            background: #fff; border: 2px solid #ea80fc; padding: 6px; margin-bottom: 6px;
            border-radius: 6px; display: flex; justify-content: space-between; font-weight: bold; font-size: 13px;
        }

        .poki-logo-box {
            background: linear-gradient(135deg, #ff80ab, #ea80fc); color: #fff; text-align: center;
            padding: 10px; border-radius: 6px; font-family: 'DungGeunMo'; font-size: 18px; font-weight: 900;
            text-shadow: 1px 1px 0px #c2185b; border: 2px solid #f06292; margin-top: 10px;
        }

        #canvas-container { flex: 1; display: flex; flex-direction: column; align-items: center; }
        canvas { background: #ffffff; border: 3px solid #ff80ab; border-radius: 8px; cursor: crosshair; box-shadow: 4px 4px 0 #ea80fc; }
        
        #toolbar {
            width: 100%; margin-top: 6px; display: flex; justify-content: space-between; align-items: center;
            background: #fff; border: 2px solid #f06292; padding: 6px; border-radius: 6px;
        }
        .palette { display: flex; gap: 3px; max-width: 250px; flex-wrap: wrap; }
        .color-dot { width: 18px; height: 18px; border-radius: 3px; border: 1px solid #ccc; cursor: pointer; }

        .tool-btn {
            background: #f3e5f5; border: 2px solid #ab47bc; color: #4a148c; padding: 4px 8px;
            font-weight: bold; border-radius: 4px; cursor: pointer; font-size: 12px;
        }
        .tool-btn:hover { background: #e1bee7; }

        #game-chat-box { width: 250px; display: flex; flex-direction: column; }
        #game-chat { flex: 1; height: 350px; background: #fff; overflow-y: auto; padding: 6px; font-size: 12px; border: 2px solid #f06292; }

        #answer-overlay {
            position: absolute; top: 40%; left: 50%; transform: translate(-50%, -50%);
            background: linear-gradient(135deg, #ff4081, #aa00ff); color: #fff; padding: 18px 36px;
            font-size: 26px; font-weight: 900; font-family: 'DungGeunMo'; border: 4px solid #fff;
            border-radius: 16px; box-shadow: 0 0 25px rgba(255, 64, 129, 0.9); display: none; z-index: 100;
            text-align: center; white-space: nowrap;
            animation: popIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        }
        @keyframes popIn { 0% { transform: translate(-50%, -50%) scale(0.5); } 100% { transform: translate(-50%, -50%) scale(1); } }
    </style>
</head>
<body>

    <div id="auth-modal" class="modal">
        <div class="pixel-box modal-body">
            <div class="window-header">ポキパティ！！ 접속하기</div>
            
            <div id="login-form">
                <div class="form-group">
                    <span>아이디</span>
                    <input type="text" id="login-id" placeholder="아이디 입력...">
                </div>
                <div class="form-group">
                    <span>비밀번호</span>
                    <input type="password" id="login-pw" placeholder="비밀번호 입력...">
                </div>
                <button class="tool-btn" onclick="submitLogin()" style="background:#ff80ab; color:#fff; padding:8px; margin-top:6px;">로그인 💖</button>
                <p style="font-size:11px; text-align:center; color:#ad1457; cursor:pointer;" onclick="toggleAuthMode('register')">계정이 없으신가요? 회원가입하기</p>
            </div>

            <div id="register-form" style="display:none;">
                <div class="form-group">
                    <span>아이디 (3자 이상)</span>
                    <input type="text" id="reg-id" placeholder="아이디...">
                </div>
                <div class="form-group">
                    <span>비밀번호</span>
                    <input type="password" id="reg-pw" placeholder="비밀번호...">
                </div>
                <div class="form-group">
                    <span>닉네임 (2~8자, 한/영/숫자)</span>
                    <input type="text" id="reg-nick" placeholder="포키가이">
                </div>
                <p style="font-size:10px; color:#c2185b; margin:0;">⚠️ 닉네임은 2~8자의 한글, 영문, 숫자만 사용할 수 있습니다.</p>
                <button class="tool-btn" onclick="submitRegister()" style="background:#ba68c8; color:#fff; padding:8px; margin-top:6px;">회원가입 완료 ✨</button>
                <p style="font-size:11px; text-align:center; color:#ad1457; cursor:pointer;" onclick="toggleAuthMode('login')">이미 계정이 있으신가요? 로그인하기</p>
            </div>
        </div>
    </div>

    <div id="lobby-screen">
        <div class="pixel-box window-header">
            <span>ポキパティ！！ (Poki Party) Lobby</span>
            <button class="tool-btn" onclick="location.reload()" style="font-size:10px;">로그아웃</button>
        </div>

        <div id="lobby-main">
            <div id="lobby-left">
                <div class="pixel-box" style="flex:1; display:flex; flex-direction:column;">
                    <div class="window-header" style="font-size:11px;">👥 접속자 목록</div>
                    <div id="user-list-box"></div>
                </div>
                <div class="pixel-box" id="my-profile">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span id="my-badge" style="font-size:18px;">🔰</span>
                        <span class="profile-badge" id="my-title">신입 포키</span>
                    </div>
                    <div id="my-name-display" style="font-weight:900; font-size:15px; color:#880e4f;">포키가이</div>
                    <div style="font-size:11px; color:#ad1457; font-weight:bold;">보유 포인트: <span id="my-points" style="color:#d81b60;">100</span> Pt</div>
                </div>
            </div>

            <div id="lobby-center">
                <div id="category-bar">
                    <button class="tab-btn" onclick="openCreateRoomModal()">➕ 방 만들기</button>
                    <button class="tab-btn" style="background:#ba68c8; border-color:#7b1fa2;" onclick="quickJoin()">⚡ 빠른 입장</button>
                </div>
                <div class="pixel-box" id="room-grid"></div>
            </div>
        </div>

        <div class="pixel-box" id="lobby-bottom">
            <div class="window-header" style="font-size:11px;">💬 로비 전체 채팅</div>
            <div id="lobby-chat"></div>
            <div style="display:flex; padding:4px; gap:4px; background:#fff;">
                <input type="text" id="lobby-chat-input" placeholder="로비 메시지 입력..." style="flex:1;" onkeypress="if(event.key==='Enter') sendLobbyChat()">
                <button class="tool-btn" onclick="sendLobbyChat()">전송</button>
            </div>
        </div>
    </div>

    <!-- 🏠 방 만들기 모달 (롤 카테고리 연동) -->
    <div id="create-room-modal" class="modal" style="display:none;">
        <div class="pixel-box modal-body">
            <div class="window-header">🏠 방 만들기</div>
            <div class="form-group">
                <span>방 제목</span>
                <input type="text" id="room-title-input" value="같이 즐겁게 그림 그려요!">
            </div>
            <div class="form-group">
                <span>비밀번호</span>
                <input type="password" id="room-pass-input" placeholder="선택 사항">
            </div>
            <div class="form-group">
                <span>최대 인원</span>
                <select id="room-max-select">
                    <option value="4">4명</option>
                    <option value="6" selected>6명</option>
                    <option value="8">8명</option>
                </select>
            </div>
            <div class="form-group">
                <span>라운드 시간</span>
                <select id="room-time-select">
                    <option value="45">45초</option>
                    <option value="60" selected>60초</option>
                    <option value="90">90초</option>
                </select>
            </div>
            <div class="form-group">
                <span>주제 선택</span>
                <select id="room-cate-select">
                    <option value="all">🎨 전체 (대용량 1000+)</option>
                    <option value="food">🍕 맛있는 음식</option>
                    <option value="anime">⚡ 애니메이션</option>
                    <option value="lol">⚔️ 리그 오브 레전드 (LOL)</option>
                    <option value="meme">🔥 유행어 / 밈</option>
                </select>
            </div>
            <div style="display:flex; gap:6px; margin-top:8px;">
                <button class="tool-btn" onclick="submitCreateRoom()" style="flex:1; background:#ff80ab; color:#fff;">확인</button>
                <button class="tool-btn" onclick="closeCreateRoomModal()" style="flex:1; background:#ccc;">취소</button>
            </div>
        </div>
    </div>

    <div id="game-screen">
        <div class="pixel-box" id="game-header">
            <span style="font-weight:bold; font-size:14px; color:#880e4f;" id="game-room-title">방 제목</span>
            <span>ROUND <span id="round-disp" style="color:#d81b60; font-weight:900;">1</span>/3</span>
            <div class="word-hint-box" id="word-disp">_ _ _</div>
            <span>⏰ <span id="timer-disp" style="color:#d81b60; font-weight:900;">60</span>s</span>
            <button class="tool-btn" onclick="confirmLeaveRoom()" style="background:#ef5350; color:#fff;">나가기</button>
        </div>

        <div id="game-main">
            <div class="pixel-box" id="game-players">
                <div>
                    <div class="window-header" style="font-size:11px;">PLAYERS</div>
                    <div id="game-player-list" style="margin-top:6px;"></div>
                </div>
                <div class="poki-logo-box">
                    ポキパティ！！
                </div>
            </div>

            <div id="canvas-container">
                <div style="position:relative;">
                    <canvas id="canvas" width="500" height="380"></canvas>
                    <div id="answer-overlay"><span id="overlay-text"></span></div>
                </div>
                
                <div id="toolbar">
                    <div class="palette" id="palette"></div>
                    <div style="display:flex; gap:4px; align-items:center;">
                        <button class="tool-btn" onclick="setPenWidth(2)">•</button>
                        <button class="tool-btn" onclick="setPenWidth(6)">●</button>
                        <button class="tool-btn" onclick="setPenWidth(14)">🔴</button>
                        <button class="tool-btn" onclick="setPenWidth(28)">██</button>
                        <button class="tool-btn" onclick="fillBucket()">🪣</button>
                        <button class="tool-btn" onclick="useEraser()">🧹</button>
                        <button class="tool-btn" onclick="clearCanvas()" style="background:#ffebee;">❌</button>
                    </div>
                </div>
            </div>

            <div class="pixel-box" id="game-chat-box">
                <div class="window-header" style="font-size:11px;">CHAT & ANSWER</div>
                <div id="game-chat"></div>
                <div style="display:flex; padding:4px; gap:4px; background:#fff;">
                    <input type="text" id="game-chat-input" placeholder="정답 입력..." style="flex:1;" onkeypress="if(event.key==='Enter') sendGameChat()">
                    <button class="tool-btn" id="game-chat-btn" onclick="sendGameChat()">전송</button>
                </div>
            </div>
        </div>
    </div>

    <script>
        const socket = io();
        let myAccount = null;
        let isDrawer = false;
        let currentColor = '#000000';
        let currentWidth = 6;
        let isDrawing = false;
        let currentRoomList = [];

        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        let audioCtx = null;

        function playCorrectSound() {
            try {
                if (!audioCtx) audioCtx = new AudioCtx();
                if (audioCtx.state === 'suspended') audioCtx.resume();
                const now = audioCtx.currentTime;
                const freqs = [523.25, 659.25, 783.99];
                freqs.forEach((f, idx) => {
                    const osc = audioCtx.createOscillator();
                    const gain = audioCtx.createGain();
                    osc.type = 'triangle';
                    osc.frequency.value = f;
                    gain.gain.setValueAtTime(0.1, now + idx * 0.08);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.2);
                    osc.connect(gain);
                    gain.connect(audioCtx.destination);
                    osc.start(now + idx * 0.08);
                    osc.stop(now + idx * 0.08 + 0.2);
                });
            } catch(e) {}
        }

        function toggleAuthMode(mode) {
            document.getElementById('login-form').style.display = (mode === 'login') ? 'block' : 'none';
            document.getElementById('register-form').style.display = (mode === 'register') ? 'block' : 'none';
        }

        function submitRegister() {
            const username = document.getElementById('reg-id').value.trim();
            const password = document.getElementById('reg-pw').value.trim();
            const nickname = document.getElementById('reg-nick').value.trim();
            socket.emit('register', { username, password, nickname });
        }

        function submitLogin() {
            const username = document.getElementById('login-id').value.trim();
            const password = document.getElementById('login-pw').value.trim();
            socket.emit('login', { username, password });
        }

        socket.on('authError', (msg) => alert(msg));
        socket.on('authSuccess', (data) => {
            alert(data.message);
            toggleAuthMode('login');
        });

        socket.on('loginSuccess', (userData) => {
            myAccount = userData;
            document.getElementById('auth-modal').style.display = 'none';
            document.getElementById('lobby-screen').style.display = 'flex';

            document.getElementById('my-name-display').innerText = userData.nickname;
            document.getElementById('my-title').innerText = userData.title;
            document.getElementById('my-badge').innerText = userData.badge;
            document.getElementById('my-points').innerText = userData.points;
        });

        const canvas = document.getElementById('canvas');
        const ctx = canvas.getContext('2d');
        const colors = [
            '#000000', '#ffffff', '#4a2c00', '#d8a7b1', '#ff4081', '#aa00ff', '#3d5aff', '#00e5ff', 
            '#1de9b6', '#00e676', '#ffea00', '#ff9100', '#ff3d00', '#795548',
            '#f8bbd0', '#e1bee7', '#c5cae9', '#b2ebf2', '#b9f6ca', '#ffe0b2'
        ];
        const palette = document.getElementById('palette');
        colors.forEach(c => {
            const dot = document.createElement('div');
            dot.className = 'color-dot';
            dot.style.background = c;
            dot.onclick = () => currentColor = c;
            palette.appendChild(dot);
        });

        canvas.addEventListener('mousedown', startDrawing);
        canvas.addEventListener('mousemove', draw);
        canvas.addEventListener('mouseup', stopDrawing);
        canvas.addEventListener('mouseleave', stopDrawing);

        function startDrawing(e) {
            if (!isDrawer) return;
            isDrawing = true;
            const pos = getCanvasPos(e);
            ctx.beginPath();
            ctx.moveTo(pos.x, pos.y);
            socket.emit('draw', { type: 'start', x: pos.x, y: pos.y, color: currentColor, width: currentWidth });
        }

        function draw(e) {
            if (!isDrawing || !isDrawer) return;
            const pos = getCanvasPos(e);
            ctx.lineTo(pos.x, pos.y);
            ctx.strokeStyle = currentColor;
            ctx.lineWidth = currentWidth;
            ctx.lineCap = 'round';
            ctx.stroke();
            socket.emit('draw', { type: 'draw', x: pos.x, y: pos.y, color: currentColor, width: currentWidth });
        }

        function stopDrawing() { isDrawing = false; }
        function getCanvasPos(e) {
            const rect = canvas.getBoundingClientRect();
            return { x: e.clientX - rect.left, y: e.clientY - rect.top };
        }

        function setPenWidth(w) { currentWidth = w; }
        function useEraser() { currentColor = '#ffffff'; }
        function clearCanvas() { if (isDrawer) socket.emit('clearCanvas'); }
        function fillBucket() {
            if (!isDrawer) return;
            ctx.fillStyle = currentColor;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            socket.emit('fillCanvas', currentColor);
        }

        socket.on('draw', (data) => {
            if (data.type === 'start') {
                ctx.beginPath();
                ctx.moveTo(data.x, data.y);
            } else if (data.type === 'draw') {
                ctx.lineTo(data.x, data.y);
                ctx.strokeStyle = data.color;
                ctx.lineWidth = data.width;
                ctx.lineCap = 'round';
                ctx.stroke();
            }
        });

        socket.on('clearCanvas', () => ctx.clearRect(0, 0, canvas.width, canvas.height));
        socket.on('fillCanvas', (color) => {
            ctx.fillStyle = color;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        });

        socket.on('updateLobbyUsers', (users) => {
            const box = document.getElementById('user-list-box');
            box.innerHTML = '';
            users.forEach(u => {
                const item = document.createElement('div');
                item.className = 'user-item';
                item.innerText = (u.badge || '🌸') + ' ' + u.nickname;
                box.appendChild(item);
            });
        });

        socket.on('updateRoomList', (roomList) => {
            currentRoomList = roomList;
            const grid = document.getElementById('room-grid');
            grid.innerHTML = '';
            
            roomList.forEach(r => {
                const card = document.createElement('div');
                card.className = 'room-card';
                card.onclick = () => joinRoomById(r.id, r.isLocked);
                card.innerHTML = \`
                    <div style="font-weight:900; font-size:15px; display:flex; justify-content:space-between;">
                        <span>#\${r.roomNum} \${r.title}</span>
                        <span>\${r.isLocked ? '🔒' : '🔓'}</span>
                    </div>
                    <div style="font-size:12px; color:#ad1457; font-weight:bold;">
                        [주제: \${r.category.toUpperCase()}] | 인원: \${r.currentPlayers}/\${r.maxPlayers}
                    </div>
                \`;
                grid.appendChild(card);
            });
        });

        function sendLobbyChat() {
            const input = document.getElementById('lobby-chat-input');
            if (input.value.trim() !== '') {
                socket.emit('lobbyChat', input.value.trim());
                input.value = '';
            }
        }

        socket.on('lobbyChat', (data) => {
            const box = document.getElementById('lobby-chat');
            const msg = document.createElement('div');
            msg.innerText = \`[\${data.sender}]: \${data.text}\`;
            box.appendChild(msg);
            box.scrollTop = box.scrollHeight;
        });

        function openCreateRoomModal() { document.getElementById('create-room-modal').style.display = 'flex'; }
        function closeCreateRoomModal() { document.getElementById('create-room-modal').style.display = 'none'; }

        function submitCreateRoom() {
            const title = document.getElementById('room-title-input').value.trim();
            const password = document.getElementById('room-pass-input').value.trim();
            const maxPlayers = document.getElementById('room-max-select').value;
            const roundTime = document.getElementById('room-time-select').value;
            const category = document.getElementById('room-cate-select').value;

            socket.emit('createRoom', { title, password, maxPlayers, roundTime, category });
            closeCreateRoomModal();
        }

        socket.on('roomCreated', ({ roomId, password }) => {
            socket.emit('joinRoom', { roomId, password });
        });

        function joinRoomById(roomId, isLocked) {
            let password = '';
            if (isLocked) {
                password = prompt('비밀번호를 입력해 주세요:');
                if (password === null) return;
            }
            socket.emit('joinRoom', { roomId, password });
        }

        function quickJoin() {
            const available = currentRoomList.find(r => !r.isLocked && r.currentPlayers < r.maxPlayers);
            if (available) {
                socket.emit('joinRoom', { roomId: available.id, password: '' });
            } else {
                alert('입장 가능한 공개 방이 없습니다.');
            }
        }

        socket.on('roomJoined', (room) => {
            document.getElementById('lobby-screen').style.display = 'none';
            document.getElementById('game-screen').style.display = 'flex';
            document.getElementById('game-room-title').innerText = room.title;
        });

        socket.on('joinError', (msg) => alert(msg));

        function confirmLeaveRoom() {
            if (confirm("정말 게임 방에서 나가시겠습니까?")) {
                socket.emit('leaveRoom');
                document.getElementById('game-screen').style.display = 'none';
                document.getElementById('lobby-screen').style.display = 'flex';
            }
        }

        socket.on('updatePlayers', (players) => {
            const list = document.getElementById('game-player-list');
            list.innerHTML = '';
            players.forEach(p => {
                const card = document.createElement('div');
                card.className = 'player-card';
                card.innerHTML = \`<span>\${p.name}</span><span style="color:#d81b60;">\${p.score}pt</span>\`;
                list.appendChild(card);
            });
        });

        socket.on('turnStart', (data) => {
            isDrawer = data.isDrawer;
            document.getElementById('word-disp').innerText = data.word;
            document.getElementById('round-disp').innerText = data.round;

            const chatInput = document.getElementById('game-chat-input');
            const chatBtn = document.getElementById('game-chat-btn');

            ctx.clearRect(0, 0, canvas.width, canvas.height);

            if (isDrawer) {
                chatInput.disabled = true;
                chatBtn.disabled = true;
                chatInput.placeholder = "🎨 당신이 출제자입니다!";

                const overlay = document.getElementById('answer-overlay');
                document.getElementById('overlay-text').innerHTML = "🎨 당신이 출제자입니다!<br>제시어를 보고 그려주세요!";
                overlay.style.display = 'block';
                setTimeout(() => { overlay.style.display = 'none'; }, 2800);
            } else {
                chatInput.disabled = false;
                chatBtn.disabled = false;
                chatInput.placeholder = "정답 입력...";
            }
        });

        socket.on('timerUpdate', (time) => {
            document.getElementById('timer-disp').innerText = time;
        });

        socket.on('correctAnswerOverlay', (data) => {
            playCorrectSound();

            const overlay = document.getElementById('answer-overlay');
            document.getElementById('overlay-text').innerText = \`🎉 \${data.winner}님 정답!\`;
            overlay.style.display = 'block';
            setTimeout(() => { overlay.style.display = 'none'; }, 2000);
        });

        function sendGameChat() {
            const input = document.getElementById('game-chat-input');
            if (input.value.trim() !== '') {
                socket.emit('chatMessage', input.value.trim());
                input.value = '';
            }
        }

        socket.on('chatMessage', (data) => {
            const box = document.getElementById('game-chat');
            const msg = document.createElement('div');
            if (data.sender.includes('SYSTEM')) {
                msg.style.color = '#d81b60';
                msg.style.fontWeight = 'bold';
            } else {
                msg.style.color = '#4a148c';
            }
            msg.innerText = \`[\${data.sender}]: \${data.text}\`;
            box.appendChild(msg);
            box.scrollTop = box.scrollHeight;
        });

        socket.on('gameOver', (rankings) => {
            alert(\`🏆 파티 종료! 1위: \${rankings[0].name} (\${rankings[0].score}점)\`);
        });
    </script>
</body>
</html>`;
}

server.listen(PORT, () => {
    console.log(`=================================================`);
    console.log(` Poki Party (ポ키パティ！！) 서버 가동 완료!`);
    console.log(` JSON 데이터베이스 파일 연동 완료 (usersDB / wordsDB)`);
    console.log(`=================================================`);
});
