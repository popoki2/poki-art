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
// 🎯 [제시어 관리자 코너] 여기서 자유롭게 단어를 추가/수정하세요!
// ==========================================
const wordDatabase = {
    all: [], // 전체 통합 카테고리 (자동 생성)
    food: ["떡볶이", "초밥", "마라탕", "붕어빵", "파스타", "짜장면", "탕수육", "치킨", "피자", "삼겹살", "라면", "돈까스"],
    anime: ["피카츄", "도라에몽", "하츠네미쿠", "귀멸의칼날", "원피스", "슬램덩크", "건담", "짱구", "보노보노", "아냐"],
    daily: ["시계", "세탁기", "스마트폰", "안경", "우산", "자전거", "냉장고", "선풍기", "지갑", "휴지", "노트북"],
    meme: ["중꺾마", "너T야", "폼미쳤다", "어쩔티비", "무야호", "민초파", "핑구", "몰루", "이용재"]
};
// 전체 카테고리 데이터 합치기
wordDatabase.all = [...wordDatabase.food, ...wordDatabase.anime, ...wordDatabase.daily, ...wordDatabase.meme];

const rooms = {};

// 모든 요청에 대해 웹 앱 전송
app.get('*', (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(getHTMLContent());
});

io.on('connection', (socket) => {
    let currentRoom = null;
    let username = '';

    socket.on('joinRoom', ({ roomId, name, category, avatar }) => {
        currentRoom = roomId || 'POKI_ROOM';
        username = name || '무명포키';

        socket.join(currentRoom);

        if (!rooms[currentRoom]) {
            rooms[currentRoom] = {
                id: currentRoom,
                category: category || 'all',
                players: [],
                drawerIndex: -1,
                currentWord: '',
                timer: null,
                timeLeft: 60,
                isPlaying: false,
                currentRound: 0,
                maxRounds: 3
            };
        }

        const room = rooms[currentRoom];
        const player = { id: socket.id, name: username, score: 0, avatar: avatar || { bg: '#ff007f', face: '◕‿◕' } };
        room.players.push(player);

        io.to(currentRoom).emit('updatePlayers', room.players);
        io.to(currentRoom).emit('chatMessage', { sender: 'SYSTEM', text: `${username} 님이 입장하셨습니다! ♡` });

        // 2명 이상이고 게임 미진행 중이면 게임 시작
        if (room.players.length >= 2 && !room.isPlaying) {
            startGame(currentRoom);
        }
    });

    socket.on('draw', (data) => {
        if (currentRoom) {
            socket.to(currentRoom).emit('draw', data);
        }
    });

    socket.on('clearCanvas', () => {
        if (currentRoom) {
            io.to(currentRoom).emit('clearCanvas');
        }
    });

    socket.on('fillCanvas', (color) => {
        if (currentRoom) {
            io.to(currentRoom).emit('fillCanvas', color);
        }
    });

    socket.on('chatMessage', (msg) => {
        if (!currentRoom || !rooms[currentRoom]) return;
        const room = rooms[currentRoom];
        const drawer = room.players[room.drawerIndex];

        // 🛑 출제자는 채팅 금지 (정답 유출 및 자가 득점 방지)
        if (room.isPlaying && drawer && drawer.id === socket.id) {
            socket.emit('chatMessage', { sender: 'SYSTEM', text: '❌ 출제 중에는 채팅을 입력할 수 없습니다!' });
            return;
        }

        // 정답 판정
        if (room.isPlaying && msg.trim() === room.currentWord) {
            const player = room.players.find(p => p.id === socket.id);
            if (player) {
                player.score += 150;
                if (drawer) drawer.score += 50; // 출제자도 맞히면 보너스 점수

                io.to(currentRoom).emit('updatePlayers', room.players);
                io.to(currentRoom).emit('chatMessage', { 
                    sender: 'SYSTEM', 
                    text: `🎉 [정답!] ${username} 님이 정답(${room.currentWord})을 맞히셨습니다! (+150pt)` 
                });
                nextTurn(currentRoom);
            }
        } else {
            io.to(currentRoom).emit('chatMessage', { sender: username, text: msg });
        }
    });

    socket.on('disconnect', () => {
        if (currentRoom && rooms[currentRoom]) {
            const room = rooms[currentRoom];
            room.players = room.players.filter(p => p.id !== socket.id);
            io.to(currentRoom).emit('updatePlayers', room.players);
            io.to(currentRoom).emit('chatMessage', { sender: 'SYSTEM', text: `${username} 님이 퇴장하셨습니다.` });

            if (room.players.length < 2) {
                clearInterval(room.timer);
                room.isPlaying = false;
                io.to(currentRoom).emit('chatMessage', { sender: 'SYSTEM', text: '인원이 부족하여 게임이 대기 상태로 전환됩니다.' });
            }
        }
    });
});

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
    
    // 한 라운드 종료 체크
    if (room.drawerIndex >= room.players.length) {
        room.drawerIndex = 0;
        room.currentRound++;
    }

    // 설정된 총 라운드 종료 시 게임 최종 완료 (시상식)
    if (room.currentRound > room.maxRounds) {
        room.isPlaying = false;
        const sortedPlayers = [...room.players].sort((a, b) => b.score - a.score);
        io.to(roomId).emit('gameOver', sortedPlayers);
        return;
    }

    const drawer = room.players[room.drawerIndex];
    const categoryList = wordDatabase[room.category] || wordDatabase.all;
    room.currentWord = categoryList[Math.floor(Math.random() * categoryList.length)];
    room.timeLeft = 60;

    io.to(roomId).emit('clearCanvas');

    room.players.forEach(p => {
        const isDrawer = (p.id === drawer.id);
        io.to(p.id).emit('turnStart', { 
            isDrawer, 
            word: isDrawer ? room.currentWord : '???', 
            drawerName: drawer.name,
            round: room.currentRound,
            maxRounds: room.maxRounds
        });
    });

    room.timer = setInterval(() => {
        room.timeLeft--;
        io.to(roomId).emit('timerUpdate', room.timeLeft);

        if (room.timeLeft === 30) {
            const chosung = getChosung(room.currentWord);
            io.to(roomId).emit('chatMessage', { sender: 'SYSTEM 💡 힌트', text: `초성 힌트: [ ${chosung} ]` });
        }

        if (room.timeLeft <= 0) {
            clearInterval(room.timer);
            io.to(roomId).emit('chatMessage', { sender: 'SYSTEM', text: `⏰ 시간 초과! 정답은 [ ${room.currentWord} ] 이었습니다.` });
            setTimeout(() => nextTurn(roomId), 3000);
        }
    }, 1000);
}

function getHTMLContent() {
    return `<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ポキアト！！ (poki art ! !)</title>
    <script src="/socket.io/socket.io.js"></script>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@500;700;900&display=swap');
        * { box-sizing: border-box; font-family: 'Noto Sans KR', '맑은 고딕', sans-serif; user-select: none; }
        body {
            margin: 0; padding: 15px;
            background: #120323;
            background-image: linear-gradient(0deg, rgba(255, 0, 128, 0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 0, 128, 0.1) 1px, transparent 1px);
            background-size: 24px 24px;
            color: #fff; display: flex; flex-direction: column; align-items: center; min-height: 100vh;
        }
        .window {
            background: #220738; border: 2px solid #ff007f;
            box-shadow: 0 0 14px rgba(255, 0, 128, 0.6), inset 0 0 10px rgba(0,255,255,0.2);
            border-radius: 10px; margin: 4px; overflow: hidden;
        }
        .window-header {
            background: linear-gradient(90deg, #ff007f, #7928ca);
            padding: 8px 14px; font-weight: 700; display: flex; justify-content: space-between; align-items: center;
            text-shadow: 0 0 4px rgba(0,0,0,0.6);
        }
        .window-body { padding: 10px; }
        
        #top-bar { width: 100%; max-width: 1050px; }
        .logo { font-size: 22px; font-weight: 900; color: #00ffff; text-shadow: 0 0 10px #00ffff; }
        
        /* 📌 1. 제시어 눈에 띄게 시선 집중 */
        .word-box {
            background: #000; border: 2px solid #00ffff; padding: 4px 16px; border-radius: 20px;
            color: #ffff00; font-size: 22px; font-weight: 900; text-shadow: 0 0 8px #ffff00;
        }

        #main-container { width: 100%; max-width: 1050px; display: flex; gap: 10px; margin-top: 8px; }
        #left-panel { width: 220px; }
        #center-panel { flex: 1; display: flex; flex-direction: column; align-items: center; }
        #right-panel { width: 270px; }
        
        .player-card {
            background: #120224; border: 1px solid #00ffff; padding: 6px 10px; margin-bottom: 6px;
            border-radius: 6px; display: flex; align-items: center; gap: 8px;
            box-shadow: 0 0 6px rgba(0,255,255,0.3);
        }
        .avatar-icon {
            width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center;
            justify-content: center; font-size: 11px; font-weight: bold; color: #fff; border: 1px solid #fff;
        }

        canvas {
            background: #ffffff; border: 3px solid #00ffff; border-radius: 8px;
            box-shadow: 0 0 18px rgba(0, 255, 255, 0.4); cursor: crosshair; touch-action: none;
        }

        #toolbar {
            width: 100%; margin-top: 8px; display: flex; justify-content: space-between; align-items: center;
            background: #1a032d; border: 1px solid #ff007f; padding: 8px; border-radius: 8px;
        }
        .color-palette { display: flex; gap: 4px; flex-wrap: wrap; max-width: 250px; }
        .color-btn { width: 20px; height: 20px; border-radius: 4px; border: 1px solid #fff; cursor: pointer; }
        
        #chat-messages {
            height: 380px; background: #0a0114; border: 1px solid #ff007f; padding: 8px;
            overflow-y: auto; font-size: 13px; display: flex; flex-direction: column; gap: 4px; border-radius: 6px;
        }
        .chat-input-box { display: flex; gap: 4px; margin-top: 6px; }
        input[type="text"], select {
            background: #080010; border: 1px solid #00ffff; color: #00ffff; padding: 8px;
            border-radius: 6px; outline: none; font-weight: bold;
        }
        button {
            background: linear-gradient(180deg, #ff007f, #b30059); border: none; color: #fff;
            padding: 8px 12px; border-radius: 6px; cursor: pointer; font-weight: bold;
            box-shadow: 0 0 8px #ff007f; transition: 0.1s;
        }
        button:hover { filter: brightness(1.2); transform: scale(1.02); }
        button:disabled { background: #444; box-shadow: none; cursor: not-allowed; }

        .modal {
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            background: rgba(0,0,0,0.85); display: flex; justify-content: center; align-items: center; z-index: 999;
        }
        .modal-content { width: 360px; text-align: center; }
    </style>
</head>
<body>

    <!-- 📌 7. 바보 커스텀 아바타 & 방 카테고리 입장 모달 -->
    <div id="join-modal" class="modal">
        <div class="window modal-content">
            <div class="window-header">ポキアト！！ 로비 입장 ♡</div>
            <div class="window-body" style="display:flex; flex-direction:column; gap:10px;">
                <!-- 아바타 커스텀 미리보기 -->
                <div style="display:flex; justify-content:center; align-items:center; gap:10px;">
                    <div id="avatar-preview" class="avatar-icon" style="width:50px; height:50px; font-size:16px;">(◕‿◕)</div>
                    <div style="display:flex; flex-direction:column; gap:4px;">
                        <button onclick="changeAvatarFace()">표정 변경 🤪</button>
                        <button onclick="changeAvatarBg()">색상 변경 🎨</button>
                    </div>
                </div>

                <input type="text" id="username-input" placeholder="닉네임 입력..." value="포키가이">
                <input type="text" id="room-input" placeholder="방 코드 (예: POKI1)" value="POKI1">
                
                <select id="category-select">
                    <option value="all">🎨 전체 카테고리</option>
                    <option value="food">🍕 맛있는 음식</option>
                    <option value="anime">⚡ 애니 / 게임</option>
                    <option value="daily">🏠 일상 용품</option>
                    <option value="meme">🔥 유행어 / 밈</option>
                </select>

                <button onclick="joinGame()" style="width:100%; margin-top:6px; font-size:16px;">게임 접속하기 🚀</button>
            </div>
        </div>
    </div>

    <!-- 📌 6. 최종 시상식 / 순위 결과 모달 -->
    <div id="game-over-modal" class="modal" style="display:none;">
        <div class="window modal-content" style="width:400px;">
            <div class="window-header">🏆 최종 순위 발표 🏆</div>
            <div class="window-body">
                <div id="rankings-list" style="display:flex; flex-direction:column; gap:8px; margin-bottom:12px;"></div>
                <button onclick="location.reload()" style="width:100%;">다시 하기 🔄</button>
            </div>
        </div>
    </div>

    <!-- 상단 대시보드 -->
    <div id="top-bar" class="window">
        <div class="window-header">
            <span class="logo">ポキアト！！</span>
            <span>ROUND <span id="round-display" style="color:#00ffff;">1</span>/<span id="max-round-display">3</span></span>
            <span>⏰ <span id="timer" style="color:#00ffff;">60</span>s</span>
            <div class="word-box">제시어: <span id="word-display">대기 중...</span></div>
        </div>
    </div>

    <!-- 메인 컨테이너 -->
    <div id="main-container">
        <!-- 왼쪽: 유저 목록 -->
        <div id="left-panel" class="window">
            <div class="window-header">♥ PLAYERS</div>
            <div class="window-body" id="player-list"></div>
        </div>

        <!-- 중앙: 캔버스 및 툴바 -->
        <div id="center-panel">
            <div class="window" style="padding: 6px;">
                <canvas id="canvas" width="520" height="400"></canvas>
            </div>
            
            <div id="toolbar">
                <div class="color-palette" id="palette"></div>
                <!-- 📌 3. 굵기 옵션 강화 및 전체 채우기 버튼 -->
                <div style="display:flex; gap:4px; align-items:center;">
                    <button onclick="setPenWidth(2)" title="얇게">•</button>
                    <button onclick="setPenWidth(6)" title="보통">●</button>
                    <button onclick="setPenWidth(14)" title="굵게">🔴</button>
                    <button onclick="setPenWidth(30)" title="왕붓">██</button>
                    <button onclick="fillBucket()" style="background:#7928ca;">🪣 채우기</button>
                    <button onclick="useEraser()" style="background:#444;">지우개</button>
                    <button onclick="clearCanvas()" style="background:#d32f2f;">지우기</button>
                </div>
            </div>
        </div>

        <!-- 오른쪽: 채팅 / 정답 입력창 -->
        <div id="right-panel" class="window">
            <div class="window-header">♥ CHAT & ANSWER</div>
            <div class="window-body">
                <div id="chat-messages"></div>
                <div class="chat-input-box">
                    <input type="text" id="chat-input" placeholder="정답 또는 채팅..." onkeypress="if(event.key==='Enter') sendChat()">
                    <button id="send-btn" onclick="sendChat()">전송</button>
                </div>
            </div>
        </div>
    </div>

    <script>
        const socket = io();
        let isDrawer = false;
        let currentColor = '#000000';
        let currentWidth = 6;
        let isDrawing = false;

        // 아바타 커스텀 데이터
        const faces = ['(◕‿◕)', '(˚Δ˚)', '(x_x)', '(•̀ᴗ•́)', '(qwq)', '(;¬_¬)', '(•ω•)'];
        const avatarBgs = ['#ff007f', '#00ffff', '#7928ca', '#4caf50', '#ffeb3b', '#ff7700'];
        let currentFaceIdx = 0;
        let currentBgIdx = 0;

        function changeAvatarFace() {
            currentFaceIdx = (currentFaceIdx + 1) % faces.length;
            updateAvatarPreview();
        }
        function changeAvatarBg() {
            currentBgIdx = (currentBgIdx + 1) % avatarBgs.length;
            updateAvatarPreview();
        }
        function updateAvatarPreview() {
            const preview = document.getElementById('avatar-preview');
            preview.innerText = faces[currentFaceIdx];
            preview.style.background = avatarBgs[currentBgIdx];
        }

        const canvas = document.getElementById('canvas');
        const ctx = canvas.getContext('2d');

        const colors = [
            '#000000', '#ffffff', '#ff007f', '#00ffff', '#7928ca', '#ff0000', 
            '#ff7700', '#ffeb3b', '#4caf50', '#2196f3', '#9c27b0', '#e91e63',
            '#ffb6c1', '#a8e6cf', '#dcedc1', '#ffd3b6', '#ff8b94', '#845ec2'
        ];
        const paletteContainer = document.getElementById('palette');
        colors.forEach(c => {
            const btn = document.createElement('div');
            btn.className = 'color-btn';
            btn.style.background = c;
            btn.onclick = () => { currentColor = c; };
            paletteContainer.appendChild(btn);
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
        
        // 📌 모두 채우기 (Bucket Fill)
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

        socket.on('updatePlayers', (players) => {
            const list = document.getElementById('player-list');
            list.innerHTML = '';
            players.forEach(p => {
                const card = document.createElement('div');
                card.className = 'player-card';
                card.innerHTML = \`
                    <div class="avatar-icon" style="background:\${p.avatar.bg};">\${p.avatar.face}</div>
                    <div style="flex:1;">
                        <div style="font-weight:bold; font-size:13px;">\${p.name}</div>
                        <div style="color:#00ffff; font-size:12px;">\${p.score} pt</div>
                    </div>
                \`;
                list.appendChild(card);
            });
        });

        socket.on('turnStart', (data) => {
            isDrawer = data.isDrawer;
            document.getElementById('word-display').innerText = data.word;
            document.getElementById('round-display').innerText = data.round;
            document.getElementById('max-round-display').innerText = data.maxRounds;

            // 📌 4. 출제자는 채팅 금지 처리
            const chatInput = document.getElementById('chat-input');
            const sendBtn = document.getElementById('send-btn');
            if (isDrawer) {
                chatInput.disabled = true;
                sendBtn.disabled = true;
                chatInput.placeholder = "🎨 지금은 그림을 그리는 중입니다...";
            } else {
                chatInput.disabled = false;
                sendBtn.disabled = false;
                chatInput.placeholder = "정답 또는 채팅 입력...";
            }

            addChatMessage({ sender: 'SYSTEM', text: \`🎨 [출제자]: \${data.drawerName} 님의 턴입니다!\` });
        });

        socket.on('timerUpdate', (time) => {
            document.getElementById('timer').innerText = time;
        });

        socket.on('chatMessage', (data) => addChatMessage(data));

        // 📌 6. 게임 종료 시 최종 순위 모달 띄우기
        socket.on('gameOver', (rankings) => {
            const modal = document.getElementById('game-over-modal');
            const list = document.getElementById('rankings-list');
            list.innerHTML = '';
            
            rankings.forEach((p, idx) => {
                const item = document.createElement('div');
                item.className = 'player-card';
                item.style.border = idx === 0 ? '2px solid #ffff00' : '1px solid #00ffff';
                item.innerHTML = \`
                    <span style="font-size:18px; font-weight:bold; width:30px;">\${idx + 1}위</span>
                    <div class="avatar-icon" style="background:\${p.avatar.bg};">\${p.avatar.face}</div>
                    <span style="flex:1; font-weight:bold;">\${p.name}</span>
                    <span style="color:#ffff00; font-weight:bold;">\${p.score} 점</span>
                \`;
                list.appendChild(item);
            });

            modal.style.display = 'flex';
        });

        function addChatMessage(data) {
            const box = document.getElementById('chat-messages');
            const msg = document.createElement('div');
            if (data.sender === 'SYSTEM' || data.sender.includes('SYSTEM')) {
                msg.style.color = '#ff007f';
                msg.style.fontWeight = 'bold';
            } else {
                msg.style.color = '#00ffff';
            }
            msg.innerText = \`[\${data.sender}]: \${data.text}\`;
            box.appendChild(msg);
            box.scrollTop = box.scrollHeight;
        }

        function sendChat() {
            const input = document.getElementById('chat-input');
            if (input.value.trim() !== '') {
                socket.emit('chatMessage', input.value.trim());
                input.value = '';
            }
        }

        function joinGame() {
            const name = document.getElementById('username-input').value.trim();
            const roomId = document.getElementById('room-input').value.trim();
            const category = document.getElementById('category-select').value;
            const avatar = { bg: avatarBgs[currentBgIdx], face: faces[currentFaceIdx] };

            if (name) {
                socket.emit('joinRoom', { roomId, name, category, avatar });
                document.getElementById('join-modal').style.display = 'none';
            }
        }
    </script>
</body>
</html>`;
}

server.listen(PORT, () => {
    console.log(`=================================================`);
    console.log(` ポキアト！！ (poki art ! !) 최종 배포 서버 가동 완료!`);
    console.log(`=================================================`);
});
