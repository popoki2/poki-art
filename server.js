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

// 🛒 상점 아이템 데이터베이스
const SHOP_ITEMS = {
    badges: [
        { id: 'badge_beginner', name: '🔰 새싹', price: 5000, desc: '기본 새싹 뱃지' },
        { id: 'badge_bronze',   name: '🥉 브론즈', price: 15000, desc: '기본적인 실력을 증명함' },
        { id: 'badge_silver',   name: '🥈 실버', price: 35000, desc: '중수 반열에 오른 실력자' },
        { id: 'badge_gold',     name: '🥇 골드', price: 80000, desc: '상위권 고수의 상징' },
        { id: 'badge_master',   name: '👑 마스터', price: 200000, desc: '압도적인 정답률의 마스터' },
        { id: 'badge_hacker',   name: '💻 개발자', price: 500000, desc: '전설의 개발자 전용 뱃지' }
    ],
    colors: [
        { id: 'color_blue',    name: '🔵 시원한 블루', price: 20000, hex: '#0055ff' },
        { id: 'color_green',   name: '🟢 네온 그린',   price: 20000, hex: '#22cc55' },
        { id: 'color_purple',  name: '🟣 영롱한 퍼플', price: 45000, hex: '#9b5de5' },
        { id: 'color_orange',  name: '🟧 불꽃 오렌지', price: 45000, hex: '#ff9900' },
        { id: 'color_gold',    name: '✨ 럭셔리 골드', price: 100000, hex: '#ffcc00' },
        { id: 'color_pink',    name: '💖 포키 핫핑크', price: 300000, hex: '#ff0055' }
    ]
};

function loadUsersDB() {
    try {
        if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, JSON.stringify({}), 'utf8');
        return JSON.parse(fs.readFileSync(DB_PATH, 'utf8') || '{}');
    } catch (e) { return {}; }
}

function saveUsersDB(db) {
    try { fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8'); } catch (e) {}
}

function loadWordsDB() {
    try {
        if (!fs.existsSync(WORDS_PATH)) {
            return { food: ["떡볶이", "초밥"], anime: ["피카츄", "나루토"], meme: ["무야호"], lol: ["티모", "메이플스토리"], all: ["떡볶이", "초밥", "피카츄", "나루토", "무야호", "티모"] };
        }
        const parsed = JSON.parse(fs.readFileSync(WORDS_PATH, 'utf8'));
        parsed.all = Array.from(new Set([...(parsed.food||[]), ...(parsed.anime||[]), ...(parsed.meme||[]), ...(parsed.lol||[])]));
        return parsed;
    } catch (e) { return { food: [], anime: [], meme: [], lol: [], all: [] }; }
}

let usersDB = loadUsersDB();
let wordsDB = loadWordsDB();

function getRandomWord(category, usedWords = []) {
    wordsDB = loadWordsDB();
    let list = wordsDB[category] || wordsDB.all;
    if (!list || list.length === 0) list = wordsDB.all;
    let available = list.filter(w => !usedWords.includes(w));
    if (available.length === 0) { available = list; usedWords.length = 0; }
    const selected = available[Math.floor(Math.random() * available.length)];
    usedWords.push(selected);
    return selected;
}

// 제시어 글자 수 힌트 변환 함수
function getWordHintFormat(word) {
    if (!word) return '???';
    const blanks = Array(word.length).fill('_').join(' ');
    return `${blanks} (${word.length}글자)`;
}

const rooms = {};
const lobbyUsers = {};
let roomCounter = 1;

function getPublicRoomList() {
    return Object.values(rooms).map(r => ({
        id: r.id, roomNum: r.roomNum, title: r.title, category: r.category,
        currentPlayers: r.players.length, maxPlayers: r.maxPlayers,
        totalRounds: r.totalRounds, isLocked: !!r.password, isPlaying: r.isPlaying
    }));
}

io.on('connection', (socket) => {
    let currentUser = { username: null, nickname: null, roomId: null };

    socket.on('register', ({ username, password, nickname }) => {
        usersDB = loadUsersDB();
        if (usersDB[username]) return socket.emit('authError', '이미 존재하는 아이디입니다.');
        if (Object.values(usersDB).some(u => u.nickname === nickname)) return socket.emit('authError', '이미 사용 중인 닉네임입니다.');

        usersDB[username] = { username, password, nickname: nickname || username, points: 10000, inventory: [], equipped: { badge: '🔰', color: '#4a2840' } };
        saveUsersDB(usersDB);
        socket.emit('authSuccess', { message: '회원가입 완료! 로그인해 주세요.' });
    });

    socket.on('login', ({ username, password }) => {
        usersDB = loadUsersDB();
        const user = usersDB[username];
        if (!user || user.password !== password) return socket.emit('authError', '아이디 또는 비밀번호가 일치하지 않습니다.');
        if (Object.values(lobbyUsers).some(u => u.username === username)) return socket.emit('authError', '이미 접속 중인 계정입니다.');

        currentUser.username = username;
        currentUser.nickname = user.nickname;
        lobbyUsers[socket.id] = { id: socket.id, username, ...user };

        socket.emit('loginSuccess', { username, ...user });
        io.emit('updateLobbyUsers', Object.values(lobbyUsers));
        socket.emit('updateRoomList', getPublicRoomList());
    });

    socket.on('buyItem', ({ category, itemId }) => {
        if (!currentUser.username) return;
        usersDB = loadUsersDB();
        const user = usersDB[currentUser.username];
        if (!user) return;

        const item = SHOP_ITEMS[category]?.find(i => i.id === itemId);
        if (!item) return socket.emit('shopResponse', { success: false, message: '존재하지 않는 상품입니다.' });
        if (user.inventory && user.inventory.includes(itemId)) return socket.emit('shopResponse', { success: false, message: '이미 보유 중입니다.' });
        if (user.points < item.price) return socket.emit('shopResponse', { success: false, message: `포인트 부족! (필요: ${item.price.toLocaleString()} Pt)` });

        user.points -= item.price;
        if (!user.inventory) user.inventory = [];
        user.inventory.push(itemId);

        if (category === 'badges') user.equipped.badge = item.name.split(' ')[0];
        if (category === 'colors') user.equipped.color = item.hex;

        saveUsersDB(usersDB);
        lobbyUsers[socket.id] = { id: socket.id, username: currentUser.username, ...user };
        socket.emit('shopResponse', { success: true, message: `'${item.name}' 구매 및 장착 완료!`, user });
        io.emit('updateLobbyUsers', Object.values(lobbyUsers));
    });

    socket.on('sendLobbyChat', (msg) => {
        if (!currentUser.nickname) return;
        io.emit('lobbyChatMessage', { sender: currentUser.nickname, text: msg });
    });

    socket.on('createRoom', (config) => {
        if (!currentUser.username) return;
        const roomId = 'room_' + Date.now();
        rooms[roomId] = {
            id: roomId, roomNum: roomCounter++, title: config.title || '신나는 포키파티!',
            password: config.password || '', maxPlayers: parseInt(config.maxPlayers) || 6,
            totalRounds: parseInt(config.totalRounds) || 3, roundTime: parseInt(config.roundTime) || 60,
            category: config.category || 'all', hostId: socket.id, players: [],
            currentRound: 1, drawerIndex: -1, currentWord: '', usedWords: [],
            timeLeft: 0, timer: null, isPlaying: false, solvedPlayers: [], canvasData: []
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
        if (room.password && room.password !== password) return socket.emit('joinError', '비밀번호가 틀렸습니다.');
        if (room.players.length >= room.maxPlayers) return socket.emit('joinError', '정원이 가득 찬 방입니다.');
        if (room.isPlaying) return socket.emit('joinError', '게임이 이미 진행 중입니다.');

        delete lobbyUsers[socket.id];
        io.emit('updateLobbyUsers', Object.values(lobbyUsers));

        currentUser.roomId = roomId;
        socket.join(roomId);

        usersDB = loadUsersDB();
        const user = usersDB[currentUser.username] || {};
        const player = { id: socket.id, username: currentUser.username, name: currentUser.nickname, score: 0, badge: user.equipped?.badge || '🔰', color: user.equipped?.color || '#4a2840' };
        room.players.push(player);

        socket.emit('roomJoined', { ...room, isHost: room.hostId === socket.id });
        io.to(roomId).emit('updatePlayers', { players: room.players, hostId: room.hostId, solvedPlayers: room.solvedPlayers, drawerId: room.players[room.drawerIndex]?.id, isPlaying: room.isPlaying });
        io.to(roomId).emit('chatMessage', { sender: 'SYSTEM', text: `${currentUser.nickname} 님이 입장하셨습니다!` });
        io.emit('updateRoomList', getPublicRoomList());
    }

    socket.on('requestStartGame', () => {
        const roomId = currentUser.roomId;
        if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];
        if (room.hostId !== socket.id) return socket.emit('chatMessage', { sender: 'SYSTEM', text: '❌ 방장만 시작할 수 있습니다.' });
        if (room.players.length < 2) return socket.emit('chatMessage', { sender: 'SYSTEM', text: '❌ 최소 2명 이상이어야 시작 가능합니다.' });
        if (room.isPlaying) return;
        
        io.to(roomId).emit('chatMessage', { sender: 'SYSTEM 🎉', text: '🎮 게임을 시작합니다!' });
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
        if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];
        const isDrawer = room.players[room.drawerIndex]?.id === socket.id;
        const isAlreadySolved = room.solvedPlayers.includes(socket.id);

        if (room.isPlaying && !isDrawer && !isAlreadySolved && msg.trim() === room.currentWord) {
            room.solvedPlayers.push(socket.id);
            const solveOrder = room.solvedPlayers.length;
            const earnedScore = Math.max(1500 - (solveOrder - 1) * 200, 500);

            const player = room.players.find(p => p.id === socket.id);
            if (player) player.score += earnedScore;

            // [v1.9.1] 정답 맞출 때 포인트 즉시 DB 반영
            usersDB = loadUsersDB();
            if (usersDB[player.username]) {
                usersDB[player.username].points += earnedScore;
                saveUsersDB(usersDB);
                
                // 포인트 업데이트 이벤트 전송
                socket.emit('updateUserData', usersDB[player.username]);
            }

            io.to(roomId).emit('updatePlayers', { players: room.players, hostId: room.hostId, solvedPlayers: room.solvedPlayers, drawerId: room.players[room.drawerIndex]?.id, isPlaying: room.isPlaying });
            io.to(roomId).emit('chatMessage', { sender: 'SYSTEM 🎉', text: `[${solveOrder}등] ${currentUser.nickname} 님 정답! (+${earnedScore} Pt)` });

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
                io.to(roomId).emit('updatePlayers', { players: room.players, hostId: room.hostId, solvedPlayers: room.solvedPlayers, drawerId: room.players[room.drawerIndex]?.id, isPlaying: room.isPlaying });
            }
        }

        currentUser.roomId = null;
        usersDB = loadUsersDB();
        if (currentUser.username && usersDB[currentUser.username]) {
            const updatedUser = usersDB[currentUser.username];
            lobbyUsers[socket.id] = { id: socket.id, username: currentUser.username, ...updatedUser };
            socket.emit('updateUserData', updatedUser); // 로비 귀환 시 최신 유저 데이터 전송
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
        
        // [v1.9.1] 게임 종료 보상 추가 보너스 포인트 적립
        usersDB = loadUsersDB();
        sorted.forEach((p, rank) => {
            let bonus = 0;
            if (rank === 0) bonus = 3000;      // 1등 보너스
            else if (rank === 1) bonus = 2000; // 2등 보너스
            else if (rank === 2) bonus = 1000; // 3등 보너스
            
            if (bonus > 0 && usersDB[p.username]) {
                usersDB[p.username].points += bonus;
            }
        });
        saveUsersDB(usersDB);

        io.to(roomId).emit('gameOver', sorted);
        io.to(roomId).emit('updatePlayers', { players: room.players, hostId: room.hostId, solvedPlayers: [], drawerId: null, isPlaying: false });
        io.to(roomId).emit('chatMessage', { sender: 'SYSTEM 🏆', text: `게임 종료! 1등: ${sorted[0]?.name || '없음'}님! (우승 보너스 포인트 지급 완료)` });
        io.emit('updateRoomList', getPublicRoomList());
        return;
    }

    const drawer = room.players[room.drawerIndex];
    room.currentWord = getRandomWord(room.category, room.usedWords);
    room.timeLeft = room.roundTime;

    const hintText = getWordHintFormat(room.currentWord);

    io.to(roomId).emit('updatePlayers', { players: room.players, hostId: room.hostId, solvedPlayers: room.solvedPlayers, drawerId: drawer.id, isPlaying: room.isPlaying });
    
    // 출제자에게는 진짜 제시어, 맞히는 사람에게는 글자수 힌트전송!
    io.to(drawer.id).emit('turnStart', { isDrawer: true, word: room.currentWord, time: room.roundTime, round: room.currentRound, totalRounds: room.totalRounds });

    room.players.forEach(p => {
        if (p.id !== drawer.id) {
            io.to(p.id).emit('turnStart', { isDrawer: false, word: hintText, time: room.roundTime, round: room.currentRound, totalRounds: room.totalRounds });
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

app.get('/', (req, res) => { res.send(getHTMLContent()); });

function getHTMLContent() {
    return `
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <title>ポキパティ！！ (Poki Party v1.9.1)</title>

    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Gaegu:wght@400;700&family=Jua&display=swap" rel="stylesheet">

    <style>
        :root {
            --bg-color: #fde8f0;
            --main-pink: #ff85a2;
            --dark-pink: #e05275;
            --pixel-border: #4a2840;
            --box-bg: #ffffff;
            --text-color: #4a2840;
        }

        * { 
            box-sizing: border-box; 
            margin: 0; 
            padding: 0; 
            font-family: 'Jua', 'Gaegu', cursive, sans-serif !important; 
        }

        body, html { width: 100vw; height: 100vh; background-color: var(--bg-color); color: var(--text-color); overflow: hidden; display: flex; justify-content: center; align-items: center; }

        .screen { display: none; width: 1280px; height: 800px; padding: 16px; background: #fff0f5; border: 4px solid var(--pixel-border); border-radius: 16px; box-shadow: 6px 6px 0px rgba(74, 40, 64, 0.2); position: relative; }
        .screen.active { display: flex; flex-direction: column; }

        #auth-screen.active { justify-content: center; align-items: center; gap: 12px; }

        .pixel-box { background: var(--box-bg); border: 3px solid var(--pixel-border); box-shadow: 3px 3px 0px rgba(74, 40, 64, 0.15); border-radius: 12px; display: flex; flex-direction: column; overflow: hidden; }
        .box-header { background: var(--main-pink); color: #fff; padding: 6px 12px; font-size: 18px; border-bottom: 3px solid var(--pixel-border); text-shadow: 1px 1px 0px var(--pixel-border); }

        .pixel-btn { background: #ffb6c1; border: 2.5px solid var(--pixel-border); color: var(--text-color); padding: 8px 18px; cursor: pointer; box-shadow: 2px 2px 0px var(--pixel-border); border-radius: 10px; font-size: 17px; transition: transform 0.05s; }
        .pixel-btn:active { transform: translate(2px, 2px); box-shadow: 0px 0px 0px var(--pixel-border); }
        .pixel-btn.primary { background: #ff75a0; color: white; }
        .pixel-btn.warning { background: #ffb703; color: white; }
        .pixel-btn.danger { background: #ef476f; color: white; }
        .pixel-btn.success { background: #06d6a0; color: white; }
        .pixel-btn.selected { background: #4a2840; color: white; border-color: #ff0055; }

        .lobby-header { text-align: center; margin-bottom: 8px; }
        .pixel-title { font-size: 48px; color: var(--dark-pink); text-shadow: 2px 2px 0px #fff, 4px 4px 0px var(--pixel-border); letter-spacing: 2px; }
        .pixel-subtitle { font-size: 22px; color: #5a3e4b; margin-top: -4px; }

        .lobby-container { display: grid; grid-template-columns: 240px 1fr 300px; gap: 12px; flex: 1; height: calc(100% - 90px); }
        .room-grid { padding: 12px; display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; overflow-y: auto; flex: 1; }
        .room-card { background: #fff; border: 2.5px solid var(--pixel-border); border-radius: 10px; padding: 10px; cursor: pointer; box-shadow: 2px 2px 0px rgba(0,0,0,0.1); font-size: 16px; }
        .room-card:hover { background: #fff5f8; border-color: #ff0055; }

        .game-header { display: grid; grid-template-columns: 200px 1fr 220px; align-items: center; background: var(--main-pink); border: 3px solid var(--pixel-border); padding: 8px 16px; color: white; margin-bottom: 12px; border-radius: 12px; text-shadow: 1px 1px 0px var(--pixel-border); }
        .game-logo { font-size: 24px; }
        .header-center { text-align: center; font-size: 26px; color: #ffffff; background: rgba(74, 40, 64, 0.25); padding: 4px 16px; border-radius: 10px; border: 2px solid var(--pixel-border); }
        .header-right { display: flex; flex-direction: column; align-items: flex-end; font-size: 16px; gap: 2px; }

        .game-container { display: grid; grid-template-columns: 200px 1fr 340px; gap: 12px; flex: 1; height: calc(100% - 60px); }
        .game-main { display: flex; flex-direction: column; gap: 8px; align-items: center; }

        #paint-canvas { background: #ffffff; cursor: crosshair; width: 800px; height: 480px; display: block; border: 3px solid var(--pixel-border); border-radius: 10px; }

        .palette-container { width: 800px; padding: 8px; gap: 6px; }
        .palette-grid { display: grid; grid-template-columns: repeat(13, 1fr); gap: 4px; margin-bottom: 6px; }
        .color-swatch { width: 100%; height: 22px; border: 2px solid var(--pixel-border); cursor: pointer; border-radius: 4px; }
        .color-swatch.selected { outline: 2.5px solid #ff0055; transform: scale(1.15); z-index: 2; }

        .chat-box { height: 100%; }
        .chat-messages { flex: 1; padding: 10px; overflow-y: auto; background: #fff5f8; font-size: 15px; display: flex; flex-direction: column; gap: 4px; }
        .chat-messages .msg { background: #fff; padding: 5px 9px; border-radius: 8px; border: 1.5px solid #ffb3c6; word-break: break-all; }
        .chat-messages .system { background: #e1f5fe; color: #0277bd; border-color: #81d4fa; }
        .chat-input-group { display: flex; padding: 6px; background: #fff; border-top: 2px solid var(--pixel-border); gap: 4px; }
        .chat-input-group input { flex: 1; border: 2px solid var(--pixel-border); padding: 4px 8px; outline: none; font-size: 15px; border-radius: 8px; }

        .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.4); justify-content: center; align-items: center; z-index: 100; }
        .modal-content { background: #fff; padding: 20px; border-radius: 14px; border: 4px solid var(--pixel-border); width: 380px; display: flex; flex-direction: column; gap: 10px; font-size: 16px; }
        .modal-content input, .modal-content select { padding: 6px; border: 2px solid var(--pixel-border); border-radius: 8px; outline: none; font-size: 15px; }
    </style>
</head>
<body>

    <!-- [1] Auth Screen -->
    <div id="auth-screen" class="screen active">
        <h1 class="pixel-title">ポキパティ！！</h1>
        <p class="pixel-subtitle">~ 포키의 놀이터 ~</p>
        <div style="display:flex; flex-direction:column; gap:8px; width:280px;">
            <input type="text" id="auth-username" style="padding:10px; border:2.5px solid var(--pixel-border); border-radius:10px; font-size:16px;" placeholder="아이디">
            <input type="password" id="auth-password" style="padding:10px; border:2.5px solid var(--pixel-border); border-radius:10px; font-size:16px;" placeholder="비밀번호">
            <input type="text" id="auth-nickname" style="padding:10px; border:2.5px solid var(--pixel-border); border-radius:10px; font-size:16px;" placeholder="닉네임 (회원가입시)">
            <div style="display: flex; gap: 10px; margin-top: 6px; justify-content: center;">
                <button type="button" id="login-btn" class="pixel-btn primary" style="flex:1;">로그인</button>
                <button type="button" id="register-btn" class="pixel-btn warning" style="flex:1;">회원가입</button>
            </div>
        </div>
    </div>

    <!-- [2] Lobby Screen -->
    <div id="lobby-screen" class="screen">
        <header class="lobby-header">
            <h1 class="pixel-title">ポキパティ！！</h1>
            <p class="pixel-subtitle">~ 포키의 놀이터 ~</p>
        </header>
        <div class="lobby-container">
            <aside style="display:flex; flex-direction:column; gap:10px;">
                <div class="pixel-box">
                    <div class="box-header">👤 내 프로필</div>
                    <div id="user-profile-info" style="padding:10px; font-size:15px; line-height:1.6;"></div>
                    <button class="pixel-btn primary" style="margin:4px 10px;" onclick="openCreateModal()">+ 방 만들기</button>
                    <button class="pixel-btn warning" style="margin:4px 10px 10px 10px;" onclick="openShopModal()">🛒 상점 방문</button>
                </div>
                <div class="pixel-box" style="flex:1;">
                    <div class="box-header">🌐 접속자 목록 (<span id="online-count">0</span>)</div>
                    <ul id="lobby-user-list" style="list-style:none; padding:8px; overflow-y:auto; font-size:15px;"></ul>
                </div>
            </aside>

            <main class="pixel-box">
                <div class="box-header">🏠 파티 방 목록</div>
                <div id="room-grid" class="room-grid"></div>
            </main>

            <aside class="pixel-box chat-box">
                <div class="box-header">💬 로비 전체 채팅</div>
                <div id="lobby-chat-messages" class="chat-messages">
                    <div class="msg system">[SYSTEM] 포키의 놀이터에 오신 것을 환영합니다!</div>
                </div>
                <div class="chat-input-group">
                    <input type="text" id="lobby-chat-input" placeholder="메시지 입력..." onkeypress="if(event.key==='Enter') sendLobbyChat()">
                    <button class="pixel-btn primary" onclick="sendLobbyChat()">전송</button>
                </div>
            </aside>
        </div>
    </div>

    <!-- [3] Game Room Screen -->
    <div id="game-room" class="screen">
        <header class="game-header">
            <div class="game-logo">ポキパティ！！</div>
            <div class="header-center">
                <span id="word-display" style="color:#a0ffb0;">제시어: ???</span>
            </div>
            <div class="header-right">
                <span id="round-display" style="color:#ffffff;">ROUND 1 / 3</span>
                <span id="timer-display" style="color:#ffcc00;">⏳ 대기 중...</span>
            </div>
        </header>

        <div class="game-container">
            <aside class="pixel-box">
                <div class="box-header">PLAYERS</div>
                <div id="game-player-list" style="padding:8px; display:flex; flex-direction:column; gap:6px; flex:1; overflow-y:auto;"></div>
                <button id="start-game-btn" class="pixel-btn success" style="margin:8px; display:none;" onclick="requestStartGame()">▶️ 게임 시작</button>
            </aside>

            <main class="game-main">
                <canvas id="paint-canvas" width="800" height="480"></canvas>
                <div class="palette-container pixel-box">
                    <div class="palette-grid" id="palette-grid"></div>
                    <div style="display:flex; gap:6px; justify-content:center; align-items:center;">
                        <button class="pixel-btn size-btn" onclick="setLineWidth(1, this)">✏️ 1px</button>
                        <button class="pixel-btn size-btn selected" onclick="setLineWidth(3, this)">✏️ 3px</button>
                        <button class="pixel-btn size-btn" onclick="setLineWidth(6, this)">✏️ 6px</button>
                        <button class="pixel-btn size-btn" onclick="setLineWidth(12, this)">✏️ 12px</button>
                        <button class="pixel-btn size-btn" onclick="setLineWidth(24, this)">✏️ 24px</button>
                        <button class="pixel-btn tool-btn" onclick="setEraser(this)">🧹 지우개</button>
                        <button class="pixel-btn danger tool-btn" onclick="clearCanvasAction()">🗑️ 전체지우기</button>
                        <button class="pixel-btn warning tool-btn" onclick="leaveRoom()">🚪 나가기</button>
                    </div>
                </div>
            </main>

            <aside class="pixel-box chat-box">
                <div id="chat-messages" class="chat-messages"></div>
                <div class="chat-input-group">
                    <input type="text" id="chat-input" placeholder="정답/채팅 입력..." onkeypress="if(event.key==='Enter') sendChat()">
                    <button class="pixel-btn primary" onclick="sendChat()">전송</button>
                </div>
            </aside>
        </div>
    </div>

    <!-- Modals -->
    <div id="create-modal" class="modal">
        <div class="modal-content">
            <h3 style="color: var(--dark-pink);">⚙️ 방 설정하기</h3>
            <label>방 제목</label><input type="text" id="room-title" value="신나는 포키파티!">
            <label>비밀번호</label><input type="password" id="room-pass" placeholder="비밀번호 없음">
            <label>최대 인원</label>
            <select id="room-max"><option value="4">4명</option><option value="6" selected>6명</option><option value="8">8명</option></select>
            <label>총 라운드</label>
            <select id="room-rounds"><option value="2">2 라운드</option><option value="3" selected>3 라운드</option><option value="5">5 라운드</option></select>
            <label>제한시간</label>
            <select id="room-time"><option value="45">45초</option><option value="60" selected>60초</option><option value="90">90초</option></select>
            <label>제시어 주제</label>
            <select id="room-category"><option value="all" selected>전체</option><option value="food">음식/디저트</option><option value="anime">애니/캐릭터</option><option value="meme">밈/유행어</option><option value="lol">메이플/하스/롤</option></select>
            <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:10px;">
                <button class="pixel-btn" onclick="closeCreateModal()">취소</button>
                <button class="pixel-btn primary" onclick="submitCreateRoom()">만들기</button>
            </div>
        </div>
    </div>

    <div id="shop-modal" class="modal">
        <div class="modal-content" style="width: 420px; max-height: 550px;">
            <h3 style="color: var(--dark-pink);">🛒 v1.9.1 포인트 상점</h3>
            <div style="display:flex; gap:10px; margin-bottom:6px;">
                <button class="pixel-btn primary" onclick="renderShopCategory('badges')">뱃지 목록</button>
                <button class="pixel-btn warning" onclick="renderShopCategory('colors')">닉네임 색상</button>
            </div>
            <div id="shop-items-container" style="flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:8px;"></div>
            <div style="display: flex; justify-content: flex-end; margin-top: 10px;">
                <button class="pixel-btn" onclick="closeShopModal()">닫기</button>
            </div>
        </div>
    </div>

    <script src="/socket.io/socket.io.js"></script>
    <script>
        const socket = io();
        let currentColor = '#000000';
        let currentLineWidth = 3;
        let isDrawing = false;
        let canDraw = false;
        let myUserData = null;

        const canvas = document.getElementById('paint-canvas');
        const ctx = canvas.getContext('2d');

        // [v1.9.1 수정] 팔레트 26색 - 중복 하늘색 -> 갈색(#8B4513) 교체 및 피색상(#CC0000) 수정
        const PALETTE_COLORS = [
            "#000000", "#555555", "#888888", "#ffffff", "#CC0000", "#ff5555", "#ff9900", "#ffcc00", "#22cc55", "#00bbf9", "#0055ff", "#9b5de5", "#f15bb5",
            "#2b1424", "#8B4513", "#a0a0a0", "#d3d3d3", "#ffc0cb", "#ff85a2", "#ffb703", "#ffe66d", "#90be6d", "#43aa8b", "#4cc9f0", "#4895ef", "#7209b7"
        ];

        const paletteContainer = document.getElementById('palette-grid');
        PALETTE_COLORS.forEach((color, index) => {
            const swatch = document.createElement('div');
            swatch.className = 'color-swatch' + (index === 0 ? ' selected' : '');
            swatch.style.backgroundColor = color;
            swatch.onclick = () => {
                document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
                swatch.classList.add('selected');
                currentColor = color;
            };
            paletteContainer.appendChild(swatch);
        });

        function showScreen(id) {
            document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
            document.getElementById(id).classList.add('active');
        }

        document.getElementById('login-btn').addEventListener('click', function() {
            const username = document.getElementById('auth-username').value.trim();
            const password = document.getElementById('auth-password').value.trim();
            if (!username || !password) return alert("아이디와 비밀번호를 모두 입력해 주세요!");
            socket.emit('login', { username, password });
        });

        document.getElementById('register-btn').addEventListener('click', function() {
            const username = document.getElementById('auth-username').value.trim();
            const password = document.getElementById('auth-password').value.trim();
            const nickname = document.getElementById('auth-nickname').value.trim();
            if (!username || !password || !nickname) return alert("아이디, 비밀번호, 닉네임을 모두 입력해 주세요!");
            socket.emit('register', { username, password, nickname });
        });

        ['auth-username', 'auth-password', 'auth-nickname'].forEach(id => {
            document.getElementById(id).addEventListener('keypress', (e) => {
                if (e.key === 'Enter') document.getElementById('login-btn').click();
            });
        });

        socket.on('authError', msg => alert(msg));
        socket.on('authSuccess', data => alert(data.message));

        socket.on('loginSuccess', user => {
            myUserData = user;
            updateProfileUI(user);
            showScreen('lobby-screen');
        });

        // [v1.9.1] 유저 포인트/아이템 실시간 동기화 수신
        socket.on('updateUserData', user => {
            myUserData = user;
            updateProfileUI(user);
        });

        function updateProfileUI(user) {
            if (!user) return;
            const badge = (user.equipped && user.equipped.badge) ? user.equipped.badge : '🔰';
            const color = (user.equipped && user.equipped.color) ? user.equipped.color : '#4a2840';
            const nickname = user.nickname ? user.nickname : '익명';
            const points = (user.points !== undefined) ? user.points.toLocaleString() : '0';

            document.getElementById('user-profile-info').innerHTML = 
                '<b>' + badge + ' <span style="color:' + color + '">' + nickname + '</span></b><br>' +
                '보유 포인트: 💰 <b>' + points + ' Pt</b>';
        }

        socket.on('updateLobbyUsers', users => {
            document.getElementById('online-count').innerText = users.length;
            const list = document.getElementById('lobby-user-list');
            list.innerHTML = '';
            users.forEach(u => {
                const li = document.createElement('li');
                li.innerHTML = (u.equipped?.badge || '🔰') + ' <span style="color:' + (u.equipped?.color || '#000') + '">' + u.nickname + '</span>';
                list.appendChild(li);
            });
        });

        function sendLobbyChat() {
            const input = document.getElementById('lobby-chat-input');
            if (!input.value.trim()) return;
            socket.emit('sendLobbyChat', input.value);
            input.value = '';
        }

        socket.on('lobbyChatMessage', ({ sender, text }) => {
            const box = document.getElementById('lobby-chat-messages');
            const msg = document.createElement('div');
            msg.className = 'msg';
            msg.innerText = '[' + sender + '] ' + text;
            box.appendChild(msg);
            box.scrollTop = box.scrollHeight;
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
                card.innerHTML = 
                    '<b>#' + r.roomNum + ' ' + r.title + '</b> ' + (r.isLocked ? '🔒' : '') + '<br>' +
                    '<small>주제: <b>' + r.category.toUpperCase() + '</b> | 인원: ' + r.currentPlayers + '/' + r.maxPlayers + '</small>';
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

        const SHOP_ITEMS_CLIENT = ${JSON.stringify(SHOP_ITEMS)};
        function openShopModal() { 
            document.getElementById('shop-modal').style.display = 'flex';
            renderShopCategory('badges');
        }
        function closeShopModal() { document.getElementById('shop-modal').style.display = 'none'; }

        function renderShopCategory(cat) {
            const container = document.getElementById('shop-items-container');
            container.innerHTML = '';
            SHOP_ITEMS_CLIENT[cat].forEach(item => {
                const div = document.createElement('div');
                div.style.cssText = 'background:#fff; border:2px solid var(--pixel-border); padding:8px; border-radius:6px; display:flex; justify-content:space-between; align-items:center;';
                div.innerHTML = 
                    '<div>' +
                        '<b>' + item.name + '</b><br>' +
                        '<b style="color:var(--dark-pink);">💰 ' + item.price.toLocaleString() + ' Pt</b>' +
                    '</div>';
                const buyBtn = document.createElement('button');
                buyBtn.className = 'pixel-btn primary';
                buyBtn.innerText = '구매';
                buyBtn.onclick = () => socket.emit('buyItem', { category: cat, itemId: item.id });
                div.appendChild(buyBtn);
                container.appendChild(div);
            });
        }

        socket.on('shopResponse', res => {
            alert(res.message);
            if (res.success && res.user) {
                myUserData = res.user;
                updateProfileUI(res.user);
            }
        });

        socket.on('joinError', msg => alert(msg));
        
        // [v1.9.1 수정] 방 입장 및 생성 시 이전 대화/제시어 완전 초기화
        socket.on('roomJoined', () => {
            document.getElementById('chat-messages').innerHTML = '';
            document.getElementById('word-display').innerText = '제시어: ???';
            document.getElementById('timer-display').innerText = '⏳ 대기 중...';
            document.getElementById('round-display').innerText = 'ROUND 1 / 3';
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            showScreen('game-room');
        });

        socket.on('leftRoom', () => showScreen('lobby-screen'));

        function leaveRoom() { socket.emit('leaveRoom'); }
        function requestStartGame() { socket.emit('requestStartGame'); }

        socket.on('updatePlayers', ({ players, hostId, solvedPlayers = [], drawerId, isPlaying }) => {
            const list = document.getElementById('game-player-list');
            list.innerHTML = '';
            players.forEach(p => {
                const card = document.createElement('div');
                card.style.cssText = 'background:#fff; border:2px solid var(--pixel-border); padding:6px; border-radius:6px; display:flex; justify-content:space-between; font-size:15px;';
                if (p.id === drawerId) card.style.background = '#fff9c4';

                const isHost = p.id === hostId ? ' 👑' : '';
                const status = p.id === drawerId ? ' 🎨' : (solvedPlayers.includes(p.id) ? ' ✅' : '');
                
                card.innerHTML = 
                    '<span>' + (p.badge || '') + ' <b style="color:' + (p.color || '#000') + '">' + p.name + '</b>' + isHost + status + '</span>' +
                    '<b>' + p.score + 'pt</b>';
                list.appendChild(card);
            });

            const startBtn = document.getElementById('start-game-btn');
            if (socket.id === hostId && !isPlaying) {
                startBtn.style.display = 'block';
            } else {
                startBtn.style.display = 'none';
            }
        });

        socket.on('turnStart', ({ isDrawer, word, time, round, totalRounds }) => {
            canDraw = isDrawer;
            document.getElementById('word-display').innerText = '제시어: ' + word;
            document.getElementById('timer-display').innerText = '⏳ 남은 시간: ' + time + '초';
            document.getElementById('round-display').innerText = 'ROUND ' + round + ' / ' + totalRounds;
        });

        socket.on('timerUpdate', time => {
            document.getElementById('timer-display').innerText = '⏳ 남은 시간: ' + time + '초';
        });

        canvas.addEventListener('mousedown', (e) => {
            if (!canDraw) return;
            isDrawing = true;
            const rect = canvas.getBoundingClientRect();
            draw(e.clientX - rect.left, e.clientY - rect.top, false);
        });

        canvas.addEventListener('mousemove', (e) => {
            if (!isDrawing || !canDraw) return;
            const rect = canvas.getBoundingClientRect();
            draw(e.clientX - rect.left, e.clientY - rect.top, true);
        });

        canvas.addEventListener('mouseup', () => isDrawing = false);

        function draw(x, y, isDragging) {
            const drawData = { x, y, isDragging, color: currentColor, width: currentLineWidth };
            renderDraw(drawData);
            socket.emit('draw', drawData);
        }

        function renderDraw({ x, y, isDragging, color, width }) {
            ctx.strokeStyle = color;
            ctx.lineWidth = width;
            ctx.lineCap = 'round';
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

        function setLineWidth(w, btn) {
            currentLineWidth = w;
            document.querySelectorAll('.size-btn').forEach(b => b.classList.remove('selected'));
            if (btn) btn.classList.add('selected');
        }

        function setEraser() { currentColor = '#ffffff'; }

        function sendChat() {
            const input = document.getElementById('chat-input');
            if (!input.value.trim()) return;
            socket.emit('chatMessage', input.value);
            input.value = '';
        }

        socket.on('chatMessage', ({ sender, text }) => {
            const box = document.getElementById('chat-messages');
            const msg = document.createElement('div');
            msg.className = 'msg' + (sender.includes('SYSTEM') ? ' system' : '');
            msg.innerText = '[' + sender + '] ' + text;
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
    console.log(` Poki Party v1.9.1 Release Server Running!`);
    console.log(` Server running on Port: ${PORT}`);
    console.log(`=================================================`);
});
