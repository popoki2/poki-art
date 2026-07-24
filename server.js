const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ==========================================
// 🎯 제시어 데이터베이스 (자유롭게 추가/수정 가능)
// ==========================================
const wordDatabase = {
    all: [],
    food: ["떡볶이", "초밥", "마라탕", "붕어빵", "파스타", "짜장면", "탕수육", "치킨", "피자", "삼겹살", "라면", "돈까스"],
    anime: ["피카츄", "도라에몽", "하츠네미쿠", "귀멸의칼날", "원피스", "슬램덩크", "건담", "짱구", "보노보노", "아냐"],
    daily: ["시계", "세탁기", "스마트폰", "안경", "우산", "자전거", "냉장고", "선풍기", "지갑", "휴지", "노트북"],
    meme: ["중꺾마", "너T야", "폼미쳤다", "어쩔티비", "무야호", "민초파", "핑구", "몰루", "테츠야"]
};
wordDatabase.all = [...wordDatabase.food, ...wordDatabase.anime, ...wordDatabase.daily, ...wordDatabase.meme];

// 상태 관리
const lobbyUsers = {};
const rooms = {};
let roomCounter = 500;

app.get('*', (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(getHTMLContent());
});

io.on('connection', (socket) => {
    let currentUser = { id: socket.id, name: '무명포키', roomId: null };

    // 로비 접속
    socket.on('joinLobby', ({ name }) => {
        currentUser.name = name || '무명포키';
        lobbyUsers[socket.id] = currentUser;
        
        io.emit('updateLobbyUsers', Object.values(lobbyUsers));
        socket.emit('updateRoomList', getPublicRoomList());
    });

    // 로비 채팅
    socket.on('lobbyChat', (msg) => {
        io.emit('lobbyChat', { sender: currentUser.name, text: msg });
    });

    // 방 생성
    socket.on('createRoom', (roomConfig) => {
        roomCounter++;
        const roomId = 'ROOM_' + roomCounter;
        
        rooms[roomId] = {
            id: roomId,
            roomNum: roomCounter,
            title: roomConfig.title || `${currentUser.name}님의 방`,
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
            maxRounds: 3
        };

        socket.emit('roomCreated', { roomId, password: roomConfig.password });
        io.emit('updateRoomList', getPublicRoomList());
    });

    // 방 입장
    socket.on('joinRoom', ({ roomId, password }) => {
        const room = rooms[roomId];
        if (!room) {
            socket.emit('joinError', '존재하지 않는 방입니다.');
            return;
        }
        if (room.password && room.password !== password) {
            socket.emit('joinError', '비밀번호가 일치하지 않습니다!');
            return;
        }
        if (room.players.length >= room.maxPlayers) {
            socket.emit('joinError', '방 인원이 가득 찼습니다.');
            return;
        }

        // 로비에서 제거 후 방 추가
        delete lobbyUsers[socket.id];
        io.emit('updateLobbyUsers', Object.values(lobbyUsers));

        currentUser.roomId = roomId;
        socket.join(roomId);

        const player = { id: socket.id, name: currentUser.name, score: 0 };
        room.players.push(player);

        socket.emit('roomJoined', room);
        io.to(roomId).emit('updatePlayers', room.players);
        io.to(roomId).emit('chatMessage', { sender: 'SYSTEM', text: `${currentUser.name} 님이 입장하셨습니다!` });
        io.emit('updateRoomList', getPublicRoomList());

        // 2명 이상 접속 시 자동 게임 시작
        if (room.players.length >= 2 && !room.isPlaying) {
            startGame(roomId);
        }
    });

    // 방 퇴장 (로비로 복귀)
    socket.on('leaveRoom', () => {
        leaveCurrentRoom(socket);
    });

    // 캔버스 이벤트들
    socket.on('draw', (data) => {
        if (currentUser.roomId) socket.to(currentUser.roomId).emit('draw', data);
    });
    socket.on('clearCanvas', () => {
        if (currentUser.roomId) io.to(currentUser.roomId).emit('clearCanvas');
    });
    socket.on('fillCanvas', (color) => {
        if (currentUser.roomId) io.to(currentUser.roomId).emit('fillCanvas', color);
    });

    // 인게임 채팅 및 정답 판정
    socket.on('chatMessage', (msg) => {
        const roomId = currentUser.roomId;
        if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];
        const drawer = room.players[room.drawerIndex];

        // 출제자 채팅 금지
        if (room.isPlaying && drawer && drawer.id === socket.id) {
            socket.emit('chatMessage', { sender: 'SYSTEM', text: '❌ 출제 중에는 정답 스포일러 방지를 위해 채팅을 입력할 수 없습니다.' });
            return;
        }

        // 정답 판정
        if (room.isPlaying && msg.trim() === room.currentWord) {
            const player = room.players.find(p => p.id === socket.id);
            if (player) {
                player.score += 150;
                if (drawer) drawer.score += 50;

                io.to(roomId).emit('updatePlayers', room.players);
                // 화면 중앙 팝업 연출 이벤트 전송
                io.to(roomId).emit('correctAnswerOverlay', { winner: currentUser.name, word: room.currentWord });
                io.to(roomId).emit('chatMessage', { 
                    sender: 'SYSTEM', 
                    text: `🎉 [정답!] ${currentUser.name} 님이 정답(${room.currentWord})을 맞히셨습니다! (+150pt)` 
                });
                nextTurn(roomId);
            }
        } else {
            io.to(roomId).emit('chatMessage', { sender: currentUser.name, text: msg });
        }
    });

    socket.on('disconnect', () => {
        delete lobbyUsers[socket.id];
        io.emit('updateLobbyUsers', Object.values(lobbyUsers));
        leaveCurrentRoom(socket);
    });
});

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

function getChosung(str) {
    const cho = ["ㄱ","ㄲ","ㄴ","ㄷ","ㄸ","ㄹ","ㅁ","ㅂ","ㅃ","ㅅ","ㅆ","ㅇ","ㅈ","ㅉ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];
    let result = "";
    for (let i = 0; i < str.length; i++) {
        const code = str.charCodeAt(i) - 44032;
        if (code >= 0 && code <= 11172) {
            result += cho[Math.floor(code / 588)];
        } else {
            result += str[i];
        }
    }
    return result;
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
    room.drawerIndex++;

    if (room.drawerIndex >= room.players.length) {
        room.drawerIndex = 0;
        room.currentRound++;
    }

    if (room.currentRound > room.maxRounds) {
        room.isPlaying = false;
        const sorted = [...room.players].sort((a, b) => b.score - a.score);
        io.to(roomId).emit('gameOver', sorted);
        return;
    }

    const drawer = room.players[room.drawerIndex];
    const categoryList = wordDatabase[room.category] || wordDatabase.all;
    room.currentWord = categoryList[Math.floor(Math.random() * categoryList.length)];
    room.timeLeft = room.roundTime;

    io.to(roomId).emit('clearCanvas');

    // 글자 수 힌트 표기 생성 (예: "떡볶이" -> "_ _ _")
    const lengthHint = "_ ".repeat(room.currentWord.length).trim();

    room.players.forEach(p => {
        const isDrawer = (p.id === drawer.id);
        io.to(p.id).emit('turnStart', { 
            isDrawer, 
            word: isDrawer ? room.currentWord : lengthHint, 
            drawerName: drawer.name,
            round: room.currentRound,
            maxRounds: room.maxRounds,
            length: room.currentWord.length
        });
    });

    room.timer = setInterval(() => {
        room.timeLeft--;
        io.to(roomId).emit('timerUpdate', room.timeLeft);

        if (room.timeLeft === Math.floor(room.roundTime / 2)) {
            const chosung = getChosung(room.currentWord);
            io.to(roomId).emit('chatMessage', { sender: 'SYSTEM 💡 힌트', text: `초성 힌트: [ ${chosung} ]` });
        }

        if (room.timeLeft <= 0) {
            clearInterval(room.timer);
            io.to(roomId).emit('chatMessage', { sender: 'SYSTEM', text: `⏰ 시간 초과! 정답은 [ ${room.currentWord} ] 이었습니다.` });
            setTimeout(() => nextTurn(roomId), 2500);
        }
    }, 1000);
}

function getHTMLContent() {
    return `<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ポキアト！！ (Poki Art)</title>
    <script src="/socket.io/socket.io.js"></script>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=DungGeunMo&family=Noto+Sans+KR:wght@500;700;900&display=swap');
        
        * { box-sizing: border-box; font-family: 'Noto Sans KR', sans-serif; user-select: none; }
        
        /* 🎀 니디걸(NEEDY GIRL) 감성의 밝은 파스텔 도트 테마 */
        body {
            margin: 0; padding: 10px;
            background: #fce4ec;
            background-image: 
                radial-gradient(#f8bbd0 15%, transparent 16%),
                radial-gradient(#f8bbd0 15%, transparent 16%);
            background-size: 20px 20px;
            background-position: 0 0, 10px 10px;
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

        /* 🔴 1. 로비 화면 레이아웃 (첫번째 사진 반영) */
        #lobby-screen { width: 100%; max-width: 1000px; display: flex; flex-direction: column; gap: 10px; }
        #lobby-main { display: flex; gap: 10px; height: 420px; }
        
        #lobby-left { width: 220px; display: flex; flex-direction: column; gap: 10px; }
        #user-list-box { flex: 1; overflow-y: auto; padding: 8px; background: #fff0f5; }
        .user-item { padding: 4px 8px; font-size: 13px; font-weight: bold; color: #880e4f; border-bottom: 1px dashed #f8bbd0; }
        
        #my-profile { padding: 10px; background: #f3e5f5; display: flex; align-items: center; gap: 10px; }
        
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
        
        /* 끄투식 방 카드 디자인 */
        .room-card {
            background: #fff5f8; border: 2px solid #ea80fc; border-radius: 6px; padding: 10px;
            display: flex; flex-direction: column; justify-content: space-between; cursor: pointer;
            box-shadow: 3px 3px 0 #ce93d8; transition: transform 0.1s;
        }
        .room-card:hover { transform: translateY(-2px); background: #f3e5f5; }
        .room-title { font-weight: 900; font-size: 15px; color: #4a148c; display: flex; justify-content: space-between; }
        .room-info { font-size: 12px; color: #ad1457; font-weight: bold; }

        #lobby-bottom { height: 160px; display: flex; flex-direction: column; }
        #lobby-chat { flex: 1; background: #fafafa; overflow-y: auto; padding: 8px; font-size: 13px; }

        /* 🟣 2. 방 만들기 모달 (두번째 사진 반영) */
        .modal {
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            background: rgba(74, 20, 140, 0.4); display: flex; justify-content: center; align-items: center; z-index: 999;
        }
        .modal-body { width: 340px; padding: 15px; background: #fff; display: flex; flex-direction: column; gap: 10px; }
        .form-group { display: flex; justify-content: space-between; align-items: center; font-size: 13px; font-weight: bold; }
        input[type="text"], input[type="password"], select {
            border: 2px solid #f06292; border-radius: 4px; padding: 5px; font-weight: bold; outline: none; background: #fff;
        }

        /* 🎨 3. 게임 화면 (세번째 사진 리뉴얼) */
        #game-screen { width: 100%; max-width: 1000px; display: none; flex-direction: column; gap: 8px; }
        #game-header { display: flex; justify-content: space-between; align-items: center; padding: 6px 14px; }
        
        .word-hint-box {
            background: #fff; border: 2px solid #ff4081; padding: 4px 16px; border-radius: 20px;
            color: #d81b60; font-size: 20px; font-weight: 900; letter-spacing: 4px; font-family: 'DungGeunMo';
            box-shadow: 2px 2px 0 #f8bbd0;
        }

        #game-main { display: flex; gap: 10px; }
        #game-players { width: 200px; padding: 6px; background: #fff0f5; }
        .player-card {
            background: #fff; border: 2px solid #ea80fc; padding: 6px; margin-bottom: 6px;
            border-radius: 6px; display: flex; justify-content: space-between; font-weight: bold; font-size: 13px;
        }

        #canvas-container { flex: 1; display: flex; flex-direction: column; align-items: center; }
        canvas { background: #ffffff; border: 3px solid #ff80ab; border-radius: 8px; cursor: crosshair; box-shadow: 4px 4px 0 #ea80fc; }
        
        #toolbar {
            width: 100%; margin-top: 6px; display: flex; justify-content: space-between; align-items: center;
            background: #fff; border: 2px solid #f06292; padding: 6px; border-radius: 6px;
        }
        .palette { display: flex; gap: 3px; max-width: 220px; flex-wrap: wrap; }
        .color-dot { width: 18px; height: 18px; border-radius: 3px; border: 1px solid #ccc; cursor: pointer; }

        .tool-btn {
            background: #f3e5f5; border: 2px solid #ab47bc; color: #4a148c; padding: 4px 8px;
            font-weight: bold; border-radius: 4px; cursor: pointer; font-size: 12px;
        }
        .tool-btn:hover { background: #e1bee7; }

        #game-chat-box { width: 250px; display: flex; flex-direction: column; }
        #game-chat { flex: 1; height: 350px; background: #fff; overflow-y: auto; padding: 6px; font-size: 12px; border: 2px solid #f06292; }

        /* 🎆 정답 화면 중앙 알림 연출 배너 */
        #answer-overlay {
            position: absolute; top: 40%; left: 50%; transform: translate(-50%, -50%);
            background: linear-gradient(135deg, #ff4081, #aa00ff); color: #fff; padding: 15px 30px;
            font-size: 24px; font-weight: 900; font-family: 'DungGeunMo'; border: 4px solid #fff;
            border-radius: 12px; box-shadow: 0 0 20px rgba(255, 64, 129, 0.8); display: none; z-index: 100;
            animation: popIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        }
        @keyframes popIn { 0% { transform: translate(-50%, -50%) scale(0.5); } 100% { transform: translate(-50%, -50%) scale(1); } }

        button { cursor: pointer; }
    </style>
</head>
<body>

    <!-- 닉네임 입력 대기 모달 -->
    <div id="nickname-modal" class="modal">
        <div class="pixel-box modal-body">
            <div class="window-header">ポキアト！！ 로비 접속</div>
            <p style="font-size:13px; font-weight:bold; color:#880e4f; text-align:center;">사용할 닉네임을 입력해 주세요!</p>
            <input type="text" id="nickname-input" value="포키가이" placeholder="닉네임..." style="text-align:center;">
            <button class="tool-btn" onclick="enterLobby()" style="background:#ff80ab; color:#fff; padding:8px;">로비 입장하기 💖</button>
        </div>
    </div>

    <!-- 📌 1. 로비 화면 -->
    <div id="lobby-screen">
        <div class="pixel-box window-header">
            <span>ポキアト！！ (Poki Art) Lobby</span>
            <button class="tool-btn" onclick="leaveToNickname()" style="font-size:10px;">닉네임 변경</button>
        </div>

        <div id="lobby-main">
            <!-- 좌측: 유저 리스트 & 프로필 -->
            <div id="lobby-left">
                <div class="pixel-box" style="flex:1; display:flex; flex-direction:column;">
                    <div class="window-header" style="font-size:11px;">👥 접속자 목록</div>
                    <div id="user-list-box"></div>
                </div>
                <div class="pixel-box" id="my-profile">
                    <div style="font-size:24px;">🎀</div>
                    <div>
                        <div id="my-name-display" style="font-weight:900; font-size:14px; color:#880e4f;">포키가이</div>
                        <div style="font-size:11px; color:#ad1457;">온라인 대기 중</div>
                    </div>
                </div>
            </div>

            <!-- 중앙: 방 목록 및 만들기 탭 -->
            <div id="lobby-center">
                <div id="category-bar">
                    <button class="tab-btn" onclick="openCreateRoomModal()">➕ 방 만들기</button>
                    <button class="tab-btn" style="background:#ba68c8; border-color:#7b1fa2;" onclick="quickJoin()">⚡ 빠른 입장</button>
                </div>
                <div class="pixel-box" id="room-grid"></div>
            </div>
        </div>

        <!-- 하단: 로비 채팅 -->
        <div class="pixel-box" id="lobby-bottom">
            <div class="window-header" style="font-size:11px;">💬 로비 전체 채팅</div>
            <div id="lobby-chat"></div>
            <div style="display:flex; padding:4px; gap:4px; background:#fff;">
                <input type="text" id="lobby-chat-input" placeholder="로비 메시지 입력..." style="flex:1;" onkeypress="if(event.key==='Enter') sendLobbyChat()">
                <button class="tool-btn" onclick="sendLobbyChat()">전송</button>
            </div>
        </div>
    </div>

    <!-- 📌 2. 방 만들기 모달 -->
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
                    <option value="all">🎨 전체 (랜덤)</option>
                    <option value="food">🍕 맛있는 음식</option>
                    <option value="anime">⚡ 애니 / 게임</option>
                    <option value="daily">🏠 일상 용품</option>
                    <option value="meme">🔥 유행어 / 밈</option>
                </select>
            </div>
            <div style="display:flex; gap:6px; margin-top:8px;">
                <button class="tool-btn" onclick="submitCreateRoom()" style="flex:1; background:#ff80ab; color:#fff;">확인</button>
                <button class="tool-btn" onclick="closeCreateRoomModal()" style="flex:1; background:#ccc;">취소</button>
            </div>
        </div>
    </div>

    <!-- 📌 3. 게임 화면 -->
    <div id="game-screen">
        <div class="pixel-box" id="game-header">
            <span style="font-weight:bold; font-size:14px; color:#880e4f;" id="game-room-title">방 제목</span>
            <span>ROUND <span id="round-disp" style="color:#d81b60; font-weight:900;">1</span>/3</span>
            <span>⏰ <span id="timer-disp" style="color:#d81b60; font-weight:900;">60</span>s</span>
            <div class="word-hint-box" id="word-disp">_ _ _</div>
            <button class="tool-btn" onclick="leaveRoom()" style="background:#ef5350; color:#fff;">나가기</button>
        </div>

        <div id="game-main">
            <!-- 왼쪽: 유저 목록 -->
            <div class="pixel-box" id="game-players">
                <div class="window-header" style="font-size:11px;">PLAYERS</div>
                <div id="game-player-list" style="margin-top:6px;"></div>
            </div>

            <!-- 중앙: 캔버스 및 정교한 툴바 -->
            <div id="canvas-container">
                <div style="position:relative;">
                    <canvas id="canvas" width="500" height="380"></canvas>
                    <div id="answer-overlay">🎉 [정답!] <span id="winner-name"></span> 님!</div>
                </div>
                
                <div id="toolbar">
                    <div class="palette" id="palette"></div>
                    <div style="display:flex; gap:4px; align-items:center;">
                        <button class="tool-btn" onclick="setPenWidth(2)">•</button>
                        <button class="tool-btn" onclick="setPenWidth(6)">●</button>
                        <button class="tool-btn" onclick="setPenWidth(14)">🔴</button>
                        <button class="tool-btn" onclick="setPenWidth(28)">██</button>
                        <button class="tool-btn" onclick="fillBucket()" title="모두 채우기">🪣</button>
                        <button class="tool-btn" onclick="useEraser()" title="지우개">🧹</button>
                        <button class="tool-btn" onclick="clearCanvas()" title="전체 지우기" style="background:#ffebee;">❌</button>
                    </div>
                </div>
            </div>

            <!-- 오른쪽: 인게임 채팅 -->
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
        let myName = '';
        let isDrawer = false;
        let currentColor = '#000000';
        let currentWidth = 6;
        let isDrawing = false;
        let currentRoomList = [];

        // 캔버스 초기화
        const canvas = document.getElementById('canvas');
        const ctx = canvas.getContext('2d');

        const colors = [
            '#000000', '#ffffff', '#ff4081', '#aa00ff', '#3d5aff', '#00e5ff', 
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

        // ------------------ 로비 제어 ------------------
        function enterLobby() {
            myName = document.getElementById('nickname-input').value.trim() || '포키가이';
            document.getElementById('my-name-display').innerText = myName;
            document.getElementById('nickname-modal').style.display = 'none';
            socket.emit('joinLobby', { name: myName });
        }

        function leaveToNickname() {
            location.reload();
        }

        socket.on('updateLobbyUsers', (users) => {
            const box = document.getElementById('user-list-box');
            box.innerHTML = '';
            users.forEach(u => {
                const item = document.createElement('div');
                item.className = 'user-item';
                item.innerText = '🌸 ' + u.name;
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
                    <div class="room-title">
                        <span>#\${r.roomNum} \${r.title}</span>
                        <span>\${r.isLocked ? '🔒' : '🔓'}</span>
                    </div>
                    <div class="room-info">
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

        // ------------------ 방 생성 및 입장 ------------------
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
                alert('입장 가능한 공개 방이 없습니다. 방을 만들어 보세요!');
            }
        }

        socket.on('roomJoined', (room) => {
            document.getElementById('lobby-screen').style.display = 'none';
            document.getElementById('game-screen').style.display = 'flex';
            document.getElementById('game-room-title').innerText = room.title;
        });

        socket.on('joinError', (msg) => alert(msg));

        function leaveRoom() {
            socket.emit('leaveRoom');
            document.getElementById('game-screen').style.display = 'none';
            document.getElementById('lobby-screen').style.display = 'flex';
            socket.emit('joinLobby', { name: myName });
        }

        // ------------------ 인게임 제어 ------------------
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

            if (isDrawer) {
                chatInput.disabled = true;
                chatBtn.disabled = true;
                chatInput.placeholder = "🎨 지금은 그림을 그리는 중입니다...";
            } else {
                chatInput.disabled = false;
                chatBtn.disabled = false;
                chatInput.placeholder = "정답 입력...";
            }
        });

        socket.on('timerUpdate', (time) => {
            document.getElementById('timer-disp').innerText = time;
        });

        // 📌 화면 중앙 정답 오버레이 연출
        socket.on('correctAnswerOverlay', (data) => {
            const overlay = document.getElementById('answer-overlay');
            document.getElementById('winner-name').innerText = data.winner;
            overlay.style.display = 'block';
            setTimeout(() => { overlay.style.display = 'none'; }, 2200);
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
            alert(\`🏆 게임 종료! 1위: \${rankings[0].name} (\${rankings[0].score}점)\`);
        });
    </script>
</body>
</html>`;
}

server.listen(PORT, () => {
    console.log(`=================================================`);
    console.log(` Poki Art (니디걸 픽셀 로비 버전) 서버 가동 완료!`);
    console.log(`=================================================`);
});
